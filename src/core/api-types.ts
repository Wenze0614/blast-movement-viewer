/**
 * API contracts (docs/02-plan.md §3.2). Zod schemas mirroring these live in src/server/schemas.ts.
 *
 * CONTRACT FILE: changes need an explicit note in the PR description (see CLAUDE.md).
 */
import type { BlastParameters, DigPolygon, GradeSettings, GridSpec, Vec3 } from './types';

export interface BlastSummary {
  /** 'b1040-017' */
  id: string;
  /** 'Bench 1040 · Blast 017' */
  name: string;
  /** 'Single dipping lens crossing the throw direction' */
  description: string;
  /** 3840 */
  blockCount: number;
  /** m, toe elevation, e.g. 1030 */
  benchRL: number;
  freeFace: BlastParameters['freeFace'];
}

/** DISPLAY ONLY — not used by the movement heuristic. */
export interface BlastPattern {
  /** m, 4.0 */
  burden: number;
  /** m, 4.6 */
  spacing: number;
  /** 115 */
  holeDiameterMm: number;
  /** m, 1.0 */
  subdrill: number;
  /** 25 */
  rows: number;
  /** 13 */
  holesPerRow: number;
}

export interface BlastHole {
  /** 'R07-H03' */
  id: string;
  /** row 0 = front, nearest free face */
  row: number;
  /** m, e.g. [74.0, 13.8, 1040.0] */
  collar: Vec3;
  /** m, e.g. [74.0, 13.8, 1029.0] */
  toe: Vec3;
  /** g/t (synthetic: column mean of model + noise) */
  sampledGrade: number;
}

export interface BlastDetail extends BlastSummary {
  grid: GridSpec;
  grades: GradeSettings;
  pattern: BlastPattern;
  /** ~325 */
  holes: BlastHole[];
  defaultParams: BlastParameters;
  /** 'Synthetic data. Heuristic movement model, not physics.' */
  disclaimer: string;
}

/**
 * `STALE_VERSION` (409): the request's `?v=` data version is not the server's current one
 * (an old client after a deploy). Never cached; the client falls back to local compute so its
 * model and movement stay a consistent pair.
 */
export type ApiErrorCode = 'NOT_FOUND' | 'INVALID_PARAMS' | 'STALE_VERSION' | 'INTERNAL';

export interface ApiError {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

/** `GET /api/health` */
export interface HealthResponse {
  ok: true;
  version: string;
}

/** Stretch S1. Persistence decided as URL hash (plan §9 Q6); kept as the share payload shape. */
export interface SavedScenario {
  /** 'k3J9xQ' (nanoid) */
  id: string;
  /** 'b1040-017' */
  blastId: string;
  /** 'High throw, low swell' */
  name: string;
  params: BlastParameters;
  /** with the editable dig line (S4) */
  manualPolygon?: DigPolygon;
  /** ISO 8601 */
  createdAt: string;
}
