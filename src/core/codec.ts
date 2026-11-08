/**
 * BMV1 binary codec (docs/02-plan.md ADR-11): one length-prefixed, columnar layout shared by the
 * server (encode) and the client (decode). Pure TS: runs on Node, in the browser and on Workers.
 *
 * ```
 * offset 0   "BMV1"                      4 bytes magic
 * offset 4   header byte length H        uint32 little-endian, H % 4 === 0
 * offset 8   header JSON (UTF-8)         padded with spaces to H bytes
 * offset 8+H sections                    each 4-byte aligned; Float32, then Uint32, then Uint8
 * ```
 *
 * The header lists every section as `{ name, type, offset, length }` with `offset` in bytes from
 * the START OF THE PAYLOAD and `length` in elements. Decode returns typed-array VIEWS on the input
 * buffer (no copies), so a decoded model goes straight to GPU attributes.
 *
 * Schema v3 is compact: a field that can be DERIVED is sent only if deriving it does not
 * reproduce it bit for bit (the encoder checks), so a round trip is always exact.
 *
 * - model:    grade (f32 N), cell (u32 N, strictly increasing grid cell index), rockType (u8 N);
 *             optional centroid (f32 3N; else origin + (ijk + ½)·blockSize from cell), density
 *             and tonnes (f32 N; else header byRock[rockType]), oreClass (u8 N; else from grade
 *             and grades). About 9 B per generated block instead of 30.
 *             Header: count, grid (the bounding grid: count ≤ nx·ny·nz), grades, pattern
 *             (burden/spacing drive the firing sequence), byRock, seed, configHash (ADR-12).
 * - movement: delay (f32 N), surface.height (f32 nx·ny), and either slotCell (u32 N, post-grid
 *             cell) + slotLevel (u16 N, stack level) or, if some position does not reproduce
 *             from its slot, end (f32 3N). Header: count, params, paramsHash, looseScale,
 *             postGrid, surface spec and the model configHash it was computed from. `start` is
 *             the model's centroid; `end` (from slots), `displacement` and `distance` are derived
 *             on decode.
 *
 * Byte order: sections are written and read through typed arrays, which use the platform order.
 * Every supported platform (x86, ARM, WASM) is little-endian; a big-endian host throws.
 */
import { classifyGrade } from './blockModel';
import { slotPosition } from './movement';
import type { BlastParameters, BlastPattern, BlockModel, GradeSettings, GridSpec, MovementResult, Vec2 } from './types';

export const BMV1_MAGIC = 'BMV1';
/**
 * v2: sparse models (the `cell` section). v3: compact (derivable fields sent only when they do
 * not derive exactly; movement as slots). Older payloads are rejected (UNSUPPORTED_VERSION).
 */
export const BMV1_SCHEMA_VERSION = 3;
/** Bytes before the header JSON: magic + uint32 header length. */
const PREAMBLE = 8;

export type CodecErrorCode =
  | 'BAD_MAGIC'
  | 'TRUNCATED'
  | 'UNSUPPORTED_VERSION'
  | 'BAD_HEADER'
  /** A section's contents break an invariant (e.g. `cell` not strictly increasing). */
  | 'BAD_DATA'
  | 'WRONG_KIND'
  | 'MODEL_MISMATCH'
  | 'UNSUPPORTED_PLATFORM';

/** Every decode failure is a CodecError with a machine-readable `code`. */
export class CodecError extends Error {
  readonly code: CodecErrorCode;
  constructor(code: CodecErrorCode, message: string) {
    super(`BMV1 ${code}: ${message}`);
    this.name = 'CodecError';
    this.code = code;
  }
}

export type FieldType = 'f32' | 'u32' | 'u16' | 'u8';

export interface FieldSpec {
  name: string;
  type: FieldType;
  /** bytes from the start of the payload, multiple of 4 */
  offset: number;
  /** elements */
  length: number;
}

interface HeaderBase {
  schemaVersion: number;
  kind: 'model' | 'movement';
  count: number;
  fields: FieldSpec[];
}

