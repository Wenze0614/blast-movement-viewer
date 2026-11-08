/**
 * Web Worker for LocalDataSource (data/computeClient.ts): generates block models, blast details
 * and movements off the main thread, so a large local compute (about 1 s + 1.7 s at 2 million
 * blocks) never freezes the page. Pure core code, the same as the API runs.
 *
 * Models are kept here (movement needs them) and posted as copies; a movement's arrays are
 * transferred (the worker has no further use for them).
 */
import { getBlastConfig } from '@/core/blasts';
import { generateBlockModel } from '@/core/blockModel';
import { buildBlastDetail } from '@/core/holes';
import { computeMovement } from '@/core/movement';
import type { BlockModel } from '@/core/types';
import type { ComputeReply, ComputeRequest } from './computeProtocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent<ComputeRequest>) => void) | null;
  postMessage(message: ComputeReply, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

const models = new Map<string, BlockModel>();

function model(id: string): BlockModel {
  let m = models.get(id);
  if (!m) {
    const cfg = getBlastConfig(id);
    if (!cfg) throw new Error(`Unknown blast id: ${id}`);
    m = generateBlockModel(cfg);
    models.set(id, m);
  }
  return m;
}

scope.onmessage = (e) => {
  const req = e.data;
  try {
    if (req.op === 'model') {
      scope.postMessage({ id: req.id, ok: true, op: 'model', value: model(req.blastId) });
    } else if (req.op === 'detail') {
      scope.postMessage({ id: req.id, ok: true, op: 'detail', value: buildBlastDetail(getBlastConfig(req.blastId)!, model(req.blastId)) });
    } else {
      const value = computeMovement(model(req.blastId), req.params);
      const transfer = [value.start, value.end, value.displacement, value.distance, value.delay, value.surface.height].map((a) => a.buffer);
      scope.postMessage({ id: req.id, ok: true, op: 'movement', value }, transfer);
    }
  } catch (err) {
    scope.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
