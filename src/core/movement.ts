/**
 * M3 — HEURISTIC blast movement model (docs/02-plan.md ADR-3, ADR-4). Not physics: a deterministic
 * stand-in for a movement engine's output that keeps the invariants a real engine promises
 * (no overlap, nothing floating, tonnes and metal conserved).
 *
 * Bench-local frame: `a` = distance from the back wall toward the free face (throw = +a),
 * `b` = lateral distance, A = bench length along the throw, W = bench width, H = bench height.
 *
 * 1. Target plan displacement per block (s = u/U, 0 = front row; h = 0 toe … 1 crest):
 *      T = T_max · [r_back + (1 − r_back)(1 − s)^p] · [r_toe + (1 − r_toe)·h] · (1 + 0.25·R·n₁)
 *      L = R·σ_lat·n₂ + fan·((b − W/2)/(W/2))·(1 − s)
 *    n₁, n₂ = seeded 3D simplex noise at centroid / noiseLength.
 * 2. Swell + re-grid: k = swell^(1/3); post-blast plan grid of cell c′ = c·k from the back wall
 *    to past the throw; bin each target. Behind the face line targets are clamped inside the
 *    bench sides (confined by unblasted rock).
 * 3. Stacking: per cell, sort by original z (ties: front first), z_n = z_toe + (n + ½)·H_b·k.
 * 4. Angle-of-repose relaxation: move the top block of the tallest offending cell to its lowest
 *    valid neighbour until stable or 20·N moves (see `allowedDrop` for the lattice criterion).
 *    Stacks are re-sorted by original z afterwards, so vertical order is preserved.
 * 5. Animation delay = 0.45·s + 0.05·noise ∈ [0, 0.5]: front rows fire first (visual only).
 *
 * Swell scales block size, cell size and stack height by k, so loose volume = swell × bank volume.
 */
import type { NoiseFunction3D } from 'simplex-noise';
import { canonicalParams, hashParams } from './hash';
import { createSeededNoise3D, deriveSeed } from './rng';
import type { BlastParameters, BlockModel, GridSpec, Heightfield, MovementResult, Vec2 } from './types';

/**
 * Version of this movement heuristic. Bump it whenever a code change alters `computeMovement`
 * output for the same model + params, so immutable cached responses keyed on paramsHash expire.
 */
export const MOVEMENT_MODEL_VERSION = 1;

/** ADR-3 step 4: stop after 20·N block moves even if not fully relaxed. */
export const RELAXATION_MOVE_FACTOR = 20;
/** Longest baseline (cells) checked by the repose criterion. */
export const REPOSE_MAX_BASELINE = 6;

const DEG = Math.PI / 180;

export interface MovementStats {
  /** Block moves made by the repose relaxation. */
  relaxationMoves: number;
  /** false if the 20·N move cap stopped the relaxation. */
  converged: boolean;
  /** Post-grid cells blocks may occupy (1) vs unblasted side walls behind the face (0); world index. */
  validMask: Uint8Array;
  /** Blocks per post-grid cell; world index ix + nx·iy. */
  stackCount: Uint16Array;
  /** m, stacked block height H_b·k. */
  stackHeight: number;
}

/**
 * Max allowed stack-height drop, in blocks, over a baseline of `d` cells along a grid axis.
 *
 * With cubic blocks one block step (H_b·k) over one cell (c·k) is a 45° slope, so the plan's
 * literal rule "neighbour difference ≤ tan(φ)·c′" (< one block for φ < 45°) could never be met
 * and the relaxation would oscillate. The lattice version enforces the AVERAGE slope over up to
 * `REPOSE_MAX_BASELINE` cells: drop ≤ max(1, round(d · tan(φ) · c′ / (H_b·k))).
 * Every allowed drop is ≥ 1, so each move lowers a block by ≥ 1 level and relaxation terminates.
 */
export function allowedDrop(d: number, reposeAngleDeg: number, cellSize: number, stackHeight: number): number {
  return Math.max(1, Math.round((d * Math.tan(reposeAngleDeg * DEG) * cellSize) / stackHeight));
}

