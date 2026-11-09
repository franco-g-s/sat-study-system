// Tests for the timed mixed set.
//
// These drive the CLI rather than importing its internals, which is the opposite
// of drill_select.test.mjs and deliberate. build_mixed.mjs is a script, not a
// module: its selection logic (`apportion`, `difficultyPlan`, `drawSection`) is
// declared at top level and runs on import. Extracting it into a module would be
// the cleaner seam and is worth doing one day -- but it means refactoring a
// generator that was shipped hours ago and is about to build a real sheet, and a
// test suite is not worth destabilising the thing it exists to protect.
//
// `--dry` makes this safe and cheap. It prints the whole plan and then
// `process.exit(0)` BEFORE buildNote() and saveUsed(), so no page is rendered
// and state/used_questions.json is never written. If that ordering ever changes,
// these tests start mutating real state -- the last test in this file pins it.
//
// Everything here runs against the REAL data files. That is the point: the one
// bug this generator actually shipped with (difficultyPlan assuming all three
// difficulties existed) was invisible to reasoning and turned up only on a real
// run with an odd flag. Fixtures small enough to reason about are fixtures small
// enough to share your wrong assumption.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'build_mixed.mjs');

/** Run the generator in dry mode and parse its plan back out. */
const plan = (...args) => {
  const out = execFileSync('node', [SCRIPT, ...args, '--dry'], { encoding: 'utf8' });
  const rows = [];
  for (const line of out.split('\n')) {
    // "  R&W    1/11  d5235d39  Craft and Structure            Easy"
    const m = /^ {2}(R&W|Maths)\s+(\d+)\/(\d+)\s+(\S+)\s+(.*?)\s+(Easy|Medium|Hard)\s*$/.exec(line);
    if (m) rows.push({ section: m[1], n: +m[2], of: +m[3], qid: m[4], group: m[5].trim(), difficulty: m[6] });
  }
  const clock = {};
  for (const m of out.matchAll(/^(R&W|Maths):\s+(\d+) questions\s+(\d+) min/gm)) {
    clock[m[1]] = { questions: +m[2], minutes: +m[3] };
  }
  return { out, rows, clock, rw: rows.filter(r => r.section === 'R&W'), maths: rows.filter(r => r.section === 'Maths') };
};

const DOMAIN_ORDER = [
  'Craft and Structure',
  'Information and Ideas',
  'Standard English Conventions',
  'Expression of Ideas',
];
const RANK = { Easy: 0, Medium: 1, Hard: 2 };

// ---- shape -----------------------------------------------------------------

test('n=20 draws exactly 20, split 11 R&W to 9 maths', () => {
  const p = plan('--n', '20');
  assert.equal(p.rows.length, 20);
  assert.equal(p.rw.length, 11);
  assert.equal(p.maths.length, 9);
});

