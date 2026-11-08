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
 * - model:    centroid (f32 3N), grade, density, tonnes (f32 N), cell (u32 N), rockType,
 *             oreClass (u8 N). Header: count, grid (the bounding grid: count ≤ nx·ny·nz),
 *             grades, pattern (burden/spacing drive the firing sequence), seed, configHash
 *             (computeMovement needs it, ADR-12). `cell` holds each
 *             block's grid cell index, strictly increasing (schema v2: sparse models).
 * - movement: end (f32 3N), delay (f32 N), surface.height (f32 nx·ny).
 *             Header: count, params, paramsHash, looseScale, postGrid, surface spec and the model
 *             configHash it was computed from. `start` is the model's centroid; `displacement`
 *             and `distance` are derived on decode (they are not sent).
 *
 * Byte order: sections are written and read through typed arrays, which use the platform order.
 * Every supported platform (x86, ARM, WASM) is little-endian; a big-endian host throws.
 */
import type { BlastParameters, BlastPattern, BlockModel, GradeSettings, GridSpec, MovementResult, Vec2 } from './types';

export const BMV1_MAGIC = 'BMV1';
/** v2: sparse models (the `cell` section). v1 payloads are rejected (UNSUPPORTED_VERSION). */
export const BMV1_SCHEMA_VERSION = 2;
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

export type FieldType = 'f32' | 'u32' | 'u8';

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

const BYTES: Record<FieldType, number> = { f32: 4, u32: 4, u8: 1 };
const align4 = (n: number) => (n + 3) & ~3;

function assertLittleEndian(): void {
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
    throw new CodecError('UNSUPPORTED_PLATFORM', 'big-endian hosts are not supported');
  }
}

type SectionData = Float32Array | Uint32Array | Uint8Array;
type Section = { name: string; data: SectionData };

const typeOf = (data: SectionData): FieldType =>
  data instanceof Float32Array ? 'f32' : data instanceof Uint32Array ? 'u32' : 'u8';
const SECTION_ORDER: readonly FieldType[] = ['f32', 'u32', 'u8'];

/** Lay out sections (Float32, Uint32, then Uint8; each 4-byte aligned) behind a padded JSON header. */
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
    else out.set(s.data, f.offset);
  });
  return out;
}

export function encodeModel(model: BlockModel): Uint8Array<ArrayBuffer> {
  if (!model.configHash) throw new TypeError('encodeModel: model.configHash is required');
  return encode(
    {
      kind: 'model',
      count: model.count,
      grid: model.grid,
      grades: model.grades,
      pattern: model.pattern,
      seed: model.seed,
      configHash: model.configHash,
    },
    [
      { name: 'centroid', data: model.centroid },
      { name: 'grade', data: model.grade },
      { name: 'density', data: model.density },
      { name: 'tonnes', data: model.tonnes },
      { name: 'cell', data: model.cell },
      { name: 'rockType', data: model.rockType },
      { name: 'oreClass', data: model.oreClass },
    ],
  );
}

/** `modelConfigHash`: the configHash of the model the movement was computed from. */
export function encodeMovement(movement: MovementResult, modelConfigHash: string): Uint8Array<ArrayBuffer> {
  const { surface } = movement;
  return encode(
    {
      kind: 'movement',
      count: movement.delay.length,
      params: movement.params,
      paramsHash: movement.paramsHash,
      looseScale: movement.looseScale,
      postGrid: movement.postGrid,
      surface: { origin: surface.origin, cellSize: surface.cellSize, nx: surface.nx, ny: surface.ny },
      modelConfigHash,
    },
    [
      { name: 'end', data: movement.end },
      { name: 'delay', data: movement.delay },
      { name: 'surface.height', data: surface.height },
    ],
  );
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
    if (f.type !== 'f32' && f.type !== 'u32' && f.type !== 'u8') throw new CodecError('BAD_HEADER', `field ${f.name}: unknown type ${String(f.type)}`);
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
    const at = base + f.offset;
    out[name] =
      type === 'f32'
        ? new Float32Array(buffer, at, length)
        : type === 'u32'
          ? new Uint32Array(buffer, at, length)
          : new Uint8Array(buffer, at, length);
  }
  return out;
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
  num(gr.highGrade, 'grades.highGrade');
  const pt = obj(h.pattern, 'pattern');
  for (const k of ['burden', 'spacing'] as const) {
    num(pt[k], `pattern.${k}`);
    if (!((pt[k] as number) > 0)) bad(`pattern.${k} must be > 0`);
  }
  for (const k of ['holeDiameterMm', 'subdrill'] as const) num(pt[k], `pattern.${k}`);
  for (const k of ['rows', 'holesPerRow'] as const) uint(pt[k], `pattern.${k}`);
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
  const v = views(buffer, base, header, {
    centroid: ['f32', 3 * n],
    grade: ['f32', n],
    density: ['f32', n],
    tonnes: ['f32', n],
    cell: ['u32', n],
    rockType: ['u8', n],
    oreClass: ['u8', n],
  });
  const cell = v.cell as Uint32Array;
  const { nx, ny, nz } = header.grid;
  const cells = nx * ny * nz;
  for (let b = 0; b < n; b++) {
    if (cell[b] >= cells || (b > 0 && cell[b] <= cell[b - 1])) {
      throw new CodecError('BAD_DATA', `cell[${b}] = ${cell[b]} is not a strictly increasing grid cell index`);
    }
  }
  return {
    grid: header.grid,
    grades: header.grades,
    count: n,
    cell,
    pattern: header.pattern,
    centroid: v.centroid as Float32Array,
    grade: v.grade as Float32Array,
    density: v.density as Float32Array,
    tonnes: v.tonnes as Float32Array,
    rockType: v.rockType as Uint8Array,
    oreClass: v.oreClass as Uint8Array,
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
    end: ['f32', 3 * n],
    delay: ['f32', n],
    'surface.height': ['f32', s.nx * s.ny],
  });
  const start = model.centroid;
  const end = v.end as Float32Array;
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
