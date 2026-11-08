/**
 * scripts/codex-review.sh with a stubbed `codex` on PATH: the verdict comes only from THIS run's
 * output and only from an exact final line; Codex failures and prose never count as PASS.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRIPT = join(ROOT, 'scripts/codex-review.sh');

/** A fake `codex`: copies its stdin to $STUB_STDIN, writes $STUB_OUTPUT to the -o file unless
 *  STUB_NO_OUTPUT is set, and exits with $STUB_EXIT. */
const STUB = `#!/usr/bin/env bash
out=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then out="$2"; shift; fi
  shift
done
cat > "$STUB_STDIN"
if [[ -z "\${STUB_NO_OUTPUT:-}" && -n "$out" ]]; then printf '%s' "$STUB_OUTPUT" > "$out"; fi
exit "\${STUB_EXIT:-0}"
`;

function run(opts: { output?: string; exit?: number; noOutput?: boolean; existing?: string; prev?: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-review-'));
  const bin = join(dir, 'bin');
  spawnSync('mkdir', [bin]);
  writeFileSync(join(bin, 'codex'), STUB);
  chmodSync(join(bin, 'codex'), 0o755);
  const out = join(dir, 'review.md');
  if (opts.existing !== undefined) writeFileSync(out, opts.existing);
  const args = [SCRIPT, out];
  if (opts.prev !== undefined) {
    writeFileSync(join(dir, 'prev.md'), opts.prev);
    args.push(join(dir, 'prev.md'));
  }
  const res = spawnSync('bash', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CODEX_REVIEW_SKIP_FETCH: '1',
      STUB_STDIN: join(dir, 'stdin.txt'),
      STUB_OUTPUT: opts.output ?? '',
      STUB_EXIT: String(opts.exit ?? 0),
      ...(opts.noOutput ? { STUB_NO_OUTPUT: '1' } : {}),
    },
  });
  const stdinPath = join(dir, 'stdin.txt');
  return { code: res.status, stdout: res.stdout, prompt: existsSync(stdinPath) ? readFileSync(stdinPath, 'utf8') : '' };
}

describe('scripts/codex-review.sh', () => {
  it('exit 0 on a final PASS line, 1 on a final CHANGES REQUESTED line', () => {
    expect(run({ output: 'Looks good.\n\nVERDICT: PASS\n' }).code).toBe(0);
    expect(run({ output: '1. BLOCKING — bug\n\nVERDICT: CHANGES REQUESTED\n\n' }).code).toBe(1);
    expect(run({ output: 'ok\r\nVERDICT: PASS\r\n' }).code).toBe(0);
  });

  it('a Codex failure is "no verdict" even if an old PASS file exists at the output path', () => {
    const r = run({ existing: 'VERDICT: PASS\n', exit: 1, noOutput: true });
    expect(r.code).toBe(2);
    expect(r.stdout).toContain('codex failed');
  });

  it('a run that writes no output does not reuse the old file', () => {
    expect(run({ existing: 'VERDICT: PASS\n', noOutput: true }).code).toBe(2);
  });

  it('verdicts quoted in prose, partial matches and text after the verdict are "no verdict"', () => {
    expect(run({ output: 'Review incomplete; required format is VERDICT: PASS or another verdict.\n' }).code).toBe(2);
    expect(run({ output: 'VERDICT: PASSED\n' }).code).toBe(2);
    expect(run({ output: '**VERDICT: PASS**\n' }).code).toBe(2);
    expect(run({ output: 'VERDICT: PASS\nOne more thing: a bug.\n' }).code).toBe(2);
    expect(run({ output: '' }).code).toBe(2);
  });

  it('builds the prompt from the repo prompt, and a follow-up round includes the previous findings', () => {
    const first = run({ output: 'VERDICT: PASS\n' });
    expect(first.prompt).toContain('git diff origin/main...HEAD');
    expect(first.prompt).toContain(readFileSync(join(ROOT, 'scripts/codex-review-prompt.md'), 'utf8').split('\n')[0]);
    expect(first.prompt).not.toContain('PREVIOUS FINDINGS');
    const followUp = run({ output: 'VERDICT: PASS\n', prev: '1. BLOCKING — drag picks\nVERDICT: CHANGES REQUESTED\n' });
    expect(followUp.prompt).toContain('--- PREVIOUS FINDINGS ---');
    expect(followUp.prompt).toContain('1. BLOCKING — drag picks');
  });
});
