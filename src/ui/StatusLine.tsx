'use client';
/** Load status under the blast picker: what is loading / error / the blast description. */
import { useAppStore } from '@/state/hooks';
import type { LoadProgress } from '@/state/store';

/** What the current load is doing, from store.loadProgress (null: a load without progress). */
export function loadingText(p: LoadProgress | null): string {
  if (!p) return 'Computing movement…';
  if (p.step === 'model') return p.loaded === 0 ? 'Preparing the block model…' : 'Downloading the block model…';
  return p.loaded === 0 ? 'Computing the movement…' : 'Downloading the movement…';
}

export default function StatusLine() {
  const status = useAppStore((s) => s.status);
  const error = useAppStore((s) => s.error);
  const description = useAppStore((s) => s.blast?.description ?? null);
  const progress = useAppStore((s) => s.loadProgress);
  return (
    <p className="text-xs text-muted" role="status" aria-live="polite">
      {status === 'error' ? (
        <span className="text-[#d9480f]">Error: {error}</span>
      ) : status === 'loading' ? (
        loadingText(progress)
      ) : (
        (description ?? 'Loading blast…')
      )}
    </p>
  );
}
