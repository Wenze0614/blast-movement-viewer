/**
 * Synthetic pit terrain around a blast (display only; the movement heuristic never reads it).
 *
 * A heightfield of absolute RL on a vertex grid aligned with the block grid, built from the
 * blast footprint (footprint.ts) in the bench-local frame (a toward the free face, b lateral):
 *
 *   - floor at the toe RL over all FREE GROUND: under the blast and on the open floor in front of
 *     its face (the floor the previous cut left, a bay FLOOR_WIDTH deep and SIDE_OPEN wider than
 *     the blast each side), stepping down one bench past the bay's front;
 *   - unblasted rock at the crest RL everywhere else, so the outline reads as a cut in the bench;
 *   - two upper benches behind the blast (berm, steep face, berm, steep face) with wall lines that
 *     wander along strike;
 *   - a little seeded roughness, never above the nominal level, and an irregular surveyed edge.
 *
 * Floor guarantee: free ground is a union of block-column squares and bands whose edges lie on
 * block boundaries, and the vertex spacing divides the block size, so every terrain cell is
 * either wholly free or wholly not. A vertex touching a free cell is floor, so walls rise only
 * outside free ground and every block movement may settle (whole swollen box on free ground,
 * movement.ts) rests on drawn floor. The surveyed edge is sized to contain all of free ground.
 *
 * Synthetic and seeded from the model seed: same model + face → identical terrain.
 */
import { createFootprint, FLOOR_WIDTH, modelColumnMask, type FreeFace } from './footprint';
import { createSeededNoise3D, deriveSeed, fbm3 } from './rng';
import type { BlockModel, Vec2 } from './types';

/** m, target vertex spacing; the actual spacing is the block size divided by a whole number. */
export const TERRAIN_SPACING_TARGET = 1.25;
export { FLOOR_WIDTH };
/** m, berm between the blast's back edge and the first upper bench face, and between faces. */
export const BERM_WIDTH = 12;
/** degrees, bench face angle of the walls. */
export const FACE_ANGLE_DEG = 72;
/** m of terrain beyond free ground: behind the blast (upper benches), past the bay, beside it. */
const REACH_BACK = 55;
const REACH_FRONT = 25;
const REACH_SIDE = 20;
/** Free ground's corners sit at most this far (per axis, normalised) from the survey centre. */
const SURVEY_FREE_EXTENT = 0.64;
/** m, maximum surface roughness depth (rock tops, floor). */
const ROUGH_ROCK = 0.35;
const ROUGH_FLOOR = 0.15;
/** m, how far the wall lines wander along strike. */
export const WALL_WANDER = 4;

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
  const bs = Math.min(grid.blockSize[0], grid.blockSize[1]);
  const spacing = bs / Math.max(1, Math.round(bs / TERRAIN_SPACING_TARGET));
  const zToe = grid.origin[2];
  const H = grid.nz * grid.blockSize[2];
  const crest = zToe + H;
  const faceRun = H / Math.tan((FACE_ANGLE_DEG * Math.PI) / 180);

  // Survey: a wobbly superellipse whose bounding box is the terrain rectangle. It covers the
  // reach around free ground and is wide enough that free ground's corners are well inside.
  const fa0 = fp.backMin;
  const fa1 = fp.openEnd;
  const fb0 = fp.openLatMin;
  const fb1 = fp.openLatMax;
  const ac = (fa0 - REACH_BACK + fa1 + REACH_FRONT) / 2;
  const bc = (fb0 - REACH_SIDE + fb1 + REACH_SIDE) / 2;
  const ha = Math.max(ac - (fa0 - REACH_BACK), Math.max(ac - fa0, fa1 - ac) / SURVEY_FREE_EXTENT);
  const hb = Math.max(bc - (fb0 - REACH_SIDE), Math.max(bc - fb0, fb1 - bc) / SURVEY_FREE_EXTENT);

  // Terrain rectangle (bench-local) → world bounds → vertex grid on block corners.
  const corners = [
    frame.toWorld(ac - ha, bc - hb),
    frame.toWorld(ac + ha, bc - hb),
    frame.toWorld(ac - ha, bc + hb),
    frame.toWorld(ac + ha, bc + hb),
  ];
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
  const eps = 1e-3 * spacing;

  const height = new Float32Array(nx * ny);
  const mask = new Uint8Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = ox + ix * spacing;
      const y = oy + iy * spacing;
      const [a, b] = frame.toLocal(x, y);
      const n = (fbm3(rough, x / 7, y / 7, 0.5, 3) + 1) / 2; // 0..1
      // Floor if the vertex touches free ground (any of the four cells around it).
      const [la, lb] = frame.toLocal(x - eps, y - eps);
      const [ra, rb] = frame.toLocal(x + eps, y + eps);
      const touchesFree = fp.isFree(la, lb) || fp.isFree(ra, rb) || fp.isFree(la, rb) || fp.isFree(ra, lb);
      let z: number;
      if (touchesFree) {
        z = zToe - ROUGH_FLOOR * n;
      } else if (a >= fp.openEnd && b >= fp.openLatMin && b < fp.openLatMax) {
        // Past the bay: floor level, then a face down to the bench below.
        const drop = fp.openEnd + WALL_WANDER * (wander(b / 30, 3.1, 0) + 1);
        z = zToe - H * smoothstep(drop, drop + faceRun, a) - ROUGH_FLOOR * n;
      } else {
        const behind = fp.backMin - a; // m behind the blast's back edge
        const w1 = BERM_WIDTH + WALL_WANDER * (wander(b / 25, 0.7, 0) + 1);
        const w2 = w1 + faceRun + BERM_WIDTH + WALL_WANDER * (wander(b / 25, 5.3, 0) + 1);
        z = crest + H * (smoothstep(w1, w1 + faceRun, behind) + smoothstep(w2, w2 + faceRun, behind)) - ROUGH_ROCK * n;
      }
      height[ix + nx * iy] = z;
      const qa = (a - ac) / ha;
      const qb = (b - bc) / hb;
      const r = Math.sqrt(Math.sqrt(qa ** 4 + qb ** 4));
      const theta = Math.atan2(qb, qa);
      const limit = 0.9 + 0.08 * edge(Math.cos(theta) * 1.6, Math.sin(theta) * 1.6, 0.25);
      mask[ix + nx * iy] = r < limit ? 1 : 0;
    }
  }
  return { origin: [ox, oy], spacing, nx, ny, height, mask };
}
