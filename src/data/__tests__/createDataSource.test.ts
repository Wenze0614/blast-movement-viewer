import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataSource, FallbackDataSource, LocalDataSource } from '..';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('createDataSource (ADR-9, M10)', () => {
  it("returns a LocalDataSource for kind 'local'", () => {
    const ds = createDataSource({ kind: 'local' });
    expect(ds).toBeInstanceOf(LocalDataSource);
    expect(ds.kind).toBe('local');
  });

  it("'api' → the API with automatic fallback to local compute", () => {
    const ds = createDataSource({ kind: 'api' });
    expect(ds).toBeInstanceOf(FallbackDataSource);
    expect(ds.kind).toBe('api');
    expect((ds as FallbackDataSource).fallback).toBeInstanceOf(LocalDataSource);
  });

  it("reads NEXT_PUBLIC_DATA_SOURCE when no kind is given; default (unset / unknown) is 'api'", () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_SOURCE', 'local');
    expect(createDataSource()).toBeInstanceOf(LocalDataSource);
    vi.stubEnv('NEXT_PUBLIC_DATA_SOURCE', '');
    expect(createDataSource()).toBeInstanceOf(FallbackDataSource);
    vi.stubEnv('NEXT_PUBLIC_DATA_SOURCE', 'bogus');
    expect(createDataSource()).toBeInstanceOf(FallbackDataSource);
  });

  it('lists the three demo blasts', async () => {
    const blasts = await new LocalDataSource().listBlasts();
    expect(blasts.map((b) => b.id)).toEqual(['b1040-017', 'b1030-022', 'b1040-031']);
  });
});
