/**
 * LocalDataSource (docs/02-plan.md ADR-9, M10): runs src/core in the browser with the shared demo
 * blast configs (core/blasts.ts). Same deterministic code as the API, so results are identical.
 * Where core runs (inline or in a Web Worker) is a LocalCompute (computeClient.ts).
 */
import { BLAST_CONFIGS, getBlastConfig, type BlastConfig } from '@/core/blasts';
import { buildBlastSummary } from '@/core/holes';
import type { BlastDetail, BlastSummary } from '@/core/api-types';
import type { BlastParameters, BlockModel, MovementResult } from '@/core/types';
import { inlineCompute, type LocalCompute } from './computeClient';
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

export class LocalDataSource implements DataSource {
  readonly kind = 'local' as const;
  private readonly compute: LocalCompute;

  /**
   * `compute`: where core runs. Inline by default (tests, the pipeline's last resort); the app
   * passes a Web Worker compute (createDataSource) so large blasts never block the main thread.
   */
  constructor(compute: LocalCompute = inlineCompute()) {
    this.compute = compute;
  }

  private config(id: string): BlastConfig {
    const cfg = getBlastConfig(id);
    if (!cfg) throw new Error(`Unknown blast id: ${id}`);
    return cfg;
  }

  async listBlasts(): Promise<BlastSummary[]> {
    return BLAST_CONFIGS.map(buildBlastSummary);
  }

  async getBlast(id: string): Promise<BlastDetail> {
    this.config(id);
    return this.compute.detail(id);
  }

  async getModel(id: string, signal?: AbortSignal): Promise<BlockModel> {
    throwIfAborted(signal);
    this.config(id);
    const model = await abortable(this.compute.model(id), signal);
    throwIfAborted(signal);
    return model;
  }

  async getMovement(id: string, params: BlastParameters, signal?: AbortSignal): Promise<MovementResult> {
    throwIfAborted(signal);
    this.config(id);
    const result = await abortable(this.compute.movement(id, params), signal);
    throwIfAborted(signal);
    return result;
  }
}

/**
 * Settle with `work`, or reject with an AbortError as soon as `signal` aborts (the work itself runs
 * to completion in the background and its result is dropped).
 */
function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
