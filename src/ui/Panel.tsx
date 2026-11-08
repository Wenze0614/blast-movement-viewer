'use client';
/**
 * Right panel (ADR-8): title, blast picker + source badge, playback, blast parameters (P5), view
 * controls + legend, layers, reconciliation.
 */
import { useAppStore } from '@/state/hooks';
import BlastControls from './BlastControls';
import BlastPicker from './BlastPicker';
import LayerToggles from './LayerToggles';
import Legend from './Legend';
import ParamsPanel from './ParamsPanel';
import SourceBadge from './SourceBadge';
import StatsTable from './StatsTable';
import StatusLine from './StatusLine';
import ViewControls from './ViewControls';

export default function Panel() {
  const blastId = useAppStore((s) => s.blastId);
  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="text-base font-semibold">Blast Movement Viewer</h1>
        <div className="flex items-end gap-2">
          <BlastPicker />
          <div className="pb-1">
            <SourceBadge />
          </div>
        </div>
        <StatusLine />
      </header>
      <section aria-label="Blast playback" className="border-t border-border pt-3">
        <BlastControls />
      </section>
      <section aria-label="Blast parameters" className="border-t border-border pt-3">
        {/* Remount per blast: a pending (debounced) edit never carries over to another blast. */}
        <ParamsPanel key={blastId} />
      </section>
      <section aria-label="View" className="space-y-3 border-t border-border pt-3">
        <ViewControls />
        <Legend />
      </section>
      <section aria-label="Layers" className="border-t border-border pt-3">
        <LayerToggles />
      </section>
      <section aria-label="Reconciliation" className="border-t border-border pt-3">
        <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Reconciliation</h2>
        <StatsTable />
      </section>
    </div>
  );
}
