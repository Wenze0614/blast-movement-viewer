# 03 — Rendering Stack & Engine Architecture

> Decision record for the Blast Movement Viewer, based on your previous project (Next.js 15 + plain three.js r176, "SceneContext + system factories").
> ⚠️ = unverified or fast-moving. Checked 8 Nov 2026; sources at the end.

## TL;DR
- **Renderer:** plain three.js `WebGLRenderer` with your own `ShaderMaterial`s. Shaders are `.glsl.ts` template strings, so no loader is needed. No post-processing in this project.
- **Architecture:** keep your *SceneContext + system factories* pattern, fixed:
  - explicit phases and one ordered registry
  - `update({ dt, elapsed })` with clamped dt
  - a mandatory `dispose()` plus a dispose bag
  - one typed system signature
  - a **vanilla Zustand store** shared by React and the engine, replacing DOM ids
- **Not now:** R3F (learning cost on a deadline; the hot paths are imperative anyway), ECS (one big homogeneous dataset, already struct-of-arrays), WebGPU/TSL (your GLSL doesn't port, the official docs still call it experimental, and its strengths aren't needed at this scale). WebGPU is the *scaling talking point*.
- **Trade-off you're accepting:** ~200 lines of engine glue and hand-written lighting, no drei conveniences, and no demonstrated WebGPU/compute.

---

## 1. Rendering stack

### What this project needs (it's different from the forest)
| Need | Forest | Blast viewer |
|---|---|---|
| Instancing | Grass/foliage per tile | One mesh with up to 30k–1M boxes |
| Custom vertex work | Wind displacement | Interpolate start→end positions with a throw arc |
| Post-processing | Selective bloom, two composers | **None.** Edge darkening and per-block "AO" can be done in the block shader. |
| Shadows | Yes | **No** for the MVP. Readability comes from lighting, edge darkening and section views. |
| Assets/loaders | Many (models, textures) | Almost none. Everything is procedural or comes from the API. |
| Frame loop | Always animating (wind) | Mostly static, so **render on demand** |

