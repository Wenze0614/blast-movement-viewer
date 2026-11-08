import { binaryCacheControl, blastEntry, findBlast, versionMismatch } from '@/server/blasts';
import { apiError, binary } from '@/server/binary';

/**
 * `GET /api/blasts/:id/model[?v=<data version>]` → BMV1 kind=model (ADR-11). Immutable: the client
 * appends `?v=` (core blastDataVersion) so a changed config never hits a stale CDN entry.
 * ETag = the model's configHash. A stale `v` → 409 STALE_VERSION (see versionMismatch); without
 * `v` the response gets a short cache policy instead of immutable (binaryCacheControl).
 */
export async function GET(req: Request, ctx: RouteContext<'/api/blasts/[id]/model'>) {
  const { id } = await ctx.params; // request-time (Cache Components)
  const cfg = findBlast(id);
  if (!cfg) return apiError('NOT_FOUND', `Unknown blast ${id}`, 404);
  const stale = versionMismatch(cfg, req.url);
  if (stale) return stale;
  const { model, modelBinary } = blastEntry(cfg);
  return binary(modelBinary, { cacheControl: binaryCacheControl(cfg, req.url), etag: model.configHash, request: req });
}