/** Bench-local frame for a free face. */
interface Frame {
  /** m, bench length along the throw and width across it */
  A: number;
  W: number;
  /** block size along / across the throw */
  ca: number;
  cb: number;
  nAlong: number;
  nLat: number;
  toLocal(x: number, y: number): Vec2;
  toWorld(a: number, b: number): Vec2;
}

function benchFrame(grid: GridSpec, face: BlastParameters['freeFace']): Frame {
  const [ox, oy] = grid.origin;
  const [bx, by] = grid.blockSize;
  const lx = grid.nx * bx;
  const ly = grid.ny * by;
  switch (face) {
    case 'east':
      return {
        A: lx, W: ly, ca: bx, cb: by, nAlong: grid.nx, nLat: grid.ny,
        toLocal: (x, y) => [x - ox, y - oy],
        toWorld: (a, b) => [ox + a, oy + b],
      };
    case 'west':
      return {
        A: lx, W: ly, ca: bx, cb: by, nAlong: grid.nx, nLat: grid.ny,
        toLocal: (x, y) => [ox + lx - x, y - oy],
        toWorld: (a, b) => [ox + lx - a, oy + b],
      };
    case 'north':
      return {
        A: ly, W: lx, ca: by, cb: bx, nAlong: grid.ny, nLat: grid.nx,
        toLocal: (x, y) => [y - oy, x - ox],
        toWorld: (a, b) => [ox + b, oy + a],
      };
    case 'south':
      return {
        A: ly, W: lx, ca: by, cb: bx, nAlong: grid.ny, nLat: grid.nx,
        toLocal: (x, y) => [oy + ly - y, x - ox],
        toWorld: (a, b) => [ox + b, oy + ly - a],
      };
  }
}

function assertParams(p: BlastParameters): void {
  const bad = (msg: string) => {
    throw new RangeError(`computeMovement: ${msg}`);
  };
  if (!(p.swellFactor >= 1)) bad('swellFactor must be >= 1');
  if (!(p.reposeAngleDeg > 0 && p.reposeAngleDeg < 90)) bad('reposeAngleDeg must be in (0, 90)');
  if (!(p.noiseLength > 0)) bad('noiseLength must be > 0');
  if (!(p.maxThrow >= 0)) bad('maxThrow must be >= 0');
}

/** Binary max-heap of numbers (priority-encoded cells). */
class MaxHeap {
  private a: number[] = [];
  get size() {
    return this.a.length;
  }
  push(v: number) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] >= v) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = v;
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop() as number;
    if (a.length > 0) {
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && a[r] > a[l] ? r : l;
        if (a[c] <= last) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
}

export function computeMovement(model: BlockModel, params: BlastParameters): MovementResult {
  return computeMovementDetailed(model, params).result;
}

