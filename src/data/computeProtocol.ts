/**
 * Messages between LocalDataSource's compute client (computeClient.ts) and its Web Worker
 * (compute.worker.ts).
 */
import type { BlastDetail } from '@/core/api-types';
import type { BlastParameters, BlockModel, MovementResult } from '@/core/types';

export type ComputeRequest =
  | { id: number; op: 'model'; blastId: string }
  | { id: number; op: 'detail'; blastId: string }
  | { id: number; op: 'movement'; blastId: string; params: BlastParameters };

/** A request before the client numbers it (Omit distributed over the union). */
export type ComputeRequestBody = ComputeRequest extends infer R ? (R extends ComputeRequest ? Omit<R, 'id'> : never) : never;

export type ComputeReply =
  | { id: number; ok: true; op: 'model'; value: BlockModel }
  | { id: number; ok: true; op: 'detail'; value: BlastDetail }
  | { id: number; ok: true; op: 'movement'; value: MovementResult }
  | { id: number; ok: false; error: string };
