/**
 * LocalDataSource (docs/02-plan.md ADR-9, M10): runs src/core in the browser with the shared demo
 * blast configs (core/blasts.ts). Same deterministic code as the API, so results are identical.
 */
import { BLAST_CONFIGS, getBlastConfig, type BlastConfig } from '@/core/blasts';
import { generateBlockModel } from '@/core/blockModel';
import { buildBlastDetail, buildBlastSummary } from '@/core/holes';
import { computeMovement } from '@/core/movement';
import type { BlastDetail, BlastSummary } from '@/core/api-types';
import type { BlastParameters, BlockModel, MovementResult } from '@/core/types';
import type { DataSource } from './index';

/** A DOMException named 'AbortError', like fetch() rejects with. */
export function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Yield to the event loop so a synchronous compute doesn't block an abort that is already queued. */
const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class LocalDataSource implements DataSource {
  readonly kind = 'local' as const;
  /** Models are deterministic per config, so generate each once. */
  private readonly models = new Map<string, BlockModel>();

  private config(id: string): BlastConfig {
    const cfg = getBlastConfig(id);
    if (!cfg) throw new Error(`Unknown blast id: ${id}`);
    return cfg;
  }

  private model(id: string): BlockModel {
    let model = this.models.get(id);
    if (!model) {
      model = generateBlockModel(this.config(id));
      this.models.set(id, model);
    }
    return model;
  }

  async listBlasts(): Promise<BlastSummary[]> {
    return BLAST_CONFIGS.map(buildBlastSummary);
  }

  async getBlast(id: string): Promise<BlastDetail> {
    return buildBlastDetail(this.config(id), this.model(id));
  }

  async getModel(id: string, signal?: AbortSignal): Promise<BlockModel> {
    throwIfAborted(signal);
    await nextTick();
    throwIfAborted(signal);
    return this.model(id);
  }

  async getMovement(id: string, params: BlastParameters, signal?: AbortSignal): Promise<MovementResult> {
    throwIfAborted(signal);
    await nextTick();
    throwIfAborted(signal);
    const result = computeMovement(this.model(id), params);
    throwIfAborted(signal);
    return result;
  }
}
