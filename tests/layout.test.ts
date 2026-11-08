// @vitest-environment happy-dom
/**
 * Page shell (app/page.tsx). The side panel scrolls on its own; absolutely positioned content
 * inside it (Tailwind `sr-only` captions and inputs, hidden tooltips) must use the panel as its
 * containing block, or the panel's overflow cannot clip it and it stretches the whole page:
 * an empty strip below the footer at desktop width (user report, 2026-11-09).
 */
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/Panel', () => ({ default: () => createElement('span', { className: 'sr-only' }, 'panel') }));
vi.mock('../app/viewer-loader', () => ({ default: () => null }));
import Home from '../app/page';

describe('page shell', () => {
  it('the scrolling side panel is a containing block (position: relative), so its absolute content cannot stretch the page', () => {
    const { container } = render(createElement(Home));
    const aside = container.querySelector('aside')!;
    expect(aside.className.split(/\s+/)).toContain('relative');
    expect(aside.className).toMatch(/overflow-y-auto/);
  });
});
