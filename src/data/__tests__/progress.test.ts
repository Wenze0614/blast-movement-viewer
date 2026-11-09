/**
 * Download progress: ApiDataSource reports bytes per chunk against X-Payload-Bytes, and the data
 * pipeline turns it into store.loadProgress (model then movement for a blast load, movement alone
 * for a parameter change, cleared when the load ends or fails).
 */
import { describe, expect, it } from 'vitest';
import { getBlastConfig } from '@/core/blasts';
import { generateBlockModel } from '@/core/blockModel';
import { encodeModel } from '@/core/codec';
import { DEFAULT_BLAST_PARAMETERS } from '@/core/defaults';
import { computeMovement } from '@/core/movement';
import { buildBlastDetail, buildBlastSummary } from '@/core/holes';
import type { BlastParameters } from '@/core/types';
import { startDataPipeline } from '@/state/pipeline';
import { createAppStore, type LoadProgress } from '@/state/store';
import { ApiDataSource, readPayload } from '../api';
import type { DataSource, ProgressListener } from '../index';

/** A Response whose body arrives in `parts` chunks, with an X-Payload-Bytes header. */
function chunkedResponse(bytes: Uint8Array, parts: number, header = true): Response {
  const size = Math.ceil(bytes.byteLength / parts);
  let o = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (o >= bytes.byteLength) return c.close();
      c.enqueue(bytes.slice(o, o + size));
      o += size;
    },
  });
  return new Response(body, { headers: header ? { 'X-Payload-Bytes': String(bytes.byteLength) } : {} });
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}

describe('readPayload progress', () => {
  it('reports 0, then the bytes received per chunk up to the payload size; the payload is unchanged', async () => {
    const raw = encodeModel(generateBlockModel(getBlastConfig('b1040-031')!));
    const gz = await gzip(raw);
    const calls: [number, number | null][] = [];
    const out = new Uint8Array(await readPayload(chunkedResponse(gz, 5), (l, t) => calls.push([l, t])));
    expect(out).toEqual(raw); // inflated after reading
    expect(calls[0]).toEqual([0, gz.byteLength]);
    expect(calls.at(-1)).toEqual([gz.byteLength, gz.byteLength]);
    expect(calls.length).toBe(6);
    for (let i = 1; i < calls.length; i++) expect(calls[i][0]).toBeGreaterThan(calls[i - 1][0]);
  });

  it('without the size header the total is null; without a listener nothing changes', async () => {
    const data = new Uint8Array(1000).fill(7);
    const calls: (number | null)[] = [];
    await readPayload(chunkedResponse(data, 3, false), (_l, t) => calls.push(t));
    expect(new Set(calls)).toEqual(new Set([null]));
    expect(new Uint8Array(await readPayload(chunkedResponse(data, 3)))).toEqual(data);
  });

  it('ApiDataSource.getModel passes its listener through to the model download', async () => {
    const model = generateBlockModel(getBlastConfig('b1040-017')!);
    const gz = await gzip(encodeModel(model));
    const ds = new ApiDataSource({ fetch: async () => chunkedResponse(gz, 4) });
    const seen: number[] = [];
    const got = await ds.getModel('b1040-017', undefined, (l) => seen.push(l));
    expect(got.configHash).toBe(model.configHash);
    expect(seen.at(-1)).toBe(gz.byteLength);
  });
});

/** A data source whose model / movement report two progress steps each before resolving. */
function progressingSource(fail = false): DataSource {
  const cfg = getBlastConfig('b1040-017')!;
  const model = generateBlockModel(cfg);
  const report = async (onProgress?: ProgressListener) => {
    onProgress?.(0, 100);
    await Promise.resolve();
    onProgress?.(60, 100);
    await Promise.resolve();
    onProgress?.(100, 100);
  };
  return {
    kind: 'api',
    listBlasts: async () => [buildBlastSummary(cfg)],
    getBlast: async () => buildBlastDetail(cfg, model),
    async getModel(_id, _s, onProgress) {
      await report(onProgress);
      return model;
    },
    async getMovement(_id, params: BlastParameters, _s, onProgress) {
      await report(onProgress);
      if (fail) throw new Error('server error');
      return computeMovement(model, params);
    },
  };
}

function record(store: ReturnType<typeof createAppStore>) {
  const seen: (LoadProgress | null)[] = [];
  store.subscribe((s) => s.loadProgress, (p) => seen.push(p));
  return seen;
}

describe('pipeline → store.loadProgress', () => {
  it('a blast load: model step then movement step (both of a two-part bar), then cleared when ready', async () => {
    const store = createAppStore();
    const seen = record(store);
    const pipeline = startDataPipeline(store, progressingSource());
    await pipeline.settled;
    const steps = seen.filter(Boolean) as LoadProgress[];
    expect(steps[0]).toMatchObject({ step: 'model', withModel: true, loaded: 0 });
    expect(steps.some((s) => s.step === 'model' && s.loaded === 100)).toBe(true);
    const firstMovement = steps.findIndex((s) => s.step === 'movement');
    expect(firstMovement).toBeGreaterThan(0);
    expect(steps.slice(firstMovement).every((s) => s.step === 'movement' && s.withModel)).toBe(true);
    expect(store.getState().status).toBe('ready');
    expect(store.getState().loadProgress).toBeNull();
    pipeline.dispose();
  });

  it('a parameter change: the movement alone (withModel false), then cleared', async () => {
    const store = createAppStore();
    const pipeline = startDataPipeline(store, progressingSource());
    await pipeline.settled;
    const seen = record(store);
    store.getState().setParams({ ...DEFAULT_BLAST_PARAMETERS, maxThrow: 12 });
    await pipeline.settled;
    const steps = seen.filter(Boolean) as LoadProgress[];
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.step === 'movement' && !s.withModel)).toBe(true);
    expect(store.getState().loadProgress).toBeNull();
    pipeline.dispose();
  });

  it('a failed load clears the progress with the error', async () => {
    const store = createAppStore();
    const pipeline = startDataPipeline(store, progressingSource(true));
    await pipeline.settled;
    expect(store.getState().status).toBe('error');
    expect(store.getState().loadProgress).toBeNull();
    pipeline.dispose();
  });
});
