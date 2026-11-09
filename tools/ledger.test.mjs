// Tests for tools/ledger.mjs -- the record push_note.mjs guards on. Pure; no cloud.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadLedger, saveLedger, recordPull, recordPush, recordRename, latestKnown, checkPush,
} from './ledger.mjs';

const BLANK = 'b1a4c0000000000000000000000000aa';
const INKED = '1a4ed000000000000000000000000bbb';
const fresh = () => ({ version: 1, notes: {} });

// R01, 2026-08-28: pulled with ink, then the cloud copy came back as the blank.
// The old guard compared against the remote and said UNCHANGED.
test('the R01 shape: remote equals the blank but a pull carried ink -> refuse loudly', () => {
  const l = recordPull(fresh(), 'R01.note', { md5: INKED, size: 8, folder: 'F', local: '/x/R01.note', at: '2026-08-28T13:16' });
  const r = checkPush(l, 'R01.note', { ours: BLANK, remoteMd5: BLANK, replace: false });
  assert.equal(r.ok, false);
  assert.equal(r.code, 4);
  assert.match(r.message, /handwriting has gone from the cloud/);
  assert.match(r.message, /\/x\/R01\.note/);
});

test('re-pushing the same blank we pushed is fine', () => {
  const l = recordPush(fresh(), 'S.note', { md5: BLANK, folder: 'F', at: '2026-09-01T10:00' });
  assert.deepEqual(checkPush(l, 'S.note', { ours: BLANK, remoteMd5: BLANK, replace: false }), { ok: true });
});

test('a push after the pull supersedes it', () => {
  const l = fresh();
  recordPull(l, 'S.note', { md5: INKED, size: 1, folder: 'F', local: 'x', at: '2026-09-01T10:00' });
  recordPush(l, 'S.note', { md5: BLANK, folder: 'F', at: '2026-09-01T11:00' });
  assert.equal(latestKnown(l, 'S.note').kind, 'push');
  assert.equal(checkPush(l, 'S.note', { ours: BLANK, remoteMd5: BLANK, replace: false }).ok, true);
});

test('a notebook pulled with ink and now missing from the cloud is refused', () => {
  const l = recordPull(fresh(), 'S.note', { md5: INKED, size: 1, folder: 'F', local: 'x', at: '2026-09-01T10:00' });
  const r = checkPush(l, 'S.note', { ours: BLANK, remoteMd5: undefined, replace: false });
  assert.equal(r.ok, false);
  assert.match(r.message, /missing from the cloud/);
  assert.equal(checkPush(l, 'S.note', { ours: BLANK, remoteMd5: undefined, replace: false, acceptLoss: true }).ok, true);
});

test('restoring the pulled copy itself is not an alarm', () => {
  const l = recordPull(fresh(), 'S.note', { md5: INKED, size: 1, folder: 'F', local: 'x', at: '2026-09-01T10:00' });
  assert.equal(checkPush(l, 'S.note', { ours: INKED, remoteMd5: undefined, replace: false }).ok, true);
});

test('--replace on a never-pulled notebook is refused', () => {
  const r = checkPush(fresh(), 'S.note', { ours: BLANK, remoteMd5: INKED, replace: true });
  assert.equal(r.ok, false);
  assert.match(r.message, /never been pulled/);
});

test('--replace carries the last-pulled md5 as the compare-and-swap', () => {
  const l = recordPull(fresh(), 'S.note', { md5: INKED.toUpperCase(), size: 1, folder: 'F', local: 'x' });
  assert.deepEqual(checkPush(l, 'S.note', { ours: BLANK, remoteMd5: INKED, replace: true }),
    { ok: true, expectRemoteMd5: INKED });
});

test('a first upload of a new sheet is untouched by the guard', () => {
  assert.deepEqual(checkPush(fresh(), 'New.note', { ours: BLANK, remoteMd5: undefined, replace: false }), { ok: true });
});

test('a rename moves the row with the file', () => {
  const l = recordPull(fresh(), 'Old.note', { md5: INKED, size: 1, folder: 'F', local: 'x' });
  recordRename(l, 'Old.note', 'New.note');
  assert.equal(l.notes['Old.note'], undefined);
  assert.equal(latestKnown(l, 'New.note').md5, INKED);
});

test('save/load round-trips, and a damaged ledger refuses rather than reading as empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  const path = join(dir, 'l.json');
  const l = recordPush(fresh(), 'S.note', { md5: BLANK, folder: 'F', at: 't' });
  saveLedger(l, path);
  assert.deepEqual(loadLedger(path), l);
  writeFileSync(path, '{"notes": 3}');
  assert.throws(() => loadLedger(path), /refusing to guess/);
  assert.deepEqual(loadLedger(join(dir, 'absent.json')), fresh());
});
