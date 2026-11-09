// Pull a notebook back from Supernote Cloud, so the handwriting on it can be looked at.
//
//   node tools/pull_note.mjs "Note/SAT/Math/Sweeps" ["Remote Name.note"] [--out DIR]
//   node tools/pull_note.mjs --list "Note/SAT"
//
// Folders: Math/Sweeps · Math/Remediation · Math/Re-sweeps ·
// English. push_note.mjs routes by filename; this end still takes a path, because
// pulling is always "the thing I just wrote on" and you know which that was.
//
// This is the return leg of the loop. Push sends a blank sheet; you write on it;
// this brings it back. Nothing here writes to the cloud -- a pull cannot destroy
// handwriting, which is the failure that matters in this direction.
import { ROOT, X, SUPERNOTE_SESSION } from './config.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadLedger, saveLedger, recordPull, md5 } from './ledger.mjs';
const { createCloudClient } = await import(`${X}/deliver/supernote/cloud.js`);
const { loadSession } = await import(`${X}/deliver/supernote/session.js`);

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const positional = args.filter(a => !a.startsWith('--'));
const listOnly = args.includes('--list');
const remoteDir = positional[0];
const wanted = positional[1];
const outDir = flag('out', join(ROOT, 'out', 'pulled'));
if (!remoteDir) { console.error('usage: pull_note.mjs <remote dir> [file.note] [--out DIR] [--list]'); process.exit(2); }

const session = loadSession(SUPERNOTE_SESSION);
if (!session) { console.error('No Supernote session. Run `xiehanzi login` in your xiehanzi checkout (see docs/setup.md).'); process.exit(1); }
const cloud = createCloudClient({ account: session.account, password: '' });
cloud.useToken(session.token);

// resolveDirectory, not ensureDirectory: a typo in the path should report a
// missing folder, not create one on the device.
const dirId = await cloud.resolveDirectory(remoteDir);
if (!dirId) { console.error(`no such remote folder: ${remoteDir}`); process.exit(1); }
const entries = await cloud.listDirectory(dirId);

if (listOnly || !wanted) {
  for (const e of entries) {
    const when = new Date(e.updateTime).toISOString().slice(0, 16).replace('T', ' ');
    console.log(`${e.isFolder ? 'dir ' : '    '}${String(e.size).padStart(9)}  ${when}  ${e.fileName}`);
  }
  process.exit(0);
}

const entry = entries.find(e => e.fileName === wanted);
if (!entry) {
  console.error(`not in ${remoteDir}: ${wanted}\nthere: ${entries.map(e => e.fileName).join(', ')}`);
  process.exit(1);
}
const bytes = await cloud.downloadFile(entry);   // verifies the cloud's own checksum
mkdirSync(outDir, { recursive: true });
const out = join(outDir, entry.fileName);
writeFileSync(out, bytes);
// The record push_note.mjs guards on: "this name came back carrying these bytes".
// It is what survives if the cloud copy later reverts to the blank.
saveLedger(recordPull(loadLedger(), entry.fileName, {
  md5: md5(bytes), size: bytes.length, folder: remoteDir, local: out,
}));
console.log(`${out}  ${(bytes.length / 1024).toFixed(0)} KB  updated ${new Date(entry.updateTime).toISOString()}`);
