/**
 * Response helpers for the route handlers (docs/02-plan.md §3.2, ADR-11, ADR-12): gzipped BMV1
 * bodies, JSON with a cache policy, typed ApiError bodies, ETag / If-None-Match → 304.
 */
import type { ApiError, ApiErrorCode } from '@/core/api-types';

/** Cache policies from the §3.2 table. */
export const CACHE = {
  /** Deterministic payloads behind a URL whose `?v=` is the current data version (model, movement). */
  immutable: 'public, s-maxage=31536000, immutable',
  /**
   * Model / movement requested WITHOUT `?v=` (curl, tools): the URL names no data version, so the
   * same URL serves different bytes after a deploy that changes the config. Short CDN lifetime.
   */
  unversioned: 'public, s-maxage=60',
  /** Blast list / detail: change only with a deploy. */
  hour: 'public, s-maxage=3600',
  none: 'no-store',
} as const;

/** BMV1 payloads travel gzipped, as a gzip file (see `binary`). */
export const BINARY_TYPE = 'application/gzip';

/** `"<tag>"`: a strong ETag. */
export const quoteEtag = (tag: string) => `"${tag}"`;

/**
 * Does `If-None-Match` match `etag`? Handles `*`, lists and weak validators (`W/"…"`): RFC 9110
 * §13.1.2 uses the weak comparison for If-None-Match.
 */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const want = quoteEtag(etag);
  return ifNoneMatch
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === want);
}

interface CacheOptions {
  cacheControl: string;
  /** Unquoted tag (e.g. paramsHash). */
  etag?: string;
}

function cacheHeaders({ cacheControl, etag }: CacheOptions): Headers {
  const h = new Headers({ 'Cache-Control': cacheControl });
  if (etag) h.set('ETag', quoteEtag(etag));
  return h;
}

/** 304 with the validators a cache needs to refresh its entry (no body). */
export function notModified(opts: CacheOptions): Response {
  return new Response(null, { status: 304, headers: cacheHeaders(opts) });
}

/**
 * A gzipped BMV1 payload as `application/gzip`, or 304 if the request's If-None-Match already
 * names this ETag. The payload is ALWAYS gzipped and labelled as a gzip file rather than sent with
 * `Content-Encoding: gzip`: Next.js route handlers drop that header (the browser would then not
 * inflate the body), and `next start` does not compress binary bodies itself. The client inflates
 * it (data/api.ts); one representation per URL, so the ETag stays strong.
 */
export function binary(gzipped: Uint8Array<ArrayBuffer>, opts: CacheOptions & { request?: Request }): Response {
  if (opts.etag && opts.request && etagMatches(opts.request.headers.get('if-none-match'), opts.etag)) {
    return notModified(opts);
  }
  const headers = cacheHeaders(opts);
  headers.set('Content-Type', BINARY_TYPE);
  headers.set('Content-Length', String(gzipped.byteLength));
  return new Response(gzipped, { status: 200, headers });
}

/** gzip bytes with the web-standard CompressionStream (Node and edge runtimes alike). */
export async function gzip(body: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function json<T>(body: T, cacheControl: string): Response {
  return Response.json(body, { headers: { 'Cache-Control': cacheControl } });
}

/** Typed error body (ApiError), never cached. */
export function apiError(code: ApiErrorCode, message: string, status: number, details?: unknown): Response {
  const body: ApiError = { error: details === undefined ? { code, message } : { code, message, details } };
  return Response.json(body, { status, headers: { 'Cache-Control': CACHE.none } });
}
