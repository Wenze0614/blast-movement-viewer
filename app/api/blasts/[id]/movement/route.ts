import { encodeMovement } from '@/core/codec';
import { hashParams } from '@/core/hash';
import { computeMovement, modelHashContext } from '@/core/movement';
import { binaryCacheControl, blastEntry, findBlast, versionMismatch } from '@/server/blasts';
import { apiError, binary, etagMatches, notModified } from '@/server/binary';
import { issueDetails, MovementQuery, queryObject } from '@/server/schemas';

/**
 * `GET /api/blasts/:id/movement?freeFace=…&maxThrow=…&…&seed=…[&v=…]` → BMV1 kind=movement.
 * Params are zod-validated against the ADR-12 ranges (400 + ApiError otherwise) and canonicalised
 * (2 dp, uint32 seed) before computing. `ETag` = paramsHash; If-None-Match → 304 without computing.
 * A stale `v` → 409 STALE_VERSION: an old client never gets a newer model's movement. Cache-Control
 * is immutable only behind the current `v`; without `v` it is short (binaryCacheControl).
 */
export async function GET(req: Request, ctx: RouteContext<'/api/blasts/[id]/movement'>) {
  const { id } = await ctx.params; // request-time (Cache Components); req.url also opts out
  const cfg = findBlast(id);
  if (!cfg) return apiError('NOT_FOUND', `Unknown blast ${id}`, 404);
  const q = MovementQuery.safeParse(queryObject(new URL(req.url).searchParams));
  if (!q.success) return apiError('INVALID_PARAMS', 'Invalid movement parameters', 400, issueDetails(q.error));
  const stale = versionMismatch(cfg, req.url);
  if (stale) return stale;

  const cacheControl = binaryCacheControl(cfg, req.url);
  const { model } = blastEntry(cfg);
  // The ETag is known before computing: a revalidation costs a hash, not a movement run.
  const etag = hashParams(q.data, modelHashContext(model));
  if (etagMatches(req.headers.get('if-none-match'), etag)) return notModified({ cacheControl, etag });
  try {
    const result = computeMovement(model, q.data);
    return binary(encodeMovement(result, model.configHash), { cacheControl, etag: result.paramsHash });
  } catch (err) {
    console.error('[api] movement failed', err);
    return apiError('INTERNAL', 'Movement computation failed', 500);
  }
}
