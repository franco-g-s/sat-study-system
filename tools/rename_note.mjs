// Rename a sheet already on Supernote Cloud, in place.
//   node tools/rename_note.mjs "Note/SAT/Math/Sweeps" "Old Name.note" "New Name.note" [--dry-run]
//
// Why this exists: `/file/upload/apply` deduplicates by md5 across the whole account,
// and DELETING A FILE DOES NOT RELEASE ITS HASH. So the intuitive correction for a
// mis-named sheet -- delete it, push it again under the right name -- fails at the
// second step, after the first step has already destroyed the handwriting. Renaming
// never touches the bytes, so it has no such failure mode.
//
// The `/file/rename` endpoint is read out of a public Supernote Cloud client
// (raaneem/supernote-cloud-sync), not out of any published specification, and had not
// been called against a real account when this tool was written -- the first real run is
// its verification. Start with --dry-run.
import { X, SUPERNOTE_SESSION } from './config.mjs';
import { cli } from './cli.mjs';
import { loadLedger, saveLedger, recordRename } from './ledger.mjs';
// Parsed before anything else runs: a typo'd `--dryrun` used to be ignored,
// which made a dry run a real rename.
const USAGE = 'usage: node tools/rename_note.mjs "Note/SAT/Math/Sweeps" "Old.note" "New.note" [--dry-run]';
const args = cli(USAGE, { bools: ['dry-run'] });
const { createCloudClient } = await import(`${X}/deliver/supernote/cloud.js`);
const { loadSession } = await import(`${X}/deliver/supernote/session.js`);

const [remoteDir, oldName, newName] = args.positional;
if (!remoteDir || !oldName || !newName || args.positional.length > 3) {
  console.error(USAGE);
  process.exit(2);
}
if (oldName === newName) { console.error('old and new name are the same'); process.exit(2); }

const session = loadSession(SUPERNOTE_SESSION);
if (!session) { console.error('No Supernote session. Run `xiehanzi login` in your xiehanzi checkout (see docs/setup.md).'); process.exit(1); }

const cloud = createCloudClient({ account: session.account, password: '' });
cloud.useToken(session.token);

// resolveDirectory, never ensureDirectory: renaming into a folder that does not exist is
// a typo in the argument, not an instruction to create one.
const directoryId = await cloud.resolveDirectory(remoteDir);
if (directoryId === undefined) { console.error(`no such folder: ${remoteDir}`); process.exit(2); }

const entry = await cloud.findEntry(directoryId, oldName);
if (entry === undefined) { console.error(`not in ${remoteDir}: ${oldName}`); process.exit(2); }

// A rename onto an occupied name is the one way this could destroy something, so it is
// refused rather than attempted and reported.
const occupied = await cloud.findEntry(directoryId, newName);
if (occupied !== undefined) {
  console.error(`${newName} already exists in ${remoteDir} (md5 ${occupied.md5}). Refusing.`);
  process.exit(2);
}

if (args.has('dry-run')) {
  console.log(`WOULD RENAME  ${remoteDir}/${oldName}`);
  console.log(`          ->  ${newName}   (id ${entry.id}, md5 ${entry.md5}, ${entry.size} bytes)`);
  process.exit(0);
}

await cloud.renameEntry(entry, newName);

// Verify by reading it back. The API answers success on a call that changed nothing more
// readily than it fails, and a rename nobody checked is how the wrong name survives.
const after = await cloud.findEntry(directoryId, newName);
if (after === undefined) {
  console.error(`rename reported success but ${newName} is not in ${remoteDir}. Nothing was deleted; the file should still be under ${oldName}.`);
  process.exit(1);
}
// The push guard keys on the name, so its record has to follow the file.
saveLedger(recordRename(loadLedger(), oldName, newName));
console.log(`RENAMED  ${remoteDir}/${oldName}  ->  ${newName}`);
