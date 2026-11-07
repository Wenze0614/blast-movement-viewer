'use client';
/** Small data-source / status line (ADR-8 badge): "● local · 12 ms". */
import { useAppStore } from '@/state/hooks';

export default function StatusLine() {
  const status = useAppStore((s) => s.status);
  const source = useAppStore((s) => s.source);
  const latency = useAppStore((s) => s.lastLatencyMs);
  const error = useAppStore((s) => s.error);
  const blastName = useAppStore((s) => s.blast?.name ?? null);
  return (
    <p className="mt-1 text-xs text-muted" role="status" aria-live="polite">
      {blastName ?? 'Loading blast…'}
      {' · '}
      {status === 'error' ? (
        <span className="text-[#d9480f]">Error: {error}</span>
      ) : status === 'loading' ? (
        'computing…'
      ) : source ? (
        <>
          <span aria-hidden>● </span>
          {source}
          {latency !== null ? ` · ${Math.round(latency)} ms` : ''}
        </>
      ) : (
        'idle'
      )}
    </p>
  );
}
