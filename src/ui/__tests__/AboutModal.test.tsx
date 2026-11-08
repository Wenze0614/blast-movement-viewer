// @vitest-environment happy-dom
/**
 * P7 About modal (opens from the panel header, Esc closes, focus returns, framing + disclaimers)
 * and the P9 holes layer toggle.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appStore, initialAppState } from '@/state/store';
import AboutButton, { FRAMING } from '../AboutModal';
import LayerToggles, { HOLES_NOTE } from '../LayerToggles';
import Panel from '../Panel';

beforeEach(() => appStore.setState(initialAppState()));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const dialog = () => document.querySelector('dialog')!;

describe('AboutModal (P7)', () => {
  it('opens from the panel header button', () => {
    render(<Panel />);
    const header = screen.getByRole('banner');
    const button = header.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement;
    expect(button.textContent).toBe('About');
    expect(dialog().open).toBe(false);
    fireEvent.click(button);
    expect(dialog().open).toBe(true);
  });

  it('shows the framing sentence verbatim and the "what this is not" disclaimers', () => {
    render(<AboutButton />);
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    const text = dialog().textContent!;
    expect(FRAMING).toBe(
      "This is the front end and API I'd build around a blast-movement engine. The movement model is a deliberately simple stand-in for the engine's output; the showcase is the visualisation, the interaction and the data plumbing.",
    );
    expect(text).toContain(FRAMING);
    expect(text).toMatch(/What this is not/);
    expect(text).toMatch(/Not physics/);
    expect(text).toMatch(/heuristic/);
    expect(text).toMatch(/Synthetic data/);
    expect(text).toMatch(/grade-threshold contour.*not an optimised dig limit/);
    expect(text).toMatch(/derived from the block model.*samples feed the grade-control model/);
    expect(text).toMatch(/Dilution is defined differently from site to site/);
    expect(text).toContain('Wenze Zhang');
    const hrefs = Array.from(dialog().querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://github.com/Wenze0614/blast-movement-viewer');
    expect(text).not.toMatch(/augment/i);
  });

  it('is labelled by its heading and moves focus inside when opened', () => {
    render(<AboutButton />);
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    const d = dialog();
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toMatch(/About Blast Movement Viewer/);
    expect(d.contains(document.activeElement)).toBe(true); // Close button (autoFocus)
  });

  /** Records whether the dialog was still open each time the opener was focused. */
  function trackFocus(opener: HTMLElement) {
    const dialogOpenAtFocus: boolean[] = [];
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(opener, 'focus').mockImplementation(function (this: HTMLElement, ...args) {
      dialogOpenAtFocus.push(dialog().open);
      focus.apply(this, args);
    });
    return dialogOpenAtFocus;
  }

  it('Esc closes and focus returns to the About button after the dialog has closed', async () => {
    render(<AboutButton />);
    const opener = screen.getByRole('button', { name: 'About' });
    opener.focus();
    fireEvent.click(opener);
    expect(dialog().open).toBe(true);
    const focusCalls = trackFocus(opener);
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(dialog().open).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(focusCalls).toEqual([false]); // focused once, from the `close` event, never while modal
  });

  it('the Close button closes and returns focus too (after closing); it can be reopened', async () => {
    render(<AboutButton />);
    const opener = screen.getByRole('button', { name: 'About' });
    fireEvent.click(opener);
    const focusCalls = trackFocus(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialog().open).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(focusCalls).toEqual([false]);
    fireEvent.click(opener);
    expect(dialog().open).toBe(true);
  });

  it('the dialog `close` event on its own triggers the focus restore', async () => {
    render(<AboutButton />);
    const opener = screen.getByRole('button', { name: 'About' });
    fireEvent.click(opener);
    const focusCalls = trackFocus(opener);
    fireEvent(dialog(), new Event('close')); // e.g. a browser closing the dialog itself
    expect(focusCalls).toHaveLength(1); // the handler ran (the element itself was not closed here)
  });
});

describe('LayerToggles: blastholes (P9)', () => {
  it('toggles store.layers.holes and shows the "illustrative pattern" label', () => {
    render(<LayerToggles />);
    const box = screen.getByRole('checkbox', { name: /Blastholes/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(screen.getByText(HOLES_NOTE)).toBeTruthy();
    expect(HOLES_NOTE).toBe('illustrative pattern; its firing sequence sets the throw direction');
    expect(box.getAttribute('aria-describedby')).toBe('holes-note');
    fireEvent.click(box);
    expect(appStore.getState().layers.holes).toBe(false);
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(appStore.getState().layers.holes).toBe(true);
  });

  it('colours the holes by firing time (default, with the firing range) or by sampled grade', () => {
    render(<LayerToggles />);
    const timing = screen.getByRole('button', { name: 'Firing time' });
    const grade = screen.getByRole('button', { name: 'Grade' });
    expect(appStore.getState().holeColour).toBe('timing');
    expect(timing.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/fired 0–/)).toBeTruthy();
    fireEvent.click(grade);
    expect(appStore.getState().holeColour).toBe('grade');
    expect(screen.getByText('(by sampled grade)')).toBeTruthy();
    fireEvent.click(timing);
    expect(appStore.getState().holeColour).toBe('timing');
  });

  it('the dig-line toggles are still there', () => {
    render(<LayerToggles />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });
});