test('R&W comes before maths, and numbering restarts per section', () => {
  const p = plan('--n', '20');
  const firstMaths = p.rows.findIndex(r => r.section === 'Maths');
  assert.ok(p.rows.slice(0, firstMaths).every(r => r.section === 'R&W'),
    'the sections must not interleave -- that is the whole change');
  assert.deepEqual(p.rw.map(r => r.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(p.maths.map(r => r.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(p.rw.every(r => r.of === 11) && p.maths.every(r => r.of === 9),
    'each section reports its OWN size, because its reached-box says "of <that>"');
});

// ---- the real module's order -----------------------------------------------

test('R&W runs the four domains in the real modules fixed sequence, without interleaving', () => {
  const p = plan('--n', '20');
  const seen = p.rw.map(r => DOMAIN_ORDER.indexOf(r.group));
  assert.ok(seen.every(i => i >= 0), `unknown domain in ${JSON.stringify(p.rw.map(r => r.group))}`);
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1],
      `domain order broke at R&W ${i + 1}: ${p.rw[i - 1].group} -> ${p.rw[i].group}`);
  }
});

// MUTATION-CHECKED 2026-09-12, and this pair did NOT come out clean.
//
// Three mutants were run against this suite. Reversing RW_DOMAINS reddened the
// sequence test; dealing difficulty slots greedily in bucket order instead of to
// the emptiest bucket reddened the spread test. Both load-bearing.
//
// The third -- deleting the within-bucket easy-first sort in drawSection -- left
// all 16 GREEN. The two ramp tests below cannot distinguish the sort from the
// dealing, because difficultySequence() already emits ascending labels and so
// every bucket arrives sorted. They pin the PROPERTY (each block reads
// easy-to-hard, which is what the learner sees on the page) and that is worth pinning; but
// they are not evidence that the sort works, and nobody should read them as such.
//
// No test here can separate the two without reaching past the CLI into
// difficultySequence, which is the extraction the header argues for and against.
// Saying so is better than a test that implies a guarantee it does not give.
//
// A FOURTH MUTANT, AND THE BIGGEST HOLE. Deleting the `.sort(byHash)` that orders
// each difficulty band also left all 16 green -- while visibly changing the sheet:
// the first R&W pick moved from d5235d39 to 01de46bb. So this suite cannot detect
// a change in WHICH questions are selected, only in their shape and order.
//
// An earlier review's generalisation covers why, and it is structural rather than an
// oversight: a determinism test cannot be broken by a deterministic mutant. "Same
// arguments, same sheet" holds just as well for the wrong sheet.
//
// The obvious fix is a golden master pinning the 20 qids, and it is the wrong
// one. `spokenFor()` excludes every question an earlier sheet served, so the pool
// legitimately shrinks each time a real MX ships and the golden master would go
// red on a correct change, every time. A test that cries wolf on the normal case
// gets deleted within a month, and then this hole is back AND undocumented.
//
// So: known, verified, and left open on purpose. If MX selection is ever changed
// deliberately, no test here will tell you whether you also changed it by
// accident -- diff two `--dry` runs across the change by hand, as was done to
// find this.
test('each R&W domain block starts easier than it ends', () => {
  const p = plan('--n', '20');
  for (const domain of DOMAIN_ORDER) {
    const block = p.rw.filter(r => r.group === domain).map(r => RANK[r.difficulty]);
    for (let i = 1; i < block.length; i++) {
      assert.ok(block[i] >= block[i - 1], `${domain} does not ramp: ${JSON.stringify(block)}`);
    }
  }
});

test('the easy questions are spread across domains, not bunched in the first one', () => {
  // The reason difficulty slots are dealt to the emptiest bucket. If they were
  // taken greedily in order, Craft and Structure would be all-easy and Standard
  // English Conventions all-hard, and neither would look like a real module.
  const p = plan('--n', '20');
  const easyDomains = new Set(p.rw.filter(r => r.difficulty === 'Easy').map(r => r.group));
  assert.ok(easyDomains.size >= 3,
    `easy R&W questions landed in only ${easyDomains.size} domain(s): ${[...easyDomains]}`);
});

test('maths ramps easy to hard across the whole section', () => {
  const p = plan('--n', '20');
  const seen = p.maths.map(r => RANK[r.difficulty]);
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], `maths does not ramp: ${JSON.stringify(p.maths.map(r => r.difficulty))}`);
  }
});

test('MX03 maths covers all four SAT domains instead of clustering in one', () => {
  // A single maths bucket gave MX03 six Advanced Math questions, one Algebra,
  // and no Geometry and Trigonometry. The bank contains ample unseen questions
  // in each domain; a nine-question mixed section should sample all four.
  const index = JSON.parse(readFileSync(join(HERE, '..', 'data', 'qb_index.json'), 'utf8'));
  const domainByQid = new Map(index.map(q => [q.qid, q.domain]));
  const domains = plan('--n', '20', '--series', '3').maths.map(q => domainByQid.get(q.qid));
  assert.deepEqual(new Set(domains), new Set([
    'Algebra', 'Advanced Math', 'Problem-Solving and Data Analysis',
    'Geometry and Trigonometry',
  ]));
  assert.ok(Math.max(...[...new Set(domains)].map(d => domains.filter(x => x === d).length)) <= 4);
});

// ---- difficulty mix --------------------------------------------------------

test('easy is 25% of the sheet, three in R&W and two in maths', () => {
  const p = plan('--n', '20');
  assert.equal(p.rows.filter(r => r.difficulty === 'Easy').length, 5);
  assert.equal(p.rw.filter(r => r.difficulty === 'Easy').length, 3);
  assert.equal(p.maths.filter(r => r.difficulty === 'Easy').length, 2);
});

test('--easy-share moves the easy count', () => {
  assert.equal(plan('--n', '20', '--easy-share', '0').rows.filter(r => r.difficulty === 'Easy').length, 0);
  assert.ok(plan('--n', '20', '--easy-share', '0.5').rows.filter(r => r.difficulty === 'Easy').length > 5);
});

