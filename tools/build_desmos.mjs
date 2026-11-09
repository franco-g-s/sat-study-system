// Build a DESMOS SPEED DRILL -- one technique, many reps, target under 30 s each.
//
//   node tools/build_desmos.mjs systems            # allocates the next DS number
//   node tools/build_desmos.mjs systems --n 8 --dry
//   node tools/build_desmos.mjs --list
//
// The output number is SECONDS, and it is the only output. This is not a
// diagnosis sheet: every question here is one the learner can already do by hand. What is
// being measured is whether the Desmos route is automatic, because a route you
// have to think about is not a route -- the plan's words, and the reason the
// target is 30 seconds rather than "faster than by hand".
//
// DELIVERY IS BOTH SCREENS AT ONCE. The laptop has Desmos open; this sheet sits
// next to it with the question and the time box. That is why it is a .note and
// not the HTML the mixed set uses -- there is no room for the question on the
// laptop when Desmos is filling it.
//
// A technique is a named set of TYPES, not a CB skill, which is why this cannot
// be build_sweep.mjs with a flag: "enter both equations and click the
// intersection" is one type inside one skill, and "y1~mx1+b" is two types inside
// a different one. The map below is the whole of what is Desmos-specific here.
import {
  ROOT, esc, dataUri, cropImages, bankIndex, byQid,
  spokenFor, loadUsed, saveUsed, claimStem, page, document_, buildNote, timeBox, endPage,
} from './sheet.mjs';
import { cli, numberFlag } from './cli.mjs';
import { readFileSync } from 'node:fs';

// Each entry: the keystrokes, and the types whose questions that route solves.
// Picked from the taxonomy rather than by hand-listing qids so the drill keeps
// working as the bank is consumed.
const TECHNIQUES = {
  systems: {
    title: 'Systems — graph both, click the intersection',
    keys: 'Type both equations on separate lines. Click where the lines cross; Desmos labels the point.',
    types: [
      'Systems of two linear equations in two variables :: solve the system for a value',
      'Nonlinear equations in one variable and systems of equations in two variables :: system by substitution',
    ],
  },
  // REMOVED 2026-09-12, after DS01. There was a `regressions` technique here
  // ('y1 ~ mx1 + b', pointed at 'fit a model to the data'). It has no bank
  // surface, and narrowing its type list -- which is what the previous fix
  // did -- could not have helped:
  //
  //   'fit a model to the data' is 9 questions. All 9 draw the line of best fit
  //   for you. Bank-wide, ZERO questions pair a numeric data table with a
  //   line-of-best-fit or regression ask:
  //     text contains 'table' AND ('line of best fit' OR 'regression')  ->  0
  //
  // So there is nothing to type into a Desmos table, and the regression panel
  // never opens. DS01 spent 8 of its 16 reps here and measured nothing: the
  // notes on the page said twice that Desmos would not have helped.
  //
  // These questions are real and 3 of 8 were answered wrong -- but the skill they need
  // is reading a slope off a drawn line, which is a remediation sheet, not a
  // keystroke drill. Do not re-add this without first re-running the query
  // above; a technique whose pool is all pictures trains nothing.
};

// Parsed first, before anything reads or writes state: an ignored flag used to
// mean a full build that marks its questions used (see build_mixed, 2026-09-21).
const USAGE = `usage: node tools/build_desmos.mjs <technique...> [--n 8] [--target 30] [--series N] [--out DIR] [--dry]
       node tools/build_desmos.mjs --list

  --dry        print the selection; build nothing, consume nothing
  --target S   the per-rep time target in seconds
  --series N   REBUILD drill DSnn instead of allocating the next number
  --rebuild    with --series, allow its questions to differ from the record

A real run renders the .note AND marks its questions used in state/used_questions.json.

techniques: ${Object.keys(TECHNIQUES).join(' · ')}`;
const args = cli(USAGE, { values: ['n', 'target', 'out', 'series'], bools: ['dry', 'list', 'rebuild'] });
const flag = args.flag;
if (args.has('list')) {
  for (const [k, t] of Object.entries(TECHNIQUES)) console.log(`${k.padEnd(14)} ${t.title}`);
  process.exit(0);
}
// Positionals are everything BEFORE the first flag. Filtering on
// !startsWith('--') would swallow flag VALUES too -- `--n 8` made "8" look like a
// technique name and the script rejected it. build_sweep.mjs has the same bug and
// only survives it by taking [0].
// The parser consumes flag values, so every positional really is a technique.
const asked = args.positional;
if (!asked.length) { console.error(USAGE); process.exit(2); }
for (const a of asked) if (!TECHNIQUES[a]) { console.error(`no such technique: ${a}\nknown: ${Object.keys(TECHNIQUES).join(' · ')}`); process.exit(1); }