/** `computeMovement` plus diagnostics for tests and the dev overlay. */
export function computeMovementDetailed(
  model: BlockModel,
  rawParams: BlastParameters,
): { result: MovementResult; stats: MovementStats } {
  // Compute with the canonical (2 dp) params so equal hashes always mean equal results (ADR-12).
  const params = canonicalParams(rawParams);
  assertParams(params);
  const { grid, count: N } = model;
  const frame = benchFrame(grid, params.freeFace);
  const { A, W, ca, cb, nAlong, nLat } = frame;
  const zToe = grid.origin[2];
  const H = grid.nz * grid.blockSize[2];

  // ── Step 2 setup: swell + post-blast grid ───────────────────────────────
  const k = Math.cbrt(params.swellFactor);
  const cell = Math.sqrt(grid.blockSize[0] * grid.blockSize[1]) * k; // c′
  const hb = grid.blockSize[2] * k; // stacked block height
  const tanPhi = Math.tan(params.reposeAngleDeg * DEG);
  const R = params.randomness;
  const reach = (2 * H * params.swellFactor) / tanPhi; // generous room for the relaxed toe
  const frontMargin = Math.ceil((params.maxThrow * (1 + 0.25 * R) + reach) / cell) + 2;
  const mLat = Math.ceil((params.lateralFan + 3 * params.lateralSigma * R + reach) / cell) + 2;
  const nA = Math.ceil(A / cell) + frontMargin;
  const nB = Math.ceil(W / cell) + 2 * mLat;
  const nCells = nA * nB;
  const jLo = mLat;
  const jHi = mLat + Math.ceil(W / cell) - 1;
  const lc = (ia: number, ib: number) => ia + nA * ib; // local cell index

  // Behind the face line, only the bench footprint is open; the sides are unblasted rock.
  const valid = new Uint8Array(nCells);
  for (let ib = 0; ib < nB; ib++) {
    for (let ia = 0; ia < nA; ia++) {
      valid[lc(ia, ib)] = (ia + 0.5) * cell >= A || (ib >= jLo && ib <= jHi) ? 1 : 0;
    }
  }

  // ── Step 1: target plan displacement, binning, delay ────────────────────
  const noiseT: NoiseFunction3D = createSeededNoise3D(deriveSeed(params.seed, 'movement/throw'));
  const noiseL: NoiseFunction3D = createSeededNoise3D(deriveSeed(params.seed, 'movement/lateral'));
  const noiseD: NoiseFunction3D = createSeededNoise3D(deriveSeed(params.seed, 'movement/delay'));
  const len = params.noiseLength;
  const rb = params.backRowRatio;
  const rt = params.toeRatio;

  const cellOf = new Int32Array(N);
  const rank = new Int32Array(N); // unique per block: (flitch, row from front, lateral index)
  const delay = new Float32Array(N);
  const c = model.centroid;
  const aMax = nA * cell - 1e-6;
  const bMin = -mLat * cell;
  const bMax = (nB - mLat) * cell - 1e-6;

  for (let n = 0; n < N; n++) {
    const x = c[3 * n];
    const y = c[3 * n + 1];
    const z = c[3 * n + 2];
    const [a, b] = frame.toLocal(x, y);
    const s = (A - a) / A; // 0 at the free face, 1 at the back wall
    const h = (z - zToe) / H;
    const qx = x / len; // noise-space coordinates
    const qy = y / len;
    const qz = z / len;
    const n1 = noiseT(qx, qy, qz);
    const n2 = noiseL(qx, qy, qz);
    const T =
      params.maxThrow *
      (rb + (1 - rb) * Math.pow(1 - s, params.throwExponent)) *
      (rt + (1 - rt) * h) *
      (1 + 0.25 * R * n1);
    const L = R * params.lateralSigma * n2 + params.lateralFan * ((b - W / 2) / (W / 2)) * (1 - s);

    const ta = Math.min(aMax, Math.max(0, a + T)); // never behind the back wall
    let tb = b + L;
    if (ta < A) tb = Math.min(W - 1e-6, Math.max(0, tb)); // confined sides behind the face
    tb = Math.min(bMax, Math.max(bMin, tb));
    const ia = Math.floor(ta / cell);
    let ib = Math.floor(tb / cell) + mLat;
    if (!valid[lc(ia, ib)]) ib = Math.min(jHi, Math.max(jLo, ib));
    cellOf[n] = lc(ia, ib);

    // rank: lower flitch first, then front row first, then lateral index
    const kk = Math.min(grid.nz - 1, Math.max(0, Math.floor((z - zToe) / grid.blockSize[2])));
    const ai = Math.min(nAlong - 1, Math.max(0, Math.floor(a / ca)));
    const bi = Math.min(nLat - 1, Math.max(0, Math.floor(b / cb)));
    rank[n] = (kk * nAlong + (nAlong - 1 - ai)) * nLat + bi;

    // Step 5: front rows fire first.
    const nd = (noiseD(qx, qy, qz) + 1) / 2;
    delay[n] = Math.min(0.5, Math.max(0, 0.45 * s + 0.05 * nd));
  }

  // ── Step 3: stacking — sort by (cell, rank) ─────────────────────────────
  const keys = new Float64Array(N);
  const rankToId = new Int32Array(N);
  for (let n = 0; n < N; n++) {
    keys[n] = cellOf[n] * N + rank[n];
    rankToId[rank[n]] = n;
  }
  keys.sort();
  const stacks: number[][] = new Array(nCells);
  for (let i = 0; i < nCells; i++) stacks[i] = [];
  for (let q = 0; q < N; q++) {
    const key = keys[q];
    const cl = Math.floor(key / N);
    stacks[cl].push(rankToId[key - cl * N]);
  }

  // ── Step 4: angle-of-repose relaxation ──────────────────────────────────
  const height = new Int32Array(nCells);
  for (let i = 0; i < nCells; i++) height[i] = stacks[i].length;
  const allowed = new Int32Array(REPOSE_MAX_BASELINE + 1);
  for (let d = 1; d <= REPOSE_MAX_BASELINE; d++) allowed[d] = allowedDrop(d, params.reposeAngleDeg, cell, hb);
  const DIRS: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const heap = new MaxHeap();
  const pushCell = (cl: number) => heap.push(height[cl] * nCells + (nCells - 1 - cl));
  for (let cl = 0; cl < nCells; cl++) if (valid[cl] && height[cl] >= 2) pushCell(cl);

  const findTarget = (cl: number): number => {
    const hgt = height[cl];
    if (hgt < 2) return -1;
    const ia = cl % nA;
    const ib = (cl - ia) / nA;
    let best = -1;
    let bestH = Infinity;
    let bestD = Infinity;
    for (const [da, db] of DIRS) {
      for (let d = 1; d <= REPOSE_MAX_BASELINE; d++) {
        const ja = ia + da * d;
        const jb = ib + db * d;
        if (ja < 0 || ja >= nA || jb < 0 || jb >= nB) break;
        const nb = lc(ja, jb);
        if (!valid[nb]) break; // can't see past a wall
        const hn = height[nb];
        if (hgt - hn > allowed[d] && (hn < bestH || (hn === bestH && d < bestD))) {
          best = nb;
          bestH = hn;
          bestD = d;
        }
      }
    }
    return best;
  };

  const maxMoves = RELAXATION_MOVE_FACTOR * N;
  let moves = 0;
  while (heap.size > 0 && moves < maxMoves) {
    const p = heap.pop();
    const hgt = Math.floor(p / nCells);
    const cl = nCells - 1 - (p - hgt * nCells);
    if (height[cl] !== hgt) continue; // stale entry
    const target = findTarget(cl);
    if (target < 0) continue;
    stacks[target].push(stacks[cl].pop() as number);
    height[cl]--;
    height[target]++;
    moves++;
    pushCell(cl);
    pushCell(target);
    // Cells that look at `cl` along an axis may now offend.
    const ia = cl % nA;
    const ib = (cl - ia) / nA;
    for (const [da, db] of DIRS) {
      for (let d = 1; d <= REPOSE_MAX_BASELINE; d++) {
        const ja = ia + da * d;
        const jb = ib + db * d;
        if (ja < 0 || ja >= nA || jb < 0 || jb >= nB) break;
        const nb = lc(ja, jb);
        if (!valid[nb]) break;
        if (height[nb] >= 2) pushCell(nb);
      }
    }
  }
  let converged = true;
  if (heap.size > 0) {
    // Stopped by the move cap: check whether anything still offends.
    for (let cl = 0; cl < nCells && converged; cl++) if (valid[cl] && findTarget(cl) >= 0) converged = false;
  }

  // ── Final positions (vertical order preserved) + world-indexed outputs ──
  const postGrid = worldPostGrid(grid, params.freeFace, cell, nA, nB, mLat);
  const toWorldCell = worldCellMapper(params.freeFace, nA, nB);
  const end = new Float32Array(3 * N);
  const surfaceHeight = new Float32Array(nCells);
  const stackCount = new Uint16Array(nCells);
  const validMask = new Uint8Array(nCells);
  for (let cl = 0; cl < nCells; cl++) {
    const ia = cl % nA;
    const ib = (cl - ia) / nA;
    const w = toWorldCell(ia, ib);
    validMask[w] = valid[cl];
    const st = stacks[cl];
    stackCount[w] = st.length;
    surfaceHeight[w] = st.length * hb;
    if (st.length === 0) continue;
    st.sort((u, v) => rank[u] - rank[v]);
    const [cx, cy] = frame.toWorld((ia + 0.5) * cell, (ib - mLat + 0.5) * cell);
    for (let lvl = 0; lvl < st.length; lvl++) {
      const id = st[lvl];
      end[3 * id] = cx;
      end[3 * id + 1] = cy;
      end[3 * id + 2] = zToe + (lvl + 0.5) * hb;
    }
  }

  const start = new Float32Array(model.centroid);
  const displacement = new Float32Array(3 * N);
  const distance = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const dx = end[3 * n] - start[3 * n];
    const dy = end[3 * n + 1] - start[3 * n + 1];
    const dz = end[3 * n + 2] - start[3 * n + 2];
    displacement[3 * n] = dx;
    displacement[3 * n + 1] = dy;
    displacement[3 * n + 2] = dz;
    distance[n] = Math.hypot(dx, dy, dz);
  }

  const surface: Heightfield = { ...postGrid, origin: [...postGrid.origin], height: surfaceHeight };
  const result: MovementResult = {
    params,
    paramsHash: hashParams(params, modelHashContext(model)),
    start,
    end,
    displacement,
    distance,
    delay,
    looseScale: k,
    postGrid,
    surface,
  };
  return {
    result,
    stats: { relaxationMoves: moves, converged, validMask, stackCount, stackHeight: hb },
  };
}

