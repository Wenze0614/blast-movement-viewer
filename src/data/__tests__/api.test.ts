/**
 * ApiDataSource + FallbackDataSource (ADR-9, P8) against a fake fetch that serves core-encoded
 * payloads. The real route handlers are exercised end to end in tests/api-datasource.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blastDataVersion, getBlastConfig } from '@/core/blasts';
import { generateBlockModel } from '@/core/blockModel';
import { encodeModel, encodeMovement } from '@/core/codec';
import { canonicalParamsString } from '@/core/hash';
import { computeMovement } from '@/core/movement';
import { ApiDataSource, ApiRequestError, FallbackDataSource, LocalDataSource, isAbortError, modelPath, movementPath } from '..';

const ID = 'b1040-017';
const cfg = getBlastConfig(ID)!;
const model = generateBlockModel(cfg);
const params = cfg.defaultParams;
const movement = computeMovement(model, params);

type Handler = (url: URL, init?: RequestInit) => Promise<Response>;

/** A fetch that serves the demo blast from core (like the routes do). */
const serve: Handler = async (url) => {
  if (url.pathname === '/api/blasts') return Response.json([{ id: ID }]);
  if (url.pathname.endsWith('/model')) return new Response(encodeModel(model));
  if (url.pathname.endsWith('/movement')) return new Response(encodeMovement(movement, model.configHash));
  return Response.json({ error: { code: 'NOT_FOUND', message: 'nope' } }, { status: 404 });
};

function fakeFetch(handler: Handler) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input), 'http://x'), init));
}

/** A fetch that only settles when its signal aborts (like a hung server). */
const hang: Handler = (_url, init) =>
  new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('ApiDataSource', () => {
  it('URLs: model and movement carry the data version; movement params are canonical', () => {
    const v = blastDataVersion(cfg);
    expect(modelPath(ID)).toBe(`/api/blasts/${ID}/model?v=${v}`);
    expect(movementPath(ID, { ...params, maxThrow: 10.004 })).toBe(
      `/api/blasts/${ID}/movement?${canonicalParamsString(params)}&v=${v}`,
    );
  });

  it('decodes model + movement (identical to local compute); the model is fetched once', async () => {
    const f = fakeFetch(serve);
    const api = new ApiDataSource({ fetch: f });
    const m = await api.getModel(ID);
    expect(m.configHash).toBe(model.configHash);
    const mv = await api.getMovement(ID, params);
    expect(mv.paramsHash).toBe(movement.paramsHash);
    expect(Array.from(mv.end)).toEqual(Array.from(movement.end));
    expect(f.mock.calls.map(([u]) => new URL(String(u), 'http://x').pathname)).toEqual([
      `/api/blasts/${ID}/model`,
      `/api/blasts/${ID}/movement`,
    ]);
  });

  it.each([
    ['409 STALE_VERSION', async () => Response.json({ error: { code: 'STALE_VERSION', message: 'old v' } }, { status: 409 })],
    ['a movement for another model (MODEL_MISMATCH)', async () => {
      const other = generateBlockModel({ ...cfg, seed: cfg.seed + 1 });
      return new Response(encodeMovement(computeMovement(other, params), other.configHash));
    }],
  ] as const)('%s on the movement drops the cached API model, so the next getModel refetches', async (_name, movementResponse) => {
    let failMovement = true;
    const f = fakeFetch(async (url, init) =>
      url.pathname.endsWith('/movement') && failMovement ? movementResponse() : serve(url, init),
    );
    const api = new ApiDataSource({ fetch: f });
    await api.getModel(ID); // cached
    await expect(api.getMovement(ID, params)).rejects.toThrow();
    failMovement = false;
    const modelFetches = () => f.mock.calls.filter(([u]) => String(u).includes('/model')).length;
    expect(modelFetches()).toBe(1);
    await api.getModel(ID);
    expect(modelFetches()).toBe(2); // evicted → refetched
    await api.getModel(ID);
    expect(modelFetches()).toBe(2); // cached again
  });

  it('non-2xx → ApiRequestError with the typed ApiError code', async () => {
    const api = new ApiDataSource({
      fetch: fakeFetch(async () => Response.json({ error: { code: 'INVALID_PARAMS', message: 'bad' } }, { status: 400 })),
    });
    const err = await api.getMovement(ID, params).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 400, code: 'INVALID_PARAMS' });
  });

  it('honours AbortSignal: already aborted, and aborted mid-request', async () => {
    const api = new ApiDataSource({ fetch: fakeFetch(hang) });
    const pre = new AbortController();
    pre.abort();
    expect(isAbortError(await api.getModel(ID, pre.signal).catch((e: unknown) => e))).toBe(true);
    const mid = new AbortController();
    const p = api.getMovement(ID, params, mid.signal).catch((e: unknown) => e);
    mid.abort();
    expect(isAbortError(await p)).toBe(true);
  });
});

describe('FallbackDataSource (automatic fallback to local)', () => {
  const failures: [string, Handler][] = [
    ['network error', async () => Promise.reject(new TypeError('fetch failed'))],
    ['HTTP 500', async () => new Response('boom', { status: 500 })],
    ['decode error (not BMV1)', async (url) => (url.pathname.endsWith('/model') ? new Response('<html>') : serve(url))],
  ];

  it.each(failures)('%s → served by local compute; kind = local; onFallback called', async (_label, handler) => {
    const onFallback = vi.fn();
    const ds = new FallbackDataSource(new ApiDataSource({ fetch: fakeFetch(handler) }), new LocalDataSource(), onFallback);
    const m = await ds.getModel(ID);
    expect(m.configHash).toBe(model.configHash);
    expect(ds.kind).toBe('local');
    expect(onFallback).toHaveBeenCalledOnce();
    const mv = await ds.getMovement(ID, params);
    expect(mv.paramsHash).toBe(movement.paramsHash);
  });

  it('a timeout counts as a failure (falls back), not as an abort', async () => {
    const ds = new FallbackDataSource(new ApiDataSource({ fetch: fakeFetch(hang), timeoutMs: 20 }));
    const m = await ds.getModel(ID);
    expect(m.count).toBe(model.count);
    expect(ds.kind).toBe('local');
  });

  it('an abort is not a failure: rejects with AbortError and never falls back', async () => {
    const onFallback = vi.fn();
    const ds = new FallbackDataSource(new ApiDataSource({ fetch: fakeFetch(hang) }), new LocalDataSource(), onFallback);
    const ctrl = new AbortController();
    const p = ds.getMovement(ID, params, ctrl.signal).catch((e: unknown) => e);
    ctrl.abort();
    expect(isAbortError(await p)).toBe(true);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('every call retries the API first: kind returns to api once the API recovers', async () => {
    let down = true;
    const ds = new FallbackDataSource(
      new ApiDataSource({ fetch: fakeFetch((url) => (down ? Promise.reject(new TypeError('offline')) : serve(url))) }),
    );
    await ds.getModel(ID);
    expect(ds.kind).toBe('local');
    down = false;
    await ds.getMovement(ID, params);
    expect(ds.kind).toBe('api');
  });

  it('listBlasts / getBlast fall back too (without changing kind)', async () => {
    const ds = new FallbackDataSource(new ApiDataSource({ fetch: fakeFetch(() => Promise.reject(new TypeError('x'))) }));
    expect((await ds.listBlasts()).length).toBe(3);
    expect((await ds.getBlast(ID)).id).toBe(ID);
    expect(ds.kind).toBe('api');
  });
});
