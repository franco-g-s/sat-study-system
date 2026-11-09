// Build a TIMED MIXED SET -- the pacing session, not a diagnosis session.
//
//   node tools/build_mixed.mjs --n 20
//   node tools/build_mixed.mjs --n 22 --math-only        # the timed module
//   node tools/build_mixed.mjs --n 20 --dry
//
// Why this is not build_sweep.mjs with a different filter, which is what the
// plan originally assumed. Three things actually differ, and each of them
// changes the artifact rather than the selection:
//
//   1. ONE CLOCK PER SECTION, not a stopwatch per question. A sweep asks "did
//      the procedure arrive?" and needs a per-question number to answer it. This
//      asks "did you finish?", and the output is one number per section --
//      questions reached. Per-question boxes would actively damage that: you
//      would optimise each question instead of managing a budget across all of
//      them, which is the skill being rehearsed.
//   2. QUESTIONS FIRST, THEN ALL THE SOLUTIONS. A sweep interleaves because
//      checking immediately is how the diagnosis gets recorded while the attempt
//      is still fresh. Here an interleaved solution sits in the middle of
//      a timed run and breaks it.
//   3. BOTH SECTIONS, RUN AS SECTIONS. R&W first, then maths, each on its own
//      clock at the real per-question rate. The real form is 54 R&W to 44 maths
//      and the default ratio matches it.
//
// Changed after the first mixed set: until MX01 this file interleaved the two
// sections under a single clock, and argued for it: blocked practice builds the
// skill, mixed practice keeps the discrimination, and the cost of switching
// between them was the thing being rehearsed. That argument is not wrong, but it
// is an argument for a DRILL, and this sheet is supposed to be a rehearsal of the
// test. The test does not interleave. It runs a Reading and Writing module and
// then a Maths module, separately timed, and the budget to manage is a
// per-module budget. Interleaving trained a skill the test never asks for.
//
// Two consequences worth being honest about:
//
//   - MX01's single "20 of 20" is NOT comparable to the per-section numbers from
//     MX02 on. The trend restarts at n=1.
//   - The old default was a flat 30 minutes, which for an 11/9 split is 2.6 min
//     MORE than the real allocation. That is part of why MX01 finished with 7:30
//     spare. Section clocks are now derived from the real rates, so "reached" is
//     measured against test pace rather than against a round number.
//
// Draws from data/qb_index.json AND data/rw_index.json. They have the same row
// shape, so cropImages() takes rows from either without knowing the difference.
import { readFileSync, existsSync } from 'node:fs';
import {
  ROOT, md, esc, dataUri, cropImages, bankIndex, rwIndex,
  spokenFor, saveUsed, claimStem, overleaf, loadUsed, page, document_, buildNote, endPage,
} from './sheet.mjs';
import { cli, numberFlag } from './cli.mjs';

// Parsed FIRST, before anything reads or writes state. `--help` used to be
// ignored, so it ran a full default build and burned 20 questions (2026-09-21).
const args = cli(`usage: node tools/build_mixed.mjs [--n 20] [--math-only] [--dry]
         [--difficulty Easy,Medium,Hard] [--easy-share 0.25] [--label L]
         [--series N] [--rw-minutes M] [--math-minutes M] [--out DIR]

  --dry         print the selection; build nothing, consume nothing
  --math-only   the standalone timed maths module
  --series N    REBUILD set MXnn instead of allocating the next number
  --rebuild     with --series, allow its questions to differ from the record

A real run renders the .note AND marks its questions used in
state/used_questions.json. Use --dry to look first.`, {
  values: ['n', 'difficulty', 'easy-share', 'label', 'series', 'rw-minutes', 'math-minutes', 'out'],
  bools: ['dry', 'math-only', 'rebuild'],
});
if (args.positional.length) {
  console.error(`build_mixed.mjs takes no positional arguments, got: ${args.positional.join(' ')}`);
  process.exit(2);
}
const flag = args.flag;
const N = numberFlag(args, 'n', 20);
// Real digital SAT rates: R&W is 27 questions in 32 minutes, maths is 22 in 35.
// Deriving each section's clock from these is what makes "questions reached"
// mean "did you keep test pace" rather than "did you beat a round number".
const RW_SEC_PER_Q = (32 * 60) / 27;      // 71.1 s
const MATH_SEC_PER_Q = (35 * 60) / 22;    // 95.5 s
// Share of each section that is Easy. A real module is about a third; this sits
// just under it, so the set is a shade harder than the test without becoming a
// grind. Easy questions stay in -- a set with none of them measures something
// other than pace, and the cover's number would not mean what it is supposed to.
const EASY_SHARE = Number(flag('easy-share', 0.25));
const outDir = flag('out', `${ROOT}/out`);
const dry = args.has('dry');
const mathOnly = args.has('math-only');
const label = flag('label', mathOnly ? 'module' : 'mixed');
// Easy included on purpose. The sweep excludes it because an easy question
// diagnoses nothing, but this session is about rate, and a real module is about
// a third easy. Removing them would make every set harder than the test and the
// "questions reached" number would not mean what it is supposed to mean.
const DIFFS = (flag('difficulty', 'Easy,Medium,Hard')).split(',').map(s => s.trim());

