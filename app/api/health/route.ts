import { connection } from 'next/server';
import type { HealthResponse } from '@/core/api-types';
import pkg from '../../../package.json';

/** `GET /api/health` → `{ ok: true, version }`, never cached. */
export async function GET() {
  // Opt out of build-time prerendering (Cache Components): health must reflect the live deploy.
  await connection();
  const body: HealthResponse = { ok: true, version: pkg.version };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
