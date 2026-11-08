/**
 * Synthetic pit terrain around a blast (display only; the movement heuristic never reads it).
 *
 * A heightfield of absolute RL on a vertex grid aligned with the block grid, built from the
 * blast footprint (footprint.ts) in the bench-local frame (a toward the free face, b lateral):
 *
 *   - floor at the toe RL under the blast and on the open floor in front of its free face (the
 *     ground the previous cut left), stepping down one bench `FLOOR_WIDTH` m past the face;
 *   - unblasted rock at the crest RL around the blast, so its outline reads as a cut in the bench;
 *   - two upper benches behind the blast (berm, steep face, berm, steep face) with wall lines that
 *     wander along strike;
 *   - a little seeded surface roughness, never above the nominal level (so it cannot poke through
 *     blocks resting on the toe or the crest), and an irregular surveyed edge (`mask`).
 *
 * Synthetic and seeded from the model seed: same model + face → identical terrain.
 */
import { createFootprint, modelColumnMask, type FreeFace } from './footprint';
import { createSeededNoise3D, deriveSeed, fbm3 } from './rng';
import type { BlockModel, Vec2 } from './types';

/** m, target vertex spacing (rounded to a whole number of blocks). */
export const TERRAIN_SPACING_TARGET = 1.25;
/** m of open floor in front of the frontmost face before the drop to the bench below. */
export const FLOOR_WIDTH = 50;
/** m, berm between the blast's back edge and the first upper bench face, and between faces. */
export const BERM_WIDTH = 12;
/** degrees, bench face angle of the walls. */
export const FACE_ANGLE_DEG = 72;
/** m of terrain beyond the blast: behind, in front, beside. */
const REACH_BACK = 45;
const REACH_FRONT = 90;
const REACH_SIDE = 45;
/** m, maximum surface roughness depth (rock tops, floor). */
const ROUGH_ROCK = 0.35;
const ROUGH_FLOOR = 0.15;
/** m, how far the upper wall lines wander along strike. */
const WALL_WANDER = 4;

export interface PitTerrain {
  /** m, world x/y of vertex (0, 0). */
  origin: Vec2;
  /** m between vertices. */
  spacing: number;
  /** Vertices along x and y; index ix + nx·iy. */
  nx: number;
  ny: number;
  /** m, absolute RL per vertex. */
  height: Float32Array;
  /** 1 inside the surveyed area; triangles touching a 0 vertex are not drawn. */
  mask: Uint8Array;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function buildPitTerrain(model: BlockModel, face: FreeFace): PitTerrain {
  const { grid } = model;
  const fp = createFootprint(grid, modelColumnMask(model), face);
  const { frame } = fp;
  const bs = grid.blockSize[0];
  // Vertices on block corners: a whole number of vertices per block, or of blocks per vertex.
  const spacing =
    bs >= TERRAIN_SPACING_TARGET
      ? bs / Math.round(bs / TERRAIN_SPACING_TARGET)
      : bs * Math.round(TERRAIN_SPACING_TARGET / bs);
  const zToe = grid.origin[2];
  const H = grid.nz * grid.blockSize[2];
  const crest = zToe + H;
  const faceRun = H / Math.tan((FACE_ANGLE_DEG * Math.PI) / 180);

  // Terrain rectangle in the bench-local frame → world bounds → vertex grid on block corners.
  const a0 = fp.backMin - REACH_BACK;
  const a1 = fp.frontMax + REACH_FRONT;
  const b0 = fp.latMin - REACH_SIDE;
  const b1 = fp.latMax + REACH_SIDE;
  const corners = [frame.toWorld(a0, b0), frame.toWorld(a1, b0), frame.toWorld(a0, b1), frame.toWorld(a1, b1)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const [gx, gy] = grid.origin;
  const ix0 = Math.floor((Math.min(...xs) - gx) / spacing);
  const iy0 = Math.floor((Math.min(...ys) - gy) / spacing);
  const ox = gx + ix0 * spacing;
  const oy = gy + iy0 * spacing;
  const nx = Math.ceil((Math.max(...xs) - ox) / spacing) + 1;
  const ny = Math.ceil((Math.max(...ys) - oy) / spacing) + 1;

  const rough = createSeededNoise3D(deriveSeed(model.seed, 'terrain/rough'));
  const wander = createSeededNoise3D(deriveSeed(model.seed, 'terrain/walls'));
  const edge = createSeededNoise3D(deriveSeed(model.seed, 'terrain/edge'));
  const ac = (a0 + a1) / 2;
  const bc = (b0 + b1) / 2;
  const ha = (a1 - a0) / 2;
  const hb = (b1 - b0) / 2;
  const eps = 1e-3 * spacing;

  const height = new Float32Array(nx * ny);
  const mask = new Uint8Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = ox + ix * spacing;
      const y = oy + iy * spacing;
      const [a, b] = frame.toLocal(x, y);
      const n = (fbm3(rough, x / 7, y / 7, 0.5, 3) + 1) / 2; // 0..1
      let z: number;
      // A vertex on the corner of any present column is floor, so the walls rise OUTSIDE the
      // blast (one terrain cell wide) and never cut into blocks.
      const [la, lb] = frame.toLocal(x - eps, y - eps);
      const [ra, rb] = frame.toLocal(x + eps, y + eps);
      const underBlast =
        fp.contains(la, lb) || fp.contains(ra, rb) || fp.contains(la, rb) || fp.contains(ra, lb);
      if (underBlast || fp.isOpen(a, b)) {
        const drop = fp.frontMax + FLOOR_WIDTH + WALL_WANDER * (wander(b / 30, 3.1, 0) + 1);
        z = zToe - H * smoothstep(drop, drop + faceRun, a) - ROUGH_FLOOR * n;
      } else {
        const behind = fp.backMin - a; // m behind the blast's back edge
        const w1 = BERM_WIDTH + WALL_WANDER * (wander(b / 25, 0.7, 0) + 1);
        const w2 = w1 + faceRun + BERM_WIDTH + WALL_WANDER * (wander(b / 25, 5.3, 0) + 1);
        z = crest + H * (smoothstep(w1, w1 + faceRun, behind) + smoothstep(w2, w2 + faceRun, behind)) - ROUGH_ROCK * n;
      }
      height[ix + nx * iy] = z;
      // Irregular survey edge: a wobbly ellipse inside the terrain rectangle.
      const qa = (a - ac) / ha;
      const qb = (b - bc) / hb;
      const r = Math.hypot(qa, qb);
      const theta = Math.atan2(qb, qa);
      const limit = 0.9 + 0.08 * edge(Math.cos(theta) * 1.6, Math.sin(theta) * 1.6, 0.25);
      mask[ix + nx * iy] = r < limit ? 1 : 0;
    }
  }
  return { origin: [ox, oy], spacing, nx, ny, height, mask };
}
