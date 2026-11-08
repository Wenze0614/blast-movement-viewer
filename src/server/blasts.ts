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
import { apiError } from './binary';

interface Entry {
  model: BlockModel;
  detail: BlastDetail;
  modelBinary: Uint8Array<ArrayBuffer>;
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

/** Model, detail and the encoded model payload for a known blast (memoised). */
export function blastEntry(cfg: BlastConfig): Entry {
  let e = cache.get(cfg.id);
  if (!e) {
    const model = generateBlockModel(cfg);
    e = { model, detail: buildBlastDetail(cfg, model), modelBinary: encodeModel(model) };
    cache.set(cfg.id, e);
  }
  return e;
}
