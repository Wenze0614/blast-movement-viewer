// @vitest-environment happy-dom
/**
 * Load progress (the bar under the blast picker): the pure view maths, the delayed show / instant
 * hide, and the step-aware status text.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appStore, initialAppState, type LoadProgress } from '@/state/store';
import LoadProgressBar, { LoadProgressView, progressView, SHOW_AFTER_MS } from '../LoadProgressBar';
import { loadingText } from '../StatusLine';

const p = (over: Partial<LoadProgress>): LoadProgress => ({ loadId: 1, step: 'model', withModel: true, loaded: 0, total: null, ...over });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('progressView', () => {
  it('a blast load is two halves: the model then the movement, each filling by bytes', () => {
    expect(progressView(p({}))).toEqual({ done: 0, span: [0, 0.5], waiting: true, bytes: '' });
    expect(progressView(p({ loaded: 3e6, total: 12e6 }))).toMatchObject({ done: 0.125, span: [0, 0.5], waiting: false, bytes: '3.0 / 12.0 MB' });
    expect(progressView(p({ step: 'movement', loaded: 0 }))).toMatchObject({ done: 0.5, span: [0.5, 1], waiting: true });
    expect(progressView(p({ step: 'movement', loaded: 6e6, total: 12e6 })).done).toBe(0.75);
  });

  it('a parameter change is the movement alone, over the whole bar; unknown sizes never overflow', () => {
    expect(progressView(p({ step: 'movement', withModel: false, loaded: 6e6, total: 12e6 }))).toMatchObject({ done: 0.5, span: [0, 1] });
    expect(progressView(p({ loaded: 2.5e6, total: null }))).toMatchObject({ done: 0, waiting: false, bytes: '2.5 MB' });
    expect(progressView(p({ loaded: 20e6, total: 10e6 })).done).toBe(0.5); // clamped to its step
  });
});

describe('LoadProgressView', () => {
  it('an accessible progress bar with the percentage, a pulse while waiting, bytes while downloading', () => {
    const { rerender } = render(<LoadProgressView progress={p({})} />);
    const bar = screen.getByRole('progressbar', { name: 'Loading the block model' });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(document.querySelector('[data-waiting]')).not.toBeNull();
    rerender(<LoadProgressView progress={p({ step: 'movement', loaded: 9e6, total: 12e6 })} />);
    expect(screen.getByRole('progressbar', { name: 'Computing the movement' }).getAttribute('aria-valuenow')).toBe('88');
    expect(document.querySelector('[data-waiting]')).toBeNull();
    expect(screen.getByText('9.0 / 12.0 MB')).toBeTruthy();
  });
});

describe('LoadProgressBar (store-connected)', () => {
  beforeEach(() => {
    appStore.setState(initialAppState());
    vi.useFakeTimers();
  });

  it(`appears only after ${SHOW_AFTER_MS} ms of loading and disappears as soon as the load ends`, () => {
    render(<LoadProgressBar />);
    act(() => appStore.getState().setLoadProgress(p({})));
    expect(screen.queryByRole('progressbar')).toBeNull(); // a quick load never flashes it
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS));
    expect(screen.getByRole('progressbar')).toBeTruthy();
    act(() => appStore.getState().setLoadProgress(p({ step: 'movement', loaded: 1e6, total: 2e6 })));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('75');
    act(() => appStore.getState().setStatus('ready'));
    expect(appStore.getState().loadProgress).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('a replacement load (a new loadId) restarts the delay, after the bar was shown or before (Codex review)', () => {
    render(<LoadProgressBar />);
    act(() => appStore.getState().setLoadProgress(p({ loadId: 1 })));
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS));
    expect(screen.getByRole('progressbar')).toBeTruthy();
    // the user switches blast mid-load: a quick replacement must not inherit the shown state
    act(() => appStore.getState().setLoadProgress(p({ loadId: 2 })));
    expect(screen.queryByRole('progressbar')).toBeNull();
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS - 50));
    act(() => appStore.getState().setLoadProgress(p({ loadId: 3 }))); // replaced again before showing
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS - 50));
    expect(screen.queryByRole('progressbar')).toBeNull(); // 3's own delay has not passed
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByRole('progressbar')).toBeTruthy();
    // the same load moving from model to movement keeps the bar
    act(() => appStore.getState().setLoadProgress(p({ loadId: 3, step: 'movement' })));
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('a load shorter than the delay never shows the bar', () => {
    render(<LoadProgressBar />);
    act(() => appStore.getState().setLoadProgress(p({})));
    act(() => vi.advanceTimersByTime(SHOW_AFTER_MS - 50));
    act(() => appStore.getState().setLoadProgress(null));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('loadingText', () => {
  it('says what the load is doing', () => {
    expect(loadingText(p({}))).toBe('Preparing the block model…');
    expect(loadingText(p({ loaded: 1 }))).toBe('Downloading the block model…');
    expect(loadingText(p({ step: 'movement' }))).toBe('Computing the movement…');
    expect(loadingText(p({ step: 'movement', loaded: 1 }))).toBe('Downloading the movement…');
    expect(loadingText(null)).toBe('Computing movement…');
  });
});
