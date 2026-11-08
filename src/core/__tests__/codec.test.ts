/**
 * BMV1 binary codec (docs/02-plan.md ADR-11).
 */
import { describe, expect, it } from 'vitest';
import { BLAST_CONFIGS } from '../blasts';
import { generateBlockModel } from '../blockModel';
import {
  BMV1_SCHEMA_VERSION,
  CodecError,
  decodeModel,
  decodeMovement,
  encodeModel,
  encodeMovement,
  readHeader,
  type CodecErrorCode,
} from '../codec';
import { computeMovement } from '../movement';
import type { BlockModel } from '../types';

const fixtures = BLAST_CONFIGS.map((cfg) => {
  const model = generateBlockModel(cfg);
  return { id: cfg.id, cfg, model, movement: computeMovement(model, cfg.defaultParams) };
});
const small = fixtures[0];

/** Byte equality of two typed arrays (stricter than toEqual: NaN payloads, -0). */
function bytesEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

function expectModelEqual(got: BlockModel, want: BlockModel) {
  for (const k of ['centroid', 'grade', 'density', 'tonnes', 'rockType', 'oreClass'] as const) {
    expect(bytesEqual(got[k], want[k]), k).toBe(true);
  }
  expect(got.grid).toEqual(want.grid);
  expect(got.grades).toEqual(want.grades);
  expect(got.count).toBe(want.count);
  expect(got.seed).toBe(want.seed);
  expect(got.configHash).toBe(want.configHash);
}

function expectThrowsCode(fn: () => unknown, code: CodecErrorCode) {
  let caught: unknown = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(CodecError);
  expect((caught as CodecError).code).toBe(code);
}

describe('BMV1 codec: round-trip (all three demo blasts)', () => {
  it.each(fixtures)('$id model: decode(encode(model)) equals the model field by field', ({ model }) => {
    expectModelEqual(decodeModel(encodeModel(model)), model);
  });

  it.each(fixtures)('$id movement: every field survives; displacement/distance derived on decode', ({ model, movement }) => {
    const got = decodeMovement(encodeMovement(movement, model.configHash), model);
    for (const k of ['start', 'end', 'displacement', 'distance', 'delay'] as const) {
      expect(bytesEqual(got[k], movement[k]), k).toBe(true);
    }
    expect(bytesEqual(got.surface.height, movement.surface.height)).toBe(true);
    const spec = (s: MovementLike['surface']) => ({ origin: s.origin, cellSize: s.cellSize, nx: s.nx, ny: s.ny });
    expect(spec(got.surface)).toEqual(spec(movement.surface));
    expect(got.params).toEqual(movement.params);
    expect(got.paramsHash).toBe(movement.paramsHash);
    expect(got.looseScale).toBe(movement.looseScale);
    expect(got.postGrid).toEqual(movement.postGrid);
  });

  it('a decoded model feeds computeMovement: identical paramsHash and end array (all blasts)', () => {
    for (const { cfg, model, movement } of fixtures) {
      const again = computeMovement(decodeModel(encodeModel(model)), cfg.defaultParams);
      expect(again.paramsHash).toBe(movement.paramsHash);
      expect(bytesEqual(again.end, movement.end)).toBe(true);
    }
  });

  it('model payload size matches the ADR-11 estimate (26 B/block + a small header)', () => {
    for (const { model } of fixtures) {
      const bytes = encodeModel(model).byteLength;
      expect(bytes).toBeGreaterThanOrEqual(26 * model.count);
      expect(bytes).toBeLessThan(26 * model.count + 2048);
    }
  });
});

type MovementLike = (typeof fixtures)[number]['movement'];

describe('BMV1 codec: layout', () => {
  it('starts with magic "BMV1" and a uint32 little-endian header length (4-aligned)', () => {
    const buf = encodeModel(small.model);
    expect(String.fromCharCode(...buf.subarray(0, 4))).toBe('BMV1');
    const h = new DataView(buf.buffer).getUint32(4, true);
    expect(h % 4).toBe(0);
    const header = readHeader(buf);
    expect(header.schemaVersion).toBe(BMV1_SCHEMA_VERSION);
    expect(header.kind).toBe('model');
    expect(header.count).toBe(small.model.count);
    expect(header.fields[0].offset).toBe(8 + h);
  });

  it('aligns every section to 4 bytes; Float32 sections precede Uint8 sections; no overlap', () => {
    for (const buf of [encodeModel(small.model), encodeMovement(small.movement, small.model.configHash)]) {
      const { fields } = readHeader(buf);
      let seenU8 = false;
      let prevEnd = 0;
      for (const f of fields) {
        expect(f.offset % 4, f.name).toBe(0);
        expect(f.offset).toBeGreaterThanOrEqual(prevEnd);
        prevEnd = f.offset + f.length * (f.type === 'f32' ? 4 : 1);
        if (f.type === 'u8') seenU8 = true;
        else expect(seenU8, `${f.name} after a Uint8 section`).toBe(false);
      }
      expect(buf.byteLength % 4).toBe(0);
      expect(buf.byteLength - prevEnd).toBeLessThan(4);
    }
  });

  it('model header carries configHash + seed; movement header carries params, hash, looseScale, grids', () => {
    const m = readHeader(encodeModel(small.model));
    expect(m).toMatchObject({ kind: 'model', configHash: small.model.configHash, seed: small.model.seed });
    const v = readHeader(encodeMovement(small.movement, small.model.configHash));
    expect(v).toMatchObject({
      kind: 'movement',
      paramsHash: small.movement.paramsHash,
      looseScale: small.movement.looseScale,
      modelConfigHash: small.model.configHash,
      params: small.movement.params,
      postGrid: small.movement.postGrid,
    });
    expect(v.fields.map((f) => f.name)).toEqual(['end', 'delay', 'surface.height']);
  });

  it('decode returns typed-array views on the input buffer (no copy)', () => {
    const buf = encodeModel(small.model);
    const model = decodeModel(buf.buffer);
    for (const k of ['centroid', 'grade', 'density', 'tonnes', 'rockType', 'oreClass'] as const) {
      expect(model[k].buffer).toBe(buf.buffer);
    }
    const mv = encodeMovement(small.movement, small.model.configHash);
    const movement = decodeMovement(mv, model);
    expect(movement.end.buffer).toBe(mv.buffer);
    expect(movement.delay.buffer).toBe(mv.buffer);
    expect(movement.surface.height.buffer).toBe(mv.buffer);
    expect(movement.start).toBe(model.centroid);
  });

  it('decodes a Uint8Array view at a non-zero offset in a larger buffer (aligned: view; misaligned: one copy)', () => {
    const buf = encodeModel(small.model);
    for (const pad of [4, 3]) {
      const big = new Uint8Array(buf.byteLength + pad);
      big.set(buf, pad);
      const decoded = decodeModel(big.subarray(pad));
      expectModelEqual(decoded, small.model);
      if (pad === 4) expect(decoded.grade.buffer).toBe(big.buffer);
    }
  });
});

