'use client';
/** Right panel (ADR-8): title, blast + scrubber, view controls + legend, layers, reconciliation. */
import BlastControls from './BlastControls';
import LayerToggles from './LayerToggles';
import Legend from './Legend';
import StatsTable from './StatsTable';
import StatusLine from './StatusLine';
import ViewControls from './ViewControls';

export default function Panel() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-base font-semibold">Blast Movement Viewer</h1>
        <StatusLine />
      </header>
      <section aria-label="Blast playback" className="border-t border-border pt-3">
        <BlastControls />
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
