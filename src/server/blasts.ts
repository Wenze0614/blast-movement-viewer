/**
 * Server-side access to the seeded demo blasts (docs/02-plan.md ADR-10): the API is a thin BFF
 * over core. Models are deterministic per config, so each is generated and encoded once per
 * server instance; movement is computed per request (< 100 ms) and cached by the CDN (ADR-12).
 */
import { BLAST_CONFIGS, getBlastConfig, type BlastConfig } from '@/core/blasts';
import { generateBlockModel } from '@/core/blockModel';
import { encodeModel } from '@/core/codec';
import { buildBlastDetail, buildBlastSummary } from '@/core/holes';
import type { BlastDetail, BlastSummary } from '@/core/api-types';
import type { BlockModel } from '@/core/types';

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
