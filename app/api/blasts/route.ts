import { connection } from 'next/server';
import type { BlastSummary } from '@/core/api-types';
import { listBlastSummaries } from '@/server/blasts';
import { CACHE, json } from '@/server/binary';

/** `GET /api/blasts` → BlastSummary[] (§3.2), CDN-cached for an hour. */
export async function GET() {
  // Request-time (Cache Components): a prerendered route handler's response headers are Next's,
  // not ours; rendering per request keeps the §3.2 Cache-Control and costs microseconds.
  await connection();
  const body: BlastSummary[] = listBlastSummaries();
  return json(body, CACHE.hour);
}
