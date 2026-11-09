// Has the bank's `text` been normalised, and is the stamp still valid?
//
// `tools/fix_split_words.py` rejoins words the PDF extraction split in half
// ("cer tain" -> "certain"). Skipping it does not error and does not break a
// build -- the corpus just quietly starts lying to every text search again,
// which is how the defect got a month of cover the first time.
//
// So the step does not depend on anyone remembering it. The stamp is a digest
// of every `text` field, in row order, which means re-extracting a bank PDF by
// ANY route invalidates it rather than leaving a sidecar that still says
// "normalised".
//
// Must agree byte-for-byte with text_digest() in fix_split_words.py:
// newline-joined, UTF-8, sha256. Verified equal across both languages.
//
// PASS THE RAW INDEX, NOT A FILTERED VIEW. The stamp covers the file as written,
// so hashing a subset never matches -- `bankIndex` is filtered to 1,833 of
// 1,925 (leaked and crop-less rows dropped) and digests to e5d329b3 against a
// stamped fb302945. A guard fed the filtered rows would fire on every build
// forever, and the obvious fix for a guard that always fires is to delete it.
// checkStamp cannot tell a filtered view from a stale index by digest alone,
// so it checks the row count first and says which one it is.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

export const STAMP_PATH = 'data/text_normalised.json';

export const textDigest = (rows) =>
  createHash('sha256').update(rows.map(r => r.text ?? '').join('\n'), 'utf8').digest('hex');

/**
 * Returns {ok, reason}. Never throws -- the caller decides how loud to be.
 *
 * Call it as checkStamp(root, relPath) and it reads the index itself. That is
 * the recommended form, because it removes the caller's ability to get it
 * wrong: pass no rows, pass no filtered view, get no misdiagnosis.
 *
 * Passing `rows` is still supported for callers that already parsed the file,
 * but it reintroduces a gap this cannot close -- a genuine re-extraction that
 * ALSO changes the row count is indistinguishable from a filtered view by
 * count alone, so it would be reported as a caller mistake when the index is
 * genuinely stale. Reading from disk has no such ambiguity.
 */
export function checkStamp(root, relPath, rows) {
  const stampFile = `${root}/${STAMP_PATH}`;
  if (!existsSync(stampFile)) {
    return { ok: false, reason: `${STAMP_PATH} is missing entirely` };
  }
  const stamp = JSON.parse(readFileSync(stampFile, 'utf8'))[relPath];
  if (!stamp) {
    return { ok: false, reason: `${STAMP_PATH} has no entry for ${relPath}` };
  }
  // Row count first. A digest mismatch on a filtered view is indistinguishable
  // from a stale index, and diagnosing it as "the index changed" sends the
  // reader to re-run a normalisation that was never the problem.
  if (rows !== undefined && typeof stamp.rows === 'number' && rows.length !== stamp.rows) {
    return {
      ok: false,
      // ADVISORY, not a diagnosis. Deliberately named as a guess, because it
      // is one: a genuine re-extraction that also changes the row count looks
      // identical to a filtered view from here, and would carry this flag
      // while the index really is stale. Use it to phrase a message; never
      // branch on it to decide whether the index is trustworthy. The
      // two-argument form of checkStamp cannot reach this at all.
      likelyCallerMistake: true,
      reason: `${rows.length} rows were passed but the stamp covers ${stamp.rows}. ` +
              `The stamp is over the RAW index file; pass the parsed file, not a ` +
              `filtered view like bankIndex (which drops leaked and crop-less rows). ` +
              `This is a caller mistake, not a stale index.`,
    };
  }
  if (rows === undefined) {
    const indexFile = `${root}/${relPath}`;
    if (!existsSync(indexFile)) {
      // Not flagged as a guess: a missing file is a fact, not an inference.
      return { ok: false, reason: `${indexFile} does not exist` };
    }
    rows = JSON.parse(readFileSync(indexFile, 'utf8'));
  }
  const actual = textDigest(rows);
  if (actual !== stamp.text_sha256) {
    return {
      ok: false,
      reason: `${relPath} has changed since it was normalised ` +
              `(stamped ${stamp.text_sha256.slice(0, 12)}, now ${actual.slice(0, 12)})`,
    };
  }
  return { ok: true, reason: `normalised by ${stamp.tool}@${stamp.rev}` };
}

/** The message to put in front of a human, with the command that fixes it. */
export const stampError = (relPath, reason, likelyCallerMistake = false) =>
  likelyCallerMistake
    ? `${relPath} stamp check may have been called wrong: ${reason}`
    : `${relPath} is not normalised: ${reason}.\n` +
  `Words split by the PDF extraction ("cer tain" for "certain") are still in ` +
  `the text, so every marker, selector and grep over this index is silently ` +
  `under-counting. Run:\n` +
  `    python3 tools/fix_split_words.py ${relPath} --write\n` +
  `and read the proposed rejoins it prints before accepting them.`;
