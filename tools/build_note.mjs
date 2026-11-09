// Build a Supernote .note from a target sheet.
//
//   node tools/build_note.mjs content/targets/M02-completing-the-square.md [outdir]
//
// Page geometry, CSS, the markdown subset and the render step live in sheet.mjs,
// shared with the sweep generator. What is here is the target-sheet format: its
// frontmatter, its markers, and the BANK expansion.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { checkSheet } from './check_math.mjs';
import {
  ROOT, md, esc, dataUri, cropImages, bankIndex, byQid, skillKey,
  spokenFor, saveUsed, claimStem, overleaf, page, document_, buildNote, timeBox, endPage,
  numberLabels,
} from './sheet.mjs';
import { cli } from './cli.mjs';

// Parsed first, before anything reads or writes state: an ignored flag used to
// mean a full build that marks its questions used (it happened in build_mixed).
// `--carry X` used to be found by indexOf and the out dir by "first non-flag
// argument", so a carry path could be taken for the out dir. The parser consumes
// flag values, so positionals are now exactly <sheet.md> [outdir].
const USAGE = `usage: node tools/build_note.mjs <content/targets/X.md> [outdir] [--carry <old.note>]

  --carry   rebuild a notebook you have written on, keeping the handwriting
  --rebuild allow the sheet's BANK questions to differ from its recorded ones
            (e.g. after hand-swapping picks in the content file)

A real run renders the .note AND marks any BANK questions used in state/used_questions.json.`;
const cliArgs = cli(USAGE, { values: ['carry'], bools: ['rebuild'] });
if (!cliArgs.positional.length || cliArgs.positional.length > 2) { console.error(USAGE); process.exit(2); }
const [src, outArg] = cliArgs.positional;
const outDir = outArg ?? `${ROOT}/out`;
// Rebuild a notebook that has already been written on, keeping the handwriting and
// appending whatever the source has grown at the end.
//
// The backgrounds are re-rendered, so if the source or the renderer has moved
// since the ink was written, it lands over a slightly different layout. The
// decision: append anyway and keep the folder clean, and fix it by hand in the
// rare case it matters. Pages beyond what the old notebook had simply get no
// writing, which is what makes appending work at all.
const carryFrom = cliArgs.flag('carry', null);
const raw = readFileSync(src, 'utf8');
const stem = basename(src).replace(/\.md$/, '');

