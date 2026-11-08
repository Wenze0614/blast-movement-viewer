/**
 * Server-side access to the seeded demo blasts (docs/02-plan.md ADR-10): the API is a thin BFF
 * over core. Models are deterministic per config, so each is generated and encoded once per
 * server instance; movement is computed per request (< 100 ms) and cached by the CDN (ADR-12).
 */
import { BLAST_CONFIGS, blastDataVersion, getBlastConfig, type BlastConfig } from '@/core/blasts';
import { generateBlockModel } from '@/core/blockModel';
import { encodeModel } from '@/core/codec';
import { buildBlastDetail, buildBlastSummary } from '@/core/holes';
import type { BlastDetail, BlastSummary } from '@/core/api-types';
import type { BlockModel } from '@/core/types';
import { apiError, CACHE, gzip } from './binary';

interface Entry {
  model: BlockModel;
  detail: BlastDetail;
  /** The encoded model, gzipped once (see binary()). */
  modelGzip: Promise<Uint8Array<ArrayBuffer>>;
}

const cache = new Map<string, Entry>();

export function listBlastSummaries(): BlastSummary[] {
  return BLAST_CONFIGS.map(buildBlastSummary);
}

export function findBlast(id: string): BlastConfig | undefined {
  return getBlastConfig(id);
}

/**
 * `?v=` check for the immutable model and movement URLs (ADR-12). A `v` that is not this blast's
 * current data version comes from a client built against another config: serving it the current
 * data would pair a newer model or movement with that client's older one. → 409 STALE_VERSION
 * (no-store), and the client's DataSource falls back to local for both. A request without `v`
 * (curl, tools) gets the current data. Returns null when the version is acceptable.
 */
export function versionMismatch(cfg: BlastConfig, url: string): Response | null {
  const v = new URL(url).searchParams.get('v');
  const current = blastDataVersion(cfg);
  if (v === null || v === current) return null;
  return apiError('STALE_VERSION', `Data version ${v} is not current for ${cfg.id}; reload the app`, 409, {
    requested: v,
    current,
  });
}

/**
 * Cache-Control for a model / movement response that passed `versionMismatch`: `immutable` only
 * when the URL's `v` is this blast's current data version (the URL then names its bytes for good);
 * a request without `v` may be served different bytes after a deploy, so it gets a short policy.
 */
export function binaryCacheControl(cfg: BlastConfig, url: string): string {
  return new URL(url).searchParams.get('v') === blastDataVersion(cfg) ? CACHE.immutable : CACHE.unversioned;
}

/** Model, detail and the encoded model payload for a known blast (memoised). */
export function blastEntry(cfg: BlastConfig): Entry {
  let e = cache.get(cfg.id);
  if (!e) {
    const model = generateBlockModel(cfg);
    e = { model, detail: buildBlastDetail(cfg, model), modelGzip: gzip(encodeModel(model)) };
    cache.set(cfg.id, e);
  }
  return e;
}
