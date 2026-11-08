/**
 * API route handlers (docs/02-plan.md §3.2, P8): call GET() directly with a Request.
 */
import { describe, expect, it, vi } from 'vitest';

// `connection()` (opt out of prerendering) needs Next's request scope, which a direct GET() call
// doesn't have; the build + curl check in the PR covers the real request path.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));
import { GET as getBlasts } from '../app/api/blasts/route';
import { GET as getBlast } from '../app/api/blasts/[id]/route';
import { GET as getModel } from '../app/api/blasts/[id]/model/route';
import { GET as getMovement } from '../app/api/blasts/[id]/movement/route';
import { GET as getHealth } from '../app/api/health/route';
import type { ApiError, BlastDetail, BlastSummary } from '@/core/api-types';
import { BLAST_CONFIGS, blastDataVersion, getBlastConfig } from '@/core/blasts';
import { generateBlockModel } from '@/core/blockModel';
import { decodeModel, decodeMovement } from '@/core/codec';
import { canonicalParamsString } from '@/core/hash';
import { computeMovement } from '@/core/movement';
import type { BlastParameters } from '@/core/types';

const BASE = 'http://localhost/api/blasts';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const cfg = getBlastConfig('b1040-017')!;
const query = (p: BlastParameters, extra = '') => `${canonicalParamsString(p)}${extra}`;
const movementUrl = (id: string, q: string) => `${BASE}/${id}/movement?${q}`;

async function errorBody(res: Response): Promise<ApiError> {
  expect(res.headers.get('content-type')).toMatch(/application\/json/);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return (await res.json()) as ApiError;
}

describe('GET /api/health and /api/blasts', () => {
  it('health: { ok: true, version }, no-store', async () => {
    const res = await getHealth();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true, version: expect.any(String) });
  });

  it('blasts: the three demo BlastSummary entries, s-maxage=3600', async () => {
    const res = await getBlasts();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=3600');
    const body = (await res.json()) as BlastSummary[];
    expect(body.map((b) => b.id)).toEqual(['b1040-017', 'b1030-022', 'b1040-031']);
    expect(body[2].blockCount).toBe(27088);
  });
});

