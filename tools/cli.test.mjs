// Tests for tools/cli.mjs, and for every build tool that uses it.
//
// The bug (2026-09-21): `build_mixed.mjs --help` was not parsed, so it ran a
// full default build and marked 20 questions used. Every build tool had the same
// shape -- flags read with indexOf, everything else ignored.
//
// The CLI tests below drive the REAL tools, so they are written so that a
// regression cannot consume anything: every build-tool invocation also carries
// --dry (or, for build_note, which has no --dry, a source path that does not
// exist), and the last test asserts state/used_questions.json is byte-identical.
// If the parser stops short-circuiting, these fail by printing a plan, not by
// burning questions.
//
// push_note / rename_note are NOT executed here, not even with --help: they
// talk to the Supernote Cloud. Their parsing is covered by the parser unit tests
// and by reading that `cli()` is their first statement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseArgs, CliError } from './cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// ---- the parser ------------------------------------------------------------

const SPEC = { values: ['n', 'out'], bools: ['dry'], noop: ['timed'] };

test('--help and -h short-circuit, wherever they appear', () => {
  assert.deepEqual(parseArgs(['--help'], SPEC), { help: true });
  assert.deepEqual(parseArgs(['Circles', '--n', '5', '-h'], SPEC), { help: true });
});

test('an unknown flag is refused, not ignored', () => {
  assert.throws(() => parseArgs(['--dyr'], SPEC), CliError);
  assert.throws(() => parseArgs(['--dryrun'], { bools: ['dry-run'] }), /unknown option --dryrun/);
  assert.throws(() => parseArgs(['-x'], SPEC), CliError);
});

test('a value flag with no value is refused', () => {
  assert.throws(() => parseArgs(['--n'], SPEC), /--n needs a value/);
  assert.throws(() => parseArgs(['--n', '--dry'], SPEC), /--n needs a value/);
  assert.throws(() => parseArgs(['--n='], SPEC), /--n needs a value/);
});

test('flag values are consumed, so they are never mistaken for positionals', () => {
  const p = parseArgs(['systems', '--n', '8', 'exponents', '--out', '/tmp/x', '--dry'], SPEC);
  assert.deepEqual(p.positional, ['systems', 'exponents']);
  assert.deepEqual(p.values, { n: '8', out: '/tmp/x' });
  assert.ok(p.bools.has('dry'));
});

test('--name=value works, and a boolean refuses a value', () => {
  assert.deepEqual(parseArgs(['--n=20'], SPEC).values, { n: '20' });
  assert.throws(() => parseArgs(['--dry=yes'], SPEC), /takes no value/);
});

test('a documented no-op flag is accepted and does nothing', () => {
  const p = parseArgs(['Transitions', '--timed'], SPEC);
  assert.deepEqual(p.positional, ['Transitions']);
  assert.equal(p.bools.size, 0);
});

test('a negative-looking number is a value, not a flag', () => {
  assert.deepEqual(parseArgs(['--n', '-1'], SPEC).values, { n: '-1' });
});

// ---- every build tool, for real ------------------------------------------

const used = () => readFileSync(join(ROOT, 'state', 'used_questions.json'));
const outFiles = () => readdirSync(join(ROOT, 'out')).sort();
const targets = () => readdirSync(join(ROOT, 'content', 'targets')).sort();
const run = (script, ...a) => spawnSync('node', [join(HERE, script), ...a], { encoding: 'utf8' });

const TOOLS = [
  ['build_mixed.mjs'],
  ['build_sweep.mjs', 'Circles'],
  ['build_rw_set.mjs', 'Boundaries'],
  ['build_desmos.mjs', 'systems'],
  ['build_drill.mjs'],
];

const before = { used: used(), out: outFiles(), targets: targets() };

for (const [script, ...pos] of TOOLS) {
  test(`${script} --help prints usage and builds nothing`, () => {
    const r = run(script, ...pos, '--help', '--dry');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^usage: /);
    assert.doesNotMatch(r.stdout, /\bpush with:|wrote |pages:/);
  });
  test(`${script} refuses an unknown flag`, () => {
    const r = run(script, ...pos, '--dyr', '--dry');
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /unknown option --dyr/);
    assert.match(r.stderr, /Nothing was built/);
  });
}

test('build_note.mjs --help prints usage; an unknown flag is refused', () => {
  const missing = join(ROOT, 'content', 'targets', 'does-not-exist.md');
  const h = run('build_note.mjs', missing, '--help');
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /^usage: /);
  const u = run('build_note.mjs', missing, '--dyr');
  assert.equal(u.status, 2);
  assert.match(u.stderr, /unknown option --dyr/);
});

test('build_rw_set.mjs still accepts the README\'s --timed', () => {
  const r = run('build_rw_set.mjs', 'Transitions', '--n', '4', '--timed', '--dry');
  assert.equal(r.status, 0, r.stderr);
});

test('none of the above touched state, out/ or content/targets/', () => {
  assert.ok(before.used.equals(used()), 'state/used_questions.json changed');
  assert.deepEqual(outFiles(), before.out, 'out/ changed');
  assert.deepEqual(targets(), before.targets, 'content/targets/ changed');
});