export interface ModelHeader extends HeaderBase {
  kind: 'model';
  grid: GridSpec;
  grades: GradeSettings;
  pattern: BlastPattern;
  /**
   * Per RockType (index), the density (t/m³) and tonnes of every block of that type, when the
   * model has one value per type (generated models do) and the `density` / `tonnes` sections are
   * therefore not sent. Null when they are sent.
   */
  byRock: { density: number[]; tonnes: number[] } | null;
  seed: number;
  configHash: string;
}

export interface MovementHeader extends HeaderBase {
  kind: 'movement';
  params: BlastParameters;
  paramsHash: string;
  looseScale: number;
  postGrid: { origin: Vec2; cellSize: number; nx: number; ny: number };
  surface: { origin: Vec2; cellSize: number; nx: number; ny: number };
  /** configHash of the model this movement was computed from (decode checks it). */
  modelConfigHash: string;
}

export type Bmv1Header = ModelHeader | MovementHeader;
/** What a caller supplies to encode(): a header without the codec-owned keys. */
type HeaderMeta = Omit<ModelHeader, 'schemaVersion' | 'fields'> | Omit<MovementHeader, 'schemaVersion' | 'fields'>;

const BYTES: Record<FieldType, number> = { f32: 4, u32: 4, u16: 2, u8: 1 };
const align4 = (n: number) => (n + 3) & ~3;

function assertLittleEndian(): void {
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
    throw new CodecError('UNSUPPORTED_PLATFORM', 'big-endian hosts are not supported');
  }
}

type SectionData = Float32Array | Uint32Array | Uint16Array | Uint8Array;
type Section = { name: string; data: SectionData };

const typeOf = (data: SectionData): FieldType =>
  data instanceof Float32Array ? 'f32' : data instanceof Uint32Array ? 'u32' : data instanceof Uint16Array ? 'u16' : 'u8';
const SECTION_ORDER: readonly FieldType[] = ['f32', 'u32', 'u16', 'u8'];

/** Lay out sections (Float32, Uint32, Uint16, then Uint8; each 4-byte aligned) behind a padded JSON header. */
function encode(meta: HeaderMeta, sections: Section[]): Uint8Array<ArrayBuffer> {
  assertLittleEndian();
  const ordered = SECTION_ORDER.flatMap((t) => sections.filter((s) => typeOf(s.data) === t));
  const enc = new TextEncoder();
  // Offsets depend on the header length, which depends on the offsets: iterate until stable
  // (converges in ≤ 2 rounds since the digits of the offsets only grow).
  let headerBytes = 0;
  let fields: FieldSpec[] = [];
  let json = new Uint8Array(0);
  for (let round = 0; round < 8; round++) {
    let cursor = PREAMBLE + headerBytes;
    fields = ordered.map((s) => {
      const type = typeOf(s.data);
      const f = { name: s.name, type, offset: cursor, length: s.data.length };
      cursor = align4(cursor + s.data.byteLength);
      return f;
    });
    json = enc.encode(JSON.stringify({ schemaVersion: BMV1_SCHEMA_VERSION, ...meta, fields }));
    const needed = align4(json.length);
    if (needed === headerBytes) break;
    headerBytes = needed;
  }
  const last = fields[fields.length - 1];
  const total = last ? align4(last.offset + last.length * BYTES[last.type]) : PREAMBLE + headerBytes;

  const out = new Uint8Array(total);
  out.set(enc.encode(BMV1_MAGIC), 0);
  new DataView(out.buffer).setUint32(4, headerBytes, true);
  out.fill(0x20, PREAMBLE, PREAMBLE + headerBytes); // JSON.parse ignores trailing spaces
  out.set(json, PREAMBLE);
  ordered.forEach((s, i) => {
    const f = fields[i];
    if (s.data instanceof Float32Array) new Float32Array(out.buffer, f.offset, f.length).set(s.data);
    else if (s.data instanceof Uint32Array) new Uint32Array(out.buffer, f.offset, f.length).set(s.data);
    else if (s.data instanceof Uint16Array) new Uint16Array(out.buffer, f.offset, f.length).set(s.data);
    else out.set(s.data, f.offset);
  });
  return out;
}

