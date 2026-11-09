// Push a built .note to Supernote Cloud, reusing xiehanzi's client and session token.
//   node tools/push_note.mjs out/X.note ["Note/SAT/Math/Sweeps"] ["Remote Name.note"] [--replace] [--dry-run]
//
// The remote folder is OPTIONAL, and leaving it out is the normal case. Sheets are
// filed by kind -- sweeps, remediation and re-sweeps into their own folders -- and
// the kind is already in the name, so routing it by hand is a decision with one
// right answer, which is the kind this repo exists to remove. Pass a folder only to
// override the route.
import { X, SUPERNOTE_SESSION, REPLACED_DIR } from './config.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cli } from './cli.mjs';
import { loadLedger, saveLedger, recordPush, checkPush, md5 } from './ledger.mjs';

// Parsed before anything else runs. Flags used to be matched with
// includes(), so a typo -- `--dryrun`, `--dry_run` -- was silently ignored and
// the "dry run" really uploaded. An unknown flag is now refused, and --help
// prints this and exits without touching the cloud.
const USAGE = `usage: node tools/push_note.mjs <file.note> ["Note/SAT/..."] ["Remote Name.note"] [--dry-run] [--replace]

  --dry-run   say what would happen; upload nothing
  --replace   overwrite a same-named remote file. Only allowed once the
              notebook has been pulled here, and only if the cloud still holds
              exactly the version last pulled or pushed -- so the ink you
              carried is all the ink there is. The old file is copied to
              SAT_REPLACED_DIR (default out/replaced/)
              before anything changes.
  --accept-loss  push even though a notebook pulled WITH handwriting is now
              missing from the cloud (read the refusal first).`;
const args = cli(USAGE, { bools: ['dry-run', 'replace', 'accept-loss'] });
const { createCloudClient } = await import(`${X}/deliver/supernote/cloud.js`);
const { pushNote, asideName } = await import(`${X}/deliver/supernote/push.js`);
// dist/ is gitignored and built per machine. A dist older than xiehanzi@d59e448 would
// silently ignore keepCopy and expectRemoteMd5 and run the old delete-before-rename
// --replace -- so refuse to run against it rather than trust it.
if (typeof asideName !== 'function') {
  console.error('xiehanzi dist is stale (predates the safe --replace). Run `npm run build` in your xiehanzi checkout. Nothing was pushed.');
  process.exit(1);
}
const { loadSession } = await import(`${X}/deliver/supernote/session.js`);

// Filename -> folder. Read from the remote name if one was given, otherwise the
// local one; both carry the kind. Fails LOUDLY rather than defaulting, because a
// sheet quietly filed in the wrong folder is exactly the silent-success failure
// the crop bugs taught this repo to distrust.
const ROUTES = [
  // A timed mixed set spans BOTH sections, so it cannot live under Math, and it
  // is a miniature test rather than a diagnosis -- one clock, test conditions,
  // output is questions reached. Practice Tests is where that already belongs.
  // MX01, MX02... The series number came in on 2026-09-11; `MX-` with no
  // number is the pre-numbering form and still routes, so the one sheet built
  // under the old stem keeps working.
  [/^MX\d*[-\s_]/i,             'Note/SAT/Practice Tests'],
  // Desmos speed drills. Maths-only but not a sweep, a remediation or a
  // re-sweep -- the output is seconds on a technique, not a diagnosis. The
  // folder did not exist and the upload created it, on 2026-09-10.
  [/^DS[-\s_]/i,                'Note/SAT/Math/Drills'],
  [/(^|[^a-z])sweep\b/i,        'Note/SAT/Math/Sweeps'],
  [/^SW[-\s_]?\d*/i,            'Note/SAT/Math/Sweeps'],
  [/re-?sweep/i,                'Note/SAT/Math/Re-sweeps'],
  [/remediation/i,              'Note/SAT/Math/Remediation'],
  [/^R\d/i,                     'Note/SAT/Math/Remediation'],
  [/^(RW|EN)[-\s_]/i,           'Note/SAT/English'],
];
function routeFor(name) {
  // Re-sweep first: "SW-circles-re-sweep" matches the sweep patterns too, and the
  // more specific kind has to win or every re-sweep lands with the sweeps.
  if (/re-?sweep/i.test(name)) return 'Note/SAT/Math/Re-sweeps';
  for (const [re, dir] of ROUTES) if (re.test(name)) return dir;
  return undefined;
}

const [file, ...rest] = args.positional;
if (!file || rest.length > 2) {
  console.error(USAGE);
  process.exit(2);
}
// A second positional starting with "Note/" is a folder; anything else is the
// remote filename. That keeps the old two-argument form working unchanged.
const explicitDir = rest.find(a => a.startsWith('Note/'));
const maybeName = rest.find(a => !a.startsWith('Note/'));
const fileName = maybeName ?? basename(file);

const remoteDir = explicitDir ?? routeFor(fileName) ?? routeFor(basename(file));
if (!remoteDir) {
  console.error(
    `cannot route "${fileName}" to a folder, and none was given.\n` +
    `Name it so the kind is visible (… — sweep / … — remediation / … — re-sweep),\n` +
    `or pass the folder explicitly as the second argument.`
  );
  process.exit(2);
}
if (!explicitDir) console.log(`routed to ${remoteDir}`);