This removes two of your pain points before any architecture choice is made: **the bloom extra pass (#6) doesn't apply**, and the fragile patching (#7) can be avoided entirely.

### Options weighed
| Criterion | **Plain three.js WebGL + GLSL** | **R3F + drei** (v9 stable on WebGL) | **WebGPURenderer + TSL** (plain or in R3F) |
|---|---|---|---|
| **Your GLSL habits** | Carry over 1:1 | GLSL still works (`shaderMaterial`), but inside the JSX/hooks model | **Don't port.** The official docs say `ShaderMaterial`, `RawShaderMaterial` and `onBeforeCompile` aren't supported; you rewrite as TSL node graphs ([manual][tjs-wgpu]) |
| **Shader portability / tooling** | `.glsl.ts` template strings work in any bundler, in Vitest and for coding agents | Same | TSL is JS, so no loader is needed and it transpiles to WGSL or GLSL. Debugging generated code is harder. |
| **Post-processing** | `EffectComposer`. Selective bloom costs an extra pass, but it's **not needed here**. | `@react-three/postprocessing` | Node-based post-processing with MRT makes selective bloom cheap, but it's **not needed here** |
| **Device support** | WebGL2 is effectively universal | Same | WebGPU ships in Chrome/Edge, Safari 26 and Firefox (Windows 141+, Apple Silicon macOS 145+). Linux, Android and Intel-Mac Firefox are still in progress ([web.dev][webdev]). There's an automatic WebGL2 fallback, but **compute shaders don't run on the fallback** ⚠️ and some features behave differently, so you'd test two backends. |
| **Performance control** | Total: your loop, `compileAsync`, shadows, layers | Good (`frameloop="demand"`, `useFrame` priorities), but the reconciler sits in the middle | Total, plus GPU compute and indirect draws, which are where it pulls ahead at 10⁶+ instances |
| **Maturity / docs** | Very mature; you know it | Mature on v9. **v10 is in alpha, makes WebGPU the default and moves WebGL to `/legacy`** ([release notes][r3f10]) ⚠️ churn | Moving fast; the manual still calls it experimental. Third-party blogs say it's production-ready from r171 ([Utsubo][utsubo]), so docs and blogs disagree ⚠️ |
| **Next.js integration** | Client component + `next/dynamic` with `ssr:false`. Nothing to configure for Turbopack. | Same boundary; R3F is fine in a client component | Same, plus an async `renderer.init()` before the first render |
| **Learning cost (this weekend)** | 0 | 1–3 h | 4 h+ (TSL + node materials + two-backend testing) |

**Decision:** plain three.js WebGL. It's the only option that keeps your habits, adds no learning cost and covers everything this project needs.

**When WebGPU/TSL becomes the right call:** real-scale block models (10⁶–10⁷ blocks) where you want GPU-driven culling or LOD, indirect draws, or movement/reconciliation in compute shaders. That's a post-weekend experiment branch and a strong interview topic. The block shader's `mix(aStart, aEnd, t)` maps naturally to a TSL `positionNode`, so the port would be small ⚠️ (TSL API names change between releases).

### Shader approach (fixes #7 and #8)
- **Own the material.** Use `InstancedBufferGeometry` + `Mesh` + `ShaderMaterial` (not `onBeforeCompile` on `MeshStandardMaterial`). Lighting for boxes is about 15 lines: hemisphere ambient, one directional N·L, edge darkening from a local-position varying. There's nothing to patch, so a three.js upgrade can't break it.
- **Own attributes:** `aStart`, `aEnd` (vec3), `aDelay` (float), `aColor` (vec3), optional `aOcclusion` (vec2: pre/post, a cheap baked AO). Don't rely on `instanceMatrix` or `instanceColor` magic.
- **Section view:** a `uSection` plane uniform plus `discard`, instead of three's clipping-plane chunks.
- **Shader files:** `blocks.vert.glsl.ts` → `export default /* glsl */\`…\``. Shared chunks are TS string imports interpolated into the template (this replaces glslify `#pragma` imports). The `/* glsl */` tag gives syntax highlighting with the VS Code "Comment tagged templates" or glsl-literal extension. Works with Turbopack (the Next 16 default for dev *and* build), webpack, Vitest and agents. No `turbopack.rules` loader config: raw-loader is listed as working with Turbopack ([Next docs][next-turbo]), but this approach avoids the question.
- **Picking:** a CPU ray–AABB test over the `start`/`end` arrays, using the **same easing function in TS** as the GLSL (one shared constant). It works mid-scrub, about 1 ms at 30k blocks, and needs no `instanceMatrix` sync.
- **Culling:** `mesh.frustumCulled = false`. It's one mesh and always on screen.
- **If you add shadows later:** custom vertex displacement needs a matching `customDepthMaterial`, otherwise the shadows are cast from undisplaced positions.

---

## 2. Architecture

### Options vs your pain points
| # | Pain point | **Adapted SceneContext + systems** | **R3F components/hooks** | **ECS** (koota / miniplex / bitecs) |
|---|---|---|---|---|
| 1 | Implicit system ordering | ✅ Each system declares a `phase` (`input → simulate → animate → render`); order is one array in `systems/index.ts` | ◐ `useFrame(cb, priority)`, but numbers are scattered across components, and **any priority > 0 turns off auto-render** so you own `gl.render` ⚠️ | ◐ The pipeline order is explicit, but still manual |
| 2 | `elapsed` passed instead of delta | ✅ `update({ dt, elapsed, frame })` with dt clamped to ≤ 1/20 s; anything time-based must use `dt` | ✅ `useFrame((state, delta))` | ◐ Up to you |
| 3 | No unmount cleanup | ✅ Mandatory `dispose()` + `DisposeBag` (geometries, materials, textures, listeners, observers) + StrictMode remount test | ✅ Auto-dispose of JSX-created objects. Imperatively created buffers/textures are still yours ⚠️ | ✗ Not addressed |
| 4 | Ad-hoc init signatures | ✅ One `SystemFactory<Deps>` type; async `init()` allowed | ✅ Components | ✅ Uniform systems |
| 5 | DOM-id coupling UI ↔ scene | ✅ **Vanilla Zustand store:** React uses `useStore(store, selector)`, the engine uses `store.subscribe(selector, cb)` for discrete changes and `getState()` per frame for continuous ones | ✅ One React tree | ◐ Needs a bridge (koota has React hooks) |
| 6 | Selective bloom extra pass | n/a here (no post-processing) | n/a | n/a. (WebGPU MRT would fix it in the forest.) |
| 7 | Fragile shader patching | ✅ Owned `ShaderMaterial` | — neutral | — neutral |
| 8 | Webpack-only shader loader | ✅ `.glsl.ts` | ✅ same trick | ✅ same trick |
| + | **Keeps what you liked** (loop control, `compileAsync` before reveal, optimisations local to a system) | ✅ All of it | ◐ Mostly, but less direct | ◐ Systems stay local; render control is yours |
| + | Learning cost / dependency | ~200 lines you own | New framework | New framework |

**Why not ECS:** an ECS pays off with many heterogeneous entities whose component sets change at runtime (games). Here there's one huge homogeneous dataset that is **already struct-of-arrays** (the useful part of ECS), plus about 6 static layers. A library would add indirection and fix nothing in the table that the adapted pattern doesn't.

**Why not R3F here:** it does fix #2–#5 elegantly. But every hot path (buffers, shader, picking) would be imperative anyway, #1 only gets "priority numbers", and you'd pay the learning cost on a deadline. It's a fine choice for a team already on it, and a good answer if you're asked about it.

### The adapted pattern
```ts
// engine/types.ts
export type Phase = 'input' | 'simulate' | 'animate' | 'render';
export interface FrameInfo { dt: number; elapsed: number; frame: number }   // seconds; dt clamped

export interface System {
  readonly name: string;
  readonly phase: Phase;
  init?(): void | Promise<void>;
  update?(f: FrameInfo): void;
  isAnimating?(): boolean;          // render-on-demand: keep the loop hot while true
  dispose(): void;                  // mandatory
}
export type SystemFactory<D extends object = {}> = (ctx: EngineContext, deps: D) => System;

export interface EngineContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  store: AppStore;                  // zustand/vanilla — the ONLY bridge to React
  data: DataSource;                 // the ONLY bridge to the API
  bag: DisposeBag;                  // track(geom|mat|tex|() => void)
  invalidate(): void;               // request one frame
}
```
```ts
// engine/Engine.ts (shape, not full code)
export async function createEngine(canvas, store, data): Promise<Engine> {
  const ctx = makeContext(canvas, store, data);
  const systems = registerSystems(ctx);            // systems/index.ts: ordered, typed deps
  for (const s of systems) await s.init?.();       // deterministic boot order
  await ctx.renderer.compileAsync(ctx.scene, ctx.camera);   // your habit: compile before reveal
  store.getState().setEngineReady(true);
  ctx.renderer.setAnimationLoop(loop);             // loop: compute dt, run phases in order,
  return { dispose };                              //   render only if dirty or any isAnimating()
  function dispose() { ctx.renderer.setAnimationLoop(null);
    [...systems].reverse().forEach(s => s.dispose()); ctx.bag.disposeAll(); ctx.renderer.dispose(); }
}
```
```tsx
// viewer/Viewer.tsx ('use client') — React owns only the canvas element and lifecycle
useEffect(() => {
  let engine: Engine | undefined, cancelled = false;
  createEngine(canvasRef.current!, appStore, dataSource).then(e => cancelled ? e.dispose() : (engine = e));
  return () => { cancelled = true; engine?.dispose(); };   // StrictMode-safe
}, []);
```

**Systems for this project, in order:**
1. `input/controls` (OrbitControls, plan-view tween)
2. `input/picking`
3. `simulate/playback` (advances `progress` by `dt / duration` while playing)
4. `animate/blocks`
5. `animate/holes`
6. `animate/digLines`
7. `animate/environment`
8. `animate/lighting`
9. `render/render` (last)

Data loading lives in the store and `DataSource`, not in systems. Systems react to `store.subscribe(s => s.movement, …)` by uploading new buffers.

---

## 3. Recommendation

**Next.js (App Router, Turbopack) + plain three.js `WebGLRenderer` + owned `ShaderMaterial`s in `.glsl.ts` + the adapted Engine/system pattern + a vanilla Zustand store + route-handler API.** Pin the current stable `next` and `three` versions when you scaffold ⚠️. I haven't checked today's exact version numbers; your last project used Next 15 / r176.

**Main trade-off:** you own about 200 lines of engine plumbing and your own lighting, and give up R3F/drei conveniences. WebGPU/compute stays a talking point rather than a demo. In return you get zero learning cost, full control, and a clean story: *"I fixed the architectural pain points from my last three.js project."*

### Starting folder structure
```
app/
  layout.tsx · page.tsx                 # server components: shell, metadata
  viewer-loader.tsx                     # 'use client'; next/dynamic(() => import('@/viewer/Viewer'), { ssr: false })
  api/health/route.ts
  api/blasts/route.ts
  api/blasts/[id]/route.ts
  api/blasts/[id]/model/route.ts        # binary; can be prebuilt for the 3 demo blasts
  api/blasts/[id]/movement/route.ts     # binary; zod-validated query; Cache-Control
src/
  core/        # pure TS (no three / react / DOM): model, movement, digline, reconcile, codec, blasts
  server/      # API helpers: schemas.ts (zod), binary.ts, cache.ts
  data/        # DataSource: api.ts, local.ts, index.ts (factory + fallback)
  state/       # store.ts (zustand/vanilla + subscribeWithSelector), hooks.ts (useAppStore)
  engine/
    Engine.ts · context.ts · types.ts · disposeBag.ts · loop.ts
    systems/   # index.ts (ordered registry), controls, picking, playback, blocks, holes, digLines, environment, lighting, render
    shaders/   # blocks.vert.glsl.ts, blocks.frag.glsl.ts, chunks/ease.glsl.ts, chunks/lighting.glsl.ts
  ui/          # React panel, timeline, stats, inspector, legend, blast picker (no three imports)
  viewer/      # Viewer.tsx: canvas + engine lifecycle
```

### Five conventions to lock in on day one
1. **Mine coordinates, Z-up, metres, everywhere.** Call `THREE.Object3D.DEFAULT_UP.set(0, 0, 1)` once before any object is created, and set `camera.up` to Z. OrbitControls follows `camera.up`. No axis conversions anywhere. Units go in names or comments (`m`, `t`, `g/t`).
2. **Hard layer boundaries, enforced by ESLint `no-restricted-imports`:**
   - `core` imports nothing app-specific
   - `engine` may import `three` but not `react`
   - `ui` may import `react` but not `three`
   - the store and `DataSource` are the only bridges between them
3. **System contract:**
   - declare a phase
   - `update({ dt, elapsed })` with all motion derived from `dt`
   - `dispose()` is mandatory, and every GPU resource is registered in the `DisposeBag`
   - React StrictMode stays on, and a mount → unmount → mount cycle must return `renderer.info.memory` to baseline
4. **Shaders:**
   - `.glsl.ts` template strings
   - owned `ShaderMaterial`
   - a typed uniforms object next to each shader
   - no global `ShaderChunk` overrides
   - `onBeforeCompile` only with a comment explaining why
5. **Data:**
   - struct-of-arrays typed arrays end to end (API → decode → GPU attributes)
   - every random number seeded
   - render on demand: anything that changes the image calls `ctx.invalidate()`

---

### Sources
- [three.js manual: WebGPURenderer][tjs-wgpu]: experimental status, WebGL2 fallback, `ShaderMaterial`/`onBeforeCompile` not supported
- [web.dev: WebGPU supported in major browsers][webdev]: browser and platform coverage
- [Utsubo: WebGPU + Three.js migration guide (2026)][utsubo]: third-party "production-ready since r171" claim, which conflicts with the manual
- [Next.js docs: Turbopack config (v15)][next-turbo]: `turbopack.rules`, tested webpack loaders incl. raw-loader
- [R3F 10.0.0-alpha.6 release notes][r3f10]: WebGPU default, WebGL moved to `/legacy`, still alpha

[tjs-wgpu]: https://threejs.org/manual/en/webgpurenderer
[webdev]: https://web.dev/blog/webgpu-supported-major-browsers
[utsubo]: https://www.utsubo.com/blog/webgpu-threejs-migration-guide
[next-turbo]: https://nextjs.org/docs/15/app/api-reference/config/next-config-js/turbopack
[r3f10]: https://newreleases.io/project/npm/@react-three/fiber/release/10.0.0-alpha.6