// Every set gets a number, and the number is the identity. Before this the stem
// was `MX-${label}-${N}`, which is a function of the SHAPE of the set rather than
// of the set -- so a second 20-question mixed set produced the same stem, and
// saveUsed() would have overwritten the first one's entry in used_questions.json.
// That releases twenty already-seen questions back into the pool AND leaves
// spokenFor() excluding only the new sheet's own questions, silently. It also
// collides on the device, where push refuses to replace a written-on notebook.
//
// One series for both variants. --math-only is a real second kind of session
// (the standalone timed Module 2) but it is still a timed set drawn from the
// same bank against the same clock, and a second prefix would mean a second
// counter and a second routing rule for nothing. `label` distinguishes them in
// the stem and the display name says which out loud.
const seriesFlag = flag('series', null);
const nextSeries = () => {
  const used = Object.keys(loadUsed())
    .map(k => /^MX(\d+)-/.exec(k))
    .filter(Boolean)
    .map(m => Number(m[1]));
  return (used.length ? Math.max(...used) : 0) + 1;
};
// --series is for REBUILDING an existing set. Without it a re-run allocates a
// fresh number and the rebuild becomes a second sheet holding the same
// questions, which is the failure this whole change exists to prevent.
const seriesNum = seriesFlag === null ? nextSeries() : Number(seriesFlag);
if (!Number.isInteger(seriesNum) || seriesNum < 1) {
  console.error(`--series must be a positive integer, got ${seriesFlag}`);
  process.exit(1);
}
const series = String(seriesNum).padStart(2, '0');
const stem = `MX${series}-${label}-${N}`;
// spokenFor() excludes every OTHER stem's questions, so the numbering change is
// safe for the pool: MX01's twenty stay spoken for when MX02 is drawn.
const taken = spokenFor(stem);

// The real section is 54 R&W and 44 maths. Keep that ratio so the set feels like
// the test rather than like a maths sheet with some reading bolted on.
const mathWanted = mathOnly ? N : Math.round(N * 44 / 98);
const rwWanted = N - mathWanted;

const usable = (rows) => rows
  .filter(r => DIFFS.includes(r.difficulty) && !taken.has(r.qid))
  .sort((a, b) => a.qid.localeCompare(b.qid));    // deterministic: same sheet, same questions

// Order WITHIN a difficulty band is a stable hash of the qid, not the qid order.
// Sorting by qid would make consecutive questions come from neighbouring pages of
// the same source PDF, which clusters topics. The hash is arbitrary and it is
// reproducible -- the same arguments always build the same sheet.
const hash = (str) => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const byHash = (x, y) => hash(x.qid) - hash(y.qid);

// Largest-remainder apportionment. Splitting n items over weights that do not
// divide evenly has to round SOMEWHERE, and rounding each share independently
// does not sum back to n -- 11 split four ways as round(2.75) each gives 12.
const apportion = (total, weights) => {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map(w => (total * w) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, rem: e - Math.floor(e) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length].i]++;
  return out;
};

