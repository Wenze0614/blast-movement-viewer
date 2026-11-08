// @vitest-environment happy-dom
/**
 * P2 inspector card (U6): block facts, in-situ → final position, displacement and destinations
 * per scenario that agree with the outcome classes; closes with × and Esc; hidden without a
 * selection.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalDataSource } from '@/data';
import { computeDerived } from '@/state/derive';
import { appStore, initialAppState } from '@/state/store';
import { Outcome, outcomeClasses } from '@/state/views';
import Inspector, { InspectorView } from '../Inspector';

const data = new LocalDataSource();
const model = await data.getModel('b1040-017');
const movement = await data.getMovement('b1040-017', (await data.getBlast('b1040-017')).defaultParams);
const { polygons } = computeDerived(model, movement);

const post = outcomeClasses(model, movement, polygons, 'post_original');
const lostId = post.indexOf(Outcome.OreLost);
const dilutionId = post.indexOf(Outcome.Dilution);

const scenarioText = (key: string) => document.querySelector(`[data-scenario="${key}"] > span:last-child`)!.textContent;

afterEach(cleanup);

describe('InspectorView', () => {
  it('shows the block facts and its in-situ and final positions', () => {
    const id = lostId;
    render(<InspectorView model={model} movement={movement} polygons={polygons} id={id} onClose={() => {}} />);
    const card = screen.getByRole('region', { name: `Block ${id} inspector` });
    const text = card.textContent!;
    expect(text).toContain(`Block ${id}`);
    expect(text).toContain(`${model.grade[id].toFixed(2)} g/t Au`);
    expect(text).toContain(`${model.tonnes[id].toFixed(1)} t`);
    expect(text).toContain(Array.from(model.centroid.subarray(3 * id, 3 * id + 3), (c) => c.toFixed(2)).join(', '));
    expect(text).toContain(Array.from(movement.end.subarray(3 * id, 3 * id + 3), (c) => c.toFixed(2)).join(', '));
    expect(text).toContain(`${movement.distance[id].toFixed(2)} m`);
    // Coordinates are not thousands-grouped (RL 1038.75, not 1,038.75).
    expect(text).not.toMatch(/1,0\d\d\.\d\d/);
  });

  it('destinations agree with the outcome classes (ore lost and dilution blocks)', () => {
    expect(lostId).toBeGreaterThanOrEqual(0);
    expect(dilutionId).toBeGreaterThanOrEqual(0);
    render(<InspectorView model={model} movement={movement} polygons={polygons} id={lostId} onClose={() => {}} />);
    expect(scenarioText('post_original')).toBe('Waste · ore lost');
    cleanup();
    render(<InspectorView model={model} movement={movement} polygons={polygons} id={dilutionId} onClose={() => {}} />);
    expect(scenarioText('post_original')).toBe('Mill · dilution');
  });

  it('before a movement exists it says so instead of showing destinations', () => {
    render(<InspectorView model={model} movement={null} polygons={null} id={0} onClose={() => {}} />);
    expect(document.body.textContent).toContain('Movement not computed yet.');
    expect(document.querySelector('[data-scenario]')).toBeNull();
  });

  it('× calls onClose', () => {
    const onClose = vi.fn();
    render(<InspectorView model={model} movement={movement} polygons={polygons} id={0} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Inspector (store-bound)', () => {
  beforeEach(() => {
    appStore.setState({ ...initialAppState(), model, movement, polygons });
  });

  it('renders nothing without a selection, and the card once a block is selected', () => {
    render(<Inspector />);
    expect(screen.queryByRole('region')).toBeNull();
    act(() => appStore.getState().select(42));
    expect(screen.getByRole('region', { name: 'Block 42 inspector' })).toBeTruthy();
  });

  it('× and Esc clear the selection', () => {
    render(<Inspector />);
    act(() => appStore.getState().select(42));
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(appStore.getState().selection).toBeNull();
    act(() => appStore.getState().select(43));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(appStore.getState().selection).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('Esc while a modal dialog is open leaves the selection alone', () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    try {
      render(<Inspector />);
      act(() => appStore.getState().select(42));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(appStore.getState().selection).toBe(42);
    } finally {
      dialog.remove();
    }
  });
});