const N = numberFlag(args, 'n', 8);                  // reps per technique
const SECONDS = numberFlag(args, 'target', 30);
const outDir = flag('out', `${ROOT}/out`);
const dry = args.has('dry');

// Every drill gets a number, and the number is its identity -- the same change
// build_mixed.mjs made for MX. `DS-${asked.join('-')}` is a function of the
// SHAPE of the drill, not of the drill, so a second `systems` sheet reused the
// stem, saveUsed() overwrote the first one's row, and its questions silently
// fell back into the pool. The first sheet was renamed DS01-systems-regressions
// by hand on 2026-09-12 to seed this counter.
//
// Counted off the used_questions KEYS, not off out/ filenames the way
// build_drill.mjs does it: out/ is a build artifact and a cleaned out/ would
// reset the numbering without saying so. state/ is the record.
const seriesFlag = flag('series', null);
const nextSeries = () => {
  const used = Object.keys(loadUsed())
    .map(k => /^DS(\d+)-/.exec(k))
    .filter(Boolean)
    .map(m => Number(m[1]));
  return (used.length ? Math.max(...used) : 0) + 1;
};
// --series is for REBUILDING one. Without it a re-run allocates a fresh number
// and the rebuild becomes a second drill holding the same questions.
const seriesNum = seriesFlag === null ? nextSeries() : Number(seriesFlag);
if (!Number.isInteger(seriesNum) || seriesNum < 1) {
  console.error(`--series must be a positive integer, got ${seriesFlag}`);
  process.exit(1);
}
const series = String(seriesNum).padStart(2, '0');
const stem = `DS${series}-${asked.join('-')}`;
// spokenFor() excludes every OTHER stem's questions, so DS01's sixteen stay
// spoken for when DS02 is drawn.
const taken = spokenFor(stem);
const assignments = JSON.parse(readFileSync(`${ROOT}/data/type_assignments.json`, 'utf8')).assignments;
const typeOf = (qid) => { const a = assignments[qid]; return a && (a.type ?? a); };
const skillOf = (qid) => { const a = assignments[qid]; return a && a.skill; };
const key = (qid) => `${skillOf(qid)} :: ${typeOf(qid)}`;

// A type is not a promise that the route applies. Three of DS01's sixteen reps
// were inside the right types and still had no Desmos route, and the notes on
// the page said so each time:
//
//   rep 1  two unknown constants       -> nothing to graph until you know them;
//                                         it became random slider-dragging
//   rep 2  graph supplied in the stem  -> the picture is already there; Desmos
//                                         was not needed
//   rep 4  one unknown constant        -> solved by dragging k until it looked
//                                         right, 67s, and only because the
//                                         answer was an easy number
//
// An unknown constant makes it a slider hunt and a supplied graph makes it a
// read-off; neither times the keystrokes, which is the only thing this sheet
// measures. Costs 5 of the 49 unused systems questions -- cheap for a rep that
// would otherwise train nothing.
const NO_ROUTE = /graphed above|shown above|\bare constants\b|\bis a constant\b/i;

