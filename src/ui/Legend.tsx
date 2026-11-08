'use client';
/** Grade legend (M2) + dig-line key. Static content: never re-renders after mount. */
import { GRADE_PALETTE } from '@/state/palette';

export function LineSwatch({ hex, dashed }: { hex: string; dashed: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block w-6 border-t-[3px]"
      style={{ borderColor: hex, borderStyle: dashed ? 'dashed' : 'solid' }}
    />
  );
}

export default function Legend() {
  return (
    <div>
      <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Grade (Au)</h2>
      <ul className="space-y-1 text-xs">
        {Object.values(GRADE_PALETTE).map((e) => (
          <li key={e.key} className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: e.hex }} />
            {e.label}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-muted">Cut-off 0.5 g/t. Colour mode: grade.</p>
    </div>
  );
}
