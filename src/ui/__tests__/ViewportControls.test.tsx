// @vitest-environment happy-dom
/**
 * P4/P6 viewport controls: 3D / Plan write store.cameraView, FPS toggles showPerf, and the
 * readout's three states (measuring, idle, active).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appStore, initialAppState } from '@/state/store';
import ViewportControls, { PerfReadout } from '../ViewportControls';

afterEach(cleanup);
beforeEach(() => appStore.setState(initialAppState()));

const frameText = () => document.querySelector('[data-perf="frame"]')!.textContent;

describe('PerfReadout', () => {
  it('measuring before the first sample, idle with no frames, fps while animating', () => {
    render(<PerfReadout perf={null} blocks={3840} />);
    expect(frameText()).toBe('measuring…');
    expect(document.querySelector('[data-perf="cost"]')).toBeNull();
    cleanup();
    render(<PerfReadout perf={{ fps: 0, frameMs: 0, active: false, drawCalls: 6, triangles: 62606 }} blocks={3840} />);
    expect(frameText()).toBe('idle · render on demand');
    expect(document.querySelector('[data-perf="cost"]')!.textContent).toBe('6 draw calls · 63k tris · 3,840 blocks');
    cleanup();
    render(<PerfReadout perf={{ fps: 59.7, frameMs: 16.75, active: true, drawCalls: 5, triangles: 47006 }} blocks={null} />);
    expect(frameText()).toBe('60 fps · 16.8 ms');
    expect(document.querySelector('[data-perf="cost"]')!.textContent).toBe('5 draw calls · 47k tris');
  });
});

describe('ViewportControls', () => {
  it('3D / Plan set the camera view and show which is active', () => {
    render(<ViewportControls />);
    const plan = screen.getByRole('button', { name: 'Plan' });
    const three = screen.getByRole('button', { name: '3D' });
    expect(three.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(plan);
    expect(appStore.getState().cameraView).toBe('plan');
    expect(plan.getAttribute('aria-pressed')).toBe('true');
    expect(three.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(three);
    expect(appStore.getState().cameraView).toBe('3d');
  });

  it('FPS toggles the readout; hiding it clears the stats', () => {
    render(<ViewportControls />);
    expect(screen.queryByTestId('perf-readout')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'FPS' }));
    expect(appStore.getState().showPerf).toBe(true);
    expect(screen.getByTestId('perf-readout')).toBeTruthy();
    act(() => appStore.getState().setPerf({ fps: 60, frameMs: 16.7, active: true, drawCalls: 5, triangles: 1000 }));
    expect(frameText()).toBe('60 fps · 16.7 ms');
    fireEvent.click(screen.getByRole('button', { name: 'FPS' }));
    expect(appStore.getState().showPerf).toBe(false);
    expect(appStore.getState().perf).toBeNull();
    expect(screen.queryByTestId('perf-readout')).toBeNull();
  });
});
