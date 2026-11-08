/**
 * Display palettes (docs/02-plan.md ADR-8), shared by the engine (block colours) and the UI
 * (legend). Lives in src/state because both sides may import it. Neutral; no brand colours,
 * no red/green pairing.
 */
import { OreClass } from '@/core/types';

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

/** Dig-line styles: original = bright solid, adjusted = different colour, dashed (M5/M6). */
export const DIG_LINE_STYLE = {
  originalLine: { label: 'Original dig line', hex: '#f4f6f8', dashed: false },
  adjustedLine: { label: 'Adjusted dig line', hex: '#22c3e6', dashed: true },
} as const;
