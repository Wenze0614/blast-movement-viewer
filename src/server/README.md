# src/server

Helpers for the route handlers in `app/api` (depends on `src/core` only; never imported by client code):

- `schemas.ts`: zod `MovementQuery` (ADR-12 ranges from `core/params.ts`; all 12 params required,
  optional `v`, unknown or repeated keys → 400), `queryObject`, `issueDetails`.
- `binary.ts`: `binary()` (octet-stream + ETag + If-None-Match → 304), `json()`, `apiError()`
  (typed `ApiError`, `no-store`), `CACHE` policies from the §3.2 table.
- `blasts.ts`: memoised demo-blast model, detail and encoded model payload per server instance.

Cache Components is on: every API handler is request-time (`ƒ` in `next build`). `/api/blasts` and
`/api/health` call `connection()`; the `[id]` routes await `params` (no `generateStaticParams`), and
the movement route also reads `req.url`. Rendering per request keeps our own `Cache-Control`/`ETag`;
CDN caching (s-maxage / immutable) does the rest.
