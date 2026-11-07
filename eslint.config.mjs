import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Layer boundaries (CLAUDE.md, docs/03 convention 2). Enforced two ways, because each catches
 * what the other can't:
 *
 * 1. `import/no-restricted-paths` (ZONES) matches the RESOLVED file path, so `@/engine/x`,
 *    `../engine/x` and `../../app/page` are all caught. It also gives core a package
 *    allowlist. It skips imports that don't resolve (TypeScript fails on those anyway).
 * 2. `no-restricted-imports` (PATTERNS) matches the import string, so it catches banned
 *    packages even when they aren't installed (e.g. `@react-three/*`) and gives clearer messages.
 *
 *   core   → pure TS: only src/core + d3-contour + simplex-noise (+ vitest in tests). No DOM.
 *   engine → may import three; never react / next / ui / viewer / server / app
 *   ui     → may import react; never three / next / engine / viewer / server / app
 *   state, data → the bridges; no three, no react (except state/hooks.ts), no engine / ui
 *   R3F (`@react-three/*`) is banned everywhere (ADR-1: plain three.js).
 */

const ROOT = import.meta.dirname;

// ── Zones: resolved-path boundaries ────────────────────────────────────────
/** Packages core may import. Anything else outside src/core is an error. */
const CORE_PACKAGES = ['d3-contour', '@types/d3-contour', 'simplex-noise'];
const coreExcept = (...extraPackages) => [
  './src/core',
  ...[...CORE_PACKAGES, ...extraPackages].map((pkg) => `./node_modules/${pkg}`),
];
const CORE_MESSAGE =
  'src/core is pure TS shared by server, browser and Workers: it may import only src/core, ' +
  `${CORE_PACKAGES.filter((p) => !p.startsWith('@types/')).join(', ')} (allowlist in eslint.config.mjs).`;

const ZONES = [
  {
    target: 'src/core/**/!(*.test).ts',
    from: '.',
    except: coreExcept(),
    message: CORE_MESSAGE,
  },
  {
    target: 'src/core/**/*.test.ts',
    from: '.',
    except: coreExcept('vitest', '@vitest'),
    message: CORE_MESSAGE,
  },
  {
    target: './src/engine',
    from: ['./src/ui', './src/viewer', './src/server', './app'],
    message: 'engine may depend on core, state and data only (never React-side code).',
  },
  {
    target: './src/ui',
    from: ['./src/engine', './src/viewer', './src/server', './app'],
    message: 'ui talks to the engine only through the store (src/state).',
  },
  {
    target: ['./src/state', './src/data'],
    from: ['./src/engine', './src/ui', './src/viewer', './src/server', './app'],
    message: 'state and data are bridges: they depend on core only.',
  },
  {
    target: './src/server',
    from: ['./src/engine', './src/ui', './src/viewer', './src/state', './src/data', './app'],
    message: 'src/server is for route handlers: it depends on core only.',
  },
  {
    target: './src/viewer',
    from: ['./src/server', './app'],
    message: 'viewer must not import server helpers or app/ routes.',
  },
];

// ── Patterns: package bans by name ─────────────────────────────────────────
const THREE = { group: ['three', 'three/**'], message: 'three.js belongs in src/engine (and src/viewer) only.' };
const REACT = {
  group: ['react', 'react/**', 'react-dom', 'react-dom/**'],
  message: 'React belongs in src/ui, src/viewer, src/state/hooks.ts and app/ only.',
};
const NEXT = { group: ['next', 'next/**'], message: 'Next.js belongs in app/ only.' };
const ZUSTAND = { group: ['zustand', 'zustand/**'], message: 'The store lives in src/state; core stays framework-free.' };
const NODE_BUILTINS = { group: ['node:*'], message: 'core also runs in the browser: no Node built-ins.' };
const R3F = {
  group: ['@react-three/*', '@react-three/**'],
  message: 'No React Three Fiber/drei: the renderer is plain three.js (ADR-1).',
};
const SHADER_FILES = {
  group: ['**/*.glsl', '**/*.vert', '**/*.frag'],
  message: 'Shaders are `.glsl.ts` modules exporting a template string (no loaders).',
};

/** Each file glob gets ONE no-restricted-imports entry (a later match replaces the options). */
const restrict = (...patterns) => ['error', { patterns: [...patterns, R3F, SHADER_FILES] }];

const DOM_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame', 'HTMLElement'];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts']),

  {
    files: ['**/*.{ts,tsx,mts}'],
    rules: {
      'no-restricted-imports': restrict(),
      'import/no-restricted-paths': ['error', { basePath: ROOT, zones: ZONES }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(THREE, REACT, NEXT, ZUSTAND, NODE_BUILTINS),
      'no-restricted-globals': [
        'error',
        ...DOM_GLOBALS.map((name) => ({ name, message: 'core runs on the server and in Workers: no DOM.' })),
      ],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(REACT, NEXT) },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict(THREE, NEXT) },
  },
  {
    files: ['src/state/**/*.ts', 'src/data/**/*.ts'],
    ignores: ['src/state/hooks.ts'],
    rules: { 'no-restricted-imports': restrict(THREE, REACT, NEXT) },
  },
  {
    files: ['src/state/hooks.ts'],
    rules: { 'no-restricted-imports': restrict(THREE, NEXT) },
  },
  {
    files: ['src/server/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(THREE, REACT) },
  },
]);

export default eslintConfig;