// Easy, then Medium, then Hard, in that order, because that is now the order they
// are SERVED in as well as selected. Medium outnumbers Hard slightly, as on the
// test: after the easy share is taken out the rest splits 8:7.
//
// Built from the difficulties actually in play, not from a hardcoded three. The
// first version assumed all three and `--difficulty Hard` then asked for eight
// questions, planned one, drew one per section and printed "POOL IS SHORT" —
// blaming the bank for a plan that had never asked for more. A wrong number with
// a plausible explanation attached is the worst shape a bug can take here.
const TIER_WEIGHT = { Medium: 8, Hard: 7 };
const difficultyPlan = (n) => {
  const rest = DIFFS.filter(d => d !== 'Easy');
  if (!rest.length) return { Easy: n };                 // --difficulty Easy
  const easy = DIFFS.includes('Easy') ? Math.round(n * EASY_SHARE) : 0;
  const counts = apportion(n - easy, rest.map(d => TIER_WEIGHT[d] ?? 1));
  const plan = easy ? { Easy: easy } : {};
  rest.forEach((d, i) => { plan[d] = counts[i]; });
  return plan;
};
// One flat list of difficulty labels in serving order: E,E,E,M,M,M,M,H,H,H,H.
const difficultySequence = (plan) => DIFFS.flatMap(d => Array(plan[d] ?? 0).fill(d));

// The real R&W module is ordered by DOMAIN, not by difficulty, and it runs them
// in this sequence every time. Verified against a practice-test error log
// that carries a `domain` field per question: Craft at M1 Q3, Q5 and M2 Q1,
// Information at M1 Q10, Conventions at M1 Q20 and M2 Q19. Six for six, monotonic,
// and the sequence restarts in module 2. Weights are the published domain shares.
const RW_DOMAINS = [
  ['Craft and Structure', 28],
  ['Information and Ideas', 26],
  ['Standard English Conventions', 26],
  ['Expression of Ideas', 20],
];
const MATH_DOMAINS = [
  ['Algebra', 35],
  ['Advanced Math', 35],
  ['Problem-Solving and Data Analysis', 15],
  ['Geometry and Trigonometry', 15],
];

/**
 * Draw one section, ordered the way the real module orders it.
 *
 * Maths uses domain buckets and is sorted Easy -> Medium -> Hard after drawing.
 * R&W is four buckets in the fixed domain sequence, and ramps WITHIN each domain -- which is what the
 * real module does, and why the easy questions are not all bunched at the very
 * front of the section: each domain restarts easy.
 *
 * Difficulty slots are dealt to whichever bucket has the most room left, so the
 * three easy R&W questions land in three different domains rather than filling
 * Craft and Structure and leaving Conventions all-hard.
 */
const drawSection = (pool, want, buckets) => {
  const sizes = apportion(want, buckets.map(b => b[1]));
  const rooms = sizes.slice();
  const picked = buckets.map(() => []);
  const remaining = buckets.map(([name]) =>
    Object.fromEntries(DIFFS.map(d => [d,
      (name === null ? pool : pool.filter(r => r.domain === name))
        .filter(r => r.difficulty === d).sort(byHash)])));
  const shortfalls = [];

  for (const want_d of difficultySequence(difficultyPlan(want))) {
    // Bucket with the most room, then earliest in the fixed sequence.
    const order = rooms.map((r, i) => ({ i, r }))
      .filter(x => x.r > 0).sort((a, b) => b.r - a.r || a.i - b.i);
    if (!order.length) break;
    let placed = false;
    // Try the intended difficulty in room order, then -- only if no bucket with
    // room has one left -- fall back to any difficulty, and say so out loud.
    for (const pass of [want_d, ...DIFFS.filter(d => d !== want_d)]) {
      for (const { i } of order) {
        const q = remaining[i][pass].shift();
        if (!q) continue;
        picked[i].push(q); rooms[i]--; placed = true;
        if (pass !== want_d) shortfalls.push(`${buckets[i][0] ?? 'maths'}: wanted ${want_d}, took ${pass}`);
        break;
      }
      if (placed) break;
    }
    if (!placed) break;
  }
  // Within a bucket, serve easy first. Buckets stay in their fixed sequence.
  //
  // REDUNDANT TODAY, AND KEPT ON PURPOSE. difficultySequence() emits its labels
  // in ascending order (E,E,E,M,M,M,M,H,H,H,H) and the loop above pushes in that
  // order, so every bucket is already ascending when it gets here. Deleting this
  // sort changes no output, and a mutation run on 2026-09-12 confirmed it: all 16
  // tests still pass without it.
  //
  // It stays because the ramp is a PROPERTY OF THE SHEET the learner sees, not a
  // side-effect the dealing happens to provide. If difficultySequence ever deals
  // in another order -- interleaving tiers to balance buckets, say -- this is what
  // keeps each domain block reading easy-to-hard instead of silently scrambling.
  // Do not remove it on the grounds that the tests do not notice.
  const rank = Object.fromEntries(DIFFS.map((d, i) => [d, i]));
  return {
    rows: picked.flatMap(b => b.sort((x, y) => rank[x.difficulty] - rank[y.difficulty] || byHash(x, y))),
    sizes, shortfalls,
  };
};