const picked = [];
for (const name of asked) {
  const t = TECHNIQUES[name];
  const pool = bankIndex
    .filter(r => t.types.includes(key(r.qid)) && !taken.has(r.qid) && !NO_ROUTE.test(r.text))
    .sort((a, b) => a.qid.localeCompare(b.qid));
  const take = pool.slice(0, N);
  console.log(`${name.padEnd(14)} ${take.length} of ${pool.length} unused`);
  if (take.length < N) console.log(`  — ASKED FOR ${N}, POOL IS SHORT`);
  take.forEach(q => picked.push({ ...q, technique: name }));
}
if (!picked.length) { console.error('nothing to build.'); process.exit(1); }
claimStem(stem, picked.map(q => q.qid), { rebuild: args.has('rebuild'), dry });
if (dry) { picked.forEach((q, i) => console.log(`  ${String(i + 1).padStart(2)}  ${q.qid}  ${q.technique.padEnd(12)} ${q.difficulty}`)); process.exit(0); }

const pages = [];
const foot = (s) => `${esc(stem)} · ${s}`;

pages.push(page({
  inner: `<h1>Desmos speed drill</h1>
<p><em>${asked.map(a => esc(TECHNIQUES[a].title)).join(' · ')}</em></p>
<h3>How to run it</h3>
<ol>
<li><strong>Laptop with Desmos open, this sheet beside it, stopwatch running.</strong></li>
<li><strong>Every rep against the clock, target under ${SECONDS} seconds.</strong> Write the seconds in the box. That number is the entire output.</li>
<li><strong>Use Desmos even when doing it by hand would be faster.</strong> You can already do these by hand — that is why they were chosen. The drill is the keystrokes.</li>
<li>If a rep goes over a minute, stop and write down which keystroke you had to think about.</li>
</ol>
<h3>The techniques</h3>
${asked.map(a => `<p><strong>${esc(TECHNIQUES[a].title)}.</strong> ${esc(TECHNIQUES[a].keys)}</p>`).join('')}
<blockquote><p>A Desmos route you have to think about is not a route. Under
${SECONDS} seconds means it has become one; ninety seconds means you are
still solving the question and Desmos is just where you are typing.</p></blockquote>`,
  foot: foot(`cover · ${new Date().toISOString().slice(0, 10)}`),
}));

picked.forEach((q, i) => {
  const { qPng } = cropImages(q);
  const n = i + 1;
  pages.push(page({
    inner: `<div class="qhead"><h2>Rep ${n} / ${picked.length}</h2>${timeBox()}</div>
      <p class="typetag">${esc(TECHNIQUES[q.technique].title)}</p>
      <img class="qb" src="${dataUri(qPng)}">`,
    // The technique IS named on the question page, unlike a sweep's type. There is
    // no recognition step being measured here -- the learner is told which route to use and
    // the clock is on the execution.
    foot: foot(`rep ${n} · ${esc(q.qid)} · ${esc(q.technique)}`),
  }));
});

pages.push(page({
  inner: `<h1>What to note</h1>
<p><em>The seconds are in the boxes. These are the two things they do not say.</em></p>
<p><strong>Which keystroke did you have to think about?</strong> A slow rep is
almost never the maths — it is not remembering whether the tilde goes before or
after, or hunting for the regression panel.</p>
<div class="srwrite"></div><div class="srwrite2"></div>
<p><strong>Did any of them tempt you back to doing it by hand?</strong> That is
worth knowing: it means the hand route is still faster, and on test day under
pressure that is the one you will take.</p>
<div class="srwrite"></div><div class="srwrite2"></div>`,
  foot: foot('after'),
}));
pages.push(endPage(foot('end')));

const html = document_(pages).replace('</style>',
  `.qhead { display: flex; align-items: flex-start; justify-content: space-between; }
   .qhead h2 { white-space: nowrap; flex: 0 1 auto; }
   .typetag { font-size: 3.4mm; color: #555; margin: 0 0 3mm; }
   </style>`);

await buildNote(html, { stem, outDir });
saveUsed(stem, picked.map(q => q.qid), { rebuild: args.has('rebuild') });
console.log(`\npush with:  node tools/push_note.mjs out/${stem}.note "Note/SAT/Math/Drills" "DS${series} Desmos — ${asked.join(" + ")}.note"`);
