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
import { ApiDataSource, FallbackDataSource, type ApiDataSourceOptions } from './api';
import { LocalDataSource } from './local';

export { LocalDataSource, isAbortError } from './local';
export { ApiDataSource, ApiRequestError, FallbackDataSource, modelPath, movementPath } from './api';
export type { ApiDataSourceOptions } from './api';

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
   * Called each time an API call fails and local compute serves it instead (the UI shows a
   * "Local fallback" badge). Aborts are not failures.
   */
  onFallback?: (error: unknown) => void;
  /** API source options (base URL, fetch, timeout); tests inject a fetch. */
  api?: ApiDataSourceOptions;
}

/**
 * Factory (ADR-9). 'api' (the default, in production and in dev, where the same app serves the
 * routes) → the API with automatic fallback to local compute; 'local' → local compute only.
 */
export function createDataSource(options: CreateDataSourceOptions = {}): DataSource {
  const kind = options.kind ?? parseKind(process.env.NEXT_PUBLIC_DATA_SOURCE) ?? 'api';
  if (kind === 'local') return new LocalDataSource();
  return new FallbackDataSource(new ApiDataSource(options.api), new LocalDataSource(), options.onFallback);
}

function parseKind(value: string | undefined): DataSourceKind | undefined {
  return value === 'api' || value === 'local' ? value : undefined;
}
