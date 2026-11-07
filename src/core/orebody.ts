/**
 * Synthetic gold ore bodies (docs/02-plan.md M1). Pure functions of position + seeded noise.
 *
 * Grade model (g/t Au) at a point p:
 *   I(p)   = max over features of a smooth shape in [0, 1] (dipping lens or ellipsoidal pod)
 *   grade  = background · e^(bgLogSigma · n_bg) + peak · I(p) · e^(amplitude · n_ore + nugget · N(0,1))
 * where n_bg and n_ore are seeded, spatially correlated simplex noise fields, so the ore boundary
 * is irregular and neighbouring blocks have similar grades. Synthetic; not a geostatistical model.
 */
import { createRng, createSeededNoise3D, deriveSeed, fbm3, type Rng } from './rng';
import type { Vec3 } from './types';

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

export type OrebodyFeature = LensFeature | PodFeature;

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

/** Shape value in [0, 1] of one feature at (x, y, z). */
export function featureShape(f: OrebodyFeature, x: number, y: number, z: number): number {
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
  /** Grade (g/t) and indicator at a point. Call in a fixed order for determinism (nugget draws). */
  sample(x: number, y: number, z: number): { grade: number; indicator: number };
}

/** Build a seeded sampler. Same (spec, seed) and same call order → identical grades. */
export function createOrebodySampler(spec: OrebodySpec, seed: number): OrebodySampler {
  const bgNoise = createSeededNoise3D(deriveSeed(seed, 'orebody/background'));
  const oreNoise = createSeededNoise3D(deriveSeed(seed, 'orebody/ore'));
  const nugget: Rng = createRng(deriveSeed(seed, 'orebody/nugget'));
  const len = spec.noise.length;
  return {
    sample(x, y, z) {
      // Strongest feature wins (pods do not add up where they overlap).
      let ind = 0;
      let peak = 0;
      for (const f of spec.features) {
        const s = featureShape(f, x, y, z);
        if (s > ind) {
          ind = s;
          peak = f.peakGrade;
        }
      }
      const nb = fbm3(bgNoise, x / len, y / len, z / len, 2);
      const no = fbm3(oreNoise, x / len, y / len, z / len, 3);
      const indicator = ind * Math.exp(spec.noise.amplitude * no);
      const g =
        spec.background.median * Math.exp(spec.background.logSigma * nb) +
        peak * indicator * Math.exp(spec.nugget * nugget.normal());
      return { grade: Math.min(spec.maxGrade, Math.max(spec.minGrade, g)), indicator };
    },
  };
}