export function encodeModel(model: BlockModel): Uint8Array<ArrayBuffer> {
  if (!model.configHash) throw new TypeError('encodeModel: model.configHash is required');
  const sections: Section[] = [
    { name: 'grade', data: model.grade },
    { name: 'cell', data: model.cell },
    { name: 'rockType', data: model.rockType },
  ];
  // Each derived field is sent only if deriving it does NOT reproduce it bit for bit.
  if (!sameF32(deriveCentroid(model.grid, model.cell), model.centroid)) sections.push({ name: 'centroid', data: model.centroid });
  const byRock = rockConstants(model);
  if (!byRock) {
    sections.push({ name: 'density', data: model.density }, { name: 'tonnes', data: model.tonnes });
  }
  if (!sameU8(deriveOreClass(model.grade, model.grades), model.oreClass)) sections.push({ name: 'oreClass', data: model.oreClass });
  return encode(
    {
      kind: 'model',
      count: model.count,
      grid: model.grid,
      grades: model.grades,
      pattern: model.pattern,
      byRock,
      seed: model.seed,
      configHash: model.configHash,
    },
    sections,
  );
}

const sameF32 = (a: Float32Array, b: Float32Array) => {
  if (a.length !== b.length) return false;
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const y = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};
const sameU8 = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Centroids from grid cells: origin + (ijk + ½) · blockSize, exactly as the generator writes them. */
export function deriveCentroid(grid: GridSpec, cell: Uint32Array): Float32Array {
  const { nx, ny } = grid;
  const [ox, oy, oz] = grid.origin;
  const [bx, by, bz] = grid.blockSize;
  const out = new Float32Array(3 * cell.length);
  for (let n = 0; n < cell.length; n++) {
    const c = cell[n];
    const i = c % nx;
    const r = (c - i) / nx;
    const j = r % ny;
    const k = (r - j) / ny;
    out[3 * n] = ox + (i + 0.5) * bx;
    out[3 * n + 1] = oy + (j + 0.5) * by;
    out[3 * n + 2] = oz + (k + 0.5) * bz;
  }
  return out;
}

/** Pre-blast class per block from its stored grade (classifyGrade, as the generator does). */
export function deriveOreClass(grade: Float32Array, grades: GradeSettings): Uint8Array {
  const out = new Uint8Array(grade.length);
  for (let n = 0; n < grade.length; n++) out[n] = classifyGrade(grade[n], grades);
  return out;
}

/** One (density, tonnes) per rock type, or null if some rock type has more than one value. */
function rockConstants(model: BlockModel): { density: number[]; tonnes: number[] } | null {
  const density: number[] = [];
  const tonnes: number[] = [];
  for (let n = 0; n < model.count; n++) {
    const r = model.rockType[n];
    if (density[r] === undefined) {
      density[r] = model.density[n];
      tonnes[r] = model.tonnes[n];
    } else if (!Object.is(density[r], model.density[n]) || !Object.is(tonnes[r], model.tonnes[n])) {
      return null;
    }
  }
  for (let r = 0; r < density.length; r++) {
    if (density[r] === undefined) {
      density[r] = 0; // a rock type no block has (keeps the arrays dense for JSON)
      tonnes[r] = 0;
    }
  }
  return { density, tonnes };
}

/**
 * Encode a movement computed for `model`. Final positions are sent as post-blast slots (post-grid
 * cell + stack level, the canonical slotPosition formula) when every block's position reproduces
 * exactly from its slot; otherwise the explicit `end` section is sent instead.
 */
export function encodeMovement(movement: MovementResult, model: BlockModel): Uint8Array<ArrayBuffer> {
  const { surface } = movement;
  const n = movement.delay.length;
  const slots = toSlots(movement, model);
  const sections: Section[] = [
    { name: 'delay', data: movement.delay },
    { name: 'surface.height', data: surface.height },
  ];
  if (slots) sections.push({ name: 'slotCell', data: slots.cell }, { name: 'slotLevel', data: slots.level });
  else sections.push({ name: 'end', data: movement.end });
  return encode(
    {
      kind: 'movement',
      count: n,
      params: movement.params,
      paramsHash: movement.paramsHash,
      looseScale: movement.looseScale,
      postGrid: movement.postGrid,
      surface: { origin: surface.origin, cellSize: surface.cellSize, nx: surface.nx, ny: surface.ny },
      modelConfigHash: model.configHash,
    },
    sections,
  );
}

