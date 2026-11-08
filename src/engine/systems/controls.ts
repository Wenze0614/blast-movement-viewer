/**
 * input/controls: OrbitControls (three/addons) around the bench, Z-up (follows camera.up).
 * Frames the camera when a new blast's model arrives. Damping keeps the loop hot only while the
 * camera is still moving.
 *
 * P4 plan view: `store.cameraView` switches between the 3D pose and a top-down, north-up pose
 * that fits the bench plus the muckpile. The switch eases over CAMERA_TWEEN_S, driven by dt
 * (input is paused, pending orbit inertia flushed). In plan view rotation is locked and a left
 * drag pans; going back to 3D restores the 3D pose the user left (until a new blast reframes).
 * A plan view fitted before the movement arrived refits once when it does.
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
  /** Active 3D ↔ plan ease (toward `view`), or null. */
  let tween: { from: CameraPose; to: CameraPose; t: number; view: AppState['cameraView'] } | null = null;
  /**
   * The 3D pose saved on leaving 3D; restored on the way back. Kept until a return to 3D
   * COMPLETES, so reversing mid-ease (plan → 3D → plan → 3D) still lands on it.
   */
  let saved3d: CameraPose | null = null;
  /**
   * The current plan pose was fitted before the movement existed (model first, movement later):
   * refit once when it arrives, so the muckpile is in view. Param changes never reframe.
   */
  let planAwaitsMovement = false;

  const planPose = (model: BlockModel): CameraPose => {
    const movement = store.getState().movement;
    planAwaitsMovement = movement === null;
    return planFramingFor(model, movement, camera.fov, camera.aspect);
  };
  const poseFor = (view: AppState['cameraView'], model: BlockModel): CameraPose =>
    view === 'plan' ? planPose(model) : framingFor(model);

  const currentPose = (): CameraPose => ({ target: controls.target.clone(), position: camera.position.clone() });

  const applyPose = ({ target, position }: CameraPose) => {
    controls.target.copy(target);
    camera.position.copy(position);
  };

  /**
   * Drop OrbitControls' pending damping (orbit/pan/zoom inertia) without moving the camera: an
   * undamped update applies and zeroes the deltas, then the pose is put back. Otherwise the
   * inertia keeps acting during and after an ease and the plan view ends up tilted or rotated.
   */
  const flushInertia = () => {
    const pose = currentPose();
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
    applyPose(pose);
    controls.update();
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

  const easeTo = (to: CameraPose, view: AppState['cameraView']) => {
    flushInertia();
    fitClipping(to);
    tween = { from: currentPose(), to, t: 0, view };
    controls.enabled = false; // no orbit/pan fighting the ease
    ctx.invalidate();
  };

  const frame = (model: BlockModel | null) => {
    if (!model || model.configHash === framedFor) return;
    framedFor = model.configHash;
    tween = null;
    saved3d = null;
    planAwaitsMovement = false;
    controls.enabled = true;
    const view = store.getState().cameraView;
    flushInertia();
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
    if (view === 'plan') {
      // Leaving a settled 3D view: remember it. Mid-ease back to 3D, the pose is still saved.
      if (!saved3d && !tween) saved3d = currentPose();
      easeTo(planPose(model), 'plan');
    } else {
      planAwaitsMovement = false;
      easeTo(saved3d ?? framingFor(model), '3d');
    }
  };

  const onMovement = (movement: MovementResult | null) => {
    const { model, cameraView } = store.getState();
    if (!movement || !model || cameraView !== 'plan' || !planAwaitsMovement) return;
    const to = planPose(model);
    if (tween && tween.view === 'plan') {
      fitClipping(to);
      tween.to = to; // retarget the running ease
      ctx.invalidate();
    } else {
      easeTo(to, 'plan');
    }
  };

  bag.track(store.subscribe((s) => s.model, frame));
  bag.track(store.subscribe((s) => s.cameraView, switchView));
  bag.track(store.subscribe((s) => s.movement, onMovement));

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
          if (tween.view === '3d') saved3d = null; // back where the user was
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
