/**
 * The app store (docs/02-plan.md ADR-7): ONE vanilla zustand store, the only bridge between
 * React and the engine.
 *
 * - React:  `useAppStore(selector)` (state/hooks.ts).
 * - Engine: `store.subscribe(selector, cb)` for discrete changes (new movement → upload buffers),
 *           `store.getState()` inside the frame loop for continuous values (`progress`).
 *
 * CONTRACT FILE: changes need an explicit note in the PR description (see CLAUDE.md).
 */
import { subscribeWithSelector } from 'zustand/middleware';
import { createStore, type Mutate, type StoreApi } from 'zustand/vanilla';
import { DEFAULT_BLAST_PARAMETERS } from '@/core/defaults';
import type {
  BlastParameters,
  BlockModel,
  DigPolygon,
  MovementResult,
  ReconciliationResult,
  ScenarioKey,
} from '@/core/types';
import type { BlastDetail, BlastSummary } from '@/core/api-types';
import type { DataSourceKind } from '@/data';

export type ColourMode = 'grade' | 'outcome' | 'movement';
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export type LayerKey = 'originalLine' | 'adjustedLine' | 'holes';
/** Which dig line drives outcome colouring once the blast has started (P1). */
export type OutcomeLine = 'original' | 'adjusted';

export interface SectionState {
  enabled: boolean;
  /** m along the section axis (mine grid, absolute world coordinate). */
  position: number;
  /**
   * 'y': the plane y = position (constant northing) hides everything south of it, so the cut
   * face shows the E–W profile, i.e. the +x throw. 'x': the plane x = position hides everything
   * east of it (a N–S profile). Both keep the side facing away from the default camera (SSE).
   */
  axis: 'x' | 'y';
}

export interface DigPolygons {
  original: DigPolygon;
  adjusted: DigPolygon;
}

export interface AppState {
  // ── Selection of data ────────────────────────────────────────────────────
  blasts: BlastSummary[];
  blastId: string;
  blast: BlastDetail | null;
  params: BlastParameters;

  // ── Async status ─────────────────────────────────────────────────────────
  status: LoadStatus;
  /** Where the current model/movement came from (drives the source badge). */
  source: DataSourceKind | null;
  /** ms for the last movement fetch/compute (badge: "● API · 38 ms"). */
  lastLatencyMs: number | null;
  /**
   * Why the API was bypassed: the error of the last API call that fell back to local compute
   * (badge: "Local fallback"). Cleared when a model or movement from the API lands.
   */
  fallback: string | null;
  error: string | null;

  // ── Data from the DataSource (SoA typed arrays; never copied into React state) ─
  model: BlockModel | null;
  movement: MovementResult | null;

  // ── Derived on the client (dig lines + reconciliation), written by a derivation step ─
  polygons: DigPolygons | null;
  reconciliation: Record<ScenarioKey, ReconciliationResult> | null;

  // ── View ─────────────────────────────────────────────────────────────────
  colourMode: ColourMode;
  /** Outcome mode, after the blast: classify against this line. Before it: always the original. */
  outcomeLine: OutcomeLine;
  layers: Record<LayerKey, boolean>;
  oreOnly: boolean;
  section: SectionState;
  /** Selected block id, or null. */
  selection: number | null;
  cameraView: '3d' | 'plan';

  // ── Playback (continuous: engine reads with getState() each frame) ───────
  /** 0 = in situ, 1 = settled muckpile. */
  progress: number;
  playing: boolean;
  /** s for the full 0 → 1 animation. */
  duration: number;

  engineReady: boolean;
}

export interface AppActions {
  setBlasts(blasts: BlastSummary[]): void;
  /** Select a blast; clears data and selection. Re-selecting the current blast is a no-op. */
  setBlastId(id: string): void;
  setBlast(detail: BlastDetail): void;
  /** Merge params (e.g. from the parameter panel). Changed params clear movement + derived slots. */
  setParams(patch: Partial<BlastParameters>): void;
  resetParams(): void;

  setStatus(status: LoadStatus, error?: string | null): void;
  /** An API call failed and local compute served it instead (DataSource `onFallback`). */
  setFallback(reason: string | null): void;
  /** Clears movement, derived slots and selection (they belong to the previous model). */
  setModel(model: BlockModel, source: DataSourceKind): void;
  /** Clears the derived slots; the derive step recomputes them for this movement. */
  setMovement(movement: MovementResult, source: DataSourceKind, latencyMs?: number): void;
  setDerived(polygons: DigPolygons | null, reconciliation: AppState['reconciliation']): void;

  setColourMode(mode: ColourMode): void;
  setOutcomeLine(line: OutcomeLine): void;
  setLayer(layer: LayerKey, visible: boolean): void;
  toggleLayer(layer: LayerKey): void;
  setOreOnly(oreOnly: boolean): void;
  setSection(patch: Partial<SectionState>): void;
  select(blockId: number | null): void;
  setCameraView(view: AppState['cameraView']): void;

  /** Clamped to [0, 1]. Called by the scrubber, and by the playback system while playing. */
  setProgress(progress: number): void;
  /** Starts from 0 if already at the end. */
  play(): void;
  pause(): void;
  setEngineReady(ready: boolean): void;
}

export type AppStoreState = AppState & AppActions;
/** Vanilla store with the subscribeWithSelector overload: `subscribe(selector, listener, opts)`. */
export type AppStore = Mutate<StoreApi<AppStoreState>, [['zustand/subscribeWithSelector', never]]>;

