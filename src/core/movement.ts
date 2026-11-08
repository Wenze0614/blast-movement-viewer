/**
 * M3 — HEURISTIC blast movement model (docs/02-plan.md ADR-3, ADR-4). Not physics: a deterministic
 * stand-in for a movement engine's output that keeps the invariants a real engine promises
 * (no overlap, nothing floating, tonnes and metal conserved).
 *
 * Bench-local frame (footprint.ts): `a` = distance from the back of the grid's bounding box toward
 * the free face (throw = +a), `b` = lateral distance, H = bench height. The blast outline is
 * irregular, so the free face is per lateral strip: face(b) = front of that strip's blocks.
 *
 * 1. Target plan displacement per block (s = (face(b) − a)/D, 0 at the face … 1 at the back,
 *    D = footprint depth; h = 0 toe … 1 crest; b̂ = lateral position in the footprint, −1 … 1):
 *      T = T_max · [r_back + (1 − r_back)(1 − s)^p] · [r_toe + (1 − r_toe)·h] · (1 + 0.25·R·n₁)
 *      L = R·σ_lat·n₂ + fan·b̂·(1 − s)
 *      target = (a, b) + T·r̂ + (0, L)
 *    r̂ = burden-relief direction from the firing sequence (timing.ts: straight at the face for
 *    row-by-row, toward the centre line for a V, toward the initiating corner for an echelon).
 *    n₁, n₂ = seeded 3D simplex noise at centroid / noiseLength.
 * 2. Swell + re-grid: k = swell^(1/3); post-blast plan grid of cell c′ = c·k from the back of the
 *    box to past the throw; bin each target. Rock can only land on free ground: inside the blast
 *    footprint or on the (bounded) open floor in front of the face. A cell is valid only if the
 *    WHOLE swollen block footprint (the cell square) is free, and a block may take a cell only if
 *    its animated box stays over free ground (within the terrain's floor margin) all the way
 *    there (footprint.pathIsFree), so no block meets rock or the pit terrain, settled or in
 *    flight. Otherwise it takes the nearest such cell to its target (then to its own position).
 * 3. Stacking: per cell, sort by original z (ties: front first), z_n = z_toe + (n + ½)·H_b·k.
 * 4. Angle-of-repose relaxation: move the top block of the tallest offending cell to its lowest
 *    valid neighbour until stable or 20·N moves (see `allowedDrop` for the lattice criterion).
 *    Stacks are re-sorted by original z afterwards, so vertical order is preserved.
 * 5. Animation delay = 0.45·(t − t_min)/(t_max − t_min) + 0.05·noise ∈ [0, 0.5], t = the firing
 *    time of the block's hole band (timing.ts): blocks start moving in firing order (visual only).
 *
 * Swell scales block size, cell size and stack height by k, so loose volume = swell × bank volume.
 */
import type { NoiseFunction3D } from 'simplex-noise';
import { canonicalParams, hashParams } from './hash';
import { floorMargin, modelFootprint } from './footprint';
import { createSeededNoise3D, deriveSeed } from './rng';
import { createFiringField } from './timing';
import type { BlastParameters, BlockModel, GridSpec, Heightfield, MovementResult } from './types';

/**
 * Version of this movement heuristic. Bump it whenever a code change alters `computeMovement`
 * output for the same model + params, so immutable cached responses keyed on paramsHash expire.
 * v2: irregular footprints (per-strip free face, rock confined by the unblasted ground).
 * v3: throw direction and animation delay from the firing sequence (timing.ts).
 */
export const MOVEMENT_MODEL_VERSION = 3;

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
  /** Post-grid cells blocks may occupy (1) vs unblasted rock (0); world index. */
  validMask: Uint8Array;
  /** Blocks per post-grid cell; world index ix + nx·iy. */
  stackCount: Uint16Array;
  /** m, stacked block height H_b·k. */
  stackHeight: number;
  /**
   * Blocks whose destination could not be reached by a free path (outline too thin for a swollen
   * block to pass); they keep the nearest valid cell. 0 for the demo blasts at any parameters.
   */
  pathFallbacks: number;
}

/** Cells (Chebyshev) searched around a blocked target for a reachable destination. */
export const REACH_SEARCH_CELLS = 10;

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