describe('BMV1 codec: typed errors', () => {
  const model = encodeModel(small.model);

  it('wrong magic → BAD_MAGIC', () => {
    const bad = model.slice();
    bad[0] = 0x58;
    expectThrowsCode(() => decodeModel(bad), 'BAD_MAGIC');
  });

  it('truncated buffer → TRUNCATED (inside the preamble, the header and the last section)', () => {
    expectThrowsCode(() => decodeModel(model.slice(0, 5)), 'TRUNCATED');
    expectThrowsCode(() => decodeModel(model.slice(0, 20)), 'TRUNCATED');
    expectThrowsCode(() => decodeModel(model.slice(0, model.byteLength - 8)), 'TRUNCATED');
  });

  it('unknown schemaVersion → UNSUPPORTED_VERSION', () => {
    const bad = model.slice();
    const h = new DataView(bad.buffer).getUint32(4, true);
    const text = new TextDecoder().decode(bad.subarray(8, 8 + h));
    expect(text).toContain('"schemaVersion":1,');
    bad.set(new TextEncoder().encode(text.replace('"schemaVersion":1,', '"schemaVersion":9,')), 8);
    expectThrowsCode(() => decodeModel(bad), 'UNSUPPORTED_VERSION');
  });

  it('garbage header → BAD_HEADER; a model payload decoded as movement → WRONG_KIND', () => {
    const bad = model.slice();
    bad[8] = 0x7b; // '{{'
    bad[9] = 0x7b;
    expectThrowsCode(() => decodeModel(bad), 'BAD_HEADER');
    expectThrowsCode(() => decodeMovement(model, small.model), 'WRONG_KIND');
  });

  /** The payload with its header JSON edited in place (still valid JSON, same header length). */
  function withHeader(buf: Uint8Array, edit: (h: Record<string, unknown>) => void): Uint8Array {
    const hLen = new DataView(buf.buffer, buf.byteOffset).getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + hLen))) as Record<string, unknown>;
    edit(header);
    const json = new TextEncoder().encode(JSON.stringify(header));
    if (json.length > hLen) throw new Error('edited header grew past its padding');
    const out = buf.slice();
    out.fill(0x20, 8, 8 + hLen);
    out.set(json, 8);
    return out;
  }

  type Edit = (h: Record<string, unknown>) => void;
  const sub = (h: Record<string, unknown>, k: string) => h[k] as Record<string, unknown>;
  const malformed: [string, 'model' | 'movement', Edit][] = [
    ['model grid missing', 'model', (h) => delete h.grid],
    ['model grid.origin not a Vec3', 'model', (h) => (sub(h, 'grid').origin = [0, 0])],
    ['model grid dims disagree with count', 'model', (h) => (sub(h, 'grid').nz = 1)],
    ['model grades null', 'model', (h) => (h.grades = null)],
    ['model configHash empty', 'model', (h) => (h.configHash = '')],
    ['movement surface missing', 'movement', (h) => delete h.surface],
    ['movement postGrid a string', 'movement', (h) => (h.postGrid = 'x')],
    ['movement surface.nx negative', 'movement', (h) => (sub(h, 'surface').nx = -1)],
    ['movement params missing', 'movement', (h) => delete h.params],
    ['movement looseScale a string', 'movement', (h) => (h.looseScale = '1')],
  ];

  it.each(malformed)('malformed but valid-JSON header (%s) → BAD_HEADER, not a TypeError', (_name, kind, edit) => {
    const buf = kind === 'model' ? encodeModel(small.model) : encodeMovement(small.movement, small.model.configHash);
    const broken = withHeader(buf, edit);
    expectThrowsCode(() => (kind === 'model' ? decodeModel(broken) : decodeMovement(broken, small.model)), 'BAD_HEADER');
  });

  it('a movement decoded against a different model → MODEL_MISMATCH', () => {
    const payload = encodeMovement(small.movement, small.model.configHash);
    expectThrowsCode(() => decodeMovement(payload, fixtures[1].model), 'MODEL_MISMATCH');
  });

  it('encodeModel refuses a model without configHash (computeMovement would throw on it)', () => {
    expect(() => encodeModel({ ...small.model, configHash: '' })).toThrow(/configHash/);
  });
});
