/**
 * render/render (last): keeps the drawing buffer matched to the canvas size, then draws.
 * Runs only on active frames (render on demand, docs/03 convention 6).
 */
import type { SystemFactory } from '../types';

export const createRenderSystem: SystemFactory = (ctx) => {
  const { renderer, scene, camera, canvas, bag } = ctx;
  let width = 0;
  let height = 0;

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => ctx.invalidate());
    observer.observe(canvas);
    bag.track(() => observer.disconnect());
  }

  const fit = () => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    if (w === width && h === height) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  return {
    name: 'render',
    phase: 'render',
    init() {
      fit();
    },
    update() {
      fit();
      renderer.render(scene, camera);
    },
    dispose() {},
  };
};
