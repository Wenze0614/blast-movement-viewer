import { encodeMovement } from '@/core/codec';
import { hashParams } from '@/core/hash';
import { computeMovement, modelHashContext } from '@/core/movement';
import { blastEntry, findBlast } from '@/server/blasts';
import { apiError, binary, CACHE, etagMatches, notModified } from '@/server/binary';
import { issueDetails, MovementQuery, queryObject } from '@/server/schemas';

/**
 * `GET /api/blasts/:id/movement?freeFace=…&maxThrow=…&…&seed=…[&v=…]` → BMV1 kind=movement.
 * Params are zod-validated against the ADR-12 ranges (400 + ApiError otherwise) and canonicalised
 * (2 dp, uint32 seed) before computing. `ETag` = paramsHash; If-None-Match → 304 without computing.
 */
export async function GET(req: Request, ctx: RouteContext<'/api/blasts/[id]/movement'>) {
  const { id } = await ctx.params; // request-time (Cache Components); req.url also opts out
  const cfg = findBlast(id);
  if (!cfg) return apiError('NOT_FOUND', `Unknown blast ${id}`, 404);
  const q = MovementQuery.safeParse(queryObject(new URL(req.url).searchParams));
  if (!q.success) return apiError('INVALID_PARAMS', 'Invalid movement parameters', 400, issueDetails(q.error));

  const { model } = blastEntry(cfg);
  // The ETag is known before computing: a revalidation costs a hash, not a movement run.
  const etag = hashParams(q.data, modelHashContext(model));
  if (etagMatches(req.headers.get('if-none-match'), etag)) return notModified({ cacheControl: CACHE.immutable, etag });
  try {
    const result = computeMovement(model, q.data);
    return binary(encodeMovement(result, model.configHash), { cacheControl: CACHE.immutable, etag: result.paramsHash });
  } catch (err) {
    console.error('[api] movement failed', err);
    return apiError('INTERNAL', 'Movement computation failed', 500);
  }
}
