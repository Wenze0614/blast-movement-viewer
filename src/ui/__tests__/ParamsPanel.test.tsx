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
import ParamsPanel, { changedKeys, MAIN_SLIDERS, MORE_SLIDERS, TIMING_SLIDERS } from '../ParamsPanel';
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
  it('lists the four demo blasts and writes store.blastId', () => {
    appStore.setState({ blasts });
    render(<BlastPicker />);
    const select = screen.getByRole('combobox', { name: /Blast/ }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['b1040-017', 'b1030-022', 'b1040-031', 'b1050-001']);
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
    for (const spec of [...TIMING_SLIDERS, ...MAIN_SLIDERS, ...MORE_SLIDERS]) {
      const el = document.getElementById(`param-${spec.key}`) as HTMLInputElement;
      expect(Number(el.min), spec.key).toBe(PARAM_RANGES[spec.key].min);
      expect(Number(el.max), spec.key).toBe(PARAM_RANGES[spec.key].max);
    }
    expect(MAIN_SLIDERS.map((s) => s.key)).toEqual(expect.arrayContaining(['maxThrow', 'swellFactor', 'randomness']));
  });

  const update = () => screen.queryByRole('button', { name: 'Update' }) as HTMLButtonElement | null;

  it('edits are staged: nothing reaches the store until Update, then ONE write with every change', () => {
    vi.useFakeTimers();
    const writes = vi.fn();
    const unsub = appStore.subscribe((s) => s.params, writes);
    render(<ParamsPanel />);
    expect(update()).toBeNull(); // no bar before any change
    const slider = screen.getByLabelText('Max throw') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '12' } });
    fireEvent.change(slider, { target: { value: '14.5' } });
    fireEvent.change(screen.getByLabelText('Swell factor'), { target: { value: '1.4' } });
    expect(slider.value).toBe('14.5'); // the draft shows immediately
    act(() => vi.advanceTimersByTime(10_000));
    expect(writes).not.toHaveBeenCalled(); // no timer sends it
    expect(screen.getByText(/unapplied change/).textContent).toBe('2 unapplied changes');
    expect(document.querySelectorAll('[data-changed]').length).toBe(2);
    fireEvent.click(update()!);
    expect(writes).toHaveBeenCalledOnce();
    expect(appStore.getState().params).toMatchObject({ maxThrow: 14.5, swellFactor: 1.4 });
    expect(update()).toBeNull(); // applied: the bar goes away
    expect(document.querySelectorAll('[data-changed]').length).toBe(0);
    unsub();
  });

  it('a value moved back to the applied one is not a change', () => {
    render(<ParamsPanel />);
    const slider = screen.getByLabelText('Max throw') as HTMLInputElement;
    const applied = slider.value;
    fireEvent.change(slider, { target: { value: '12' } });
    expect(update()).not.toBeNull();
    fireEvent.change(slider, { target: { value: applied } });
    expect(update()).toBeNull();
  });

  it('Discard drops the draft and shows the applied values again', () => {
    const writes = vi.fn();
    const unsub = appStore.subscribe((s) => s.params, writes);
    render(<ParamsPanel />);
    const slider = screen.getByLabelText('Max throw') as HTMLInputElement;
    const applied = slider.value;
    fireEvent.change(slider, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(slider.value).toBe(applied);
    expect(update()).toBeNull();
    expect(writes).not.toHaveBeenCalled();
    unsub();
  });

  it('firing sequence: the initiation select and the delay sliders write the timing params on Update', () => {
    render(<ParamsPanel />);
    const select = screen.getByRole('combobox', { name: /Initiation/ }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['row', 'v', 'echelon-left', 'echelon-right']);
    expect(select.value).toBe(appStore.getState().params.initiation);
    fireEvent.change(select, { target: { value: 'echelon-left' } });
    fireEvent.change(screen.getByLabelText('Hole delay'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('Row delay'), { target: { value: '30' } });
    fireEvent.click(update()!);
    expect(appStore.getState().params).toMatchObject({ initiation: 'echelon-left', holeDelayMs: 60, rowDelayMs: 30 });
  });

  it('seed input stages an integer ≥ 0; Enter in the field applies it', () => {
    render(<ParamsPanel />);
    const seed = screen.getByRole('spinbutton', { name: /Seed/ });
    fireEvent.change(seed, { target: { value: '7.8' } });
    expect(appStore.getState().params.seed).toBe(detail.defaultParams.seed);
    fireEvent.submit(seed.closest('form')!);
    expect(appStore.getState().params.seed).toBe(7);
  });

  it('Reset to defaults stages the defaults (replacing a pending edit); Update applies them', () => {
    act(() => appStore.getState().setParams({ maxThrow: 20 }));
    render(<ParamsPanel />);
    const reset = screen.getByRole('button', { name: 'Reset to defaults' }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Randomness'), { target: { value: '0.9' } });
    fireEvent.click(reset);
    expect(reset.disabled).toBe(true); // the panel shows the defaults…
    expect(appStore.getState().params.maxThrow).toBe(20); // …but nothing is applied yet
    expect(screen.getByText(/unapplied change/).textContent).toBe('1 unapplied change'); // only maxThrow differs
    fireEvent.click(update()!);
    expect(appStore.getState().params).toEqual(detail.defaultParams);
    expect(update()).toBeNull();
  });

  it('unmounting with a pending edit drops it (blast switch remounts the panel)', () => {
    const { unmount } = render(<ParamsPanel />);
    fireEvent.change(screen.getByLabelText('Max throw'), { target: { value: '3' } });
    unmount();
    expect(appStore.getState().params.maxThrow).toBe(detail.defaultParams.maxThrow);
  });

  it('changedKeys: only defined draft values that differ from the applied params', () => {
    const p = detail.defaultParams;
    expect(changedKeys(null, p)).toEqual([]);
    expect(changedKeys({ ...p }, p)).toEqual([]);
    expect(changedKeys({ maxThrow: p.maxThrow + 1, seed: p.seed, swellFactor: undefined }, p)).toEqual(['maxThrow']);
  });
});
