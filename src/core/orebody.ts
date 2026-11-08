/**
 * Synthetic gold ore bodies (docs/02-plan.md M1). Pure functions of position + seeded noise.
 *
 * Grade model (g/t Au) at a point p:
 *   c_f(p) = feature f's grade contribution: peak · shape (dipping lens, ellipsoidal pod) or, for a
 *            vein, peak · core + halo grade · halo (see VeinFeature)
 *   winner = the feature with the largest c_f; I(p) = c_winner / peak_winner (its shape, 0..1+)
 *   grade  = background · e^(bgLogSigma · n_bg) + peak · I(p) · e^(amplitude · n_ore + nugget · N(0,1))
 * where n_bg and n_ore are seeded, spatially correlated simplex noise fields, so the ore boundary
 * is irregular and neighbouring blocks have similar grades. Synthetic; not a geostatistical model.
 */
import { createRng, createSeededNoise3D, deriveSeed, fbm3, type Rng } from './rng';
import type { NoiseFunction3D } from 'simplex-noise';
import type { Vec2, Vec3 } from './types';

const DEG = Math.PI / 180;

/** A tabular lens: Gaussian across the plane, flat-topped (super-Gaussian) along strike and dip. */
export interface LensFeature {
  kind: 'lens';
  /** m, a point on the lens mid-plane. */
  centre: Vec3;
  /** degrees, azimuth of strike clockwise from north (0 = strikes north–south). */
  strikeDeg: number;
  /** degrees from horizontal; dips to the right of the strike direction (strike 0 → dips east). */
  dipDeg: number;
  /** m, 1/e half-thickness of the indicator across the plane. */
  halfThickness: number;
  /** m, half-length along strike. */
  halfStrike: number;
  /** m, half-length down dip. */
  halfDip: number;
  /** g/t at the core. */
  peakGrade: number;
}

/** An ellipsoidal pod, axis-aligned in plan after rotation about z. */
export interface PodFeature {
  kind: 'pod';
  /** m */
  centre: Vec3;
  /** m, 1/e radii along the pod's local x, y, z. */
  radii: Vec3;
  /** degrees, rotation of the pod's local x axis from east, anticlockwise. */
  rotationDeg: number;
  /** g/t at the core. */
  peakGrade: number;
}

/**
 * A gold-bearing vein: a thin, dipping, meandering sheet along a plan trace, the typical host of
 * orogenic gold. Grade across it is a narrow high-grade core inside a wider low-grade halo
 * (disseminated alteration). Along strike the core is patchy (ore shoots and barren gaps), and
 * both pinch out past the trace's ends. Several veins sharing an end point read as a branch.
 *
 * Geometry at a point: d = signed plan distance from the trace (positive on the dip side, i.e.
 * to the right walking along the trace), minus the down-dip offset (zRef − z) / tan(dip), plus a
 * seeded meander; the distance across the sheet is that times sin(dip).
 */
export interface VeinFeature {
  kind: 'vein';
  /** Plan trace (world x, y, m) of the vein's mid-surface at elevation zRef; two or more points. */
  trace: Vec2[];
  /** m, elevation at which the mid-surface follows the trace exactly. */
  zRef: number;
  /** degrees from horizontal (90 = vertical); dips to the right of the trace direction. */
  dipDeg: number;
  /** m, 1/e half-thickness of the high-grade core across the sheet. */
  halfThickness: number;
  /** g/t at the core. */
  peakGrade: number;
  /** Disseminated envelope: 1/e half-width across the sheet (m) and its grade at the vein (g/t). */
  halo: { halfWidth: number; grade: number };
  /** m, how far the sheet meanders sideways (seeded noise along strike and down dip). */
  wander: number;
  /** m, correlation length of the meander and of the ore shoots. */
  wanderLength: number;
  /** 0..1, how patchy the core is along strike (0 = continuous; 1 = distinct shoots and gaps). */
  patchiness: number;
}

export type OrebodyFeature = LensFeature | PodFeature | VeinFeature;

/** m: the core and halo fade out over about this distance past a trace end (pinch-out). */
export const VEIN_PINCH_OUT = 10;

/**
 * Signed plan distance to a polyline (positive to the right of its direction), the arc length
 * along it, and how far past its first or last point the nearest point lies (`overshoot`). Past an
 * end, `d` is measured across the extended end segment, so the vein pinches out along strike
 * instead of being cut off by the distance to the end point.
 */