// ---- hand-written maths ----------------------------------------------------
// Every CHECK marker is evaluated, and every numbered answer on an answers page
// must carry one, BEFORE anything renders. A wrong printed answer teaches the
// wrong method with the authority of print (R05, 2026-09-04); this refuses the
// build the way the overflow guard refuses a clipped page. See check_math.mjs.
{
  const { results, problems } = checkSheet(raw);
  if (problems.length) {
    console.error(`MATH CHECK -- ${problems.length} problem(s) in ${src}:`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('Fix the answer, or the CHECK if the claim was mis-typed. Refusing to build.');
    process.exit(1);
  }
  if (results.length) console.log(`math check: ${results.filter(r => !r.none).length} claim(s) verified` +
    `${results.some(r => r.none) ? `, ${results.filter(r => r.none).length} opted out` : ''}`);
}

// ---- frontmatter -----------------------------------------------------------
const fmEnd = raw.indexOf('\n---', 4);
const fm = Object.fromEntries(
  raw.slice(4, fmEnd).split('\n')
    .filter(l => /^[a-z_]+:/.test(l))
    .map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
const body = raw.slice(fmEnd + 4);

// ---- question selection ----------------------------------------------------
const bankMap = JSON.parse(readFileSync(`${ROOT}/tools/bank_map.json`, 'utf8'));
// Only OTHER sheets' questions are off limits. Excluding this sheet's own made a
// rebuild pick twelve different questions, which push then read as handwriting.
const seen = spokenFor(stem);

function pickQuestions(target, difficulty, n) {
  const want = new Set((bankMap[target] ?? []).map(skillKey));
  if (!want.size) return [];
  return bankIndex
    .filter(r => want.has(skillKey(r.skill)) && r.difficulty === difficulty && !seen.has(r.qid))
    .sort((a, b) => a.qid.localeCompare(b.qid))   // stable: same sheet, same questions
    .slice(0, n);
}

// ---- pages -----------------------------------------------------------------
const srcPages = body.split('<!-- PAGE -->').map(p => p.trim()).filter(Boolean);
const bankSpecs = [];
const rendered = srcPages.map((p, n) => {
  const ws = p.match(/<!-- WORKSPACE: ([\d.]+) -->/);
  const bank = [...p.matchAll(/<!-- BANK: ([^>]+?) -->/g)].map(m => m[1].trim());
  // Explicit question ids, for a sheet aimed at a PRIMITIVE rather than a CB
  // skill. Selection by skill cannot express "the questions that turn on
  // b^(x+k) = b^k * b^x", because those sit in three different types across two
  // skills -- which is the whole reason the primitive layer exists.
  // `label=Follow-up, qid, qid` — a second set on the same sheet needs its own
  // name, or it prints "Drill 1 / 3" straight after "Drill 10 / 10".
  const explicit = [...p.matchAll(/<!-- QUESTIONS: ([^>]+?) -->/g)]
    .flatMap(m => m[1].split(',').map(x => x.trim())).filter(Boolean);
  const labelled = explicit.filter(x => x.startsWith('label='));
  const qids = explicit.filter(x => !x.startsWith('label='));
  if (qids.length) bankSpecs.push({ at: n, qids, label: labelled[0]?.slice(6) ?? 'Drill' });
  const isSession2 = /<!-- SESSION 2 -->/.test(p);
  let inner = md(p.replace(/<!--[\s\S]*?-->/g, '').trim());
  // A hand-written question page needs the same time box the BANK/QUESTIONS
  // expansion gives a bank question -- the box is what makes the learner record the
  // seconds, and without the seconds "slow" is an adjective. Matches the
  // .qhead structure the expansion emits so the two look identical.
  if (/<!-- TIMEBOX -->/.test(p)) {
    inner = inner.replace(/^(<h[12]>[\s\S]*?<\/h[12]>)/,
      `<div class="qhead">$1${timeBox()}</div>`);
  }
  if (bank.length) bankSpecs.push({ at: n, specs: bank });
  if (ws) inner += `<div class="workspace" style="min-height:${Math.round(Number(ws[1]) * 100)}%"></div>`;
  return page({
    inner,
    // Total is a placeholder: the real page count is not known until the BANK
    // and QUESTIONS markers have expanded, and a footer reading "2/7" on a
    // 27-page notebook is worse than no count at all.
    // Both numbers are placeholders. A source page does not know where it will
    // land: the BANK and QUESTIONS markers splice pages in ahead of it, so page 8
    // of the source was printing "8/35" while sitting at position 28.
    foot: `${esc(fm.id ?? '')} · ${esc(fm.title ?? '')} · @@POS@@/@@TOTAL@@`,
    cls: isSession2 ? 'session2' : '',
  });
});

// A label numbers across ALL its markers, not within each one. Must run on
// bankSpecs in DOCUMENT order -- the expansion below runs reversed.
numberLabels(bankSpecs);

// Expand each BANK marker into alternating question / solution pages, in place.
const chosen = [];
for (const { at, specs, qids, label = 'Drill',
             labelStart = 0, labelTotal } of bankSpecs.reverse()) {
  const built = [];
  // Explicit ids: same page pair as a bank spec, but WITH a time box. A
  // remediation sheet that only explains produces recognition the learner cannot
  // reach under a clock; the verdict on the first draft of M02 was that reading
  // a derivation activates nothing.
  for (const [k, qid] of (qids ?? []).entries()) {
    const q = byQid.get(qid);
    if (!q) { console.error(`unknown question id: ${qid}`); process.exit(1); }
    chosen.push(qid);
    const { qPng, aPng, hPng, extra } = cropImages(q);
    built.push(page({
      inner: `<div class="qhead"><h2>${esc(label)} ${labelStart + k + 1} / ${labelTotal ?? qids.length}</h2>${timeBox()}</div>
        <img class="qb sweepq" src="${dataUri(qPng)}">
        <div class="workspace"></div>`,
      foot: `${esc(fm.id ?? '')} · question ${esc(qid)} · ${esc(q.difficulty)}`,
    }));
    // The outcome tick grid, for sheets whose output is a DIAGNOSIS.
    //
    // build_sweep.mjs has always carried this; this branch never did, and the
    // gap was invisible until RS01 was reviewed. Its cover said "tick
    // what happened" and there was nothing to tick, so all fourteen outcomes
    // had to be inferred from the working and the prose. The outcome is what
    // decides the remedy -- `slipped` and `no-method` on the same wrong answer
    // need opposite responses -- so inferring it is the weakest link in the
    // review.
    //
    // Gated on `kind` so remediation sheets render exactly as before: their
    // solution pages are teaching pages, and a 120mm rationale plus a grid is
    // what the overflow guard would reject.
    const diagnostic = fm.kind === 'drill';
    built.push(page({
      inner: `<h2>${esc(label)} ${labelStart + k + 1} · solution${overleaf(extra)}</h2>
        ${hPng ? `<img class="qb sweeph" src="${dataUri(hPng)}">` : ''}
        <img class="qb sweepa${diagnostic ? ' drillans' : ''}" src="${dataUri(aPng)}">
        ${diagnostic ? `<div class="selfreview"><div class="srhead">what happened?</div>
          <div class="srgrid">${[
    'had it', 'wrong method',
    'knew it, took a while', 'ran out of patience',
    'right method, slipped', 'no method',
    'misread the question',
  ].map(l => `<span><span class="box"></span>${l}</span>`).join('')}</div>
          <div class="srlabel">in your words — what actually stopped you?</div>
          <div class="srwrite"></div><div class="srwrite2"></div></div>` : ''}`,
      foot: `${esc(fm.id ?? '')} · solution ${esc(qid)}`,
    }));
    // A rationale that spans two source pages gets a CONTINUATION page, the way
    // build_sweep.mjs has always done it. Stacking them was an overflow waiting
    // for the first two-page question to arrive: `.sweepa` is capped at 120mm,
    // so a hint plus two rationale images is 240mm of image on a 216.8mm page.
    // DR01 found it -- pages 4 and 20, 285px and 159px past the bottom, the only
    // two questions on the sheet with a second rationale page. The overflow
    // guard caught it, which is the only reason it was never shipped clipped.
    extra.forEach((e, j) => built.push(page({
      inner: `<h2>${esc(label)} ${labelStart + k + 1} · solution (cont.)</h2>
        <img class="qb sweepa" src="${dataUri(e)}">`,
      foot: `${esc(fm.id ?? '')} · solution ${esc(qid)} cont. ${j + 2}`,
    })));
  }
  for (const spec of specs ?? []) {
    const kv = Object.fromEntries(spec.split(',').map(s => s.trim().split('=')));
    if (!kv.target) continue;
    const qs = pickQuestions(kv.target, kv.difficulty, Number(kv.n ?? 6));
    for (const [k, q] of qs.entries()) {
      chosen.push(q.qid);
      const { qPng, aPng, extra } = cropImages(q);
      const label = `${kv.difficulty} ${k + 1}/${qs.length}`;
      built.push(page({
        inner: `<h2>Practice — ${esc(label)}</h2>
        <img class="qb" src="${dataUri(qPng)}">
        <div class="workspace"></div>`,
        foot: `${esc(fm.id ?? '')} · official question ${esc(q.qid)}`,
      }));
      built.push(page({
        inner: `<h2>Practice — ${esc(label)} · solution</h2>
        <img class="qb" src="${dataUri(aPng)}">
        ${extra.map(e => `<img class="qb" src="${dataUri(e)}">`).join('')}`,
        foot: `${esc(fm.id ?? '')} · solution ${esc(q.qid)}`,
      }));
    }
  }
  rendered.splice(at + 1, 0, ...built);
}

rendered.push(endPage(fm.id ?? stem));
const total = rendered.length;
// Resolve each page's position from where it actually ended up after splicing.
for (let i = 0; i < rendered.length; i++) rendered[i] = rendered[i].replace('@@POS@@', String(i + 1));
const html = document_(rendered).replaceAll('@@TOTAL@@', String(total)).replace('</style>',
  `.sweepq { max-height: 108mm; object-fit: contain; object-position: left top; }
   .sweepa { max-height: 120mm; object-fit: contain; object-position: left top; }
   /* A drill's solution page carries the tick grid as well as the rationale, so
      the rationale gets less room -- the same 74mm build_sweep.mjs settled on
      for the same reason. Only drill sheets get the class. */
   .drillans { max-height: 74mm; }
   </style>`);
// Before rendering: a refused build must leave no .note behind (issue 2026-11-01).
if (chosen.length) claimStem(stem, chosen, { rebuild: cliArgs.has('rebuild') });
await buildNote(html, { stem, outDir, carryFrom });
if (chosen.length) {
  saveUsed(stem, chosen, { rebuild: cliArgs.has('rebuild') });
  console.log(`bank questions injected: ${chosen.length}`);
}
