/**
 * animate/holes (P9, ADR-2 "Other layers"): the blasthole pattern from the store's BlastDetail as
 * ONE instanced cylinder mesh (one draw call) with a tiny owned ShaderMaterial. Colour = grade
 * class of each hole's sampled grade (grade palette). Visible before the blast, fading out while
 * the front rows fire: the per-frame CPU work is one uniform (uOpacity) plus the visibility flag.
 *
 * - Rebuilt only when `store.blast` changes (a new blast, or the pipeline swapping in the local
 *   detail so the holes always match the model's source).
 * - Section plane: honoured (per-fragment discard, same plane as the blocks).
 * - Ore-only: ignored on purpose. Holes are not blocks and carry no ore flag; with waste hidden,
 *   the columns through the ore read as context.
 * - Lighting: the same hand-written chunk as the blocks, so no scene lights are added and the
 *   blocks are unaffected.
 * - Illustrative only: the movement heuristic never reads the pattern (labelled in the UI).
 * - Depth: at full opacity (before the blast) the material is OPAQUE (depth write on, opaque
 *   pass), so the stick-ups occlude and sort like solid geometry. Only while fading
 *   (0 < opacity < 1) is it transparent with depthWrite: false, so a fading hole never punches
 *   depth "holes" that hide blocks or the other holes behind it. At opacity 0 the mesh is hidden.
 */
import * as THREE from 'three';
import type { BlastDetail } from '@/core/api-types';
import { sectionPlane } from '@/state/views';
import holesFrag from '../shaders/holes.frag.glsl';
import { createHolesUniforms } from '../shaders/holes.uniforms';
import holesVert from '../shaders/holes.vert.glsl';
import type { SystemFactory } from '../types';
import { EMPTY_HOLE_PACK, holesOpacity, packHoles, type HolePack } from './holesAttributes';

/** Radial segments of the unit cylinder: round enough at r = 0.3 m, ~50 triangles per hole. */
const RADIAL_SEGMENTS = 12;

export function buildHolesGeometry(base: THREE.BufferGeometry, pack: HolePack): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute('position', base.getAttribute('position'));
  geometry.setAttribute('normal', base.getAttribute('normal'));
  geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(pack.center, 3));
  geometry.setAttribute('aAxis', new THREE.InstancedBufferAttribute(pack.axis, 3));
  geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(pack.color, 3));
  geometry.instanceCount = pack.count;
  return geometry;
}

export const createHolesSystem: SystemFactory = (ctx) => {
  const { store, scene, bag } = ctx;
  const uniforms = createHolesUniforms();
  const material = bag.track(
    new THREE.ShaderMaterial({
      name: 'holes',
      vertexShader: holesVert,
      fragmentShader: holesFrag,
      uniforms,
      transparent: false, // switched by applyVisibility() while fading
      depthWrite: true,
    }),
  );
  const base = bag.track(new THREE.CylinderGeometry(1, 1, 1, RADIAL_SEGMENTS, 1, false));
  let geometry = buildHolesGeometry(base, EMPTY_HOLE_PACK);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'holes';
  mesh.frustumCulled = false; // instances are placed in the shader; the unit cylinder's bounds are wrong
  mesh.visible = false;
  scene.add(mesh);
  bag.track(() => {
    scene.remove(mesh);
    geometry.dispose();
  });

  /**
   * Render state of the mesh: 'opaque' (opacity 1), 'fading' (0 < opacity < 1) or 'hidden' (faded
   * out, layer off, or no holes). The material flags and `mesh.visible` are written only on a
   * transition between these; per frame only the opacity uniform is written.
   */
  type HolesState = 'opaque' | 'fading' | 'hidden';
  let state: HolesState | null = null;

  const applyVisibility = () => {
    const s = store.getState();
    const opacity = holesOpacity(s.progress);
    uniforms.uOpacity.value = opacity;
    const next: HolesState =
      !s.layers.holes || geometry.instanceCount === 0 || opacity <= 0 ? 'hidden' : opacity < 1 ? 'fading' : 'opaque';
    if (next === state) return;
    state = next;
    mesh.visible = next !== 'hidden';
    if (next === 'hidden') return; // keep the last material flags; nothing is drawn
    const fading = next === 'fading';
    if (material.transparent !== fading) {
      material.transparent = fading;
      material.depthWrite = !fading;
      material.needsUpdate = true; // opaque ↔ transparent moves the mesh between render lists
    }
  };

  const rebuild = (blast: BlastDetail | null) => {
    const pack = blast ? packHoles(blast.holes, blast.grades) : EMPTY_HOLE_PACK;
    geometry.dispose();
    geometry = buildHolesGeometry(base, pack);
    mesh.geometry = geometry;
    applyVisibility();
    ctx.invalidate();
  };

  const applySection = () => {
    uniforms.uSection.value.set(...sectionPlane(store.getState().section));
    ctx.invalidate();
  };

  bag.track(store.subscribe((s) => s.blast, rebuild));
  bag.track(
    store.subscribe(
      (s) => s.layers.holes,
      () => {
        applyVisibility();
        ctx.invalidate();
      },
    ),
  );
  bag.track(store.subscribe((s) => s.section, applySection));
  bag.track(store.subscribe((s) => s.progress, () => ctx.invalidate()));

  return {
    name: 'holes',
    phase: 'animate',
    init() {
      rebuild(store.getState().blast);
      applySection();
    },
    update() {
      // P9: the only per-frame CPU work for the holes: one uniform write (material flags and
      // visibility change only on an opaque ↔ fading ↔ hidden transition).
      applyVisibility();
    },
    dispose() {
      // Mesh, geometries, material and subscriptions are all in ctx.bag.
    },
  };
};