export function traceDistance(trace: readonly Vec2[], x: number, y: number): { d: number; along: number; overshoot: number } {
  let best = Infinity;
  let bestD = 0;
  let bestAlong = 0;
  let bestOver = 0;
  let acc = 0;
  for (let k = 0; k + 1 < trace.length; k++) {
    const [ax, ay] = trace[k];
    const [bx, by] = trace[k + 1];
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey);
    if (len === 0) continue;
    const raw = ((x - ax) * ex + (y - ay) * ey) / (len * len);
    const t = Math.min(1, Math.max(0, raw));
    const px = ax + ex * t;
    const py = ay + ey * t;
    const dist = Math.hypot(x - px, y - py);
    if (dist < best) {
      best = dist;
      // right of the direction (ex, ey) is (ey, −ex); cross / len = signed distance to the line
      const cross = ((x - ax) * ey - (y - ay) * ex) / len;
      const first = k === 0;
      const last = k + 2 === trace.length;
      bestOver = first && raw < 0 ? -raw * len : last && raw > 1 ? (raw - 1) * len : 0;
      // Past an end, measure across the extended end segment (the pinch-out handles the overshoot).
      bestD = bestOver > 0 ? cross : (cross >= 0 ? 1 : -1) * dist;
      bestAlong = acc + t * len;
    }
    acc += len;
  }
  return { d: bestD, along: bestAlong, overshoot: bestOver };
}

