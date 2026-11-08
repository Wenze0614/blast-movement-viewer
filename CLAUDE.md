# CLAUDE.md — Blast Movement Viewer

Concept prototype: synthetic gold block model → heuristic blast movement → ore loss / dilution for
original vs movement-adjusted dig lines. Spec: `docs/01-research.md` (domain), `docs/02-plan.md`
(requirements, ADRs, schemas), `docs/03-engine-architecture.md` (engine). Read the relevant section
before changing behaviour. Next.js here is newer than most training data: see @AGENTS.md.

## Gates (every PR, all green)

```sh
npm run lint && npm run typecheck && npm test && npm run build
```

`typecheck` runs `next typegen` first (route types such as `LayoutProps` are generated).
Specification tests are `it.todo` until implemented; never leave a red test in a PR.

## Contracts (change only with an explicit note in the PR description)

| File | Defines |
|---|---|
| `src/core/types.ts` | domain shapes (plan §3.1) |
| `src/core/api-types.ts` | API shapes (plan §3.2) |
| `src/engine/types.ts` | `System`, `Phase`, `FrameInfo`, `SystemFactory`, `EngineContext` |
| `src/data/index.ts` | `DataSource` (ADR-9) |
| `src/state/store.ts` | app state + actions (ADR-7) |

Code against these. If a contract is wrong, say so in the PR and change it there, visibly.

## Conventions

1. **Mine coordinates, Z-up, metres.** x = East, y = North, z = elevation (RL). Grid origin is the
   MIN corner of the first block; grid cell = `i + nx * (j + ny * k)`. Models are sparse (only
   blocks inside the blast outline): block id = array index, `model.cell[id]` = its grid cell. Call
   `THREE.Object3D.DEFAULT_UP.set(0, 0, 1)` before creating objects; no axis conversions anywhere.
   Units in names or comments: m, t, t/m³, g/t Au, g (oz = g / 31.1035).
2. **Layer boundaries** (`eslint.config.mjs`: path zones via `import/no-restricted-paths` +
   package bans via `no-restricted-imports`; regression-tested in `tests/lint-boundaries.test.ts`):
   - `src/core` — pure TS. May import only `src/core`, `d3-contour` and `simplex-noise` (+ `vitest`
     in tests). No three, react, next, zustand, `node:*`, DOM globals, app/ or other layers. Runs
     on server, browser and Workers. Adding a package to core = edit `CORE_PACKAGES` with a reason.
   - `src/engine` — three.js, no React. `src/ui` — React, no three. No `@react-three/*` anywhere.
   - `src/state` (store) and `src/data` (DataSource) are the only bridges between React and the engine.
   - `src/server` — route-handler helpers only. `src/viewer` — canvas + engine lifecycle.
   - When you add a boundary, add blocked/allowed cases to the regression test.
3. **System contract** (`src/engine/types.ts`): declare a `phase`; all motion from `dt` (clamped);
   `dispose()` is mandatory and every GPU resource goes in `ctx.bag`. React StrictMode stays on;
   mount → unmount → mount must return `renderer.info.memory` to baseline. React never re-renders
   per frame: the engine reads continuous values with `store.getState()` and subscribes to discrete
   ones with `store.subscribe(selector, cb)`.
4. **Shaders**: `*.glsl.ts` modules (`export default /* glsl */ \`…\``) with a typed uniforms object
   beside each; owned `ShaderMaterial`; no loaders, no global `ShaderChunk` overrides,
   `onBeforeCompile` only with a comment explaining why.
5. **Data**: struct-of-arrays typed arrays end to end (API → decode → GPU attributes); build `Block`
   objects only on demand. Every random number is seeded (no `Math.random` in core).
6. **Render on demand**: anything that changes the image calls `ctx.invalidate()`; the loop runs
   only while dirty or while a system `isAnimating()`.

## Honesty and branding

Always-visible footer: "Concept prototype · heuristic movement model, not physics · synthetic data".
No company names, logos, colours or product names from the target employer. The movement model is a
heuristic stand-in; never describe it as physics.

## Workflow

One branch and one PR per feature, off `main`; small focused PRs, readable commit history. Don't
refactor outside the task's scope.

## Review (every PR)

Codex reviews every PR before it merges. After the gates pass and the branch is pushed:

```sh
scripts/codex-review.sh /tmp/review-r1.md                    # → VERDICT: PASS | CHANGES REQUESTED
scripts/codex-review.sh /tmp/review-r2.md /tmp/review-r1.md  # follow-up: verifies earlier findings
```

- It runs `codex exec` read-only on `git diff origin/main...HEAD` with
  `scripts/codex-review-prompt.md`. Exit code 0 = PASS, 1 = CHANGES REQUESTED, 2 = no verdict.
- Fix every BLOCKING finding (with a regression test that fails before the fix), rerun the gates,
  push, and run a follow-up round with the previous output until PASS. NON-BLOCKING findings are
  judgement calls: fix or say why not in the PR.
- Summarise each round (findings, fixes, verdict) in the PR description. A PR merges only after
  PASS; merging stays the human's call.