export const DEFAULT_BLAST_ID = 'b1040-017';

export function initialAppState(): AppState {
  return {
    blasts: [],
    blastId: DEFAULT_BLAST_ID,
    blast: null,
    params: { ...DEFAULT_BLAST_PARAMETERS },
    status: 'idle',
    source: null,
    lastLatencyMs: null,
    fallback: null,
    error: null,
    model: null,
    movement: null,
    polygons: null,
    reconciliation: null,
    colourMode: 'grade',
    outcomeLine: 'original',
    layers: { originalLine: true, adjustedLine: true, holes: true },
    oreOnly: false,
    section: { enabled: false, position: 0, axis: 'y' },
    selection: null,
    cameraView: '3d',
    progress: 0,
    playing: false,
    duration: 2.5,
    engineReady: false,
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function sameParams(a: BlastParameters, b: BlastParameters): boolean {
  for (const k of Object.keys(a) as (keyof BlastParameters)[]) if (a[k] !== b[k]) return false;
  return Object.keys(a).length === Object.keys(b).length;
}

/**
 * Invalidating the movement also rewinds playback, atomically: without a movement every block
 * sits in situ (packInstances), so a kept progress (e.g. 1) would show the old end → in-situ
 * jump now and an in-situ → new-end jump when the new movement lands at that progress. At
 * progress 0, paused, the new movement arrives exactly where the blocks already are.
 */
const REWIND: Pick<AppState, 'progress' | 'playing'> = { progress: 0, playing: false };

/**
 * New params make the current movement and everything derived from it stale: clear them so stale
 * results never show with new inputs, and rewind (REWIND). Unchanged params leave the state as it is.
 */
function paramsUpdate(state: AppState, next: BlastParameters): Partial<AppState> {
  if (sameParams(state.params, next)) return {};
  return { params: { ...next }, movement: null, polygons: null, reconciliation: null, ...REWIND };
}

/**
 * The state update `setModel` applies: the new model, and the movement and everything derived from
 * it cleared, rewound. Exported so the load pipeline can store a model together with its blast
 * detail in ONE `setState` (every subscriber sees a matched pair) without duplicating this logic.
 */
export function modelUpdate(model: BlockModel, source: DataSourceKind): Partial<AppState> {
  return {
    model,
    source,
    ...(source === 'api' ? { fallback: null } : {}),
    movement: null,
    polygons: null,
    reconciliation: null,
    selection: null,
    ...REWIND,
  };
}

/** Factory so tests (and StrictMode remounts) can get an isolated store. */
export function createAppStore(initial: Partial<AppState> = {}): AppStore {
  return createStore<AppStoreState>()(
    subscribeWithSelector((set, get) => ({
      ...initialAppState(),
      ...initial,

      setBlasts: (blasts) => set({ blasts }),
      setBlastId: (blastId) => {
        if (blastId === get().blastId) return;
        set({
          blastId,
          blast: null,
          model: null,
          movement: null,
          polygons: null,
          reconciliation: null,
          selection: null,
          progress: 0,
          playing: false,
        });
      },
      setBlast: (blast) => set({ blast, ...paramsUpdate(get(), blast.defaultParams) }),
      setParams: (patch) => set(paramsUpdate(get(), { ...get().params, ...patch })),
      resetParams: () => set(paramsUpdate(get(), get().blast?.defaultParams ?? DEFAULT_BLAST_PARAMETERS)),

      setStatus: (status, error = null) => set({ status, error }),
      setFallback: (fallback) => set({ fallback }),
      // A new model invalidates the movement and everything derived from it, and rewinds.
      setModel: (model, source) => set(modelUpdate(model, source)),
      // A new movement invalidates the derived slots; the derive step (state/derive.ts) refills them.
      // It always lands at progress 0 (blocks in situ, no pop). `playing` is kept: a Blast pressed
      // while the movement was loading (playback holds at 0 meanwhile) starts from the beginning.
      setMovement: (movement, source, latencyMs) =>
        set({
          movement,
          progress: 0,
          source,
          ...(source === 'api' ? { fallback: null } : {}),
          lastLatencyMs: latencyMs ?? null,
          status: 'ready',
          error: null,
          polygons: null,
          reconciliation: null,
        }),
      setDerived: (polygons, reconciliation) => set({ polygons, reconciliation }),

      setColourMode: (colourMode) => set({ colourMode }),
      setOutcomeLine: (outcomeLine) => set({ outcomeLine }),
      setLayer: (layer, visible) => set({ layers: { ...get().layers, [layer]: visible } }),
      toggleLayer: (layer) => set({ layers: { ...get().layers, [layer]: !get().layers[layer] } }),
      setOreOnly: (oreOnly) => set({ oreOnly }),
      setSection: (patch) => set({ section: { ...get().section, ...patch } }),
      select: (selection) => set({ selection }),
      setCameraView: (cameraView) => set({ cameraView }),

      setProgress: (progress) => set({ progress: clamp01(progress) }),
      play: () => set({ playing: true, progress: get().progress >= 1 ? 0 : get().progress }),
      pause: () => set({ playing: false }),
      setEngineReady: (engineReady) => set({ engineReady }),
    })),
  );
}

/** The app-wide singleton shared by React (hooks.ts) and the engine (EngineContext.store). */
export const appStore: AppStore = createAppStore();
