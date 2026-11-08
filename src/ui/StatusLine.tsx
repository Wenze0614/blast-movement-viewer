'use client';
/** Load status under the blast picker: computing / error / the blast description. */
import { useAppStore } from '@/state/hooks';

export default function StatusLine() {
  const status = useAppStore((s) => s.status);
  const error = useAppStore((s) => s.error);
  const description = useAppStore((s) => s.blast?.description ?? null);
  return (
    <p className="text-xs text-muted" role="status" aria-live="polite">
      {status === 'error' ? (
        <span className="text-[#d9480f]">Error: {error}</span>
      ) : status === 'loading' ? (
        'Computing movement…'
      ) : (
        (description ?? 'Loading blast…')
      )}
    </p>
  );
}