describe('GET /api/blasts/:id', () => {
  it('known id → BlastDetail with default params and holes, s-maxage=3600', async () => {
    const res = await getBlast(new Request(`${BASE}/b1040-017`), ctx('b1040-017'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=3600');
    const body = (await res.json()) as BlastDetail;
    expect(body.id).toBe('b1040-017');
    expect(body.defaultParams).toEqual(cfg.defaultParams);
    expect(body.holes.length).toBeGreaterThan(0);
  });

  it('unknown id → 404 typed NOT_FOUND', async () => {
    const res = await getBlast(new Request(`${BASE}/nope`), ctx('nope'));
    expect(res.status).toBe(404);
    expect((await errorBody(res)).error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/blasts/:id/model', () => {
  it.each(BLAST_CONFIGS.map((c) => c.id))('%s → octet-stream BMV1 model, immutable, ETag = configHash; round-trips', async (id) => {
    const res = await getModel(new Request(`${BASE}/${id}/model?v=${blastDataVersion(getBlastConfig(id)!)}`), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=31536000, immutable');
    const buf = await res.arrayBuffer();
    expect(Number(res.headers.get('content-length'))).toBe(buf.byteLength);
    const model = decodeModel(buf);
    const want = generateBlockModel(getBlastConfig(id)!);
    expect(res.headers.get('etag')).toBe(`"${want.configHash}"`);
    expect(model.configHash).toBe(want.configHash);
    expect(Array.from(model.grade)).toEqual(Array.from(want.grade));
  });

  it('If-None-Match → 304; unknown id → 404', async () => {
    const first = await getModel(new Request(`${BASE}/b1040-017/model`), ctx('b1040-017'));
    const etag = first.headers.get('etag')!;
    const res = await getModel(new Request(`${BASE}/b1040-017/model`, { headers: { 'If-None-Match': etag } }), ctx('b1040-017'));
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(etag);
    const missing = await getModel(new Request(`${BASE}/x/model`), ctx('x'));
    expect(missing.status).toBe(404);
  });
});

describe('GET /api/blasts/:id/movement', () => {
  const model = generateBlockModel(cfg);
  const expected = computeMovement(model, cfg.defaultParams);

  it('200 octet-stream, immutable, ETag = paramsHash; body round-trips to the local result', async () => {
    const res = await getMovement(new Request(movementUrl(cfg.id, query(cfg.defaultParams, `&v=${blastDataVersion(cfg)}`))), ctx(cfg.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=31536000, immutable');
    expect(res.headers.get('etag')).toBe(`"${expected.paramsHash}"`);
    const movement = decodeMovement(await res.arrayBuffer(), model);
    expect(movement.paramsHash).toBe(expected.paramsHash);
    expect(Array.from(movement.end)).toEqual(Array.from(expected.end));
    expect(Array.from(movement.distance)).toEqual(Array.from(expected.distance));
  });

  it('canonicalises: key order and sub-2-dp noise give the same ETag', async () => {
    const shuffled = new URLSearchParams(canonicalParamsString({ ...cfg.defaultParams, maxThrow: 10.004 }));
    const reversed = new URLSearchParams([...shuffled.entries()].reverse()).toString();
    const res = await getMovement(new Request(movementUrl(cfg.id, reversed)), ctx(cfg.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe(`"${expected.paramsHash}"`);
  });

  it('If-None-Match with the ETag (also weak / in a list) → 304 with the validators', async () => {
    for (const inm of [`"${expected.paramsHash}"`, `W/"${expected.paramsHash}"`, `"other", "${expected.paramsHash}"`]) {
      const versioned = movementUrl(cfg.id, query(cfg.defaultParams, `&v=${blastDataVersion(cfg)}`));
      const req = new Request(versioned, { headers: { 'If-None-Match': inm } });
      const res = await getMovement(req, ctx(cfg.id));
      expect(res.status, inm).toBe(304);
      expect(res.headers.get('etag')).toBe(`"${expected.paramsHash}"`);
      expect(res.headers.get('cache-control')).toBe('public, s-maxage=31536000, immutable');
      expect(await res.text()).toBe('');
    }
    const stale = new Request(movementUrl(cfg.id, query(cfg.defaultParams)), { headers: { 'If-None-Match': '"deadbeef"' } });
    expect((await getMovement(stale, ctx(cfg.id))).status).toBe(200);
  });

  it.each([
    ['maxThrow=99 (out of range)', query({ ...cfg.defaultParams, maxThrow: 99 }), 'maxThrow'],
    ['swellFactor=0.9', query({ ...cfg.defaultParams, swellFactor: 0.9 }), 'swellFactor'],
    ['seed=-1', query({ ...cfg.defaultParams }).replace('seed=42', 'seed=-1'), 'seed'],
    ['seed=1.5', query({ ...cfg.defaultParams }).replace('seed=42', 'seed=1.5'), 'seed'],
    ['maxThrow=abc', query({ ...cfg.defaultParams }).replace('maxThrow=10', 'maxThrow=abc'), 'maxThrow'],
    ['maxThrow= (empty)', query({ ...cfg.defaultParams }).replace('maxThrow=10', 'maxThrow='), 'maxThrow'],
    ['freeFace=up', query({ ...cfg.defaultParams }).replace('freeFace=east', 'freeFace=up'), 'freeFace'],
    ['missing randomness', query({ ...cfg.defaultParams }).replace(/randomness=[^&]*&/, ''), 'randomness'],
    ['unknown key', query(cfg.defaultParams, '&powderFactor=1'), ''],
    ['repeated key', query(cfg.defaultParams, '&maxThrow=11'), 'maxThrow'],
  ])('%s → 400 INVALID_PARAMS with details', async (_label, q, path) => {
    const res = await getMovement(new Request(movementUrl(cfg.id, q)), ctx(cfg.id));
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('INVALID_PARAMS');
    const details = body.error.details as { path: string; message: string }[];
    expect(details.length).toBeGreaterThan(0);
    if (path) expect(details.map((d) => d.path)).toContain(path);
  });

  it('unknown blast → 404 (checked before the params)', async () => {
    const res = await getMovement(new Request(movementUrl('nope', 'maxThrow=99')), ctx('nope'));
    expect(res.status).toBe(404);
    expect((await errorBody(res)).error.code).toBe('NOT_FOUND');
  });
});

describe('?v= data version (stale clients after a deploy)', () => {
  const current = blastDataVersion(cfg);

  it('movement: a stale v → 409 STALE_VERSION (no-store), never a movement for the current model', async () => {
    const res = await getMovement(new Request(movementUrl(cfg.id, query(cfg.defaultParams, '&v=0badc0de'))), ctx(cfg.id));
    expect(res.status).toBe(409);
    expect(res.headers.get('cache-control')).toBe('no-store'); // a 409 must never be cached
    expect(res.headers.get('content-type')).not.toBe('application/octet-stream');
    expect(res.headers.get('etag')).toBeNull();
    const body = await errorBody(res);
    expect(body.error.code).toBe('STALE_VERSION');
    expect(body.error.details).toEqual({ requested: '0badc0de', current });
  });

  it('a stale v is rejected even with a matching If-None-Match (no 304 revalidates a stale URL)', async () => {
    const etag = computeMovement(generateBlockModel(cfg), cfg.defaultParams).paramsHash;
    const req = new Request(movementUrl(cfg.id, query(cfg.defaultParams, '&v=0badc0de')), {
      headers: { 'If-None-Match': `"${etag}"` },
    });
    expect((await getMovement(req, ctx(cfg.id))).status).toBe(409);
  });

  it('model: a stale v → 409; the current v and no v → 200', async () => {
    const stale = await getModel(new Request(`${BASE}/${cfg.id}/model?v=0badc0de`), ctx(cfg.id));
    expect(stale.status).toBe(409);
    expect(stale.headers.get('cache-control')).toBe('no-store');
    expect((await errorBody(stale)).error.code).toBe('STALE_VERSION');
    expect((await getModel(new Request(`${BASE}/${cfg.id}/model?v=${current}`), ctx(cfg.id))).status).toBe(200);
    expect((await getModel(new Request(`${BASE}/${cfg.id}/model`), ctx(cfg.id))).status).toBe(200);
  });

  it('movement without v (curl, tools) → 200 with the current data', async () => {
    expect((await getMovement(new Request(movementUrl(cfg.id, query(cfg.defaultParams))), ctx(cfg.id))).status).toBe(200);
  });

  it('versions differ per blast, so one blast\'s v is stale for another', async () => {
    const other = getBlastConfig('b1030-022')!;
    expect(blastDataVersion(other)).not.toBe(current);
    const res = await getMovement(
      new Request(movementUrl(other.id, query(other.defaultParams, `&v=${current}`))),
      ctx(other.id),
    );
    expect(res.status).toBe(409);
  });

  it('no v (curl, tools): 200 with the current data but a short policy, never immutable — model, movement and 304', async () => {
    const SHORT = 'public, s-maxage=60';
    const mv = await getMovement(new Request(movementUrl(cfg.id, query(cfg.defaultParams))), ctx(cfg.id));
    expect(mv.status).toBe(200);
    expect(mv.headers.get('cache-control')).toBe(SHORT);
    const etag = mv.headers.get('etag')!;
    const mv304 = await getMovement(
      new Request(movementUrl(cfg.id, query(cfg.defaultParams)), { headers: { 'If-None-Match': etag } }),
      ctx(cfg.id),
    );
    expect(mv304.status).toBe(304);
    expect(mv304.headers.get('cache-control')).toBe(SHORT);
    const model = await getModel(new Request(`${BASE}/${cfg.id}/model`), ctx(cfg.id));
    expect(model.status).toBe(200);
    expect(model.headers.get('cache-control')).toBe(SHORT);
    const model304 = await getModel(
      new Request(`${BASE}/${cfg.id}/model`, { headers: { 'If-None-Match': model.headers.get('etag')! } }),
      ctx(cfg.id),
    );
    expect(model304.status).toBe(304);
    expect(model304.headers.get('cache-control')).toBe(SHORT);
  });

  it('the current v → immutable on both binary routes (including a 304 revalidation)', async () => {
    const IMMUTABLE = 'public, s-maxage=31536000, immutable';
    const model = await getModel(new Request(`${BASE}/${cfg.id}/model?v=${current}`), ctx(cfg.id));
    expect(model.headers.get('cache-control')).toBe(IMMUTABLE);
    const model304 = await getModel(
      new Request(`${BASE}/${cfg.id}/model?v=${current}`, { headers: { 'If-None-Match': model.headers.get('etag')! } }),
      ctx(cfg.id),
    );
    expect(model304.status).toBe(304);
    expect(model304.headers.get('cache-control')).toBe(IMMUTABLE);
    const mv = await getMovement(new Request(movementUrl(cfg.id, query(cfg.defaultParams, `&v=${current}`))), ctx(cfg.id));
    expect(mv.headers.get('cache-control')).toBe(IMMUTABLE);
  });
});