// ---- clocks ----------------------------------------------------------------

test('section clocks come from the real per-question rates, not a round number', () => {
  const p = plan('--n', '20');
  // 11 x 71.1s = 13.0 min, 9 x 95.5s = 14.3 min
  assert.deepEqual(p.clock['R&W'], { questions: 11, minutes: 13 });
  assert.deepEqual(p.clock.Maths, { questions: 9, minutes: 14 });
});

test('--math-only --n 22 reproduces the real Module 2 allocation exactly', () => {
  const p = plan('--n', '22', '--math-only');
  assert.equal(p.rows.length, 22);
  assert.equal(p.rw.length, 0, 'a maths-only sheet must draw no R&W');
  assert.deepEqual(p.clock.Maths, { questions: 22, minutes: 35 });
});

// ---- the bug this file exists for ------------------------------------------

test('a restricted --difficulty still draws the full n', () => {
  // REGRESSION. difficultyPlan assumed Easy/Medium/Hard all existed, so
  // `--difficulty Hard --n 8` planned one question per section, drew one, and
  // printed "ASKED FOR 8, POOL IS SHORT" -- blaming the bank for a plan that had
  // never asked for more. A wrong number carrying a plausible explanation is the
  // worst shape a bug takes here, because it reads as a finding.
  for (const diff of ['Hard', 'Easy', 'Medium', 'Easy,Medium', 'Medium,Hard']) {
    const p = plan('--n', '8', '--difficulty', diff);
    assert.equal(p.rows.length, 8, `--difficulty ${diff} drew ${p.rows.length} of 8`);
    assert.ok(!p.out.includes('POOL IS SHORT'), `--difficulty ${diff} falsely reported a short pool`);
    const allowed = new Set(diff.split(','));
    assert.ok(p.rows.every(r => allowed.has(r.difficulty)),
      `--difficulty ${diff} served a difficulty it was not asked for`);
  }
});

// ---- apportionment at awkward sizes ----------------------------------------

test('every size draws exactly n, with nothing substituted and no false shortfall', () => {
  // Largest-remainder apportionment has to round somewhere, twice over -- across
  // four domains and across three difficulty tiers. These are the sizes where
  // the two roundings can disagree.
  for (const n of [4, 5, 6, 7, 9, 10, 11, 13, 14, 17, 20, 22, 27]) {
    const p = plan('--n', String(n));
    assert.equal(p.rows.length, n, `--n ${n} drew ${p.rows.length}`);
    assert.ok(!p.out.includes('SUBSTITUTED'), `--n ${n} substituted a difficulty:\n${p.out}`);
    assert.ok(!p.out.includes('POOL IS SHORT'), `--n ${n} reported a short pool`);
  }
});

test('no sheet repeats a question, and none reuses one MX01 already served', async () => {
  const { readFileSync } = await import('node:fs');
  const used = JSON.parse(readFileSync(join(HERE, '..', 'state', 'used_questions.json'), 'utf8'));
  const spoken = new Set(Object.values(used).flat());
  const p = plan('--n', '20');
  const qids = p.rows.map(r => r.qid);
  assert.equal(new Set(qids).size, qids.length, 'a question appears twice on one sheet');
  for (const qid of qids) {
    assert.ok(!spoken.has(qid), `${qid} was already served by an earlier sheet`);
  }
});

// ---- reproducibility and safety --------------------------------------------

test('the same arguments always build the same sheet', () => {
  assert.deepEqual(plan('--n', '20').rows, plan('--n', '20').rows);
});

test('--series rejects zero rather than building MX00', () => {
  assert.throws(() => plan('--n', '20', '--series', '0'), /status 1|Command failed/);
});

test('--dry writes nothing: state is byte-identical after a run', async () => {
  // The safety property every other test in this file rests on. If --dry ever
  // stops short-circuiting before saveUsed(), this suite would start consuming
  // real questions from the bank every time it ran -- silently, and only
  // visible weeks later as a sheet that could not fill itself.
  const { readFileSync } = await import('node:fs');
  const path = join(HERE, '..', 'state', 'used_questions.json');
  const before = readFileSync(path);
  plan('--n', '20');
  plan('--n', '22', '--math-only');
  assert.ok(before.equals(readFileSync(path)), '--dry mutated state/used_questions.json');
});
