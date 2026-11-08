/**
 * Display palettes (docs/02-plan.md ADR-8), shared by the engine (block colours) and the UI
 * (legend). Lives in src/state because both sides may import it. Neutral; no brand colours,
 * no red/green pairing.
 */
import { OreClass } from '@/core/types';
import { Outcome } from './views';

export interface PaletteEntry {
  key: string;
  label: string;
  /** sRGB hex */
  hex: string;
}

/** Grade classes: waste < 0.5, low 0.5–1.5, high ≥ 1.5 g/t Au (M1). Indexed by OreClass. */
export const GRADE_PALETTE: Record<OreClass, PaletteEntry> = {
  [OreClass.Waste]: { key: 'waste', label: 'Waste (< 0.5 g/t)', hex: '#8b9099' },
  [OreClass.LowGrade]: { key: 'low', label: 'Low grade (0.5–1.5 g/t)', hex: '#e3a72f' },
  [OreClass.HighGrade]: { key: 'high', label: 'High grade (≥ 1.5 g/t)', hex: '#b3134a' },
};

/**
 * Outcome classes (P1, ADR-8 palette). Teal / magenta / orange stay distinct under deuteranopia,
 * protanopia and tritanopia; waste → waste is a dim grey so the three interesting classes pop.
 */
export const OUTCOME_PALETTE: Record<Outcome, PaletteEntry> = {
  [Outcome.OreToMill]: { key: 'oreToMill', label: 'Ore → mill', hex: '#14b8a6' },
  [Outcome.OreLost]: { key: 'oreLost', label: 'Ore lost (ore → waste)', hex: '#d946ef' },
  [Outcome.Dilution]: { key: 'dilution', label: 'Dilution (waste → mill)', hex: '#f97316' },
  [Outcome.WasteToWaste]: { key: 'wasteToWaste', label: 'Waste → waste', hex: '#565c66' },
};

/**
 * Viridis (matplotlib, perceptually uniform and colour-blind safe), 9 stops at t = 0, 1/8 … 1.
 * Movement mode: low displacement = dark purple, high = yellow.
 */
export const VIRIDIS_STOPS: readonly string[] = [
  '#440154',
  '#472d7b',
  '#3b528b',
  '#2c728e',
  '#21918c',
  '#28ae80',
  '#5ec962',
  '#addc30',
  '#fde725',
];

const hexToSrgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const VIRIDIS_SRGB = VIRIDIS_STOPS.map(hexToSrgb);

/** Viridis at t ∈ [0, 1] (clamped) as sRGB 0..1, linear interpolation between the stops. */
export function viridisSrgb(t: number): [number, number, number] {
  const x = (t < 0 ? 0 : t > 1 ? 1 : t) * (VIRIDIS_SRGB.length - 1);
  const i = Math.min(Math.floor(x), VIRIDIS_SRGB.length - 2);
  const f = x - i;
  const a = VIRIDIS_SRGB[i];
  const b = VIRIDIS_SRGB[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** CSS gradient for the movement legend bar (same stops as the blocks). */
export const VIRIDIS_CSS = `linear-gradient(to right, ${VIRIDIS_STOPS.join(', ')})`;

/**
 * Plasma (perceptually uniform, matplotlib), for the holes' firing time: first hole = deep blue,
 * last = yellow. A different ramp from the blocks' viridis so the two never read as one scale.
 */
export const PLASMA_STOPS: readonly string[] = ['#0d0887', '#5302a3', '#8b0aa5', '#b83289', '#db5c68', '#f48849', '#febd2a', '#f0f921'];
const PLASMA_SRGB = PLASMA_STOPS.map(hexToSrgb);

/** Plasma at t ∈ [0, 1] (clamped) as sRGB 0..1, linear interpolation between the stops. */
export function plasmaSrgb(t: number): [number, number, number] {
  const x = (t < 0 ? 0 : t > 1 ? 1 : t) * (PLASMA_SRGB.length - 1);
  const i = Math.min(Math.floor(x), PLASMA_SRGB.length - 2);
  const f = x - i;
  const a = PLASMA_SRGB[i];
  const b = PLASMA_SRGB[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** CSS gradient for the firing-time swatch (same stops as the holes). */
export const PLASMA_CSS = `linear-gradient(to right, ${PLASMA_STOPS.join(', ')})`;

/** Dig-line styles: original = bright solid, adjusted = different colour, dashed (M5/M6). */
export const DIG_LINE_STYLE = {
  originalLine: { label: 'Original dig line', hex: '#f4f6f8', dashed: false },
  adjustedLine: { label: 'Adjusted dig line', hex: '#22c3e6', dashed: true },
} as const;
