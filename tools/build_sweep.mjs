// Build a sweep notebook for one CB skill.
//
//   node tools/build_sweep.mjs "Circles" [--n 15] [--out DIR] [--label "SW08 Circles"] [--dry]
//
// A sweep is a coverage instrument, not a lesson. It puts ~15 questions spanning
// every type in one skill in front of the learner, one per page, each with a TIME BOX,
// each with its worked solution overleaf. One skill is roughly one study block,
// so sweeping can start as soon as that skill's questions are assigned.
//
// The time box is the reason the notebook exists. The pivot this whole system
// rests on is that the problem is speed, not knowledge -- and without a number
// written on the page, "slow" is an adjective and that claim cannot be checked.
//
// The type name is deliberately NOT on the question page. Recognising the type
// in three seconds is the skill being measured; printing it above the question
// hands over the answer to the only question worth asking.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  ROOT, esc, dataUri, cropImages, byQid, skillKey,
  spokenFor, saveUsed, claimStem, overleaf, page, document_, buildNote, timeBox, endPage,
} from './sheet.mjs';
import { cli, numberFlag } from './cli.mjs';

// Parsed first, before anything reads or writes state: an ignored flag used to
// mean a full build that marks its questions used (see build_mixed, 2026-09-21).
const USAGE = `usage: node tools/build_sweep.mjs "<CB skill>" [--n 15] [--label "SW08 Circles"] [--out DIR] [--dry]

  --dry   print the selection; build nothing, consume nothing
  --rebuild  allow replacing an existing SW-<skill> record whose questions differ

A real run renders the .note AND marks its questions used in state/used_questions.json.`;
const args = cli(USAGE, { values: ['n', 'out', 'label'], bools: ['dry', 'rebuild'] });
const flag = args.flag;
const skillArg = args.positional[0];
if (!skillArg || args.positional.length > 1) { console.error(USAGE); process.exit(2); }
const N = numberFlag(args, 'n', 15);
const outDir = flag('out', `${ROOT}/out`);
const dry = args.has('dry');

// ---- inputs ----------------------------------------------------------------
const assignPath = `${ROOT}/data/type_assignments.json`;
if (!existsSync(assignPath)) {
  console.error('data/type_assignments.json missing — run the assignment pass first.');
  process.exit(1);
}
const assignments = JSON.parse(readFileSync(assignPath, 'utf8')).assignments;
const tax = JSON.parse(readFileSync(`${ROOT}/data/taxonomy.json`, 'utf8'));

// Every solution page prints its type's TELL and DO lines, so a line carrying
// one question's detail ("substitute h = r + 4") prints on every question of
// that type and teaches a cue that never fires. Refuse rather than ship it.
try {
  execFileSync('python3', [`${ROOT}/tools/check_taxonomy.py`], { stdio: 'pipe' });
} catch (e) {
  console.error(String(e.stdout ?? '') + String(e.stderr ?? ''));
  console.error('TAXONOMY CHECK failed -- fix data/taxonomy.json before sweeping.');
  process.exit(1);
}

const skillName = Object.keys(tax.skills)
  .find(s => skillKey(s) === skillKey(skillArg))
  ?? Object.keys(tax.skills).find(s => skillKey(s).includes(skillKey(skillArg)));
if (!skillName) {
  console.error(`no such CB skill: ${skillArg}\nknown:\n  ` + Object.keys(tax.skills).join('\n  '));
  process.exit(1);
}

const typeInfo = new Map();
for (const t of tax.skills[skillName].types) typeInfo.set(t.name, t);
for (const ct of tax.cross_skill_types ?? []) {
  if (ct.spans.includes(skillName)) typeInfo.set(ct.name, ct);
}

// Trim AFTER truncating: stripping first left a trailing hyphen on any name long
// enough to be cut, so the stem came out "…-one-variable-and-".
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '');
const stem = `SW-${slug(skillName)}`;
const label = flag('label', stem);

