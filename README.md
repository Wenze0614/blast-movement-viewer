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

- **Before / after block model.** Three seeded demo blasts with irregular outlines (a ragged face,
  an L-shape, a notched bench): 3,200 and 3,088 blocks of 2.5 m, and a dense 27,088-block blast of
  1.25 m blocks, plus a **scale blast of 2,074,720 blocks** (0.5 m blocks across a 220 m bench; see
  [Performance](#performance)). Press **Blast** or scrub the timeline: every block follows its own movement vector
  out from the free face, the rock swells and slumps.
- **Gold veins.** The ore is a set of meandering, dipping veins: a narrow high-grade core inside a
  wider low-grade halo, patchy along strike (ore shoots and barren gaps), pinching out at their
  ends and branching (a splay, a two-vein system with a waste parting, a network with a
  high-grade shoot). Four grade classes: waste < 0.5, low 0.5–1.5, medium 1.5–3, high ≥ 3 g/t.
- **Pit context.** A synthetic, seeded terrain around the blast: the floor it sits on, the open
  floor in front of its free face (stepping down to the bench below), unblasted bench rock around
  its outline and two upper benches behind, with an irregular surveyed edge. Display only.
- **Firing sequence.** Each blast has an initiation pattern (row by row, a V from the front
  centre, or an echelon from a front corner) with row and hole delays. Rock moves toward the
  holes that fired before it (burden relief), so a V piles the muck on its centre line and an
  echelon throws it diagonally toward its starting corner; blocks start moving in firing order.
- **Blastholes.** The burden × spacing pattern as instanced cylinders, coloured by **firing time**
  (default) or by sampled grade. Visible before the blast and fading out as it fires. Labelled
  *illustrative pattern; its firing sequence sets the throw direction*.
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
- **Parameters.** Initiation, row and hole delays, max throw, swell, randomness, back-row and toe
  ratios, and more. Each change requests a new movement from the API (debounced).
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

## Deploy (Vercel)

No configuration is needed beyond importing the repository:

1. In Vercel, **Add New → Project**, import the GitHub repository. The framework preset is
   detected as Next.js; keep the defaults (build `next build`, Node 22 or later per `engines`).
2. No environment variables are required. Optional: `NEXT_PUBLIC_DATA_SOURCE=local` makes the
   deployed app compute everything in the browser (a Web Worker) and never call the API.
3. Deploy. The page is static; `/api/*` runs as Vercel Functions (Node.js runtime).

What to expect, checked against Vercel's documented limits:

| Limit | This app |
|---|---|
| Function memory (2 GB on Hobby) | about 0.45 GB peak for the 2-million-block blast at extreme parameters |
| Function duration (300 s default) | movement 1.7–2.4 s for the scale blast, milliseconds for the others |
| Function response body (4.5 MB unless streamed) | payloads over 4 MB (only the scale blast's, about 13 MB) are streamed |
| CDN cacheable response (10 MB) | the standard blasts are cached at the edge (`s-maxage`, immutable with `?v=`); the scale blast's payloads are larger, so every request reaches the function (the model is generated once per warm instance) |

After the first deploy, check the cache headers (replace the host):

```sh
curl -s https://YOUR-APP.vercel.app/api/health
# the same model URL twice: x-vercel-cache MISS, then HIT (unversioned URLs: s-maxage=60; the
# ?v= URLs the app requests are immutable)
curl -s -D - -o /dev/null https://YOUR-APP.vercel.app/api/blasts/b1040-017/model | grep -i -E 'x-vercel-cache|cache-control|content-type'
curl -s -D - -o /dev/null https://YOUR-APP.vercel.app/api/blasts/b1040-017/model | grep -i -E 'x-vercel-cache|cache-control|content-type'
```

In the app, the source badge should read `● API · … ms` for every blast, including the scale blast
(`● Local fallback` would mean an API call failed; hover the badge for the reason).

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
(`schemaVersion`, `kind`, `count`, field table and metadata), then 4-byte-aligned Float32, Uint32,
Uint16 and Uint8 sections. Models are **sparse**: only blocks inside the blast outline are sent,
each with its grid cell index (`cell`, Uint32, strictly increasing). Schema v3 is **compact**: a
field that can be derived (centroid from `cell`, density and tonnes from the rock type, class from
the grade, a final position from its post-blast slot) is sent only if deriving it would not
reproduce it bit for bit, which the encoder checks, so a round trip is always exact. Sent sections
decode to typed-array **views** on the response buffer, which go straight into GPU attributes.
Malformed payloads throw typed `CodecError`s.

Payloads travel **gzipped, as a gzip file** (`application/gzip`): Next.js route handlers drop a
`Content-Encoding` header, so the client (`ApiDataSource`) inflates the body itself.

Measured sizes (raw / gzipped):

| Payload | 3,200 blocks | 27,088 blocks | 2,074,720 blocks |
|---|---|---|---|
| Model (`grade, cell, rockType`: 9 B/block) | 29 kB | 244 kB | 18.7 MB / 12.9 MB |
| Movement (`delay, slotCell, slotLevel, surface.height`: 10 B/block) | 45 kB | 318 kB | 21.5 MB / 12.8 MB |

## API

| Route | Returns | Cache-Control |
|---|---|---|
| `GET /api/health` | `{ ok: true, version }` | `no-store` |
| `GET /api/blasts` | `BlastSummary[]` | `public, s-maxage=3600` |
| `GET /api/blasts/:id` | `BlastDetail` (grid, grades, pattern, holes, default params) | `public, s-maxage=3600` |
| `GET /api/blasts/:id/model?v=…` | gzipped BMV1 model, `ETag` = model configHash | `public, s-maxage=31536000, immutable` |
| `GET /api/blasts/:id/movement?freeFace=…&maxThrow=…&…&seed=…&v=…` | gzipped BMV1 movement, `ETag` = paramsHash | `public, s-maxage=31536000, immutable` |

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
- `LocalDataSource` runs the same `src/core` code in the browser, in a **Web Worker**
  (`src/data/compute.worker.ts`), so even the 2-million-block blast never freezes the page;
  results are byte-identical to the API's.
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
The outline is irregular, so the face is too: each lateral strip (one block column wide) has its
face at the front of its own blocks (`src/core/footprint.ts`). With s = distance from the strip's
face ÷ footprint depth (0 = front row) and h = height in the bench (1 = crest):

1. **Firing sequence** (`src/core/timing.ts`). A hole fires at `t = row · rowDelay + steps · holeDelay`:
   rows are burden bands behind each strip's face, steps are spacing bands from the initiation
   point (none for row by row; outward from the centre line for a V; along the row from a corner
   for an echelon). Rock is relieved down the firing-time gradient,
   `r̂ = normalise(rowDelay / B, −holeDelay · ∂steps/∂y)` (∂steps/∂y = ±1/S holes per metre): straight at the face, converging on
   a V's centre line, or diagonal toward an echelon's corner. The holes are coloured by the same t.
2. **Target displacement.** Throw `T = T_max · [r_back + (1 − r_back)(1 − s)^p] · [r_toe + (1 − r_toe)·h] · (1 + 0.25·R·n₁)`
   along r̂, plus lateral `L = R·σ_lat·n₂ + fan·((y − y_c)/(W/2))·(1 − s)` (y_c, W: the footprint's
   lateral centre and width). n₁ and n₂ are seeded 3D simplex noise, so neighbours move coherently.
   The defaults give ~6–10 m at the crest and ~3–4 m at the toe.
3. **Swell and re-grid.** k = swell^(1/3). Targets are binned onto a post-blast plan grid with cell
   size c·k. Rock lands only on free ground: the blast footprint or the open floor in front of the
   face (a bay about 45 m deep and 30 m wider than the blast each side). A cell is taken only if
   the whole swollen block fits on free ground **and** the block's animated box stays over free
   ground (within the terrain's 1.25 m floor margin) all the way there, so no block meets the pit
   terrain, settled or in flight. A blocked target moves to the nearest reachable cell.
4. **Stacking.** Each cell stacks its blocks by original elevation, so nothing floats or overlaps.
   Loose volume = swell × bank volume exactly (unit-tested).
5. **Angle of repose.** The tallest offending stack moves its top block to the lowest valid
   neighbour, repeatedly. A stack offends when, along a grid axis, the drop to a cell up to
   6 cells away (d = 1…6) exceeds the allowed drop `max(1, round(d · tan(φ) · c′ / (H_b·k)))`
   blocks, i.e. the **rounded average slope** over that baseline is steeper than φ. Relaxation
   stops when nothing offends or after **20·N block moves** (N = block count), whichever is first.
   Why not the literal rule (each adjacent pair within tan(φ)·c′): with cubic blocks one block step
   over one cell is already a 45° slope, so for φ < 45° no pair of unequal neighbours could ever
   satisfy it and the piles would oscillate. Every allowed drop is ≥ 1 block, so each move lowers a
   block and the relaxation terminates (`allowedDrop` in `src/core/movement.ts`).
6. **Animation delay.** Blocks start in firing order: `0.45 · (t − t_min)/(t_max − t_min)` plus a little noise (visual only).

**Known simplifications:** the firing sequence sets direction and order only (no timing,
explosive or rock physics: delays do not change throw distance or fragmentation); vertical order is preserved within
a column; positions snap to the post-blast lattice (no sub-block mixing); one free face; a single
dig horizon; blocks fly in straight lines, so a pile against a corner of unblasted rock can stand a
little steeper than the repose angle (no block could reach the lower cell without crossing the rock).

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

Measured during development on an Apple M4 Pro (Node for core, the embedded Chromium test pane for
the browser; that pane caps `requestAnimationFrame` at about 50 Hz, so "at the cap" means the engine
kept up with the display, not its ceiling). Press **FPS** to measure on your own machine.

| | 3,200 blocks | 27,088 blocks | **2,074,720 blocks** |
|---|---|---|---|
| Generate the model (server once, or the worker) | 3 ms | 16 ms | 1.1 s |
| Movement (server per parameter change, or the worker) | 2–5 ms | 21 ms | 1.7 s |
| Dig lines + reconciliation (client) | 1 ms | 3 ms | 0.3 s |
| Triangles (blocks + terrain) | 68 k | 214 k | 12.6 M |
| Playback | at the cap | at the cap | **at the cap**, 5 draw calls |
| Click to inspect (CPU picking) | < 1 ms | 1 ms | 60–70 ms |

Loading the scale blast from the API took 1.8 s end to end. A parameter change took 3.3 s: 2.7 s on
the server, and a longest main-thread task of 0.3 s. With local compute the page's longest
main-thread task stayed at 0.3 s (the generation and movement run in the worker).

What makes 2 million blocks work:

- **Reconciliation** tests each distinct plan position once (a column in situ, a stack after the
  blast), with a point-in-polygon test whose edges are bucketed into horizontal bands. That took it
  from 65 s to 0.24 s at 2 M blocks, with identical answers.
- **Movement** answers "is this rectangle free ground?" in O(1) from a summed-area table of rock
  cells, and checks a block's whole throw against one bounding box first, so most free-path checks
  are a single lookup (4.3 s → 1.7 s).
- **Generation** computes each vein's plan geometry once per column and skips the vein noise far
  from every vein, where its contribution is below Float32 resolution (2.1 s → 1.1 s). That left the
  four demo blasts byte-identical, but it can flip a Float32 rounding that sits on a boundary (one
  block of one test seed did), so the generator version was bumped and a golden test pins grades
  to it.
- **Rendering**: each block is three faces turned toward the camera in the vertex shader (a box never
  shows more than three), so 2 M blocks are 12.5 M triangles instead of 25 M, still one draw call.
  The terrain mesh uses a whole multiple of a small block size (62 k vertices instead of 549 k).
- **Transport**: the compact codec and gzip shrink the scale blast from 96 MB to 26 MB.
- **Per-frame CPU while scrubbing or playing:** the `uProgress` and `uOpacity` uniform writes, at any
  block count.

## Scaling to real block models (millions of blocks)

- **Tiled, range-requestable chunks.** Split the model into spatial tiles stored as BMV1 sections
  in one immutable object. The client range-requests only the tiles in view, at the level of
  detail it needs.
- **Interior culling.** Most blocks of a solid bench are hidden. Send and draw only the exposed
  shell of each tile, and re-expose blocks when a section or filter changes.
- **More in workers.** Local compute already runs in a Web Worker; decode, dig lines and
  reconciliation (0.3 s at 2 M blocks) could follow, with transferable typed arrays.
- **Spatial index for picking.** A click is a brute-force ray test (60–70 ms at 2 M blocks); a
  uniform grid over the settled positions would make it constant time.
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
