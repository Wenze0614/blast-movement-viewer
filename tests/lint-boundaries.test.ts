/**
 * Regression test for the layer boundaries in eslint.config.mjs.
 *
 * Lints in-memory snippets as if they lived in each layer (`ESLint#lintText` with a virtual
 * `filePath`) and checks only the boundary rules. Path-zone cases must import files that EXIST,
 * because import/no-restricted-paths skips imports it can't resolve.
 */
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BOUNDARY_RULES = new Set(['no-restricted-imports', 'import/no-restricted-paths', 'no-restricted-globals']);

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

async function boundaryErrors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter((m) => m.ruleId !== null && BOUNDARY_RULES.has(m.ruleId))
    .map((m) => `${m.ruleId}: ${m.message}`);
}

const importOf = (spec: string) => `import * as m from '${spec}';\nexport default m;\n`;

interface Case {
  file: string;
  blocked: string[];
  allowed: string[];
}

const CASES: Record<string, Case> = {
  core: {
    file: 'src/core/__probe__.ts',
    blocked: [
      'three',
      'three/addons/controls/OrbitControls.js',
      'react',
      'react-dom/client',
      'next/server',
      'zustand',
      'zustand/vanilla',
      '@react-three/fiber',
      '@react-three/drei',
      'zod', // not on the core allowlist
      'node:fs',
      '@/state/store',
      '../state/store',
      '@/engine/disposeBag',
      '../engine/disposeBag',
      '@/data',
      '../../app/page',
      '../../package.json',
      './blocks.glsl',
    ],
    allowed: ['./types', '@/core/types', './defaults', 'd3-contour', 'simplex-noise'],
  },
  coreTest: {
    file: 'src/core/__tests__/__probe__.test.ts',
    blocked: ['../../state/store', '@/engine/disposeBag', 'three'],
    allowed: ['vitest', '../types', '@/core/defaults'],
  },
  engine: {
    file: 'src/engine/__probe__.ts',
    blocked: [
      'react',
      'react-dom/client',
      '@react-three/fiber',
      'next/dynamic',
      '@/viewer/Viewer',
      '../viewer/Viewer',
      '../../app/page',
    ],
    allowed: ['three', 'three/addons/controls/OrbitControls.js', './disposeBag', '@/state/store', '@/data', '@/core/types'],
  },
  ui: {
    file: 'src/ui/__probe__.tsx',
    blocked: [
      'three',
      'three/addons/controls/OrbitControls.js',
      '@react-three/fiber',
      'next/link',
      '@/engine/disposeBag',
      '../engine/disposeBag',
      '@/viewer/Viewer',
      '../../app/page',
    ],
    allowed: ['react', 'react-dom', '@/state/hooks', '@/core/types'],
  },
  state: {
    file: 'src/state/__probe__.ts',
    blocked: ['react', 'three', '@react-three/fiber', '@/engine/disposeBag', '../engine/types', '../../app/page'],
    allowed: ['zustand/vanilla', '@/core/types', '@/data'],
  },
  stateHooks: {
    file: 'src/state/hooks.ts',
    blocked: ['three', '@/engine/disposeBag'],
    allowed: ['react', 'zustand', './store'],
  },
  data: {
    file: 'src/data/__probe__.ts',
    blocked: ['three', 'react', '@/engine/types', '@/viewer/Viewer'],
    allowed: ['@/core/types', '@/core/api-types'],
  },
};

describe('layer boundaries (eslint.config.mjs)', () => {
  for (const [layer, { file, blocked, allowed }] of Object.entries(CASES)) {
    describe(layer, () => {
      it.each(blocked)(`blocks %s in ${file}`, async (spec) => {
        expect(await boundaryErrors(file, importOf(spec))).not.toEqual([]);
      });
      it.each(allowed)(`allows %s in ${file}`, async (spec) => {
        expect(await boundaryErrors(file, importOf(spec))).toEqual([]);
      });
    });
  }

  it('blocks DOM globals in core', async () => {
    expect(await boundaryErrors('src/core/__probe__.ts', 'export const w = window.innerWidth;\n')).not.toEqual([]);
  });

  it('allows DOM globals in engine', async () => {
    expect(await boundaryErrors('src/engine/__probe__.ts', 'export const w = window.innerWidth;\n')).toEqual([]);
  });
});
