// @vitest-environment happy-dom
/**
 * Panel header (blast picker, source badge) and the P5 parameter panel.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalDataSource } from '@/data';
import { PARAM_RANGES } from '@/core/params';
import { appStore, initialAppState } from '@/state/store';
import BlastPicker from '../BlastPicker';
import ParamsPanel, { MAIN_SLIDERS, MORE_SLIDERS, PARAM_DEBOUNCE_MS } from '../ParamsPanel';
import { SourceBadgeView } from '../SourceBadge';

const data = new LocalDataSource();
const blasts = await data.listBlasts();
const detail = await data.getBlast('b1040-017');

beforeEach(() => appStore.setState(initialAppState()));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('BlastPicker', () => {
  it('lists the three demo blasts and writes store.blastId', () => {
    appStore.setState({ blasts });
    render(<BlastPicker />);
    const select = screen.getByRole('combobox', { name: /Blast/ }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['b1040-017', 'b1030-022', 'b1040-031']);
    expect(select.options[2].textContent).toContain('27,088 blocks');
    fireEvent.change(select, { target: { value: 'b1040-031' } });
    expect(appStore.getState().blastId).toBe('b1040-031');
  });

  it('is disabled until the list arrives', () => {
    render(<BlastPicker />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  });
});

describe('SourceBadgeView', () => {
  const text = () => document.querySelector('[data-source]')?.textContent?.replace('●', '').trim();

  it("API: 'API · 42 ms'", () => {
    render(<SourceBadgeView source="api" latencyMs={41.6} fallback={null} />);
    expect(text()).toBe('API · 42 ms');
    expect(document.querySelector('[data-source]')!.getAttribute('data-source')).toBe('api');
  });

  it("API failed → 'Local fallback' with the reason in the tooltip", () => {
    render(<SourceBadgeView source="local" latencyMs={12} fallback="fetch failed" />);
    expect(text()).toBe('Local fallback');
    const el = document.querySelector('[data-source]')!;
    expect(el.getAttribute('data-source')).toBe('fallback');
    expect(el.getAttribute('title')).toContain('fetch failed');
  });

  it("configured local: 'Local · 12 ms'; nothing before the first load", () => {
    const { unmount } = render(<SourceBadgeView source="local" latencyMs={12.2} fallback={null} />);
    expect(text()).toBe('Local · 12 ms');
    unmount();
    render(<SourceBadgeView source={null} latencyMs={null} fallback={null} />);
    expect(document.querySelector('[data-source]')).toBeNull();
  });
});

describe('ParamsPanel (P5)', () => {
  beforeEach(() => {
    act(() => appStore.getState().setBlast(detail));
  });

  it('slider ranges are the ADR-12 ranges the API validates', () => {
    render(<ParamsPanel />);
    for (const spec of [...MAIN_SLIDERS, ...MORE_SLIDERS]) {
      const el = document.getElementById(`param-${spec.key}`) as HTMLInputElement;
      expect(Number(el.min), spec.key).toBe(PARAM_RANGES[spec.key].min);
      expect(Number(el.max), spec.key).toBe(PARAM_RANGES[spec.key].max);
    }
    expect(MAIN_SLIDERS.map((s) => s.key)).toEqual(expect.arrayContaining(['maxThrow', 'swellFactor', 'randomness']));
  });

  it(`debounces edits by ${PARAM_DEBOUNCE_MS} ms into ONE store write (one movement request)`, () => {
    vi.useFakeTimers();
    const writes = vi.fn();
    const unsub = appStore.subscribe((s) => s.params, writes);
    render(<ParamsPanel />);
    const slider = screen.getByLabelText('Max throw') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '12' } });
    act(() => vi.advanceTimersByTime(PARAM_DEBOUNCE_MS - 50));
    fireEvent.change(slider, { target: { value: '14.5' } });
    fireEvent.change(screen.getByLabelText('Swell factor'), { target: { value: '1.4' } });
    expect(slider.value).toBe('14.5'); // the draft shows immediately
    act(() => vi.advanceTimersByTime(PARAM_DEBOUNCE_MS - 1));
    expect(writes).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(writes).toHaveBeenCalledOnce();
    expect(appStore.getState().params).toMatchObject({ maxThrow: 14.5, swellFactor: 1.4 });
    unsub();
  });

  it('seed input writes an integer ≥ 0', () => {
    vi.useFakeTimers();
    render(<ParamsPanel />);
    const seed = screen.getByRole('spinbutton', { name: /Seed/ });
    fireEvent.change(seed, { target: { value: '7.8' } });
    act(() => vi.advanceTimersByTime(PARAM_DEBOUNCE_MS));
    expect(appStore.getState().params.seed).toBe(7);
  });

  it('Reset to defaults: restores the blast defaults and cancels a pending edit', () => {
    vi.useFakeTimers();
    act(() => appStore.getState().setParams({ maxThrow: 20 }));
    render(<ParamsPanel />);
    const reset = screen.getByRole('button', { name: 'Reset to defaults' }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Randomness'), { target: { value: '0.9' } });
    fireEvent.click(reset);
    act(() => vi.advanceTimersByTime(PARAM_DEBOUNCE_MS * 2));
    expect(appStore.getState().params).toEqual(detail.defaultParams);
    expect(reset.disabled).toBe(true);
  });

  it('unmounting with a pending edit drops it (blast switch remounts the panel)', () => {
    vi.useFakeTimers();
    const { unmount } = render(<ParamsPanel />);
    fireEvent.change(screen.getByLabelText('Max throw'), { target: { value: '3' } });
    unmount();
    act(() => vi.advanceTimersByTime(PARAM_DEBOUNCE_MS * 2));
    expect(appStore.getState().params.maxThrow).toBe(detail.defaultParams.maxThrow);
  });
});
