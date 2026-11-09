/**
 * Binary response helper (server/binary.ts): gzip-file payloads, 304s, and streaming for bodies
 * Vercel would refuse to send whole (4.5 MB cap on a non-streamed Function response).
 */
import { describe, expect, it } from 'vitest';
import { binary, BINARY_TYPE, CACHE, gzip, STREAM_OVER_BYTES } from '../binary';

const bytes = (n: number, seed = 7) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) out[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
  return out;
};

describe('binary()', () => {
  it('small payloads: one body with a Content-Length (cacheable by the CDN)', async () => {
    const body = await gzip(bytes(50_000));
    const res = binary(body, { cacheControl: CACHE.immutable, etag: 'abc' });
    expect(res.headers.get('content-type')).toBe(BINARY_TYPE);
    expect(res.headers.get('content-length')).toBe(String(body.byteLength));
    expect(res.headers.get('etag')).toBe('"abc"');
    expect(res.headers.get('x-payload-bytes')).toBe(String(body.byteLength));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
  });

  it('payloads over 4 MB are streamed in chunks without a Content-Length, byte for byte', async () => {
    const body = bytes(STREAM_OVER_BYTES + 2_500_000) as Uint8Array<ArrayBuffer>; // incompressible stand-in
    const res = binary(body, { cacheControl: CACHE.immutable, etag: 'big' });
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.headers.get('x-payload-bytes')).toBe(String(body.byteLength)); // the client's progress total
    expect(res.headers.get('cache-control')).toBe(CACHE.immutable);
    const reader = res.body!.getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    expect(parts.length).toBeGreaterThan(4);
    expect(Math.max(...parts.map((p) => p.byteLength))).toBeLessThanOrEqual(1024 * 1024);
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let o = 0;
    for (const p of parts) {
      joined.set(p, o);
      o += p.byteLength;
    }
    expect(joined).toEqual(body);
  });

  it('If-None-Match with the ETag → 304 before any body work', () => {
    const res = binary(new Uint8Array(10), { cacheControl: CACHE.immutable, etag: 'abc', request: new Request('http://x', { headers: { 'If-None-Match': '"abc"' } }) });
    expect(res.status).toBe(304);
  });
});
