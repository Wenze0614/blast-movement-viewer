import { blastEntry, findBlast } from '@/server/blasts';
import { apiError, binary, CACHE } from '@/server/binary';

/**
 * `GET /api/blasts/:id/model[?v=<data version>]` → BMV1 kind=model (ADR-11). Immutable: the client
 * appends `?v=` (core blastDataVersion) so a changed config never hits a stale CDN entry.
 * ETag = the model's configHash.
 */
export async function GET(req: Request, ctx: RouteContext<'/api/blasts/[id]/model'>) {
  const { id } = await ctx.params; // request-time (Cache Components)
  const cfg = findBlast(id);
  if (!cfg) return apiError('NOT_FOUND', `Unknown blast ${id}`, 404);
  const { model, modelBinary } = blastEntry(cfg);
  return binary(modelBinary, { cacheControl: CACHE.immutable, etag: model.configHash, request: req });
}
