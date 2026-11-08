// @vitest-environment happy-dom
/**
 * Legend per colour mode (M2, P1) and the view controls (P1, P3).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDataSource } from '@/data';
import { computeDerived } from '@/state/derive';
import { appStore, initialAppState } from '@/state/store';
import { classTonnes, sectionRange, sumTonnes } from '@/state/views';
import { legendProps, LegendView, OUTCOME_CAPTION } from '../Legend';
import { mid, sliderBounds } from '../ViewControls';
import ViewControls from '../ViewControls';

const data = new LocalDataSource();
const model = await data.getModel('b1040-017');
const movement = await data.getMovement('b1040-017', (await data.getBlast('b1040-017')).defaultParams);
const derived = computeDerived(model, movement);

const labels = () => Array.from(document.querySelectorAll('[data-legend]')).map((li) => li.getAttribute('data-legend'));
const tonnes = () => Array.from(document.querySelectorAll('[data-tonnes]')).map((el) => el.textContent);

afterEach(cleanup);

describe('LegendView', () => {
  it('grade: three classes with tonnes', () => {
    render(<LegendView mode="grade" tonnes={[1000, 250.4, 49.6]} />);
    expect(screen.getByRole('heading').textContent).toBe('Grade (Au)');
    expect(labels()).toEqual(['waste', 'low', 'high']);
    expect(tonnes()).toEqual(['1,000 t', '250 t', '50 t']);
  });

  it('outcome: four classes with tonnes and a caption naming positions + line', () => {
    render(<LegendView mode="outcome" scenario="post_original" tonnes={[900, 120, 80, 5000]} />);
    expect(screen.getByRole('heading').textContent).toBe('Outcome');
    expect(labels()).toEqual(['oreToMill', 'oreLost', 'dilution', 'wasteToWaste']);
    expect(tonnes()).toEqual(['900 t', '120 t', '80 t', '5,000 t']);
    expect(document.querySelector('[data-caption]')!.textContent).toContain(OUTCOME_CAPTION.post_original);
    expect(document.body.textContent).toContain('Ore lost (ore → waste)');
    expect(document.body.textContent).toContain('Dilution (waste → mill)');
  });

  it('movement: viridis bar with min / max in m', () => {
    render(<LegendView mode="movement" range={[0.84, 13.46]} />);
    expect(screen.getByRole('heading').textContent).toBe('Movement distance');
    expect(document.querySelector('[data-min]')!.textContent).toBe('0.8 m');
    expect(document.querySelector('[data-max]')!.textContent).toBe('13.5 m');
  });

  it('a mode waiting for data says it is showing grade', () => {
    render(<LegendView mode="grade" tonnes={null} fallbackFrom="outcome" />);
    expect(screen.getByRole('heading').textContent).toBe('Outcome');
    expect(labels()).toEqual(['waste', 'low', 'high']);
    expect(document.body.textContent).toContain('showing grade');
  });
});

describe('legendProps (mirrors the colours the engine paints)', () => {
  const base = {
    movement,
    polygons: derived.polygons,
    reconciliation: derived.reconciliation,
    outcomeLine: 'original' as const,
    started: false,
  };
  const gradeT = classTonnes(model.oreClass, model.tonnes, 3);
  const total = sumTonnes(model.tonnes);

  it('outcome follows progress and the line; tonnes come from the matching reconciliation column', () => {
    const before = legendProps({ ...base, colourMode: 'outcome' }, gradeT, total);
    expect(before).toMatchObject({ mode: 'outcome', scenario: 'insitu_original' });
    const after = legendProps({ ...base, colourMode: 'outcome', started: true, outcomeLine: 'adjusted' }, gradeT, total);
    expect(after).toMatchObject({ mode: 'outcome', scenario: 'post_adjusted' });
    if (after.mode !== 'outcome') throw new Error('unreachable');
    const r = derived.reconciliation.post_adjusted;
    expect(after.tonnes![0]).toBeCloseTo(r.oreToMill.tonnes, 6);
    expect(after.tonnes![1]).toBeCloseTo(r.oreToWaste.tonnes, 6);
    expect(after.tonnes![2]).toBeCloseTo(r.wasteToMill.tonnes, 6);
    expect(after.tonnes!.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 1);
  });

  it('outcome without dig lines and movement without a movement fall back to grade', () => {
    expect(legendProps({ ...base, polygons: null, colourMode: 'outcome' }, gradeT, total)).toMatchObject({
      mode: 'grade',
      fallbackFrom: 'outcome',
    });
    expect(legendProps({ ...base, movement: null, colourMode: 'movement' }, gradeT, total)).toMatchObject({
      mode: 'grade',
      fallbackFrom: 'movement',
    });
  });

  it('grade tonnes sum to the model tonnes', () => {
    const p = legendProps({ ...base, colourMode: 'grade' }, gradeT, total);
    if (p.mode !== 'grade') throw new Error('unreachable');
    expect(p.tonnes!.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 1);
  });
});

describe('ViewControls (store-connected)', () => {
  beforeEach(() => {
    appStore.setState(initialAppState());
  });

  it('colour mode radios write store.colourMode; outcome line is enabled only in outcome mode', () => {
    render(<ViewControls />);
    const adjusted = screen.getByRole('radio', { name: 'Adjusted' });
    expect((adjusted as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Outcome' }));
    expect(appStore.getState().colourMode).toBe('outcome');
    expect((adjusted as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(adjusted);
    expect(appStore.getState().outcomeLine).toBe('adjusted');
    fireEvent.click(screen.getByRole('radio', { name: 'Movement' }));
    expect(appStore.getState().colourMode).toBe('movement');
  });

  it('ore only toggles store.oreOnly', () => {
    render(<ViewControls />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Ore only/ }));
    expect(appStore.getState().oreOnly).toBe(true);
  });

  it('section: disabled without a model; first enable centres the plane in the blast range; axis change re-centres', () => {
    render(<ViewControls />);
    const toggle = screen.getByRole('checkbox', { name: 'Section' }) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    act(() => {
      appStore.getState().setModel(model, 'local');
      appStore.getState().setMovement(movement, 'local');
    });
    expect(toggle.disabled).toBe(false);
    // The initial position (0) is inside the y range (the bench edge): it must still be centred.
    const yRange = sliderBounds(sectionRange(model, movement, 'y'));
    const [y0, y1] = yRange;
    expect(appStore.getState().section.position).toBeGreaterThanOrEqual(y0);
    fireEvent.click(toggle);
    const s = appStore.getState().section;
    expect(s.enabled).toBe(true);
    expect(s.position).toBe(mid(yRange));
    expect(s.position).toBeCloseTo((y0 + y1) / 2, 0);

    const slider = screen.getByRole('slider', { name: /Section position/ }) as HTMLInputElement;
    expect(Number(slider.min)).toBe(y0);
    expect(Number(slider.max)).toBe(y1);
    fireEvent.change(slider, { target: { value: '12.5' } });
    expect(appStore.getState().section.position).toBe(12.5);

    fireEvent.click(screen.getByRole('radio', { name: 'Easting (x)' }));
    const xRange = sliderBounds(sectionRange(model, movement, 'x'));
    expect(appStore.getState().section.axis).toBe('x');
    expect(appStore.getState().section.position).toBe(mid(xRange));
  });

  it('section: a position the user chose survives disable → re-enable', () => {
    appStore.setState({ model, movement });
    render(<ViewControls />);
    const toggle = screen.getByRole('checkbox', { name: 'Section' });
    fireEvent.click(toggle); // centred
    const slider = screen.getByRole('slider', { name: /Section position/ });
    fireEvent.change(slider, { target: { value: '12.5' } });
    fireEvent.click(toggle); // off
    expect(appStore.getState().section.enabled).toBe(false);
    fireEvent.click(toggle); // on again: keeps 12.5
    expect(appStore.getState().section).toMatchObject({ enabled: true, position: 12.5 });
  });

  it('a position outside a new blast’s range is clamped back into it', () => {
    appStore.setState({ model, movement, section: { enabled: true, axis: 'y', position: 500 } });
    render(<ViewControls />);
    const [, y1] = sliderBounds(sectionRange(model, movement, 'y'));
    expect(appStore.getState().section.position).toBe(y1);
  });
});
