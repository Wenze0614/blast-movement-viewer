'use client';
/**
 * Blast picker (P8, ADR-8 panel header): the demo blasts from `store.blasts` (filled by the
 * DataSource: /api/blasts, or the local list on fallback). Selecting writes `store.blastId`; the
 * pipeline aborts the old load and fetches the new model + movement.
 */
import { useAppStore } from '@/state/hooks';
import { fmt } from './format';

export default function BlastPicker() {
  const blasts = useAppStore((s) => s.blasts);
  const blastId = useAppStore((s) => s.blastId);
  const setBlastId = useAppStore((s) => s.setBlastId);
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs text-muted">
      Blast
      <select
        className="w-full min-w-0 rounded border border-border bg-surface px-2 py-1 text-sm text-foreground"
        value={blastId}
        disabled={blasts.length === 0}
        onChange={(e) => setBlastId(e.currentTarget.value)}
      >
        {blasts.length === 0 ? <option value={blastId}>Loading blasts…</option> : null}
        {blasts.map((b) => (
          <option key={b.id} value={b.id} title={b.description}>
            {b.name} ({fmt(b.blockCount, 0)} blocks)
          </option>
        ))}
      </select>
    </label>
  );
}