// ---- selection -------------------------------------------------------------
// Round-robin across types so every type is met once before any is met twice.
// That is the guard that keeps a sweep a sweep: depth on one type is exactly how
// the previous plan spent its hours and never got coverage.
const taken = spokenFor(stem);
const pools = new Map();
for (const [qid, a] of Object.entries(assignments)) {
  if (skillKey(a.skill) !== skillKey(skillName)) continue;
  if (a.type === 'unmatched' || taken.has(qid)) continue;
  if (!byQid.has(qid)) continue;
  (pools.get(a.type) ?? pools.set(a.type, []).get(a.type)).push(qid);
}
for (const qids of pools.values()) qids.sort();          // deterministic rebuilds

// Types with the most of the bank behind them go first: if the budget runs out
// before every type is covered, the questions left uncovered should be the few.
const order = [...pools.keys()].sort((a, b) => pools.get(b).length - pools.get(a).length || a.localeCompare(b));
const chosen = [];
for (let round = 0; chosen.length < N; round++) {
  let progressed = false;
  for (const t of order) {
    if (chosen.length >= N) break;
    const q = pools.get(t)[round];
    if (!q) continue;
    chosen.push({ qid: q, type: t });
    progressed = true;
  }
  if (!progressed) break;
}

const missedTypes = order.filter(t => !chosen.some(c => c.type === t));
const uncovered = [...typeInfo.keys()].filter(t => !pools.has(t));

console.log(`skill: ${skillName}`);
console.log(`types with questions: ${pools.size}/${typeInfo.size}`);
console.log(`selected ${chosen.length} questions across ${new Set(chosen.map(c => c.type)).size} types`);
// A silent cap reads as "covered everything". Say what was left out.
if (missedTypes.length) console.log(`NOT on this sheet (budget of ${N}): ${missedTypes.join(', ')}`);
if (uncovered.length) console.log(`no question assigned at all: ${uncovered.join(', ')}`);
if (!chosen.length) { console.error('nothing to sweep.'); process.exit(1); }
// SW-<skill> is derived from the skill, so a second sweep of one skill shares
// the key -- refuse to erase the first one's record (issue 2026-11-01).
claimStem(stem, chosen.map(c => c.qid), { rebuild: args.has('rebuild'), dry });
if (dry) { for (const c of chosen) console.log(`  ${c.qid}  ${c.type}`); process.exit(0); }

// ---- pages -----------------------------------------------------------------
const pages = [];
// The footer label is cosmetic and defaults to the stem. `--label` overrides it
// so the sheet can carry its series number ("SW15 One-variable data"), which is
// what the notebook is called on the device and in any task list. It is
// deliberately NOT the stem: the stem keys state/used_questions.json, and
// changing that would let the same questions be drawn again by another sheet.
const foot = (s) => `${esc(label)} · ${s}`;

pages.push(page({
  // CB skill names run to 68 characters ("Nonlinear equations in one variable and
  // systems of equations in two variables"), which at full heading size wraps to
  // three lines and pushes the cover past the bottom. Scale the heading instead of
  // truncating the name -- the learner needs to know which skill this is.
  // 34 was too generous: "Linear equations in two variables" is 32 and still
  // wrapped to two lines, overflowing by 34px. Three skills sit at exactly 32
  // (that one, "Linear equations in one variable", "Right triangles and
  // trigonometry"), so the gap between "wraps" and "gets scaled" swallowed
  // SW06, SW10 and SW14. 30 puts all three on the scaled path.
  inner: `<h1${skillName.length > 30 ? ' class="long"' : ''}>Sweep — ${esc(skillName)}</h1>
<p><em>${chosen.length} questions, one per page, worked solution on the page after.
Not a lesson. The point is to find out which of these you can already do fast.</em></p>
<h3>How to run it</h3>
<ol>
<li>Start the stopwatch on your watch. Tap <strong>lap</strong> when you finish a question.</li>
<li><strong>Write the lap seconds in the time box before you turn the page.</strong>
That number is the whole experiment — a page without it tells us nothing.</li>
<li>Then turn over, check, and fill in <strong>what happened</strong>. Tick the
box, and add a line in your own words if there is one to add — that line is
usually the most useful thing on the page.</li>
<li><strong>Three minutes is the cap.</strong> If you are still exploring at three
minutes, write the time, tick <em>ran out of patience</em>, and move on. A question
you grind out in six minutes is a question you would not have had time for anyway.</li>
</ol>
<h3>What happens after</h3>
<p>Afterwards, score the pages against the official answers and record each
question with <code>tools/types_state.py record</code>. That is what works out which
types are actually weak and what they have in common. Anything that needs it gets
one sheet — one, then move on.</p>
<p><em>Don't mark right or wrong while you work.</em> Scoring comes afterwards; your
time is better spent on the box and the line.</p>
<blockquote><p>44 questions in 70 minutes is <strong>95 seconds each</strong>. That is
plenty when the method arrives instantly, and nowhere near enough when it
doesn't. This is measuring which of those two you are on.</p></blockquote>`,
  foot: foot(`cover · ${new Date().toISOString().slice(0, 10)}`),
}));