const mathPool = usable(bankIndex);
const rwPool = mathOnly ? [] : usable(rwIndex);

const mathDraw = drawSection(mathPool, mathWanted, MATH_DOMAINS);
const rwDraw = mathOnly
  ? { rows: [], sizes: [], shortfalls: [] }
  : drawSection(rwPool, rwWanted, RW_DOMAINS);

const mathRank = Object.fromEntries(DIFFS.map((d, i) => [d, i]));
const maths = mathDraw.rows
  .sort((a, b) => mathRank[a.difficulty] - mathRank[b.difficulty] || byHash(a, b))
  .map(q => ({ ...q, section: 'Math' }));
const rws = rwDraw.rows.map(q => ({ ...q, section: 'Reading and Writing' }));

// R&W first, then maths. The real test runs the Reading and Writing module before
// the Maths module, and the point of splitting them was to match that.
const SECTIONS = (mathOnly ? [] : [{
  key: 'rw', title: 'Reading and Writing', short: 'R&W', rows: rws,
  minutes: Number(flag('rw-minutes', Math.round((rws.length * RW_SEC_PER_Q) / 60))),
}]).concat([{
  key: 'math', title: 'Maths', short: 'Maths', rows: maths,
  minutes: Number(flag('math-minutes', Math.round((maths.length * MATH_SEC_PER_Q) / 60))),
}]).filter(sec => sec.rows.length);

// Numbering RESTARTS each section, as it does on the test -- and as it has to,
// because each section's reached-box says "of <that section's count>".
const chosen = SECTIONS.flatMap(sec =>
  sec.rows.map((q, i) => ({ ...q, sec, n: i + 1, of: sec.rows.length })));

console.log(`set:      ${mathOnly ? 'timed module (maths only)' : 'timed mixed set'}`);
console.log(`asked:    ${N}`);
for (const sec of SECTIONS) {
  const per = sec.key === 'rw' ? RW_SEC_PER_Q : MATH_SEC_PER_Q;
  console.log(`${(sec.short + ':').padEnd(9)} ${String(sec.rows.length).padStart(2)} questions   ${sec.minutes} min   `
    + `(test pace ${(per).toFixed(0)}s/q)`);
  for (const d of DIFFS) {
    const k = sec.rows.filter(r => r.difficulty === d).length;
    if (k) console.log(`            ${d}: ${k}`);
  }
}
if (!mathOnly) {
  console.log('R&W domains:');
  RW_DOMAINS.forEach(([name], i) => console.log(`            ${name}: ${rwDraw.sizes[i]}`));
}
console.log('Maths domains:');
MATH_DOMAINS.forEach(([name], i) => console.log(`            ${name}: ${mathDraw.sizes[i]}`));
// A shortfall means a (bucket, difficulty) slot could not be filled and something
// else was substituted. Never silent: a sheet that quietly drifts off its plan
// still looks like a sheet.
for (const line of [...rwDraw.shortfalls, ...mathDraw.shortfalls]) console.log(`  — SUBSTITUTED  ${line}`);
if (chosen.length < N) console.log(`  — ASKED FOR ${N}, POOL IS SHORT`);
if (!chosen.length) { console.error('nothing to build.'); process.exit(1); }
// A --series rebuild whose picks moved would erase MXnn's record (issue 2026-11-01).
claimStem(stem, chosen.map(c => c.qid), { rebuild: args.has('rebuild'), dry });
if (dry) {
  chosen.forEach((c) => console.log(
    `  ${c.sec.short.padEnd(5)} ${String(c.n).padStart(2)}/${c.of}  ${c.qid}  `
    + `${(c.domain ?? c.skill ?? '').padEnd(30)} ${c.difficulty}`));
  process.exit(0);
}

// ---- pages -----------------------------------------------------------------
const pages = [];
const foot = (s) => `${esc(stem)} · ${s}`;
const CHOICES = ['A', 'B', 'C', 'D'];

const clockLine = SECTIONS.map(sec => `${sec.short} ${sec.minutes} min`).join(', ');