const session = loadSession(SUPERNOTE_SESSION);
if (!session) { console.error('No Supernote session. Run `xiehanzi login` in your xiehanzi checkout (see docs/setup.md).'); process.exit(1); }

const cloud = createCloudClient({ account: session.account, password: '' });
cloud.useToken(session.token);

const bytes = readFileSync(file);
const ours = md5(bytes);
const dryRun = args.has('dry-run');
const replace = args.has('replace');

// The guard, asked of the LEDGER rather than of the remote: a remote that has already
// reverted to the blank compares equal and used to report UNCHANGED (R01). Read-only
// lookups only -- resolveDirectory, never ensureDirectory.
const ledger = loadLedger();
const dirId = await cloud.resolveDirectory(remoteDir);
const remote = dirId === undefined ? undefined : await cloud.findEntry(dirId, fileName);
const verdict = checkPush(ledger, fileName, {
  ours, remoteMd5: remote?.md5, replace, acceptLoss: args.has('accept-loss'),
});
if (!verdict.ok) {
  console.error(`REFUSED  ${remoteDir}/${fileName}`);
  console.error(verdict.message);
  process.exit(verdict.code);
}

// A replacement keeps the file it overwrites, before the cloud changes, in REPLACED_DIR
// (see config.mjs) -- ideally a folder you back up or commit regularly.
const keepCopy = (entry, previous) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(REPLACED_DIR, { recursive: true });
  const kept = join(REPLACED_DIR, `${stamp} ${entry.fileName}`);
  writeFileSync(kept, previous);
  console.log(`kept the previous copy: ${kept}`);
};

let res;
try {
  res = await pushNote(cloud, remoteDir, fileName, bytes, {
    replace,
    dryRun,
    ...(replace ? { keepCopy } : {}),
    ...(verdict.expectRemoteMd5 ? { expectRemoteMd5: verdict.expectRemoteMd5 } : {}),
  });
} catch (error) {
  // The cloud deduplicates uploads by md5 across the whole account, and deleting a file
  // does NOT release its hash. So these exact bytes have been uploaded before, under
  // some name, and no upload will ever put them up again. The raw error says "no need to
  // upload!", which reads like success and tells nobody what to do next.
  const message = String(error?.message ?? error);
  if (/identical md5/i.test(message)) {
    console.error(`${message}
`);
    console.error('These bytes are already on the cloud under a different name. The upload');
    console.error('cannot succeed and re-building will not help: builds are deterministic.');
    console.error('');
    console.error('  - to correct the NAME of the sheet already up there:');
    console.error(`      node tools/rename_note.mjs "${remoteDir}" "<current name>" "${fileName}" --dry-run`);
    console.error('  - to force different bytes on a sweep: rebuild with --label "<footer>"');
    console.error('    (the footer only -- the stem keys state/used_questions.json and must not move)');
    console.error('');
    console.error('  (Known limitation: the cloud dedupes by md5 account-wide, so identical bytes cannot be re-uploaded under a new name.)');
    process.exit(3);
  }
  throw error;
}
// A dry run must not print what a real run prints.
//
// `pushNote` returns outcome 'uploaded' on the dry-run path too, so this line
// used to say `UPLOADED  <path>/<name>` for a push that uploaded nothing. That
// is the silent-success shape this repo already distrusts, pointing the other
// way: reporting work that did not happen. The realistic cost is a script or
// assistant dry-running to check a route, reading UPLOADED, reporting the sheet
// as on the device, and the study block starting with nothing to open.
//
// Fixed at the CALLER rather than in pushNote: that function lives in
// xiehanzi, which is a different repo, and the caller already knows whether
// it asked for a dry run. Nothing here depends on what pushNote reports.
//
// A REFUSAL passes through unchanged, and that matters more than it looks: the
// commonest reason to dry-run at all is "does this name already exist without
// --replace?", so `refused` is the likeliest dry-run outcome. Dressing it up as
// `WOULD UPLOAD` would be the very lie this block exists to stop, one layer in.
//
// UNCHANGED passes through too: it used to print WOULD UPLOAD on a dry run.
const refused = res.outcome === 'refused';
const unchanged = res.outcome === 'unchanged';
const acts = !refused && !unchanged;
const outcome = (dryRun && acts)
  ? `WOULD ${res.outcome === 'replaced' ? 'REPLACE' : 'UPLOAD'}`
  : res.outcome.toUpperCase();
const prefix = (dryRun && acts) ? 'DRY RUN — ' : '';
console.log(`${prefix}${outcome}  ${res.remotePath}/${res.fileName}`);
if (res.reason) console.log(res.reason);
if (res.leftover) console.log(`The previous version is still on the cloud as ${res.leftover}; delete it by hand.`);
// Only say this when something WOULD have happened. Telling the user to re-run
// without --dry-run after a refusal is advice to repeat a failure.
if (dryRun && acts) {
  console.log('Nothing was uploaded. Re-run without --dry-run to push.');
}
if (!dryRun && acts) saveLedger(recordPush(ledger, fileName, { md5: ours, folder: remoteDir }));
process.exit(refused ? 2 : 0);
