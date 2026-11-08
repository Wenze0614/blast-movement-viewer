/**
 * LocalDataSource's compute seam (data/computeClient.ts) and its Web Worker (data/compute.worker.ts),
 * without a real Worker: the worker script runs against a fake `self`, and the client talks to a
 * fake Worker that forwards to it. Results must equal inline compute exactly.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BLAST_PARAMETERS } from '@/core/defaults';
import { inlineCompute, workerCompute } from '../computeClient';
import type { ComputeReply, ComputeRequest } from '../computeProtocol';
import { LocalDataSource } from '../local';

type Scope = { onmessage: ((e: { data: ComputeRequest }) => void) | null; postMessage: (m: ComputeReply, t?: Transferable[]) => void };
const g = globalThis as unknown as { self?: Scope };
let saved: Scope | undefined;
const replies: { msg: ComputeReply; transfer?: Transferable[] }[] = [];
let scope: Scope;

beforeAll(async () => {
  saved = g.self;
  scope = { onmessage: null, postMessage: (msg, transfer) => replies.push({ msg, transfer }) };
  g.self = scope;
  await import('../compute.worker');
});
afterAll(() => {
  g.self = saved;
});

/** A fake Worker: postMessage runs the worker script; its replies come back on onmessage, async. */
function fakeWorker() {
  const w = {
    onmessage: null as ((e: MessageEvent<ComputeReply>) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    postMessage: vi.fn((req: ComputeRequest) => {
      replies.length = 0;
      scope.onmessage!({ data: req });
      const out = replies.splice(0);
      setTimeout(() => out.forEach(({ msg }) => w.onmessage?.({ data: structuredClone(msg) } as MessageEvent<ComputeReply>)), 0);
    }),
  };
  return w;
}

describe('compute worker script', () => {
  it('answers model, detail and movement; transfers the movement arrays; reports errors by id', () => {
    replies.length = 0;
    scope.onmessage!({ data: { id: 1, op: 'model', blastId: 'b1040-017' } });
    scope.onmessage!({ data: { id: 2, op: 'detail', blastId: 'b1040-017' } });
    scope.onmessage!({ data: { id: 3, op: 'movement', blastId: 'b1040-017', params: DEFAULT_BLAST_PARAMETERS } });
    scope.onmessage!({ data: { id: 4, op: 'model', blastId: 'nope' } });
    expect(replies.map((r) => [r.msg.id, r.msg.ok])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, false],
    ]);
    expect(replies[0].transfer).toBeUndefined(); // the worker keeps its model: copies only
    expect(replies[2].transfer).toHaveLength(6);
    expect((replies[3].msg as { error: string }).error).toMatch(/Unknown blast id/);
  });
});

describe('workerCompute (client side)', () => {
  it('returns exactly what inline compute returns; one model request per blast', async () => {
    const worker = fakeWorker();
    const viaWorker = workerCompute(worker as unknown as Worker);
    const inline = inlineCompute();
    const [m1, m2] = await Promise.all([viaWorker.model('b1030-022'), viaWorker.model('b1030-022')]);
    expect(m1).toBe(m2);
    expect(worker.postMessage.mock.calls.filter(([r]) => r.op === 'model')).toHaveLength(1);
    const want = await inline.model('b1030-022');
    expect(Array.from(m1.grade)).toEqual(Array.from(want.grade));
    expect(m1.configHash).toBe(want.configHash);
    const mv = await viaWorker.movement('b1030-022', DEFAULT_BLAST_PARAMETERS);
    const wantMv = await inline.movement('b1030-022', DEFAULT_BLAST_PARAMETERS);
    expect(mv.paramsHash).toBe(wantMv.paramsHash);
    expect(Array.from(mv.end)).toEqual(Array.from(wantMv.end));
    expect((await viaWorker.detail('b1030-022')).holes).toEqual((await inline.detail('b1030-022')).holes);
  });

  it('a failed request rejects with the worker\'s message; a worker error rejects everything pending', async () => {
    const worker = fakeWorker();
    const c = workerCompute(worker as unknown as Worker);
    await expect(c.model('nope')).rejects.toThrow(/Unknown blast id/);
    const stuck = { ...fakeWorker(), postMessage: vi.fn() };
    const c2 = workerCompute(stuck as unknown as Worker);
    const p = c2.movement('b1040-017', DEFAULT_BLAST_PARAMETERS);
    stuck.onerror!({ message: 'boom' } as ErrorEvent);
    await expect(p).rejects.toThrow(/compute worker failed: boom/);
  });

  it('LocalDataSource over a worker compute: an abort rejects at once, the late result is dropped', async () => {
    const ds = new LocalDataSource(workerCompute(fakeWorker() as unknown as Worker));
    const ctrl = new AbortController();
    const p = ds.getMovement('b1040-017', DEFAULT_BLAST_PARAMETERS, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    const model = await ds.getModel('b1040-017');
    expect(model.count).toBe(3200);
  });
});
