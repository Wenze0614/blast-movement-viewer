/** Number formatting for the panel (deterministic: fixed en-US locale). */
import { GRAMS_PER_TROY_OZ } from '@/core/defaults';

const MINUS = '−';

export const gramsToOz = (grams: number) => grams / GRAMS_PER_TROY_OZ;

export function fmt(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '–';
  const s = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return value < 0 && Number(s.replace(/,/g, '')) !== 0 ? `${MINUS}${s}` : s;
}

/** Signed with an explicit + or − (U+2212); zero after rounding shows as ±0. */
export function fmtSigned(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '–';
  const s = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (Number(s.replace(/,/g, '')) === 0) return `±${s}`;
  return `${value < 0 ? MINUS : '+'}${s}`;
}
