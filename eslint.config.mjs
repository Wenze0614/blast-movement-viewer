import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Layer boundaries (CLAUDE.md, docs/03 convention 2).
 *
 *   core   → pure TS: no three / react / next / DOM, no other app layer
 *   engine → may import three; never react / next / ui / viewer / server
 *   ui     → may import react; never three / engine / server
 *   state, data → the bridges; no three, no react (except state/hooks.ts), no engine / ui
 *
 * The store (src/state) and DataSource (src/data) are the only bridges between React and the engine.
 * Each file glob gets ONE no-restricted-imports entry, because a later matching entry replaces
 * the rule options of an earlier one.
 */

// Matches both alias (`@/engine/x`) and relative (`../engine/x`) imports of a layer.
const layer = (name) => [`@/${name}`, `@/${name}/**`, `**/${name}`, `**/${name}/**`];

const THREE = { group: ['three', 'three/**'], message: 'three.js belongs in src/engine (and src/viewer) only.' };
const REACT = {
  group: ['react', 'react/**', 'react-dom', 'react-dom/**'],
  message: 'React belongs in src/ui, src/viewer, src/state/hooks.ts and app/ only.',
};
const NEXT = { group: ['next', 'next/**'], message: 'Next.js belongs in app/ only.' };
const ENGINE = { group: layer('engine'), message: 'Only src/viewer may import the engine.' };
const UI = { group: layer('ui'), message: 'Only app/ and src/viewer may import UI components.' };
const VIEWER = { group: layer('viewer'), message: 'Only app/ may import the viewer.' };
const SERVER = { group: layer('server'), message: 'src/server is for route handlers (app/api) only.' };
const APP_LAYERS = {
  group: [...layer('state'), ...layer('data')],
  message: 'core must not depend on app layers.',
};
const SHADER_FILES = {
  group: ['**/*.glsl', '**/*.vert', '**/*.frag'],
  message: 'Shaders are `.glsl.ts` modules exporting a template string (no loaders).',
};

const restrict = (...patterns) => ['error', { patterns: [...patterns, SHADER_FILES] }];

const DOM_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame', 'HTMLElement'];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts']),

  // Everywhere: no raw shader files.
  { files: ['**/*.{ts,tsx,mts}'], rules: { 'no-restricted-imports': restrict() } },

  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(THREE, REACT, NEXT, ENGINE, UI, VIEWER, SERVER, APP_LAYERS),
      'no-restricted-globals': [
        'error',
        ...DOM_GLOBALS.map((name) => ({ name, message: 'core runs on the server and in Workers: no DOM.' })),
      ],
    },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(REACT, NEXT, UI, VIEWER, SERVER) },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict(THREE, NEXT, ENGINE, VIEWER, SERVER) },
  },
  {
    files: ['src/state/**/*.ts', 'src/data/**/*.ts'],
    ignores: ['src/state/hooks.ts'],
    rules: { 'no-restricted-imports': restrict(THREE, REACT, NEXT, ENGINE, UI, VIEWER, SERVER) },
  },
  {
    files: ['src/state/hooks.ts'],
    rules: { 'no-restricted-imports': restrict(THREE, NEXT, ENGINE, UI, VIEWER, SERVER) },
  },
  {
    files: ['src/server/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(THREE, REACT, ENGINE, UI, VIEWER) },
  },
]);

export default eslintConfig;
