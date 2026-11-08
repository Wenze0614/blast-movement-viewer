import Panel from '@/ui/Panel';
import ViewerLoader from './viewer-loader';

const REPO_URL = 'https://github.com/Wenze0614/blast-movement-viewer';

/** Server component: static shell. three.js only loads client-side via ViewerLoader. */
export default function Home() {
  return (
    <>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto min-[900px]:flex-row min-[900px]:overflow-hidden">
        <section className="relative min-h-[60vh] flex-1 bg-viewport min-[900px]:min-h-0" aria-label="3D view">
          <ViewerLoader />
        </section>
        <aside className="w-full shrink-0 border-border bg-surface p-4 min-[900px]:w-[360px] min-[900px]:overflow-y-auto min-[900px]:border-l">
          <Panel />
        </aside>
      </main>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border bg-surface px-4 py-2 text-xs text-muted">
        <span>Concept prototype · heuristic movement model, not physics · synthetic data</span>
        <span>
          Wenze Zhang ·{' '}
          <a className="underline hover:text-accent" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </span>
      </footer>
    </>
  );
}