/** Stacked block height of a movement on `model` (as the movement computes it). */
const stackHeightOf = (model: BlockModel, looseScale: number) => model.grid.blockSize[2] * looseScale;

/** Slots (cell, level) reproducing every final position exactly, or null. */
function toSlots(movement: MovementResult, model: BlockModel): { cell: Uint32Array; level: Uint16Array } | null {
  const g = movement.postGrid;
  const n = movement.delay.length;
  const zToe = model.grid.origin[2];
  const hb = stackHeightOf(model, movement.looseScale);
  const cell = new Uint32Array(n);
  const level = new Uint16Array(n);
  const probe = new Float32Array(3);
  const end = movement.end;
  for (let b = 0; b < n; b++) {
    const ix = Math.round((end[3 * b] - g.origin[0]) / g.cellSize - 0.5);
    const iy = Math.round((end[3 * b + 1] - g.origin[1]) / g.cellSize - 0.5);
    const lv = Math.round((end[3 * b + 2] - zToe) / hb - 0.5);
    if (ix < 0 || ix >= g.nx || iy < 0 || iy >= g.ny || lv < 0 || lv > 0xffff) return null;
    cell[b] = ix + g.nx * iy;
    level[b] = lv;
    slotPosition(g, zToe, hb, cell[b], lv, probe, 0);
    if (!Object.is(probe[0], end[3 * b]) || !Object.is(probe[1], end[3 * b + 1]) || !Object.is(probe[2], end[3 * b + 2])) return null;
  }
  return { cell, level };
}

// ── Decode ──────────────────────────────────────────────────────────────────

type Input = ArrayBuffer | Uint8Array;

/** The payload as an ArrayBuffer slice whose byte 0 is 4-aligned (views need aligned offsets). */
function toAligned(input: Input): { buffer: ArrayBuffer; base: number; byteLength: number } {
  if (input instanceof ArrayBuffer) return { buffer: input, base: 0, byteLength: input.byteLength };
  if (input.byteOffset % 4 === 0 && input.buffer instanceof ArrayBuffer) {
    return { buffer: input.buffer, base: input.byteOffset, byteLength: input.byteLength };
  }
  // Misaligned view (e.g. a pooled Node Buffer): one copy so Float32 views are legal.
  const copy = input.slice();
  return { buffer: copy.buffer, base: 0, byteLength: copy.byteLength };
}

/** Parse and validate the preamble + header; never touches the sections. */
export function readHeader(input: Input): Bmv1Header {
  const { buffer, base, byteLength } = toAligned(input);
  return parseHeader(buffer, base, byteLength);
}

function parseHeader(buffer: ArrayBuffer, base: number, byteLength: number): Bmv1Header {
  if (byteLength < PREAMBLE) throw new CodecError('TRUNCATED', `${byteLength} bytes is shorter than the preamble`);
  const bytes = new Uint8Array(buffer, base, byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== BMV1_MAGIC) throw new CodecError('BAD_MAGIC', `expected "${BMV1_MAGIC}", got ${JSON.stringify(magic)}`);
  const headerBytes = new DataView(buffer, base, byteLength).getUint32(4, true);
  if (headerBytes % 4 !== 0) throw new CodecError('BAD_HEADER', `header length ${headerBytes} is not 4-byte aligned`);
  if (PREAMBLE + headerBytes > byteLength) {
    throw new CodecError('TRUNCATED', `header needs ${PREAMBLE + headerBytes} bytes, payload has ${byteLength}`);
  }
  let header: Bmv1Header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(PREAMBLE, PREAMBLE + headerBytes))) as Bmv1Header;
  } catch (err) {
    throw new CodecError('BAD_HEADER', `header is not JSON (${(err as Error).message})`);
  }
  if (typeof header !== 'object' || header === null) throw new CodecError('BAD_HEADER', 'header is not an object');
  if (header.schemaVersion !== BMV1_SCHEMA_VERSION) {
    throw new CodecError('UNSUPPORTED_VERSION', `schemaVersion ${String(header.schemaVersion)} (supported: ${BMV1_SCHEMA_VERSION})`);
  }
  const kind: unknown = header.kind;
  if (kind !== 'model' && kind !== 'movement') throw new CodecError('BAD_HEADER', `unknown kind ${JSON.stringify(kind)}`);
  if (!Number.isInteger(header.count) || header.count < 0) throw new CodecError('BAD_HEADER', 'count must be an integer >= 0');
  if (!Array.isArray(header.fields)) throw new CodecError('BAD_HEADER', 'fields must be an array');
  const dataStart = PREAMBLE + headerBytes;
  for (const f of header.fields) {
    if (f.type !== 'f32' && f.type !== 'u32' && f.type !== 'u16' && f.type !== 'u8') throw new CodecError('BAD_HEADER', `field ${f.name}: unknown type ${String(f.type)}`);
    if (!Number.isInteger(f.offset) || f.offset < dataStart || f.offset % 4 !== 0) {
      throw new CodecError('BAD_HEADER', `field ${f.name}: offset ${f.offset} is not an aligned section offset`);
    }
    if (!Number.isInteger(f.length) || f.length < 0) throw new CodecError('BAD_HEADER', `field ${f.name}: bad length`);
    const end = f.offset + f.length * BYTES[f.type];
    if (end > byteLength) {
      throw new CodecError('TRUNCATED', `field ${f.name} ends at byte ${end}, payload has ${byteLength}`);
    }
  }
  return header;
}