/** Seeded noise a vein needs (meander, ore shoots). */
export interface VeinNoise {
  wander: NoiseFunction3D;
  shoot: NoiseFunction3D;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** A vein's grade contribution (g/t, before the global ore noise and nugget) at (x, y, z). */
export function veinContribution(f: VeinFeature, noise: VeinNoise, x: number, y: number, z: number): number {
  const { d, along, overshoot } = traceDistance(f.trace, x, y);
  return veinContributionAt(f, noise, d, along, overshoot, z);
}

/** Beyond this many 1/e widths across the sheet a vein adds less than Float32 can resolve. */
const VEIN_REACH_WIDTHS = 5;

/**
 * veinContribution with the plan-only part (traceDistance: d, along, overshoot) supplied, so a
 * generator can compute it once per column. Far from the sheet (even after the largest meander)
 * it returns 0 without touching the noise: the exact value there is below exp(−25) of the peak.
 */
export function veinContributionAt(f: VeinFeature, noise: VeinNoise, d: number, along: number, overshoot: number, z: number): number {
  const dip = f.dipDeg * DEG;
  const offset = f.dipDeg >= 89.999 ? 0 : (f.zRef - z) / Math.tan(dip);
  const sinDip = Math.sin(dip);
  const reach = VEIN_REACH_WIDTHS * Math.max(f.halfThickness, f.halo.halfWidth);
  if ((Math.abs(d - offset) - Math.abs(f.wander)) * sinDip > reach || overshoot > VEIN_REACH_WIDTHS * VEIN_PINCH_OUT) return 0;
  const L = f.wanderLength;
  const meander = f.wander * noise.wander(along / L, z / L, 0.37);
  const across = (d - offset + meander) * sinDip;
  const pinch = Math.exp(-((overshoot / VEIN_PINCH_OUT) ** 2));
  const s = noise.shoot(along / L, z / L, 4.1);
  const shoot = 1 - f.patchiness + f.patchiness * smoothstep(-0.25, 0.35, s);
  const qc = across / f.halfThickness;
  const qh = across / f.halo.halfWidth;
  return pinch * (f.peakGrade * shoot * Math.exp(-qc * qc) + f.halo.grade * Math.exp(-qh * qh));
}

export interface OrebodySpec {
  features: OrebodyFeature[];
  /** Host-rock grade: median g/t and log-space sigma of its noise. */
  background: { median: number; logSigma: number };
  /** Ore grade variability: correlation length (m) and log-space amplitude. */
  noise: { length: number; amplitude: number };
  /** Log-space per-block (uncorrelated) noise sigma. */
  nugget: number;
  /** Indicator level above which a block is RockType.Mineralised (display only). */
  mineralisedThreshold: number;
  /** t/m³ in situ. */
  density: { host: number; mineralised: number };
  /** g/t, grades are clamped to [minGrade, maxGrade]. */
  minGrade: number;
  maxGrade: number;
}

/** Shape value in [0, 1] of a lens or pod at (x, y, z). */
export function featureShape(f: LensFeature | PodFeature, x: number, y: number, z: number): number {
  const dx = x - f.centre[0];
  const dy = y - f.centre[1];
  const dz = z - f.centre[2];
  if (f.kind === 'lens') {
    const st = f.strikeDeg * DEG;
    const dip = f.dipDeg * DEG;
    // strike unit vector (azimuth from north, clockwise): (sin, cos, 0)
    const sx = Math.sin(st);
    const sy = Math.cos(st);
    // horizontal dip direction = strike rotated 90° clockwise: (cos, -sin, 0)
    const hx = Math.cos(st);
    const hy = -Math.sin(st);
    // down-dip vector and plane normal
    const cd = Math.cos(dip);
    const sd = Math.sin(dip);
    const along = dx * sx + dy * sy;
    const down = (dx * hx + dy * hy) * cd - dz * sd;
    const across = (dx * hx + dy * hy) * sd + dz * cd;
    const qa = across / f.halfThickness;
    const qs = along / f.halfStrike;
    const qd = down / f.halfDip;
    return Math.exp(-(qa * qa) - qs * qs * qs * qs - qd * qd * qd * qd);
  }
  const r = f.rotationDeg * DEG;
  const lx = (dx * Math.cos(r) + dy * Math.sin(r)) / f.radii[0];
  const ly = (-dx * Math.sin(r) + dy * Math.cos(r)) / f.radii[1];
  const lz = dz / f.radii[2];
  return Math.exp(-(lx * lx + ly * ly + lz * lz));
}

export interface OrebodySampler {
  /**
   * Grade (g/t) and indicator at a point. Call in a fixed order for determinism (nugget draws).
   * `column` (0 ≤ column < options.columns) names the point's plan column: points sharing it must
   * share (x, y), and the plan-only vein geometry is then computed once per column.
   */
  sample(x: number, y: number, z: number, column?: number): { grade: number; indicator: number };
}

/**
 * Build a seeded sampler. Same (spec, seed) and same call order → identical grades.
 * `options.columns`: how many plan columns `sample` may name (enables the per-column cache).
 */
export function createOrebodySampler(spec: OrebodySpec, seed: number, options: { columns?: number } = {}): OrebodySampler {
  const bgNoise = createSeededNoise3D(deriveSeed(seed, 'orebody/background'));
  const oreNoise = createSeededNoise3D(deriveSeed(seed, 'orebody/ore'));
  const nugget: Rng = createRng(deriveSeed(seed, 'orebody/nugget'));
  const len = spec.noise.length;
  const veinNoise: (VeinNoise | null)[] = spec.features.map((f, i) =>
    f.kind === 'vein'
      ? {
          wander: createSeededNoise3D(deriveSeed(seed, `orebody/vein/${i}/wander`)),
          shoot: createSeededNoise3D(deriveSeed(seed, `orebody/vein/${i}/shoot`)),
        }
      : null,
  );
  // Per-column cache of each vein's plan geometry (d, along, overshoot); NaN = not computed yet.
  const columns = options.columns ?? 0;
  const planCache = spec.features.map((f) => (f.kind === 'vein' && columns > 0 ? new Float64Array(3 * columns).fill(NaN) : null));
  const plan = (i: number, f: VeinFeature, x: number, y: number, column: number | undefined): [number, number, number] => {
    const cache = planCache[i];
    if (cache && column !== undefined && column >= 0 && column < columns) {
      const o = 3 * column;
      if (Number.isNaN(cache[o])) {
        const t = traceDistance(f.trace, x, y);
        cache[o] = t.d;
        cache[o + 1] = t.along;
        cache[o + 2] = t.overshoot;
      }
      return [cache[o], cache[o + 1], cache[o + 2]];
    }
    const t = traceDistance(f.trace, x, y);
    return [t.d, t.along, t.overshoot];
  };
  return {
    sample(x, y, z, column) {
      // Strongest contribution wins (features do not add up where they overlap).
      let best = 0;
      let peak = 0;
      for (let i = 0; i < spec.features.length; i++) {
        const f = spec.features[i];
        let c: number;
        if (f.kind === 'vein') {
          const [d, along, overshoot] = plan(i, f, x, y, column);
          c = veinContributionAt(f, veinNoise[i]!, d, along, overshoot, z);
        } else {
          c = f.peakGrade * featureShape(f, x, y, z);
        }
        if (c > best) {
          best = c;
          peak = f.peakGrade;
        }
      }
      const ind = peak > 0 ? best / peak : 0;
      const nb = fbm3(bgNoise, x / len, y / len, z / len, 2);
      // No ore feature here: the ore noise cannot change anything (indicator = 0), so skip it.
      const no = ind > 0 ? fbm3(oreNoise, x / len, y / len, z / len, 3) : 0;
      const indicator = ind * Math.exp(spec.noise.amplitude * no);
      const g =
        spec.background.median * Math.exp(spec.background.logSigma * nb) +
        peak * indicator * Math.exp(spec.nugget * nugget.normal());
      return { grade: Math.min(spec.maxGrade, Math.max(spec.minGrade, g)), indicator };
    },
  };
}
