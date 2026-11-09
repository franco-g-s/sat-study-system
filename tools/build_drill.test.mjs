// Tests for the drill's markdown emission.
//
// build_drill.mjs writes a target sheet; build_note.mjs renders it. Testing the
// markdown rather than the .note is deliberate -- the rendering path is already
// exercised by every remediation sheet, and the part that is new here is which
// questions end up in the marker and what the frontmatter records about why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drillMarkdown, drillStem, drillBasename } from './build_drill.mjs';

const pick = (over = {}) => ({
  qid: 'aaaa1111', typeKey: 'Skill A :: type a', skill: 'Skill A',
  tier: 3, daysStale: 14, reuse: false, ...over,
});

test('every pick lands in one QUESTIONS marker, in sheet order', () => {
  const md = drillMarkdown({
    id: 'DR01',
    date: '2026-09-12',
    picks: [
      pick({ qid: 'aaaa1111' }),
      pick({ qid: 'bbbb2222', typeKey: 'Skill B :: type b', skill: 'Skill B' }),
      pick({ qid: 'cccc3333', typeKey: 'Skill C :: type c', skill: 'Skill C' }),
    ],
    shortfalls: [],
    relaxed: [],
  });

  const markers = [...md.matchAll(/<!-- QUESTIONS: ([^>]+?) -->/g)].map((m) => m[1]);
  assert.equal(markers.length, 1, 'one set, so the drill numbering runs 1..n');
  assert.equal(markers[0], 'label=Drill, aaaa1111, bbbb2222, cccc3333');
});

test('the frontmatter records why each question is there', () => {
  // Reviewing RS01 meant re-deriving every earlier baseline by hand because the
  // sheet did not carry its own intent. This is that fix: the review reads why
  // a question was picked instead of reconstructing it.
  const md = drillMarkdown({
    id: 'DR01', date: '2026-09-12',
    picks: [
      pick({ qid: 'aaaa1111', tier: 1, daysStale: 13, reuse: true }),
      pick({ qid: 'bbbb2222', typeKey: 'Skill B :: type b', skill: 'Skill B', tier: 3, daysStale: 29 }),
    ],
    shortfalls: [], relaxed: [],
  });

  assert.match(md, /^---\n/, 'must open with frontmatter');
  assert.match(md, /^kind: drill$/m);
  assert.match(md, /^id: DR01$/m);
  assert.match(md, /- qid: aaaa1111\n {4}type: Skill A :: type a\n {4}tier: 1\n {4}days_stale: 13\n {4}reuse: true$/m);
  assert.match(md, /- qid: bbbb2222\n {4}type: Skill B :: type b\n {4}tier: 3\n {4}days_stale: 29\n {4}reuse: false$/m);
});

test('a shortfall is written into the sheet, not dropped', () => {
  const md = drillMarkdown({
    id: 'DR01', date: '2026-09-12',
    picks: [pick()],
    shortfalls: [{ typeKey: 'Skill Z :: vieta', wanted: 2, got: 1, reason: 'pool exhausted' }],
    relaxed: [],
  });
  assert.match(md, /shortfalls:/);
  assert.match(md, /Skill Z :: vieta wanted 2 got 1 \(pool exhausted\)/);
});

test('a relaxed ordering constraint is written into the sheet', () => {
  // If the sheet broke its own five-apart rule, the seconds on the questions
  // either side are not comparable and the review has to know.
  const md = drillMarkdown({
    id: 'DR01', date: '2026-09-12',
    picks: [pick()], shortfalls: [],
    relaxed: [{ at: 7, constraint: 'type gap' }],
  });
  assert.match(md, /relaxed:/);
  assert.match(md, /position 7: type gap/);
});

test('the sheet ends with a stop page and no trailing question', () => {
  const md = drillMarkdown({
    id: 'DR01', date: '2026-09-12', picks: [pick()], shortfalls: [], relaxed: [],
  });
  const pages = md.split('<!-- PAGE -->');
  assert.ok(pages.length >= 3, 'cover, questions, stop');
  assert.match(pages.at(-1), /## Stop here/);
});

test('the used-questions stem matches the filename build_note.mjs saves under', () => {
  // Found by rebuilding DR01: 1 of 20 questions overlapped with the sheet
  // already on disk. build_drill.mjs excluded stem "DR01-drill" while
  // build_note.mjs saves under the markdown basename, "DR01-2026-09-12", so a
  // rebuild treated the sheet's OWN twenty questions as spoken for by another
  // sheet and picked nineteen different ones. push_note.mjs compares checksums
  // to tell an untouched notebook from a written-on one, so a rebuild that
  // silently changes its contents defeats the safety check.
  assert.equal(drillStem('DR01', '2026-09-12'), 'DR01-2026-09-12');
  assert.equal(drillStem('DR01', '2026-09-12'), drillBasename('DR01', '2026-09-12'));
});

test('--dry writes nothing at all', async (t) => {
  // Borrowed from the MX (mixed-set) suite. --dry short-circuits before writeFileSync,
  // but nothing enforced that, and the failure would be silent and slow: a
  // --dry run that consumed bank questions would only surface weeks later as a
  // sheet that could not fill itself. Asserting on bytes rather than on the
  // code path, because the code path is the thing that might change.
  const { execFileSync } = await import('node:child_process');
  const { readFileSync, readdirSync } = await import('node:fs');
  const root = new URL('..', import.meta.url).pathname;

  const usedBefore = readFileSync(`${root}state/used_questions.json`);
  const stateBefore = readFileSync(`${root}state/types.json`);
  const targetsBefore = readdirSync(`${root}content/targets`).sort();

  try {
    execFileSync(process.execPath, [
      `${root}tools/build_drill.mjs`, '--dry', '--n', '16', '--date', '2026-09-12',
    ], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    if (/nothing to drill/.test(String(e.stderr))) {
      t.skip('no drillable types in state/types.json yet (a fresh install)');
      return;
    }
    throw e;
  }

  assert.ok(usedBefore.equals(readFileSync(`${root}state/used_questions.json`)), 'used_questions.json changed');
  assert.ok(stateBefore.equals(readFileSync(`${root}state/types.json`)), 'types.json changed');
  assert.deepEqual(readdirSync(`${root}content/targets`).sort(), targetsBefore, 'a target file appeared');
});
