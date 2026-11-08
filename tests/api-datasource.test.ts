/**
 * End to end without a server: ApiDataSource → (fetch routed into the real route handlers) →
 * BMV1 decode → data pipeline → store. Checks the Stage-2 guarantees (superseded-load guard,
 * progress-0 rewind) still hold on the API path, and that killing the API falls back to local.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getBlasts } from '../app/api/blasts/route';
import { GET as getBlast } from '../app/api/blasts/[id]/route';
import { GET as getModel } from '../app/api/blasts/[id]/model/route';
import { GET as getMovement } from '../app/api/blasts/[id]/movement/route';
import { generateBlockModel } from '@/core/blockModel';
import { getBlastConfig } from '@/core/blasts';
import { computeMovement, isMovementFor } from '@/core/movement';
import { createDataSource, LocalDataSource } from '@/data';
import { startDataPipeline } from '@/state/pipeline';
import { createAppStore } from '@/state/store';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));

let apiUp = true;
/** Simulates a client bundle built against another config: its `?v=` is not the server's. */
let staleClient = false;
/** Movement requests are held until released, so tests can order responses. */
let gate: Promise<void> | null = null;

/** fetch → the app's GET handlers, as `next start` would route them. */
const routedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (!apiUp) throw new TypeError('fetch failed');
  const url = new URL(String(input), 'http://localhost');
  if (staleClient && url.searchParams.has('v')) url.searchParams.set('v', '0badc0de');
  const req = new Request(url, init);
  const path = new URL(req.url).pathname.split('/').filter(Boolean); // ['api','blasts',id?,leaf?]
  const ctx = { params: Promise.resolve({ id: path[2] }) };
  if (path.length === 2) return getBlasts();
  if (path.length === 3) return getBlast(req, ctx);
  if (path[3] === 'model') return getModel(req, ctx);
  if (gate) await gate;
  init?.signal?.throwIfAborted();
  return getMovement(req, ctx);
});

const cfg = getBlastConfig('b1040-017')!;
const model = generateBlockModel(cfg);

beforeEach(() => {
  apiUp = true;
  staleClient = false;
  gate = null;
  routedFetch.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function setup() {
  const store = createAppStore();
  const data = createDataSource({
    kind: 'api',
    api: { fetch: routedFetch },
    onFallback: (err) => store.getState().setFallback(String(err)),
  });
  return { store, data, pipeline: startDataPipeline(store, data) };
}

describe('ApiDataSource through the route handlers', () => {
  it('loads blast → model → movement from the API; source = api, latency recorded; identical to local', async () => {
    const { store, pipeline } = setup();
    await pipeline.settled;
    const s = store.getState();
    expect(s.status).toBe('ready');
    expect(s.source).toBe('api');
    expect(s.fallback).toBeNull();
    expect(typeof s.lastLatencyMs).toBe('number');
    expect(s.blasts.map((b) => b.id)).toEqual(['b1040-017', 'b1030-022', 'b1040-031']);
    expect(s.model!.configHash).toBe(model.configHash);
    const local = computeMovement(model, cfg.defaultParams);
    expect(s.movement!.paramsHash).toBe(local.paramsHash);
    expect(Array.from(s.movement!.end)).toEqual(Array.from(local.end));
    expect(s.reconciliation).not.toBeNull(); // derive ran on the decoded payloads
    const urls = routedFetch.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => /\/model\?v=[0-9a-f]{8}$/.test(u))).toBe(true);
    expect(urls.some((u) => /\/movement\?freeFace=east&initiation=v&rowDelayMs=42&holeDelayMs=25&maxThrow=10&.*&seed=42&v=[0-9a-f]{8}$/.test(u))).toBe(true);
    pipeline.dispose();
  });

  it('new params: rewinds to progress 0 at once; a superseded API response is never applied', async () => {
    const { store, pipeline } = setup();
    await pipeline.settled;
    store.getState().setProgress(1);
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    store.getState().setParams({ maxThrow: 14 });
    expect(store.getState().progress).toBe(0); // REWIND is atomic with the param change
    expect(store.getState().movement).toBeNull();
    store.getState().setParams({ maxThrow: 6 }); // supersedes the 14 m request (aborted)
    release();
    await pipeline.settled;
    const s = store.getState();
    expect(s.movement!.params.maxThrow).toBe(6);
    expect(s.movement!.paramsHash).toBe(computeMovement(model, { ...cfg.defaultParams, maxThrow: 6 }).paramsHash);
    expect(s.source).toBe('api');
    pipeline.dispose();
  });

  it('switching blast loads all three, including the 27,088-block dense blast', async () => {
    const { store, pipeline } = setup();
    await pipeline.settled;
    for (const id of ['b1030-022', 'b1040-031']) {
      store.getState().setBlastId(id);
      await pipeline.settled;
      expect(store.getState().blast!.id).toBe(id);
      expect(store.getState().model!.count).toBe(generateBlockModel(getBlastConfig(id)!).count);
      expect(store.getState().movement).not.toBeNull();
      expect(store.getState().source).toBe('api');
    }
    expect(store.getState().model!.count).toBe(27088);
    pipeline.dispose();
  });

  it('killing the API falls back to local compute (badge: Local fallback); recovery returns to api', async () => {
    const { store, pipeline } = setup();
    await pipeline.settled;
    apiUp = false;
    store.getState().setParams({ maxThrow: 12 });
    await pipeline.settled;
    let s = store.getState();
    expect(s.status).toBe('ready');
    expect(s.source).toBe('local');
    expect(s.fallback).toMatch(/fetch failed/);
    expect(s.movement!.paramsHash).toBe(
      (await new LocalDataSource().getMovement(cfg.id, { ...cfg.defaultParams, maxThrow: 12 })).paramsHash,
    );
    apiUp = true;
    store.getState().setParams({ maxThrow: 13 });
    await pipeline.settled;
    s = store.getState();
    expect(s.source).toBe('api');
    expect(s.fallback).toBeNull();
    pipeline.dispose();
  });

  it('a stale client (old ?v=) never gets the current model or movement: 409 → local for both, a consistent pair', async () => {
    staleClient = true;
    const { store, pipeline } = setup();
    await pipeline.settled;
    const s = store.getState();
    expect(s.status).toBe('ready');
    expect(s.source).toBe('local');
    expect(s.fallback).toMatch(/409 STALE_VERSION/);
    expect(isMovementFor(s.movement!, s.model!, s.params)).toBe(true);
    // Every model / movement request was refused: no server data reached this client.
    const binaryCalls = routedFetch.mock.calls
      .map(([u], i) => ({ url: String(u), result: routedFetch.mock.results[i] }))
      .filter(({ url }) => /\/(model|movement)\?/.test(url));
    expect(binaryCalls.length).toBeGreaterThanOrEqual(2);
    const statuses = await Promise.all(binaryCalls.map(async ({ result }) => (await (result.value as Promise<Response>)).status));
    expect(new Set(statuses)).toEqual(new Set([409]));
    pipeline.dispose();
  });
});
