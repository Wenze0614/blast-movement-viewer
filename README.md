# Blast Movement Viewer

A concept prototype exploring blast movement visualisation: the front end and API around a
(stand-in) movement engine. A synthetic gold bench is blasted with a heuristic movement model, every
block is animated from its in-situ position to the muckpile, and ore loss and dilution are compared
for the original and the movement-adjusted dig lines.

> *"This is the front end and API I'd build around a blast-movement engine. The movement model is a
> deliberately simple stand-in for the engine's output; the showcase is the visualisation, the
> interaction and the data plumbing."*

**Repo:** <https://github.com/Wenze0614/blast-movement-viewer>

Live demo: link added after first deploy.

<!--
Media to capture in a browser (not yet recorded); add the image links once the files exist:
- docs/media/demo.gif: ≈ 8 s, bench with holes → Blast → settled muckpile.
- docs/media/screenshot.png: outcome colours after the blast, original and adjusted dig lines,
  reconciliation panel visible.
-->

## What it shows

- **Before / after block model.** Three seeded demo blasts: two 3,840-block benches (2.5 m blocks)
  and a dense 30,720-block bench (1.25 m blocks). Press **Blast** or scrub the timeline: every
  block follows its own movement vector out from the free face, the rock swells and slumps.
- **Blastholes.** The burden × spacing pattern as instanced cylinders coloured by the hole's
  sampled grade. Visible before the blast and fading out as it fires. Labelled *illustrative
  pattern, not used by the movement heuristic*.
- **Dig lines.** The original line (contoured on the in-situ model) and the adjusted line
  (contoured on the post-blast model), toggleable.
- **Colour modes.** Grade class, outcome (ore → mill, ore lost, dilution, waste → waste) and
  movement distance.
- **Click to inspect.** Click any block, before, during or after the blast, to highlight it and
  see its grade, tonnes, in-situ and final position, displacement, and where it goes (mill or
  waste) under each reconciliation scenario. Picking is a CPU ray–box test on the same easing as
  the shader, so it hits what is on screen at any scrub position and skips blocks hidden by the
  section or ore-only. Esc or × closes it.
- **Plan view.** The **Plan** button eases the camera to a top-down, north-up view of the bench
  and muckpile (rotation locked, drag to pan); **3D** returns to where you were.
- **Frame stats.** The **FPS** button shows fps, draw calls, triangles and block count, published
  about twice a second (on by default in development; add `?fps` to the URL in production).
  Rendering is on demand, so when nothing moves it says *idle*.
- **Section and ore-only.** A section plane through the bench (the cut face shows ore pushed under
  waste) and a toggle that hides waste blocks.
- **Reconciliation table.** Mill tonnes, mill grade, ore loss %, dilution %, ounces to the mill and
  ore metal recovery for three scenarios (in-situ / original, post-blast / original, post-blast /
  adjusted), with deltas and formula tooltips.
- **Parameters.** Max throw, swell, randomness, back-row and toe ratios, and more. Each change
  requests a new movement from the API (debounced).
- **Source badge.** `● API · 42 ms`, `● Local fallback` (the API failed; hover for why) or
  `● Local · 12 ms`.
- **About.** A modal with the framing above, what this is not, and links.

## ⚠️ What this is not

- **Not physics.** Movement comes from a deliberately simple, seeded heuristic (below), not a blast
  simulation: no timing, explosive energy or rock mass. It is **not calibrated** against any mine.
- **Synthetic data.** The block model, grades and the three demo blasts are generated.
- **The adjusted dig line is a grade-threshold contour**, not an optimised dig limit.
- **Blastholes are derived from the model.** Here each hole's grade is sampled *from* the block
  model; in reality blasthole samples *feed* the grade-control model.
