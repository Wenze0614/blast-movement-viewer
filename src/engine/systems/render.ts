/**
 * render/render (last): keeps the drawing buffer matched to the canvas size AND the device pixel
 * ratio, then draws. Runs only on active frames (render on demand, docs/03 convention 6).
 *
 * A DPR change (window dragged to another monitor, browser zoom) doesn't resize the canvas in CSS
 * px, so ResizeObserver stays silent; a `(resolution: Ndppx)` media query catches it instead.
 * LineMaterial's resolution needs no extra work: LineSegments2.onBeforeRender reads it from the
 * renderer viewport (CSS px) every draw, and linewidth is in CSS px too.
 */
import { targetPixelRatio } from '../context';
import type { SystemFactory } from '../types';

export const createRenderSystem: SystemFactory = (ctx) => {
  const { renderer, scene, camera, canvas, bag } = ctx;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => ctx.invalidate());
    observer.observe(canvas);
    bag.track(() => observer.disconnect());
  }

  // One-shot query for the current DPR, re-armed after every change (the query text embeds it).
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    let query: MediaQueryList | null = null;
    const onChange = () => {
      arm();
      ctx.invalidate();
    };
    const disarm = () => query?.removeEventListener('change', onChange);
    const arm = () => {
      disarm();
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      query.addEventListener('change', onChange);
    };
    arm();
    bag.track(disarm);
  }

  const fit = () => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const pr = targetPixelRatio();
    if (w === width && h === height && pr === pixelRatio) return;
    if (pr !== pixelRatio) {
      pixelRatio = pr;
      renderer.setPixelRatio(pr);
    }
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
