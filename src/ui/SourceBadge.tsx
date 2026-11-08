'use client';
/**
 * Data-source badge (ADR-8, ADR-9): where the blocks on screen came from.
 * "● API · 42 ms" | "● Local fallback" (the API failed; hover for why) | "● Local · 12 ms".
 * The latency is the last movement request (fetch + decode, or local compute).
 */
import { useAppStore } from '@/state/hooks';
import type { DataSourceKind } from '@/data';

export interface SourceBadgeProps {
  source: DataSourceKind | null;
  latencyMs: number | null;
  fallback: string | null;
}

const ms = (latency: number | null) => (latency === null ? '' : ` · ${Math.round(latency)} ms`);

export function SourceBadgeView({ source, latencyMs, fallback }: SourceBadgeProps) {
  if (!source) return null;
  const isFallback = source === 'local' && fallback !== null;
  const text = source === 'api' ? `API${ms(latencyMs)}` : isFallback ? 'Local fallback' : `Local${ms(latencyMs)}`;
  const title =
    source === 'api'
      ? 'Served by the API (binary BMV1 payload, CDN-cacheable)'
      : isFallback
        ? `The API failed, so the movement was computed in the browser: ${fallback}`
        : 'Computed in the browser (local data source)';
  return (
    <span
      data-source={isFallback ? 'fallback' : source}
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums ${
        isFallback ? 'border-[#d9480f] text-[#d9480f]' : 'border-border text-muted'
      }`}
    >
      <span aria-hidden className={source === 'api' ? 'text-accent' : ''}>
        ●
      </span>
      {text}
    </span>
  );
}

export default function SourceBadge() {
  const source = useAppStore((s) => s.source);
  const latencyMs = useAppStore((s) => s.lastLatencyMs);
  const fallback = useAppStore((s) => s.fallback);
  return <SourceBadgeView source={source} latencyMs={latencyMs} fallback={fallback} />;
}
