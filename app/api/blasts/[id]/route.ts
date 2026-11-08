import type { BlastDetail } from '@/core/api-types';
import { blastEntry, findBlast } from '@/server/blasts';
import { apiError, CACHE, json } from '@/server/binary';

/** `GET /api/blasts/:id` → BlastDetail (§3.2) or a typed 404. */
export async function GET(_req: Request, ctx: RouteContext<'/api/blasts/[id]'>) {
  // Awaiting params makes this request-time (no generateStaticParams, Cache Components).
  const { id } = await ctx.params;
  const cfg = findBlast(id);
  if (!cfg) return apiError('NOT_FOUND', `Unknown blast ${id}`, 404);
  const body: BlastDetail = blastEntry(cfg).detail;
  return json(body, CACHE.hour);
}