/** Typed-array views for the named sections, checking type and element count. */
function views(buffer: ArrayBuffer, base: number, header: Bmv1Header, expect: Record<string, [FieldType, number]>) {
  const out: Record<string, SectionData> = {};
  for (const [name, [type, length]] of Object.entries(expect)) {
    const f = header.fields.find((x) => x.name === name);
    if (!f) throw new CodecError('BAD_HEADER', `missing field ${name}`);
    if (f.type !== type || f.length !== length) {
      throw new CodecError('BAD_HEADER', `field ${name}: expected ${type}[${length}], got ${f.type}[${f.length}]`);
    }
    out[name] = viewOf(buffer, base + f.offset, type, length);
  }
  return out;
}

function viewOf(buffer: ArrayBuffer, at: number, type: FieldType, length: number): SectionData {
  return type === 'f32'
    ? new Float32Array(buffer, at, length)
    : type === 'u32'
      ? new Uint32Array(buffer, at, length)
      : type === 'u16'
        ? new Uint16Array(buffer, at, length)
        : new Uint8Array(buffer, at, length);
}

/** A view on an OPTIONAL section (sent only when it cannot be derived), or null if absent. */
function optionalView(buffer: ArrayBuffer, base: number, header: Bmv1Header, name: string, type: FieldType, length: number) {
  const f = header.fields.find((x) => x.name === name);
  if (!f) return null;
  if (f.type !== type || f.length !== length) {
    throw new CodecError('BAD_HEADER', `field ${name}: expected ${type}[${length}], got ${f.type}[${f.length}]`);
  }
  return viewOf(buffer, base + f.offset, type, length);
}

// ── Header shape checks: a header that is valid JSON but malformed throws BAD_HEADER, never a
// TypeError from deep inside decode.

