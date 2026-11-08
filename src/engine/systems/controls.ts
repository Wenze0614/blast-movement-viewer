/**
 * input/controls: OrbitControls (three/addons) around the bench, Z-up (follows camera.up).
 * Frames the camera when a new blast's model arrives. Damping keeps the loop hot only while the
 * camera is still moving.
 *
 * P4 plan view: `store.cameraView` switches between the 3D pose and a top-down, north-up pose
 * that fits the bench plus the muckpile. The switch eases over CAMERA_TWEEN_S, driven by dt
 * (input is paused meanwhile). In plan view rotation is locked and a left drag pans; going back
 * to 3D restores the 3D pose the user left (until a new blast reframes).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { smoothstep01 } from '@/core/easing';
import type { BlockModel, MovementResult } from '@/core/types';
import type { AppState } from '@/state/store';
import { sectionRange } from '@/state/views';
import type { SystemFactory } from '../types';

export interface CameraPose {
  target: THREE.Vector3;
  position: THREE.Vector3;
}

/** s, duration of the 3D ↔ plan camera ease. */
export const CAMERA_TWEEN_S = 0.6;
/** Margin around the drawn extent in plan view (1.1 = 10 % each way). */
export const PLAN_MARGIN = 1.1;

/** Camera pose for a bench: from the south and a little east/above, looking at its centre. */
export function framingFor(model: BlockModel): CameraPose {
  const { origin, blockSize, nx, ny, nz } = model.grid;
  const w = nx * blockSize[0];
  const h = ny * blockSize[1];
  const d = nz * blockSize[2];
  const target = new THREE.Vector3(origin[0] + w / 2, origin[1] + h / 2, origin[2] + d / 2);
  const span = Math.max(w, h);
  const position = target.clone().add(new THREE.Vector3(0.2 * span, -1.05 * span, 0.75 * span));
  return { target, position };
}

/**
 * Top-down pose that fits the in-situ bench plus the muckpile (the section-slider extents) in a
 * perspective camera of vertical field of view `fovDeg` and `aspect`, looking at the bench crest.
 * The camera sits a hair south of the target so lookAt with Z-up is well defined and north is up.
 */
export function planFramingFor(
  model: BlockModel,
  movement: MovementResult | null,
  fovDeg: number,
  aspect: number,
): CameraPose {
  const [x0, x1] = sectionRange(model, movement, 'x');
  const [y0, y1] = sectionRange(model, movement, 'y');
  const crest = model.grid.origin[2] + model.grid.nz * model.grid.blockSize[2];
  const target = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, crest);
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  const halfW = ((x1 - x0) / 2) * PLAN_MARGIN;
  const halfH = ((y1 - y0) / 2) * PLAN_MARGIN;
  const height = Math.max(halfH / tanHalf, halfW / (tanHalf * Math.max(aspect, 1e-3)));
  const position = new THREE.Vector3(target.x, target.y - 1e-3 * height, crest + height);
  return { target, position };
}

export const createControlsSystem: SystemFactory = (ctx) => {
  const { camera, canvas, store, bag } = ctx;
  const controls = bag.track(new OrbitControls(camera, canvas));
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.495; // stay above the floor
  controls.screenSpacePanning = true;
  const onChange = () => ctx.invalidate();
  controls.addEventListener('change', onChange);
  bag.track(() => controls.removeEventListener('change', onChange));

  let moving = false;
  let framedFor: string | null = null;
  /** Active 3D ↔ plan ease, or null. */
  let tween: { from: CameraPose; to: CameraPose; t: number } | null = null;
  /** The 3D pose saved when switching to plan; restored on the way back. */
  let saved3d: CameraPose | null = null;

  const poseFor = (view: AppState['cameraView'], model: BlockModel): CameraPose =>
    view === 'plan' ? planFramingFor(model, store.getState().movement, camera.fov, camera.aspect) : framingFor(model);

  const applyPose = ({ target, position }: CameraPose) => {
    controls.target.copy(target);
    camera.position.copy(position);
  };

  const applyViewMode = (view: AppState['cameraView']) => {
    const plan = view === 'plan';
    controls.enableRotate = !plan;
    controls.mouseButtons.LEFT = plan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE = plan ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  };

  const fitClipping = (pose: CameraPose) => {
    camera.near = 0.5;
    camera.far = Math.max(camera.far, 20 * pose.position.distanceTo(pose.target));
    camera.updateProjectionMatrix();
  };

  const frame = (model: BlockModel | null) => {
    if (!model || model.configHash === framedFor) return;
    framedFor = model.configHash;
    tween = null;
    saved3d = null;
    controls.enabled = true;
    const view = store.getState().cameraView;
    const pose = poseFor(view, model);
    camera.far = 0; // re-derive for this bench
    fitClipping(pose);
    applyPose(pose);
    applyViewMode(view);
    controls.update();
    ctx.invalidate();
  };

  const switchView = (view: AppState['cameraView']) => {
    const { model } = store.getState();
    applyViewMode(view);
    if (!model) return;
    const from: CameraPose = { target: controls.target.clone(), position: camera.position.clone() };
    // Leaving 3D (not mid-ease back from plan): remember where the user was.
    if (view === 'plan' && !tween) saved3d = from;
    const to = view === '3d' && saved3d ? saved3d : poseFor(view, model);
    if (view === '3d') saved3d = null;
    fitClipping(to);
    tween = { from, to, t: 0 };
    controls.enabled = false; // no orbit/pan fighting the ease
    ctx.invalidate();
  };

  bag.track(store.subscribe((s) => s.model, frame));
  bag.track(store.subscribe((s) => s.cameraView, switchView));

  return {
    name: 'controls',
    phase: 'input',
    init() {
      camera.position.set(50, -80, 1100);
      controls.target.set(50, 30, 1035);
      controls.update();
      applyViewMode(store.getState().cameraView);
      frame(store.getState().model);
    },
    update({ dt }) {
      if (tween) {
        tween.t = Math.min(1, tween.t + dt / CAMERA_TWEEN_S);
        const k = smoothstep01(tween.t);
        controls.target.lerpVectors(tween.from.target, tween.to.target, k);
        camera.position.lerpVectors(tween.from.position, tween.to.position, k);
        if (tween.t >= 1) {
          tween = null;
          controls.enabled = true;
        }
        controls.update();
        moving = true;
        return;
      }
      moving = controls.update(dt);
    },
    isAnimating() {
      return moving || tween !== null;
    },
    dispose() {},
  };
};