- **Dilution is defined differently from site to site.** This app uses waste → mill t ÷ mill t (see
  [Reconciliation](#reconciliation)); some sites report waste t ÷ ore t instead.
- **Not affiliated** with any company or product.

## Run locally

Requires Node 22+.

```sh
npm install
npm run dev                      # http://localhost:3000 (the same app serves /api)
npm test                         # Vitest
npm run lint && npm run typecheck && npm test && npm run build   # the gates every PR passes
npm run build && npm run start   # production build
```

`NEXT_PUBLIC_DATA_SOURCE=local` runs everything in the browser without the API.

## Architecture

```
            src/core  (pure TypeScript: model, movement, dig lines, reconciliation, BMV1 codec)
             ▲      ▲
   app/api ──┘      └── src/data (DataSource: ApiDataSource → fallback LocalDataSource)
   route handlers            │
   (zod, cache headers)      ▼
        │             src/state (one vanilla Zustand store + load pipeline + derive step)
        ▼               ▲                 │
   CDN / browser        │ actions         ├─ subscribe(selector) / getState() per frame
   (binary BMV1)    src/ui (React)    src/engine (plain three.js: Engine + phased systems)
```

- **Layers with lint-enforced boundaries.** `src/core` is pure TS (no three, React, Next, DOM or
  `node:*`), so the same code runs on the server, in the browser and in the fallback. `src/engine`
  is three.js without React, `src/ui` is React without three, and `src/state` / `src/data` are the
  only bridges. The rules live in `eslint.config.mjs` and are regression-tested
  (`tests/lint-boundaries.test.ts`).
- **Engine / System pattern.** `createEngine` boots an ordered registry of systems. Each declares a
  phase (`input → simulate → animate → render`), updates from a clamped `dt`, and has a mandatory
  `dispose()`; every GPU resource goes into a `DisposeBag`. React StrictMode stays on, and a
  mount → unmount → mount cycle returns renderer memory to baseline. Current order: controls →
  picking → playback → blocks → holes → dig lines → environment → render → perf.
- **Owned `ShaderMaterial` with GPU interpolation.** The blocks are one `InstancedBufferGeometry`
  (unit box) with `aStart`, `aEnd`, `aDelay` and `aColor`. The vertex shader eases each block from
  start to end with a throw arc and the swell scale, so scrubbing costs **one uniform write per
  frame** at any block count. No `onBeforeCompile` patching. The selected block is one more
  uniform (`uSelected`, compared with `gl_InstanceID`), so selecting never touches a buffer. The holes use the same approach (one
  instanced cylinder mesh, one opacity uniform). Lighting is a small hand-written chunk shared by
  both, so there are no scene lights. The hole material is opaque before the blast and switches to
  transparent with `depthWrite: false` only while it fades, so fading holes never hide what is
  behind them. Those flags and the mesh visibility change only on a transition (opaque ↔ fading ↔
  hidden, or the layer toggle); per frame only the opacity uniform is written.
- **Render on demand.** The loop draws only when something invalidates the frame or a system is
  animating (playback). React never re-renders per frame: the engine subscribes to discrete store
  changes and reads continuous ones (`progress`) with `getState()`.

## Data transport

Model and movement travel as **BMV1**, a small binary, columnar (struct-of-arrays) format shared by
server and client (`src/core/codec.ts`): magic `BMV1`, a uint32 header length, a JSON header
(`schemaVersion`, `kind`, `count`, field table and metadata), then 4-byte-aligned Float32 and Uint8
sections. Decode returns typed-array **views** on the response buffer (no per-block objects, no
copies), which go straight into GPU attributes. Malformed payloads throw typed `CodecError`s.

Measured response sizes (Stage 4):

| Payload | 3,840 blocks | 30,720 blocks |
|---|---|---|
| Model (`centroid, grade, density, tonnes, rockType, oreClass`) | 100,464 B | 799,356 B |
| Movement (`end, delay, surface.height`; `start`, `displacement` and `distance` are derived on decode) | 74,280 B | 538,032 B |

These are uncompressed: `next start` does not gzip `application/octet-stream` (gzip would make
them about 4× smaller; still open for the deploy).

## API

| Route | Returns | Cache-Control |
|---|---|---|
| `GET /api/health` | `{ ok: true, version }` | `no-store` |
| `GET /api/blasts` | `BlastSummary[]` | `public, s-maxage=3600` |
| `GET /api/blasts/:id` | `BlastDetail` (grid, grades, pattern, holes, default params) | `public, s-maxage=3600` |
| `GET /api/blasts/:id/model?v=…` | BMV1 model, `ETag` = model configHash | `public, s-maxage=31536000, immutable` |
| `GET /api/blasts/:id/movement?freeFace=…&maxThrow=…&…&seed=…&v=…` | BMV1 movement, `ETag` = paramsHash | `public, s-maxage=31536000, immutable` |

Errors are typed JSON (`{ error: { code, message, details? } }`, always `no-store`): `NOT_FOUND`
404, `INVALID_PARAMS` 400 (zod, with per-field details), `STALE_VERSION` 409, `INTERNAL` 500.

**Caching strategy**

- Movement is a pure function of (blast config, params), so each URL names its bytes for good.
  All 12 parameters are required, validated against the same ranges the sliders use, and
  canonicalised (fixed key order, 2 dp, uint32 seed): equal inputs give equal URLs and ETags.
- **`ETag` = paramsHash**, computed *before* the movement, so an `If-None-Match` revalidation
  (→ 304) costs a hash, not a movement run.
- **`?v=` data version.** The client appends a per-blast data version (a hash of the model config
  and the movement-heuristic version) to the model and movement URLs, so a config or heuristic
  change never hits a stale CDN entry.
- **`409 STALE_VERSION`.** A `v` that isn't the server's current one (an old client after a deploy)
  is refused and not cached, so an old client never pairs a newer model's movement with its older
  model. The client then computes both locally.
- **Versionless requests** (curl, tools) get current data with a short `public, s-maxage=60`;
  `immutable` is reserved for URLs whose `v` matches the current data version.
- Every API handler is request-time (`ƒ` in the build), so these headers are ours, and the CDN does
  the caching.

## DataSource and fallback

The UI and engine never call `fetch`. They go through one `DataSource` interface (`listBlasts`,
`getBlast`, `getModel`, `getMovement`). Only `getModel` and `getMovement` take an `AbortSignal`;
a `listBlasts` or `getBlast` result that arrives after the pipeline has moved on is ignored
rather than aborted.

- `ApiDataSource` fetches and decodes BMV1 (10 s timeout).
- `LocalDataSource` runs the same `src/core` code in the browser; results are byte-identical.
- `FallbackDataSource` tries the API on **every** call and serves that call locally on a network
  error, non-2xx, decode error or timeout (never on an abort), so the app recovers by itself.
- The load pipeline aborts superseded loads and ignores their late results and errors. It applies
  a movement **only to the model it was computed for** (`paramsHash` binds the model's config hash
  and the params). On a mismatch it reloads a consistent pair; as a last resort it computes blast
  detail, model and movement locally, shown as "Local fallback". Before any model is stored, from
  either source, the blast detail (and so the hole layer) is checked against it and rebuilt or
  refetched if its holes were not generated from that model.

## Movement heuristic (stand-in for an engine)

Mine coordinates: x = East, y = North, z = elevation (Z-up, metres). Free face east, throw +x.
With s = distance from the free face ÷ bench length (0 = front row) and h = height in the bench
(1 = crest):

1. **Target displacement.** Throw `T = T_max · [r_back + (1 − r_back)(1 − s)^p] · [r_toe + (1 − r_toe)·h] · (1 + 0.25·R·n₁)`;
   lateral `L = R·σ_lat·n₂ + fan·((y − y_c)/(W/2))·(1 − s)`. n₁ and n₂ are seeded 3D simplex
   noise, so neighbours move coherently. The defaults give ~6–10 m at the crest and ~3–4 m at the toe.
2. **Swell and re-grid.** k = swell^(1/3). Targets are binned onto a post-blast plan grid with cell
   size c·k and clamped behind the back wall.
3. **Stacking.** Each cell stacks its blocks by original elevation, so nothing floats or overlaps.
   Loose volume = swell × bank volume exactly (unit-tested).
4. **Angle of repose.** The tallest offending stack moves its top block to the lowest valid
   neighbour, repeatedly. A stack offends when, along a grid axis, the drop to a cell up to
   6 cells away (d = 1…6) exceeds the allowed drop `max(1, round(d · tan(φ) · c′ / (H_b·k)))`
   blocks, i.e. the **rounded average slope** over that baseline is steeper than φ. Relaxation
   stops when nothing offends or after **20·N block moves** (N = block count), whichever is first.
   Why not the literal rule (each adjacent pair within tan(φ)·c′): with cubic blocks one block step
   over one cell is already a 45° slope, so for φ < 45° no pair of unequal neighbours could ever
   satisfy it and the piles would oscillate. Every allowed drop is ≥ 1 block, so each move lowers a
   block and the relaxation terminates (`allowedDrop` in `src/core/movement.ts`).
5. **Animation delay.** Front rows start first (visual only).

**Known simplifications:** no timing, explosive or rock physics; vertical order is preserved within
a column; positions snap to the post-blast lattice (no sub-block mixing); one free face; a single
dig horizon.

**Dig lines.** Column tonnage-weighted grade per plan cell (the in-situ grid for the original line,
the post-blast grid for the adjusted one), a one-cell Gaussian blur (a stand-in for minimum mining
width), a `d3-contour` at the 0.5 g/t cut-off, and small rings dropped. Using the same algorithm
for both lines keeps the comparison fair.

## Reconciliation

Each block keeps its true class (grade ≥ 0.5 g/t cut-off). Its destination is the mill if its plan
centroid is inside the dig polygon (even–odd point-in-polygon, so holes in the polygon work).

- **ore loss %** = ore → waste t ÷ ore t
- **dilution %** = waste → mill t ÷ mill t
- **mill grade** = Σ t·g ÷ Σ t over mill blocks
- **ore metal recovery %** = ore → mill metal ÷ total ore metal
- **oz** = g ÷ 31.1035

*Dilution variant:* some sites report dilution as waste t ÷ ore t (a waste-to-ore ratio) rather
than as a fraction of mill tonnes. The two numbers are not interchangeable.

Reconciliation runs on the client: it is cheap and has to follow every parameter change live.

## Performance

- **Movement compute:** about 2 ms for 3,840 blocks and 15 ms for 30,720 blocks (measured during
  development). An API movement round trip on a cold seed took 16–42 ms end to end locally.
- **Draw calls:** one per layer. The blocks are **one** draw call at any block count and the holes
  one, plus the floor, the grid and the two dig lines.
- **Per-frame CPU while scrubbing or playing:** the `uProgress` and `uOpacity` uniform writes.
- **Frame rate:** measured with the FPS overlay during playback in the development test browser
  (an embedded Chromium pane on an Apple M4 Pro, 581 × 859 px at DPR 1, whose
  `requestAnimationFrame` is capped at about 50 Hz even on an idle page): **both the 3,840-block
  and the 30,720-block (370k triangles) blasts ran at that cap**, 5 draw calls each. That shows
  the engine keeps up with the display, not its ceiling; press **FPS** to measure on your own
  machine and display.

## Scaling to real block models (millions of blocks)

- **Tiled, range-requestable chunks.** Split the model into spatial tiles stored as BMV1 sections
  in one immutable object. The client range-requests only the tiles in view, at the level of
  detail it needs.
- **Interior culling.** Most blocks of a solid bench are hidden. Send and draw only the exposed
  shell of each tile, and re-expose blocks when a section or filter changes.
- **Workers.** Decode, classification and reconciliation run in Web Workers with transferable
  typed arrays, so the main thread only uploads buffers.
- **WebGPU / compute.** Per-block easing, classification and culling move to compute shaders, with
  WebGL kept as the fallback.
- **Async job API for a real engine.** A real movement engine is slow and stateful: submit a job
  (`POST /jobs` → id), poll or stream its status, and fetch results as immutable, content-addressed
  BMV1 objects. The `DataSource` seam stays the same.

## What a real model adds

Initiation timing and delay sequencing, explosive energy distribution, rock mass properties and
structure, free-face geometry, and calibration against surveyed movement (for example, blast
movement monitors). See [docs/01-research.md](docs/01-research.md) for background and sources.

## How it was built

An agentic workflow:

- **Spec and contracts first.** The research, plan and engine architecture
  ([docs/01](docs/01-research.md), [02](docs/02-plan.md), [03](docs/03-engine-architecture.md)) and
  the contract files (`src/core/types.ts`, `api-types.ts`, `src/engine/types.ts`, `src/data/index.ts`,
  `src/state/store.ts`) were settled before any feature code. A contract changes only with an
  explicit note in the PR.
- **Claude Code implemented each stage** as a stacked pull request in its own git worktree
  (core → MVP → views → API → v1.0), against an acceptance contract and the gates below.
- **Codex reviewed each stage's diff** against that contract. Blocking findings went back for fix
  rounds until the review passed. Two examples: never apply a movement to a model it wasn't
  computed for, and never let a superseded recovery overwrite a newer load's status.
- **A lead agent orchestrated** the stages, routed review findings and kept one writer per
  worktree. Merging stays a human decision.

## Tests and gates

```sh
npm run lint && npm run typecheck && npm test && npm run build
```

Every PR passes all four. Vitest covers:

- **Core:** determinism, conservation, movement, dig lines, reconciliation, codec round-trips and
  typed errors.
- **API route handlers:** headers, ETag / 304, validation and stale versions.
- **DataSource and fallback,** including through the real route handlers.
- **Store and pipeline:** superseded loads and model–movement binding.
- **Engine systems without WebGL:** one draw call, disposal and uniforms.
- **UI** with React Testing Library.

The lint boundaries are regression-tested.

Design notes: [docs/02-plan.md](docs/02-plan.md) (requirements, ADRs, schemas; §7 has the demo
script) · [docs/03-engine-architecture.md](docs/03-engine-architecture.md)

---

Concept prototype · heuristic movement model, not physics · synthetic data.
Wenze Zhang · [GitHub](https://github.com/Wenze0614)
