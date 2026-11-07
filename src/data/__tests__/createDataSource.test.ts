import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataSource, LocalDataSource } from '..';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('createDataSource (ADR-9, M10)', () => {
  it("returns a LocalDataSource for kind 'local' without a note", () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const ds = createDataSource({ kind: 'local' });
    expect(ds).toBeInstanceOf(LocalDataSource);
    expect(ds.kind).toBe('local');
    expect(info).not.toHaveBeenCalled();
  });

  it("'api' falls back to local with a console note until the API source lands (Stage 4)", () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const ds = createDataSource({ kind: 'api' });
    expect(ds.kind).toBe('local');
    expect(info).toHaveBeenCalledOnce();
  });

  it('reads NEXT_PUBLIC_DATA_SOURCE when no kind is given', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubEnv('NEXT_PUBLIC_DATA_SOURCE', 'local');
    createDataSource();
    expect(info).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_PUBLIC_DATA_SOURCE', '');
    createDataSource();
    expect(info).toHaveBeenCalledOnce(); // default 'api' → note
  });

  it('lists the three demo blasts', async () => {
    const blasts = await new LocalDataSource().listBlasts();
    expect(blasts.map((b) => b.id)).toEqual(['b1040-017', 'b1030-022', 'b1040-031']);
  });
});
