// Tests for the used-questions overwrite guard (sheet.mjs stemConflict/claimStem).
//
// Issue 2026-11-01: build_rw_set derived its stem from the skill list, so a
// second set over the same skills wrote to the first set's key. saveUsed()
// replaced that record, and spokenFor() -- which skips the current stem's own
// entry -- let five already-served questions back onto the new sheet. The build
// reported success. These pin the guard that now refuses it, in every builder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stemConflict, saveUsed } from './sheet.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = join(HERE, '..', 'state', 'used_questions.json');
const hash = () => createHash('sha256').update(readFileSync(STATE)).digest('hex');

// ---- the pure decision ------------------------------------------------------

test('a new key is not a conflict', () => {
  assert.equal(stemConflict({ other: ['a'] }, 'new', ['b', 'c']), null);
});

test('the same questions under the same key is a stable rebuild, not a conflict', () => {
  // Order-insensitive: the record is a set of served questions.
  assert.equal(stemConflict({ s: ['a', 'b', 'c'] }, 's', ['c', 'a', 'b']), null);
});

test('different questions under an existing key is a conflict, with the overlap named', () => {
  const c = stemConflict({ s: ['a', 'b', 'c', 'd'] }, 's', ['c', 'd', 'e']);
  assert.deepEqual(c, { stem: 's', previous: ['a', 'b', 'c', 'd'], next: ['c', 'd', 'e'], overlap: ['c', 'd'] });
});

test('a subset is still a conflict: shrinking a record forgets served questions', () => {
  assert.ok(stemConflict({ s: ['a', 'b'] }, 's', ['a']));
});

test('saveUsed refuses a conflicting overwrite before touching the file', () => {
  // The live file has keys; writing a single bogus qid over the first one must
  // throw, and the file must be byte-identical afterwards.
  const before = hash();
  const used = JSON.parse(readFileSync(STATE, 'utf8'));
  const [someKey] = Object.keys(used);
  assert.throws(() => saveUsed(someKey, ['__not_a_qid__']), /DIFFERENT questions/);
  assert.equal(hash(), before);
});

// ---- the real collision, through the CLI ------------------------------------
// --dry exits before buildNote/saveUsed, and claimStem runs before --dry, so
// these reproduce the 2026-11-01 command without consuming anything.

const RW = join(HERE, 'build_rw_set.mjs');
const CS01 = 'Words in Context,Text Structure and Purpose,Inferences,Command of Evidence,Form, Structure, and Sense,Rhetorical Synthesis';
const COLLIDING = 'RW-words-in-context-text-structure-and-purp';

test('build_rw_set flags the exact command that erased a record on 2026-11-01', (t) => {
  // Dry, so the run warns instead of refusing (a real run exits 1 in claimStem,
  // before buildNote; that path is the same stemConflict pinned above and is
  // deliberately not driven here -- a broken guard would then write state).
  const used = JSON.parse(readFileSync(STATE, 'utf8'));
  if (!used[COLLIDING] || used[COLLIDING].length === 11) {
    t.skip(`${COLLIDING} no longer holds a set of a different size; the repro needs it`);
    return;
  }
  const before = hash();
  const r = spawnSync('node', [RW, CS01, '--n', '11', '--difficulty', 'Hard', '--dry'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /a real run would be REFUSED/);
  assert.match(r.stderr, /already has "RW-words-in-context-text-structure-and-purp"/);
  assert.match(r.stderr, /--name/);
  assert.equal(hash(), before);
});

test('--name gives a second set over the same skills its own identity', () => {
  const before = hash();
  const out = execFileSync('node', [RW, CS01, '--n', '11', '--difficulty', 'Hard', '--name', 'RW-guardtest-unique', '--dry'], { encoding: 'utf8' });
  const picks = [...out.matchAll(/^ {2}([0-9a-f]{8})\s/gm)].map(m => m[1]);
  assert.equal(picks.length, 11);
  // Under a fresh stem every existing record is spoken for, so none of the
  // colliding set's questions can come back.
  const used = JSON.parse(readFileSync(STATE, 'utf8'));
  const served = new Set(Object.values(used).flat());
  assert.deepEqual(picks.filter(q => served.has(q)), []);
  assert.equal(hash(), before);
});

test('--name must start RW- because push_note routes on it', () => {
  const r = spawnSync('node', [RW, 'Boundaries', '--name', 'cs01', '--dry'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /RW-/);
});

test('--rebuild is the explicit override, and is accepted by every builder', () => {
  const before = hash();
  const r = spawnSync('node', [RW, CS01, '--n', '11', '--difficulty', 'Hard', '--rebuild', '--dry'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--rebuild: replacing "RW-words-in-context-text-structure-and-purp"/);
  assert.doesNotMatch(r.stderr, /REFUSED/);
  // Every builder that calls saveUsed must declare the flag, or the override
  // the refusal message points at is itself an "unknown option".
  for (const b of ['build_sweep.mjs', 'build_mixed.mjs', 'build_desmos.mjs', 'build_note.mjs']) {
    const h = spawnSync('node', [join(HERE, b), '--help'], { encoding: 'utf8' });
    assert.match(h.stdout + h.stderr, /--rebuild/, `${b} --help must document --rebuild`);
  }
  assert.equal(hash(), before);
});
