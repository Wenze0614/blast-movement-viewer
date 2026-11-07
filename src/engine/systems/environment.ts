/**
 * animate/environment: a dark floor and a 10 m grid at the bench toe for spatial context.
 * Rebuilt when the model (bench extent) changes. Stock materials, no lights needed.
 */
import * as THREE from 'three';
import type { BlockModel } from '@/core/types';
import type { SystemFactory } from '../types';

/** Grid line spacing, m. */
export const GRID_SPACING = 10;

export const createEnvironmentSystem: SystemFactory = (ctx) => {
  const { store, scene, bag } = ctx;
  const group = new THREE.Group();
  group.name = 'environment';
  scene.add(group);

  const floorMaterial = bag.track(new THREE.MeshBasicMaterial({ color: '#2a2f37' }));
  let floorGeometry: THREE.PlaneGeometry | null = null;
  let grid: THREE.GridHelper | null = null;

  const clear = () => {
    group.clear();
    floorGeometry?.dispose();
    floorGeometry = null;
    if (grid) {
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      grid = null;
    }
  };
  bag.track(() => {
    clear();
    scene.remove(group);
  });

  const build = (model: BlockModel | null) => {
    clear();
    if (model) {
      const { origin, blockSize, nx, ny } = model.grid;
      const w = nx * blockSize[0];
      const h = ny * blockSize[1];
      const cx = origin[0] + w / 2;
      const cy = origin[1] + h / 2;
      const size = Math.ceil((Math.max(w, h) * 3) / GRID_SPACING) * GRID_SPACING;
      floorGeometry = new THREE.PlaneGeometry(size, size); // lies in XY, faces +Z: Z-up native
      const floor = new THREE.Mesh(floorGeometry, floorMaterial);
      floor.position.set(cx, cy, origin[2] - 0.02);
      floor.name = 'floor';
      grid = new THREE.GridHelper(size, size / GRID_SPACING, '#4a515c', '#363c45');
      grid.rotation.x = Math.PI / 2; // GridHelper is built in XZ; rotate into the XY (plan) plane
      grid.position.set(cx, cy, origin[2] - 0.01);
      group.add(floor, grid);
    }
    ctx.invalidate();
  };

  bag.track(store.subscribe((s) => s.model, build));

  return {
    name: 'environment',
    phase: 'animate',
    init() {
      build(store.getState().model);
    },
    dispose() {},
  };
};