chosen.forEach((c, i) => {
  const q = byQid.get(c.qid);
  const { qPng, aPng, hPng, extra } = cropImages(q);
  const n = i + 1;
  pages.push(page({
    inner: `<div class="qhead"><h2>Question ${n} / ${chosen.length}</h2>${timeBox()}</div>
      <img class="qb sweepq" src="${dataUri(qPng)}">
      <div class="workspace"></div>`,
    foot: foot(`question ${n} · ${esc(c.qid)} · ${esc(q.difficulty)}`),
  }));
  const t = typeInfo.get(c.type);
  pages.push(page({
    inner: `<h2>Question ${n} · solution${overleaf(extra)}</h2>
      <div class="typetag"><span class="k">type</span> <strong>${esc(c.type)}</strong><br>
        <span class="k">tell</span> ${esc(t?.cue ?? '')}<br>
        <span class="k">do</span> ${esc(t?.procedure ?? '')}</div>
      ${hPng ? `<img class="qb sweeph" src="${dataUri(hPng)}">` : ''}
      <img class="qb sweepa" src="${dataUri(aPng)}">
      <div class="selfreview"><div class="srhead">what happened?</div>
        <div class="srgrid">${[
          'had it', 'wrong method',
          'knew it, took a while', 'ran out of patience',
          'right method, slipped', 'no method',
          'misread the question',
        ].map(l => `<span><span class="box"></span>${l}</span>`).join('')}</div>
        <div class="srlabel">in your words — what actually stopped you?</div>
        <div class="srwrite"></div><div class="srwrite2"></div></div>`,
    foot: foot(`solution ${n} · ${esc(c.qid)}`),
  }));
  extra.forEach((e, k) => pages.push(page({
    inner: `<h2>Question ${n} · solution (cont.)</h2><img class="qb sweepa" src="${dataUri(e)}">`,
    foot: foot(`solution ${n} cont. ${k + 2} · ${esc(c.qid)}`),
  })));
});

// No tally page. It asked the learner to copy 15 numbers already written into
// a grid, which is transcription, not practice -- and it was never going to
// get done. The times are read off the pages themselves.

pages.push(endPage(label));

// ---- build -----------------------------------------------------------------
// The question crop can be tall enough to squeeze the working space to nothing,
// which the overflow guard would pass because nothing is clipped. Cap it and let
// the grid keep its share of the page.
const html = document_(pages).replace('</style>',
  `.sweepq { max-height: 108mm; object-fit: contain; object-position: left top; }
   /* The solution page now carries the metadata header as well as the rationale,
      so the rationale gets less room. Measured against the overflow guard: 150mm
      ran 56px past the bottom on the longest Circles rationale. */
   .sweepa { max-height: 74mm; object-fit: contain; object-position: left top; }
   </style>`);

await buildNote(html, { stem, outDir });
saveUsed(stem, chosen.map(c => c.qid), { rebuild: args.has('rebuild') });
console.log(`\nswept types: ${[...new Set(chosen.map(c => c.type))].join(' · ')}`);
