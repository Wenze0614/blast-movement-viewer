'use client';

import dynamic from 'next/dynamic';

/** Keeps three.js out of SSR and out of the initial bundle (ADR-1). */
const Viewer = dynamic(() => import('@/viewer/Viewer'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-sm text-white/60">Loading viewer…</div>,
});

export default function ViewerLoader() {
  return <Viewer />;
}