const bad = (msg: string): never => {
  throw new CodecError('BAD_HEADER', msg);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isUint = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function obj(v: unknown, path: string): Record<string, unknown> {
  return isObj(v) ? v : bad(`${path} must be an object`);
}
function num(v: unknown, path: string): void {
  if (!isNum(v)) bad(`${path} must be a finite number`);
}
function uint(v: unknown, path: string): void {
  if (!isUint(v)) bad(`${path} must be an integer >= 0`);
}
function str(v: unknown, path: string): void {
  if (typeof v !== 'string' || v.length === 0) bad(`${path} must be a non-empty string`);
}
function vec(v: unknown, n: number, path: string): void {
  if (!Array.isArray(v) || v.length !== n || !v.every(isNum)) bad(`${path} must be ${n} finite numbers`);
}
/** `{ origin: Vec2, cellSize, nx, ny }` (postGrid, surface). */
function grid2(v: unknown, path: string): void {
  const g = obj(v, path);
  vec(g.origin, 2, `${path}.origin`);
  num(g.cellSize, `${path}.cellSize`);
  uint(g.nx, `${path}.nx`);
  uint(g.ny, `${path}.ny`);
}

function checkModelHeader(h: ModelHeader): void {
  const g = obj(h.grid, 'grid');
  vec(g.origin, 3, 'grid.origin');
  vec(g.blockSize, 3, 'grid.blockSize');
  uint(g.nx, 'grid.nx');
  uint(g.ny, 'grid.ny');
  uint(g.nz, 'grid.nz');
  if (h.count > (g.nx as number) * (g.ny as number) * (g.nz as number)) bad('count must be <= grid.nx * ny * nz');
  const gr = obj(h.grades, 'grades');
  num(gr.cutoff, 'grades.cutoff');
  num(gr.mediumGrade, 'grades.mediumGrade');
  num(gr.highGrade, 'grades.highGrade');
  if (!((gr.cutoff as number) <= (gr.mediumGrade as number) && (gr.mediumGrade as number) <= (gr.highGrade as number))) {
    bad('grades must satisfy cutoff <= mediumGrade <= highGrade');
  }
  const pt = obj(h.pattern, 'pattern');
  for (const k of ['burden', 'spacing'] as const) {
    num(pt[k], `pattern.${k}`);
    if (!((pt[k] as number) > 0)) bad(`pattern.${k} must be > 0`);
  }
  for (const k of ['holeDiameterMm', 'subdrill'] as const) num(pt[k], `pattern.${k}`);
  for (const k of ['rows', 'holesPerRow'] as const) uint(pt[k], `pattern.${k}`);
  if (h.byRock !== null && h.byRock !== undefined) {
    // Density and tonnes per rock type: both tables, the same non-zero length, finite values ≥ 0.
    // (Coverage of every rock type in the payload is checked per block in decodeModel.)
    const br = obj(h.byRock, 'byRock');
    const d = br.density;
    const t = br.tonnes;
    if (!Array.isArray(d) || !Array.isArray(t) || d.length === 0 || d.length !== t.length) {
      bad('byRock.density and byRock.tonnes must be arrays of the same non-zero length');
    }
    for (const [name, arr] of [['density', d], ['tonnes', t]] as const) {
      (arr as unknown[]).forEach((v, i) => {
        if (!isNum(v) || v < 0) bad(`byRock.${name}[${i}] must be a finite number >= 0`);
      });
    }
  }
  num(h.seed, 'seed');
  str(h.configHash, 'configHash');
}

function checkMovementHeader(h: MovementHeader): void {
  obj(h.params, 'params');
  str(h.paramsHash, 'paramsHash');
  str(h.modelConfigHash, 'modelConfigHash');
  num(h.looseScale, 'looseScale');
  grid2(h.postGrid, 'postGrid');
  grid2(h.surface, 'surface');
}

function begin(input: Input, kind: Bmv1Header['kind']) {
  assertLittleEndian();
  const { buffer, base, byteLength } = toAligned(input);
  const header = parseHeader(buffer, base, byteLength);
  if (header.kind !== kind) throw new CodecError('WRONG_KIND', `expected a ${kind} payload, got ${header.kind}`);
  return { buffer, base, header };
}

/** Decode a model payload. Typed arrays are views on `input`'s buffer (no copies). */
export function decodeModel(input: Input): BlockModel {
  const { buffer, base, header: h } = begin(input, 'model');
  const header = h as ModelHeader;
  checkModelHeader(header);
  const n = header.count;
  const v = views(buffer, base, header, { grade: ['f32', n], cell: ['u32', n], rockType: ['u8', n] });
  const cell = v.cell as Uint32Array;
  const grade = v.grade as Float32Array;
  const rockType = v.rockType as Uint8Array;
  const { nx, ny, nz } = header.grid;
  const cells = nx * ny * nz;
  for (let b = 0; b < n; b++) {
    if (cell[b] >= cells || (b > 0 && cell[b] <= cell[b - 1])) {
      throw new CodecError('BAD_DATA', `cell[${b}] = ${cell[b]} is not a strictly increasing grid cell index`);
    }
  }
  const centroid = (optionalView(buffer, base, header, 'centroid', 'f32', 3 * n) as Float32Array | null) ?? deriveCentroid(header.grid, cell);
  let density = optionalView(buffer, base, header, 'density', 'f32', n) as Float32Array | null;
  let tonnes = optionalView(buffer, base, header, 'tonnes', 'f32', n) as Float32Array | null;
  if (!density || !tonnes) {
    const byRock = header.byRock;
    if (!byRock) throw new CodecError('BAD_HEADER', 'byRock is required when density/tonnes are not sent');
    density = new Float32Array(n);
    tonnes = new Float32Array(n);
    for (let b = 0; b < n; b++) {
      const r = rockType[b];
      if (r >= byRock.density.length || r >= byRock.tonnes.length) {
        throw new CodecError('BAD_DATA', `rockType[${b}] = ${r} has no byRock entry`);
      }
      density[b] = byRock.density[r];
      tonnes[b] = byRock.tonnes[r];
    }
  }
  const oreClass = (optionalView(buffer, base, header, 'oreClass', 'u8', n) as Uint8Array | null) ?? deriveOreClass(grade, header.grades);
  return {
    grid: header.grid,
    grades: header.grades,
    count: n,
    cell,
    pattern: header.pattern,
    centroid,
    grade,
    density,
    tonnes,
    rockType,
    oreClass,
    seed: header.seed,
    configHash: header.configHash,
  };
}

/**
 * Decode a movement payload against the model it was computed from: `start` is the model's
 * centroid (shared, not copied); `displacement = end − start` and `distance = |displacement|`
 * are derived here. Throws MODEL_MISMATCH if the payload belongs to a different model.
 */
export function decodeMovement(input: Input, model: BlockModel): MovementResult {
  const { buffer, base, header: h } = begin(input, 'movement');
  const header = h as MovementHeader;
  checkMovementHeader(header);
  if (header.modelConfigHash !== model.configHash || header.count !== model.count) {
    throw new CodecError(
      'MODEL_MISMATCH',
      `movement for model ${header.modelConfigHash} (${header.count} blocks), got ${model.configHash} (${model.count})`,
    );
  }
  const n = header.count;
  const s = header.surface;
  const v = views(buffer, base, header, {
    delay: ['f32', n],
    'surface.height': ['f32', s.nx * s.ny],
  });
  let end = optionalView(buffer, base, header, 'end', 'f32', 3 * n) as Float32Array | null;
  if (!end) {
    const slotCell = optionalView(buffer, base, header, 'slotCell', 'u32', n) as Uint32Array | null;
    const slotLevel = optionalView(buffer, base, header, 'slotLevel', 'u16', n) as Uint16Array | null;
    if (!slotCell || !slotLevel) throw new CodecError('BAD_HEADER', 'missing field end (or slotCell + slotLevel)');
    const g = header.postGrid;
    const zToe = model.grid.origin[2];
    const hb = stackHeightOf(model, header.looseScale);
    end = new Float32Array(3 * n);
    for (let b = 0; b < n; b++) {
      if (slotCell[b] >= g.nx * g.ny) throw new CodecError('BAD_DATA', `slotCell[${b}] = ${slotCell[b]} is outside the post grid`);
      slotPosition(g, zToe, hb, slotCell[b], slotLevel[b], end, 3 * b);
    }
  }
  const start = model.centroid;
  const displacement = new Float32Array(3 * n);
  const distance = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const dx = end[3 * b] - start[3 * b];
    const dy = end[3 * b + 1] - start[3 * b + 1];
    const dz = end[3 * b + 2] - start[3 * b + 2];
    displacement[3 * b] = dx;
    displacement[3 * b + 1] = dy;
    displacement[3 * b + 2] = dz;
    distance[b] = Math.hypot(dx, dy, dz);
  }
  return {
    params: header.params,
    paramsHash: header.paramsHash,
    start,
    end,
    displacement,
    distance,
    delay: v.delay as Float32Array,
    looseScale: header.looseScale,
    postGrid: header.postGrid,
    surface: { origin: s.origin, cellSize: s.cellSize, nx: s.nx, ny: s.ny, height: v['surface.height'] as Float32Array },
  };
}