function assertParams(p: BlastParameters): void {
  const bad = (msg: string) => {
    throw new RangeError(`computeMovement: ${msg}`);
  };
  if (!(p.swellFactor >= 1)) bad('swellFactor must be >= 1');
  if (!(p.reposeAngleDeg > 0 && p.reposeAngleDeg < 90)) bad('reposeAngleDeg must be in (0, 90)');
  if (!(p.noiseLength > 0)) bad('noiseLength must be > 0');
  if (!(p.maxThrow >= 0)) bad('maxThrow must be >= 0');
  if (!(p.rowDelayMs > 0)) bad('rowDelayMs must be > 0');
  if (!(p.holeDelayMs >= 0)) bad('holeDelayMs must be >= 0');
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
  const fp = modelFootprint(model, params.freeFace);
  const frame = fp.frame;
  const { W, ca, cb, nAlong, nLat } = frame;
  const depth = Math.max(fp.frontMax - fp.backMin, ca); // D: footprint length along the throw
  const latCentre = (fp.latMin + fp.latMax) / 2;
  const latHalf = Math.max((fp.latMax - fp.latMin) / 2, cb);
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
  const nA = Math.ceil(fp.frontMax / cell) + frontMargin;
  const nB = Math.ceil(W / cell) + 2 * mLat;
  const nCells = nA * nB;
  const lc = (ia: number, ib: number) => ia + nA * ib; // local cell index

  // A cell is valid when its whole square (the swollen block's plan footprint) is free ground.
  // Every row ib in the footprint's lateral range has valid cells: the open floor in front of the
  // frontmost face is FLOOR_WIDTH ≫ c′ deep and SIDE_OPEN ≫ c′ wider than the footprint.
  const valid = new Uint8Array(nCells);
  for (let ib = 0; ib < nB; ib++) {
    const b0 = (ib - mLat) * cell;
    for (let ia = 0; ia < nA; ia++) valid[lc(ia, ib)] = fp.boxIsFree(ia * cell, b0, cell) ? 1 : 0;
  }

  // ── Step 1: target plan displacement, binning, delay ────────────────────
  const noiseT: NoiseFunction3D = createSeededNoise3D(deriveSeed(params.seed, 'movement/throw'));
  const noiseL: NoiseFunction3D = createSeededNoise3D(deriveSeed(params.seed, 'movement/lateral'));
  const noiseD: NoiseFunction3D = createSeededNoise3D(deriveSeed(params.seed, 'movement/delay'));
  const len = params.noiseLength;
  const rb = params.backRowRatio;
  const rt = params.toeRatio;

  // A block's animated box: half-extents (ca, cb)/2 growing by k, centre from its start to the cell
  // centre. It must stay within the terrain's floor margin of free ground (see pathIsFree).
  const tol = floorMargin(grid);
  const startA = new Float64Array(N);
  const startB = new Float64Array(N);
  const reachable = (n: number, cl: number): boolean => {
    const ia = cl % nA;
    const ib = (cl - ia) / nA;
    return fp.pathIsFree(startA[n], startB[n], (ia + 0.5) * cell, (ib - mLat + 0.5) * cell, ca / 2, cb / 2, k, tol);
  };
  /** Nearest valid, reachable cell to (ia, ib) within REACH_SEARCH_CELLS, or -1. Deterministic. */
  const nearestReachable = (n: number, ia: number, ib: number): number => {
    for (let r = 0; r <= REACH_SEARCH_CELLS; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let jb = ib - r; jb <= ib + r; jb++) {
        if (jb < 0 || jb >= nB) continue;
        for (let ja = ia - r; ja <= ia + r; ja++) {
          if (ja < 0 || ja >= nA || Math.max(Math.abs(ja - ia), Math.abs(jb - ib)) !== r) continue;
          const cl = lc(ja, jb);
          const d = (ja - ia) ** 2 + (jb - ib) ** 2;
          if (d < bestD && valid[cl] && reachable(n, cl)) {
            best = cl;
            bestD = d;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  let pathFallbacks = 0;

  const firing = createFiringField(fp, model.pattern, params);
  const fireMs = new Float64Array(N);
  const delayNoise = new Float64Array(N);

  const cellOf = new Int32Array(N);
  // Unique per block: (flitch, row from front, lateral index) over the dense bounding grid.
  const gridCount = nAlong * nLat * grid.nz;
  const rank = new Int32Array(N);
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
    startA[n] = a;
    startB[n] = b;
    const s = Math.min(1, Math.max(0, (fp.faceLine(b) - a) / depth)); // 0 at the face, 1 at the back
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
    const L = R * params.lateralSigma * n2 + params.lateralFan * ((b - latCentre) / latHalf) * (1 - s);

    const [ra, rbl] = firing.reliefAt(a, b);
    const ta = Math.min(aMax, Math.max(0, a + T * ra)); // never behind the back of the box
    const tb = Math.min(bMax, Math.max(bMin, b + T * rbl + L));
    let ia = Math.floor(ta / cell);
    let ib = Math.floor(tb / cell) + mLat;
    const wanted = lc(ia, ib);
    if (!valid[wanted] || !reachable(n, wanted)) {
      // Blocked: the nearest reachable cell to the target, else to the block's own position.
      let pick = nearestReachable(n, ia, ib);
      if (pick < 0) pick = nearestReachable(n, Math.min(nA - 1, Math.floor(a / cell)), Math.min(nB - 1, Math.max(0, Math.floor(b / cell) + mLat)));
      if (pick >= 0) {
        ia = pick % nA;
        ib = (pick - ia) / nA;
      }
    }
    if (!valid[lc(ia, ib)]) {
      // Target not on free ground: slide back toward the block's own strip, then along the throw,
      // forward first (its face and the open floor are ahead), else back (past the open floor).
      const ib0 = Math.min(nB - 1, Math.max(0, Math.floor(b / cell) + mLat));
      const step = Math.sign(ib0 - ib);
      while (ib !== ib0 && !valid[lc(ia, ib)]) ib += step;
      let ja = ia;
      while (ja < nA - 1 && !valid[lc(ja, ib)]) ja++;
      if (!valid[lc(ja, ib)]) {
        ja = ia;
        while (ja > 0 && !valid[lc(ja, ib)]) ja--;
      }
      if (!valid[lc(ja, ib)]) throw new Error(`computeMovement: no free ground in post-grid row ${ib}`);
      ia = ja;
    }
    if (!reachable(n, lc(ia, ib))) pathFallbacks++;
    cellOf[n] = lc(ia, ib);

    // rank: lower flitch first, then front row first, then lateral index
    const kk = Math.min(grid.nz - 1, Math.max(0, Math.floor((z - zToe) / grid.blockSize[2])));
    const ai = Math.min(nAlong - 1, Math.max(0, Math.floor(a / ca)));
    const bi = Math.min(nLat - 1, Math.max(0, Math.floor(b / cb)));
    rank[n] = (kk * nAlong + (nAlong - 1 - ai)) * nLat + bi;

    // Step 5 (below, once the firing-time range is known): blocks start in firing order.
    fireMs[n] = firing.timeAt(a, b);
    delayNoise[n] = (noiseD(qx, qy, qz) + 1) / 2;
  }
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let n = 0; n < N; n++) {
    tMin = Math.min(tMin, fireMs[n]);
    tMax = Math.max(tMax, fireMs[n]);
  }
  const tSpan = tMax > tMin ? tMax - tMin : 1;
  for (let n = 0; n < N; n++) {
    delay[n] = Math.min(0.5, Math.max(0, (0.45 * (fireMs[n] - tMin)) / tSpan + 0.05 * delayNoise[n]));
  }

  // ── Step 3: stacking — sort by (cell, rank) ─────────────────────────────
  const keys = new Float64Array(N);
  const rankToId = new Int32Array(gridCount);
  for (let n = 0; n < N; n++) {
    keys[n] = cellOf[n] * gridCount + rank[n]; // < nCells · gridCount, exact in a double
    rankToId[rank[n]] = n;
  }
  keys.sort();
  const stacks: number[][] = new Array(nCells);
  for (let i = 0; i < nCells; i++) stacks[i] = [];
  for (let q = 0; q < N; q++) {
    const key = keys[q];
    const cl = Math.floor(key / gridCount);
    stacks[cl].push(rankToId[key - cl * gridCount]);
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

  /**
   * The cell the stack in `cl` should shed a block to, or -1. Sets `moverIdx` to the stack index of
   * the block that moves: the highest one with a free path there (usually the top one; final
   * stacks are re-sorted by original elevation, so which block moves never breaks vertical order).
   */
  let moverIdx = -1;
  const highestReachable = (cl: number, target: number): number => {
    const st = stacks[cl];
    for (let i = st.length - 1; i >= 0; i--) if (reachable(st[i], target)) return i;
    return -1;
  };
  const findTarget = (cl: number): number => {
    const hgt = height[cl];
    if (hgt < 2) return -1;
    const ia = cl % nA;
    const ib = (cl - ia) / nA;
    let best = -1;
    let bestIdx = -1;
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
          const idx = highestReachable(cl, nb);
          if (idx < 0) continue;
          best = nb;
          bestIdx = idx;
          bestH = hn;
          bestD = d;
        }
      }
    }
    moverIdx = bestIdx;
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
    stacks[target].push(stacks[cl].splice(moverIdx, 1)[0]);
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
    stats: { relaxationMoves: moves, converged, validMask, stackCount, stackHeight: hb, pathFallbacks },
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

/**
 * Is `movement` the result for exactly this (model, params)? `paramsHash` binds both: it hashes
 * the model's configHash (+ heuristic version) and the canonical params, so a movement computed
 * for another model or other params never matches. The block count is checked too, so a
 * mismatched payload can never reach geometry packing. Use before pairing a movement with a model
 * that came from a different request (or a different source).
 */
export function isMovementFor(movement: MovementResult, model: BlockModel, params: BlastParameters): boolean {
  return (
    movement.delay.length === model.count &&
    movement.end.length === 3 * model.count &&
    movement.paramsHash === hashParams(params, modelHashContext(model))
  );
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
