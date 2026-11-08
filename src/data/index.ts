/**
 * DataSource: the ONLY seam between the client and the backend (docs/02-plan.md ADR-9).
 *
 * - `LocalDataSource` (data/local.ts) runs src/core in the browser.
 * - `ApiDataSource` (data/api.ts) fetches binary BMV1 payloads and decodes them with core/codec.
 * Swapping one for the other must change no UI or engine code.
 *
 * CONTRACT FILE: changes need an explicit note in the PR description (see CLAUDE.md).
 */
import type { BlastDetail, BlastSummary } from '@/core/api-types';
import type { BlastParameters, BlockModel, MovementResult } from '@/core/types';

export type DataSourceKind = 'api' | 'local';

export interface DataSource {
  readonly kind: DataSourceKind;
  listBlasts(): Promise<BlastSummary[]>;
  getBlast(id: string): Promise<BlastDetail>;
  getModel(id: string, signal?: AbortSignal): Promise<BlockModel>;
  getMovement(id: string, params: BlastParameters, signal?: AbortSignal): Promise<MovementResult>;
}

export interface CreateDataSourceOptions {
  /** Defaults to `process.env.NEXT_PUBLIC_DATA_SOURCE`, then 'api'. */
  kind?: DataSourceKind;
  /**
   * Called once when an API call fails and the source falls back to local compute
   * (the UI shows an "offline mode" toast). Aborts are not failures.
   */
  onFallback?: (error: unknown) => void;
}

/**
 * Factory + fallback. Returns an API source that falls back to local on error, or a pure
 * local source. Implemented in a later stage (LocalDataSource at Checkpoint 1, ApiDataSource with
 * the API workstream).
 */
export function createDataSource(options: CreateDataSourceOptions = {}): DataSource {
  void options;
  throw new Error('createDataSource: not implemented yet (Stage 0 declares the contract only).');
}
