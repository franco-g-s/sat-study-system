// What this machine last did with each notebook on the Supernote Cloud: the md5 it
// last PULLED (the handwriting) and the md5 it last PUSHED (a blank or a carried
// rebuild). Keyed by remote FILE NAME, not folder -- names carry the kind and are
// unique across the SAT folders, and an earlier folder reorganisation would have
// orphaned every folder-keyed row.
//
// Why it exists: push_note.mjs used to decide "has this been written on?" by
// comparing against the REMOTE, and once the remote reverted to the blank (sheet
// R01 lost its handwriting from the cloud) the comparison said UNCHANGED and the guard failed open, silently.
// The record of a pull survives the thing it guards against, so the guard now asks
// it instead.
//
// Pure functions over a plain object, plus load/save. Tested in ledger.test.mjs.
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const LEDGER_PATH = join(ROOT, 'state', 'supernote_ledger.json');

export const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');

export function loadLedger(path = LEDGER_PATH) {
  if (!existsSync(path)) return { version: 1, notes: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed?.version !== 1 || typeof parsed.notes !== 'object') {
    // A damaged ledger must stop a push, not be treated as empty: empty means "never
    // pulled", which is exactly the fail-open this file exists to close.
    throw new Error(`${path} is not a v1 supernote ledger; refusing to guess`);
  }
  return parsed;
}

export function saveLedger(ledger, path = LEDGER_PATH) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(tmp, path);
}

export function recordPull(ledger, fileName, { md5, size, folder, local, at = new Date().toISOString() }) {
  const row = (ledger.notes[fileName] ??= {});
  row.pull = { md5: md5.toLowerCase(), size, folder, local, at };
  return ledger;
}

export function recordPush(ledger, fileName, { md5, folder, at = new Date().toISOString() }) {
  const row = (ledger.notes[fileName] ??= {});
  row.push = { md5: md5.toLowerCase(), folder, at };
  return ledger;
}

export function recordRename(ledger, oldName, newName) {
  if (ledger.notes[oldName] === undefined) return ledger;
  ledger.notes[newName] = ledger.notes[oldName];
  delete ledger.notes[oldName];
  return ledger;
}

/** The most recent thing we know the cloud held under this name, or undefined. */
export function latestKnown(ledger, fileName) {
  const row = ledger.notes[fileName];
  if (row === undefined) return undefined;
  const { pull, push } = row;
  if (pull && push) return pull.at >= push.at ? { kind: 'pull', ...pull } : { kind: 'push', ...push };
  if (pull) return { kind: 'pull', ...pull };
  if (push) return { kind: 'push', ...push };
  return undefined;
}

/**
 * The guard's decision, before anything is uploaded.
 *
 *   ours       md5 of the bytes about to be pushed
 *   remoteMd5  md5 of what is on the cloud under this name, or undefined if nothing is
 *   replace    --replace was given
 *
 * Returns { ok: true, expectRemoteMd5? } or { ok: false, code, message }.
 */
export function checkPush(ledger, fileName, { ours, remoteMd5, replace, acceptLoss = false }) {
  const known = latestKnown(ledger, fileName);
  const inked = known?.kind === 'pull' && known.md5 !== ours.toLowerCase();
  const where = known?.local ? ` A copy is at ${known.local}.` : '';

  if (remoteMd5 !== undefined && remoteMd5.toLowerCase() === ours.toLowerCase() && inked) {
    return {
      ok: false, code: 4,
      message:
        `${fileName} on the cloud is byte-identical to this sheet, but it was pulled on ` +
        `${known.at.slice(0, 16)} carrying different bytes (md5 ${known.md5}). ` +
        `The handwriting has gone from the cloud; nothing was pushed.${where}` +
        (known.backfilled ? ' (Ledger row backfilled from out/pulled/ on 2026-09-28: if this ' +
          'sheet was --replace-d after that pull, the alarm is stale -- record a pull to clear it.)' : ''),
    };
  }
  if (remoteMd5 === undefined && inked && !acceptLoss) {
    return {
      ok: false, code: 4,
      message:
        `${fileName} is missing from the cloud, but it was pulled on ${known.at.slice(0, 16)} ` +
        `carrying handwriting (md5 ${known.md5}). Something removed it; nothing was pushed.${where} ` +
        'Check the cloud recycle bin. Pass --accept-loss to upload this sheet anyway.',
    };
  }
  if (replace && remoteMd5 !== undefined && remoteMd5.toLowerCase() !== ours.toLowerCase()) {
    if (known === undefined) {
      return {
        ok: false, code: 2,
        message:
          `${fileName} has never been pulled on this machine, so there is no copy of what ` +
          '--replace would overwrite and nothing to carry its ink from. Pull it first ' +
          '(tools/pull_note.mjs), rebuild from that copy, then replace.',
      };
    }
    return { ok: true, expectRemoteMd5: known.md5 };
  }
  return { ok: true };
}
