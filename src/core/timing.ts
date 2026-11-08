/**
 * Firing sequence of a blast (HEURISTIC, not a timing simulation): when each hole fires, and which
 * way the rock around it is relieved. Shared by the movement heuristic (throw direction, animation
 * delay) and the hole layer (colour by firing time), so the two always agree.
 *
 * Bench-local frame (footprint.ts): a toward the free face, b lateral. Holes sit in rows one burden
 * B apart behind each strip's face and one spacing S apart along a row. A hole fires at
 *
 *   t = row · rowDelay + steps · holeDelay
 *
 * row   = burden bands behind the face: ⌊(face(b) − a) / B⌋ (row 0 at the face fires first);
 * steps = spacing bands from the initiation point along the row:
 *           'row'           0 (a whole row fires together)
 *           'v'             round(|b − b₀| / S), b₀ = the footprint's lateral centre
 *           'echelon-*'     ⌊d / S⌋, d = distance from the initiating corner's side
 *
 * Burden relief: rock moves toward the ground already opened, i.e. down the firing-time gradient.
 * With the smooth field t(a, b) = rowDelay·(face − a)/B + holeDelay·steps(b), the relief direction
 * is −∇t = (rowDelay / B, −holeDelay / S · ∂steps/∂b), normalised. So a row-by-row blast throws
 * straight at the face, a V converges on its centre line, and an echelon throws diagonally toward
 * its initiating corner, the familiar shapes of real muckpiles. The V's lateral pull tapers to zero
 * across the central hole band so the two halves do not cross over.
 *
 * 'left' / 'right' are seen from behind the blast, looking at the free face.
 */
import type { BlastHole } from './api-types';
import { modelFootprint, type Footprint } from './footprint';
import type { BlastParameters, BlastPattern, BlockModel } from './types';

export interface FiringField {
  /** ms after the first hole: firing time of the hole whose band holds (a, b). */
  timeAt(a: number, b: number): number;
  /** Unit vector (bench-local da, db): direction of burden relief at (a, b). */
  reliefAt(a: number, b: number): [number, number];
  /** b of the V's centre line or of the echelon's initiating side; NaN for 'row'. */
  origin: number;
}

/** +1 when bench-local +b points to the left of the throw direction (seen from behind), else −1. */
export function leftSign(fp: Footprint): 1 | -1 {
  const [x0, y0] = fp.frame.toWorld(0, 0);
  const [xa, ya] = fp.frame.toWorld(1, 0);
  const [xb, yb] = fp.frame.toWorld(0, 1);
  // left of the throw direction (dx, dy) is (−dy, dx)
  return (-(ya - y0)) * (xb - x0) + (xa - x0) * (yb - y0) > 0 ? 1 : -1;
}

export function createFiringField(
  fp: Footprint,
  pattern: Pick<BlastPattern, 'burden' | 'spacing'>,
  params: Pick<BlastParameters, 'initiation' | 'rowDelayMs' | 'holeDelayMs'>,
): FiringField {
  const B = pattern.burden;
  const S = pattern.spacing;
  const { initiation, rowDelayMs, holeDelayMs } = params;
  const left = leftSign(fp);
  // b of the initiation line / corner side, and the direction (in b) away from it into the blast.
  let origin = NaN;
  let away = 0;
  if (initiation === 'v') origin = (fp.latMin + fp.latMax) / 2;
  else if (initiation === 'echelon-left') {
    origin = left > 0 ? fp.latMax : fp.latMin;
    away = -left;
  } else if (initiation === 'echelon-right') {
    origin = left > 0 ? fp.latMin : fp.latMax;
    away = left;
  }

  const steps = (b: number): number => {
    if (initiation === 'row') return 0;
    if (initiation === 'v') return Math.round(Math.abs(b - origin) / S);
    return Math.max(0, Math.floor((away * (b - origin)) / S));
  };

  /** ∂steps/∂b of the smooth field (holes per metre), signed. */
  const stepSlope = (b: number): number => {
    if (initiation === 'row') return 0;
    if (initiation === 'v') return Math.max(-1, Math.min(1, (b - origin) / (S / 2))) / S;
    return away / S;
  };

  return {
    origin,
    timeAt(a, b) {
      const row = Math.max(0, Math.floor((fp.faceLine(b) - a) / B));
      return row * rowDelayMs + steps(b) * holeDelayMs;
    },
    reliefAt(_a, b) {
      const da = rowDelayMs / B;
      const db = -holeDelayMs * stepSlope(b) || 0; // || 0: no -0 on a straight throw
      const len = Math.hypot(da, db);
      return len > 0 ? [da / len, db / len] : [1, 0];
    },
  };
}

/**
 * ms: firing time of each hole (collar position) under `params`, measured on the model's own
 * footprint and drill pattern, i.e. exactly the field the movement used. For the hole layer.
 */
export function holeFiringTimes(
  model: BlockModel,
  holes: readonly Pick<BlastHole, 'collar'>[],
  params: Pick<BlastParameters, 'freeFace' | 'initiation' | 'rowDelayMs' | 'holeDelayMs'>,
): Float32Array {
  const fp = modelFootprint(model, params.freeFace);
  const field = createFiringField(fp, model.pattern, params);
  const out = new Float32Array(holes.length);
  holes.forEach((h, i) => {
    const [a, b] = fp.frame.toLocal(h.collar[0], h.collar[1]);
    out[i] = field.timeAt(a, b);
  });
  return out;
}
