/**
 * ApiDataSource (docs/02-plan.md ADR-9, P8): `fetch` + the shared BMV1 codec, and
 * FallbackDataSource, which serves each call from the API and falls back to LocalDataSource when
 * the API fails (network error, non-2xx, decode error, timeout). Aborts are never failures: an
 * aborted call rejects with AbortError and does not fall back.
 */
import type { ApiError, BlastDetail, BlastSummary } from '@/core/api-types';
import { blastDataVersion, getBlastConfig } from '@/core/blasts';
import { CodecError, decodeModel, decodeMovement } from '@/core/codec';
import { canonicalParamsString } from '@/core/hash';
import type { BlastParameters, BlockModel, MovementResult } from '@/core/types';
import type { DataSource, DataSourceKind } from './index';
import { isAbortError, LocalDataSource } from './local';

/** A non-2xx API response. `code` comes from the typed ApiError body when there is one. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(`API ${status} ${code}: ${message}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

export interface ApiDataSourceOptions {
  /** Prefix for `/api/...`; '' = same origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** ms before a request counts as failed (→ fallback). Default 10 s. */
  timeoutMs?: number;
}

/** `?v=` for the immutable model / movement URLs: the blast's data version (core/blasts.ts). */
function versionQuery(id: string): string {
  const cfg = getBlastConfig(id);
  return cfg ? `v=${blastDataVersion(cfg)}` : '';
}

export function modelPath(id: string): string {
  const v = versionQuery(id);
  return `/api/blasts/${encodeURIComponent(id)}/model${v ? `?${v}` : ''}`;
}

/** Canonical query (fixed key order, 2 dp) so equal params always hit the same CDN entry. */
export function movementPath(id: string, params: BlastParameters): string {
  const v = versionQuery(id);
  return `/api/blasts/${encodeURIComponent(id)}/movement?${canonicalParamsString(params)}${v ? `&${v}` : ''}`;
}

export class ApiDataSource implements DataSource {
  readonly kind = 'api' as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  /** Decoded models by blast id: movement payloads decode against them (start = centroid). */
  private readonly models = new Map<string, BlockModel>();

  constructor(options: ApiDataSourceOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async request(path: string, signal?: AbortSignal): Promise<Response> {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      let code = 'HTTP_ERROR';
      let message = res.statusText || `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as Partial<ApiError>;
        if (body.error) ({ code, message } = body.error);
      } catch {
        // not a typed error body
      }
      throw new ApiRequestError(res.status, code, message);
    }
    return res;
  }

  private async json<T>(path: string, signal?: AbortSignal): Promise<T> {
    return (await (await this.request(path, signal)).json()) as T;
  }

  listBlasts(): Promise<BlastSummary[]> {
    return this.json<BlastSummary[]>('/api/blasts');
  }

  getBlast(id: string): Promise<BlastDetail> {
    return this.json<BlastDetail>(`/api/blasts/${encodeURIComponent(id)}`);
  }

  /**
   * Resolved models are cached (deterministic per data version); in-flight fetches are not shared,
   * so one caller's abort never rejects another caller's request.
   */
  async getModel(id: string, signal?: AbortSignal): Promise<BlockModel> {
    const cached = this.models.get(id);
    if (cached) {
      signal?.throwIfAborted();
      return cached;
    }
    const res = await this.request(modelPath(id), signal);
    const model = decodeModel(await res.arrayBuffer());
    this.models.set(id, model);
    return model;
  }

  async getMovement(id: string, params: BlastParameters, signal?: AbortSignal): Promise<MovementResult> {
    const [model, res] = await Promise.all([this.getModel(id, signal), this.request(movementPath(id, params), signal)]);
    try {
      return decodeMovement(await res.arrayBuffer(), model);
    } catch (err) {
      // The server's model changed under our cached one: drop it so the next getModel refetches.
      if (err instanceof CodecError && err.code === 'MODEL_MISMATCH') this.models.delete(id);
      throw err;
    }
  }
}

/**
 * The API with automatic fallback. `kind` is the source that served the most recent model or
 * movement (the pipeline reads it right after each await to fill `store.source`). Every call
 * tries the API first, so the app recovers by itself when the API comes back.
 */
export class FallbackDataSource implements DataSource {
  private served: DataSourceKind = 'api';

  constructor(
    readonly primary: DataSource,
    readonly fallback: DataSource = new LocalDataSource(),
    private readonly onFallback?: (error: unknown) => void,
  ) {}

  get kind(): DataSourceKind {
    return this.served;
  }

  private async run<T>(call: (ds: DataSource) => Promise<T>, signal?: AbortSignal, tracks = false): Promise<T> {
    try {
      const result = await call(this.primary);
      if (tracks) this.served = this.primary.kind;
      return result;
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err;
      console.warn('[bmv] API failed; falling back to local compute.', err);
      this.onFallback?.(err);
      const result = await call(this.fallback);
      if (tracks) this.served = this.fallback.kind;
      return result;
    }
  }

  listBlasts(): Promise<BlastSummary[]> {
    return this.run((ds) => ds.listBlasts());
  }

  getBlast(id: string): Promise<BlastDetail> {
    return this.run((ds) => ds.getBlast(id));
  }

  getModel(id: string, signal?: AbortSignal): Promise<BlockModel> {
    return this.run((ds) => ds.getModel(id, signal), signal, true);
  }

  getMovement(id: string, params: BlastParameters, signal?: AbortSignal): Promise<MovementResult> {
    return this.run((ds) => ds.getMovement(id, params, signal), signal, true);
  }
}
