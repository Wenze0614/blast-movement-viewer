/**
 * BMV1 binary codec (docs/02-plan.md ADR-11). Specification stubs for workstream D (core/codec.ts).
 */
import { describe, it } from 'vitest';

describe('BMV1 codec', () => {
  it.todo('model round-trip: decode(encode(model)) equals the model field by field (typed arrays byte-equal)');
  it.todo('movement round-trip: end, delay, surface.height, params, paramsHash, looseScale, postGrid survive');
  it.todo('derives displacement = end − start and distance = |displacement| on decode');
  it.todo('starts with magic "BMV1" and a uint32 little-endian header length');
  it.todo('aligns every section to 4 bytes; Float32 sections precede Uint8 sections');
  it.todo('decode returns typed-array views on the input buffer (no copy)');
  it.todo('rejects a wrong magic, an unknown schemaVersion, or a truncated buffer with a typed error');
});