/**
 * Identifies the model + algorithm in the params hash (ADR-12: key = (blast config, params)).
 * `configHash` covers the complete blast config (grid, grades, ore body, seed, generator version);
 * MOVEMENT_MODEL_VERSION covers changes to this heuristic itself.
 */
export function modelHashContext(model: BlockModel): string {
  if (!model.configHash) {
    // A model without a config hash (e.g. a decoder that dropped it) would silently share cache
    // keys with other ore bodies. Fail loudly instead.
    throw new TypeError('computeMovement: model.configHash is missing (build models with generateBlockModel)');
  }
  return `movement/v${MOVEMENT_MODEL_VERSION};model=${model.configHash}`;
}

function worldCellMapper(face: BlastParameters['freeFace'], nA: number, nB: number) {
  switch (face) {
    case 'east':
      return (ia: number, ib: number) => ia + nA * ib;
    case 'west':
      return (ia: number, ib: number) => nA - 1 - ia + nA * ib;
    case 'north':
      return (ia: number, ib: number) => ib + nB * ia;
    case 'south':
      return (ia: number, ib: number) => ib + nB * (nA - 1 - ia);
  }
}

function worldPostGrid(
  grid: GridSpec,
  face: BlastParameters['freeFace'],
  cell: number,
  nA: number,
  nB: number,
  mLat: number,
): MovementResult['postGrid'] {
  const [ox, oy] = grid.origin;
  const lx = grid.nx * grid.blockSize[0];
  const ly = grid.ny * grid.blockSize[1];
  switch (face) {
    case 'east':
      return { origin: [ox, oy - mLat * cell], cellSize: cell, nx: nA, ny: nB };
    case 'west':
      return { origin: [ox + lx - nA * cell, oy - mLat * cell], cellSize: cell, nx: nA, ny: nB };
    case 'north':
      return { origin: [ox - mLat * cell, oy], cellSize: cell, nx: nB, ny: nA };
    case 'south':
      return { origin: [ox - mLat * cell, oy + ly - nA * cell], cellSize: cell, nx: nB, ny: nA };
  }
}