pages.push(page({
  inner: `<h1>${mathOnly ? 'Timed module' : 'Timed mixed set'}</h1>
<p><em>${SECTIONS.map(sec => `${sec.rows.length} ${sec.short}`).join(' then ')},
${SECTIONS.length > 1 ? 'each section on its own clock' : 'one clock'}. The solutions are at the
back, not after each question.</em></p>
<h3>How to run it</h3>
<ol>
<li><strong>${SECTIONS.length > 1
  ? `One timer per section: ${esc(clockLine)}.`
  : `Set a timer for ${SECTIONS[0].minutes} minutes.`}</strong> Start it once at the
section divider, not per question.${SECTIONS.length > 1 ? ' Stop between sections.' : ''}</li>
<li><strong>Work straight through in order.</strong> Flag and move on rather than sitting on one — that is the habit being rehearsed, and it is the one that most easily fails to carry over into maths.</li>
<li><strong>When the timer goes, stop and draw a line where you are.</strong> Then carry on untimed if you want to; the line is the measurement and everything after it is free.</li>
<li>Only then turn to the solutions.</li>
</ol>
<h3>The number this produces</h3>
<p><strong>Questions reached, not score${SECTIONS.length > 1 ? ' — one number per section' : ''}.</strong>
Accuracy on a set you did not finish is a number
about the questions you happened to get to, and it moves for reasons that have
nothing to do with pacing.</p>
<p>${SECTIONS.length > 1 ? 'These clocks are' : 'This clock is'} the real
test\u2019s rate, not a round number: ${SECTIONS.length > 1
  ? 'R&amp;W 27 questions in 32 minutes, maths 22 in 35'
  : 'maths 22 questions in 35 minutes'}. Finishing here means finishing there.</p>`,
  foot: foot(`cover · ${new Date().toISOString().slice(0, 10)}`),
}));

for (const sec of SECTIONS) {
  // A divider, so the clock has somewhere to start and the section boundary is a
  // physical page turn rather than a change of typeface halfway down a page.
  pages.push(page({
    inner: `<div class="secpage">
${SECTIONS.length > 1
  ? `<p class="seckicker">Section ${SECTIONS.indexOf(sec) + 1} of ${SECTIONS.length}</p>` : ''}
<h1>${esc(sec.title)}</h1>
<p class="secclock">${sec.rows.length} questions · <strong>${sec.minutes} minutes</strong></p>
<p><em>Start the timer now. ${sec.key === 'rw'
  ? 'Questions run in the real module\u2019s domain order — Craft and Structure, Information and Ideas, Standard English Conventions, Expression of Ideas — and each domain starts easier than it ends.'
  : 'Questions run easier to harder.'}</em></p>
</div>`,
    foot: foot(`${sec.short} · section divider`),
  }));

  for (const q of chosen.filter(c => c.sec === sec)) {
    const { qPng } = cropImages(q);
    const isRw = q.section !== 'Math';
    // A student-produced response has no letters to circle. MX01 printed A-D
    // bubbles above question 17, a grid-in whose answer is 0.7 -- they were ignored
    // and the number was written in the working space, but the row is an invitation to
    // answer in the wrong format, which is the one mistake a grid-in punishes.
    // Decided by the SHAPE of the key, not by a flag: the bank has no grid-in
    // marker, and an answer that is not one of four letters is not multiple choice.
    const isSpr = !CHOICES.includes(String(q.answer ?? '').trim());
    pages.push(page({
      // No time box, deliberately. See the header of this file.
      inner: `<div class="qhead"><h2>Question ${q.n} / ${q.of}</h2>
        <div class="answerbox"><span class="k">answer</span>${
          isSpr ? '<span class="sprbox"></span>'
                : CHOICES.map(c => `<span class="choice">${c}</span>`).join('')}</div></div>
      <img class="qb${isRw ? ' rwq' : ''}" src="${dataUri(qPng)}">`,
      // Difficulty deliberately NOT on the question page. A sweep prints it and
      // that is harmless there, because the sweep times each question on its own
      // and the label cannot change the budget. Here it can: knowing a question is
      // Easy tells you how long to spend on it, which is the exact judgement the
      // session exists to rehearse. The real test never shows it either.
      foot: foot(`${sec.short} question ${q.n} · ${esc(q.qid)}`),
    }));
  }

  // One reached page per section, immediately after that section's questions, so
  // the number is written while the clock is still the thing in your head.
  pages.push(page({
    inner: `<h1>Where the clock ran out</h1>
<p><em>${esc(sec.title)} — write the number of the question you were on when the
timer went. This is what the section produces; everything else on it is in
service of this one number.</em></p>
<div class="reached"><div class="rbox"></div><div class="rof">of ${sec.rows.length}</div></div>
<h3>And two lines, while it is fresh</h3>
<p>Did flag-and-sweep run — did you actually flag and move on, or did you sit on
one? And which question was the first one where you felt the clock?</p>
<div class="srwrite"></div><div class="srwrite2"></div><div class="srwrite3"></div>`,
    foot: foot(`${sec.short} · questions reached`),
  }));
}

// Solutions in the same order the questions were served, section by section.
// The heading carries the section because numbering restarts -- there are now two
// "question 3"s on the sheet and an unqualified answer heading would be ambiguous.
chosen.forEach((q) => {
  const { aPng, hPng, extra } = cropImages(q);
  const label = SECTIONS.length > 1 ? `${q.sec.short} question ${q.n}` : `Question ${q.n}`;
  pages.push(page({
    inner: `<h2>${esc(label)} · answer${overleaf(extra)}</h2>
      ${hPng ? `<img class="qb sweeph" src="${dataUri(hPng)}">` : ''}
      <img class="qb mxa" src="${dataUri(aPng)}">`,
    foot: foot(`${q.sec.short} answer ${q.n} · ${esc(q.qid)}`),
  }));
  extra.forEach((e, k) => pages.push(page({
    inner: `<h2>${esc(label)} · answer (cont.)</h2><img class="qb mxa" src="${dataUri(e)}">`,
    foot: foot(`${q.sec.short} answer ${q.n} cont. ${k + 2} · ${esc(q.qid)}`),
  })));
});

pages.push(endPage(foot('end')));

// Same layout rules as build_rw_set for the R&W crops -- an R&W stem is a
// paragraph plus four sentence-length options and needs most of the page, where
// a maths crop does not.
const html = document_(pages).replace('</style>',
  `.rwq { max-height: 178mm; object-fit: contain; object-position: left top; }
   /* The answer page carries a heading, the metadata strip and the rationale and
      nothing else -- no tick grid, no writing lines -- so the rationale gets
      almost the whole page. Capped rather than uncapped because the base .qb has
      no max-height at all, and a long maths rationale at full width runs off the
      bottom: that is what overflowed on the first build. */
   .mxa { max-height: 168mm; object-fit: contain; object-position: left top; }
   .qhead h2 { white-space: nowrap; flex: 0 1 auto; }
   .answerbox { display: flex; align-items: center; gap: 3mm; flex: 0 0 auto; }
   .answerbox .k { font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; opacity: .55; }
   .answerbox .choice { width: 8mm; height: 8mm; border: 1.1pt solid #000; border-radius: 50%;
     display: inline-flex; align-items: center; justify-content: center; font-size: 10pt; }
   /* Grid-in: a box to write the value in, the same height as the bubble row so
      the header does not reflow question by question. */
   .answerbox .sprbox { width: 38mm; height: 8mm; border: 1.1pt solid #000; }
   .srwrite3 { margin-top: 3.5mm; border-bottom: 0.3mm solid #888; height: 7mm; }
   /* The reached box is deliberately large. It is the single output of the
      session and it competes with nothing else on its page. */
   .reached { display: flex; align-items: flex-end; gap: 6mm; margin: 10mm 0 4mm; }
   .reached .rbox { width: 44mm; height: 34mm; border: 1.4pt solid #000; }
   .reached .rof { font-size: 14pt; padding-bottom: 4mm; }
   /* The section divider is a page you are meant to STOP on -- it is where the
      timer starts -- so it is deliberately empty below the fold rather than
      running straight into question 1. */
   .secpage { margin-top: 38mm; }
   .secpage .seckicker { font-size: 9pt; letter-spacing: .1em; text-transform: uppercase;
     opacity: .55; margin: 0 0 2mm; }
   .secpage h1 { margin: 0 0 3mm; }
   .secpage .secclock { font-size: 13pt; margin: 0 0 6mm; }
   </style>`);

await buildNote(html, { stem, outDir });
saveUsed(stem, chosen.map(c => c.qid), { rebuild: args.has('rebuild') });
// The display name carries the same number as the stem, so the notebook on the
// device, the row in used_questions.json and the reminder all say MX01.
const display = mathOnly
  ? `MX${series} timed module — ${N} questions.note`
  : `MX${series} mixed set — ${N} questions.note`;
console.log(`\npush with:  node tools/push_note.mjs out/${stem}.note "${display}"`);
