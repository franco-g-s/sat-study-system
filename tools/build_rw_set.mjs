// Build a Reading & Writing blocked set.
//
//   node tools/build_rw_set.mjs "Boundaries" --n 25 --target R03
//   node tools/build_rw_set.mjs "Words in Context" --n 20 --dry
//   node tools/build_rw_set.mjs "Transitions" --n 20 --untimed   # no time box
//
// The R&W counterpart of build_sweep.mjs, and deliberately a SIMPLER thing.
//
// A maths sweep round-robins across the derived types inside one CB skill, which
// is why it needs data/type_assignments.json and a taxonomy. R&W has no such
// layer and does not need one: the plan's unit of work is literally "25
// Boundaries questions in a row", which is a filter on skill and difficulty --
// and the indexer already emits both. So this selects, crops and lays out. That
// is the whole job.
//
// NO TIME BOX BY DEFAULT, and that is the one real design difference. The sweep
// times every question because on maths the diagnosis IS speed. The R&W habits
// being built here run the other way -- R3 is "read to the period before you
// choose", which is deliberately slower than instinct -- so a stopwatch on
// the page would train against the thing the page exists to teach. `--timed` puts
// it back for a mixed set, where pacing is the point.
import { readFileSync, existsSync } from 'node:fs';
import {
  ROOT, md, esc, dataUri, cropImages, rwIndex, skillKey,
  spokenFor, saveUsed, claimStem, overleaf, page, document_, buildNote, timeBox, endPage,
} from './sheet.mjs';
import { cli, numberFlag } from './cli.mjs';

// Parsed first, before anything reads or writes state: an ignored flag used to
// mean a full build that marks its questions used (see build_mixed, 2026-09-21).
// --timed is accepted as a no-op: timed has been the default since 2026-09-08,
// and the README still documents the flag.
const USAGE = `usage: node tools/build_rw_set.mjs "<CB skill>[,<CB skill>...]" [--n 25] [--target R03]
         [--difficulty Medium,Hard] [--untimed] [--out DIR] [--dry]
         [--name RW-<label>-<date>] [--rebuild] [--qids id,id,...]

  --dry       print the selection; build nothing, consume nothing
  --untimed   drop the per-question time box (timed is the default)
  --name      the sheet's stem (must start RW-). Use it for any set whose skill
              list an earlier set already used -- the default stem is derived
              from the skills, so it would collide
  --rebuild   allow replacing an existing record whose questions differ
  --title     cover heading, when the skill list is not what the set is about
  --qids      serve exactly these questions, in this order, instead of drawing
              from the skill pool. For a set aimed at a passage TYPE (archaic
              drama) that no skill filter can express. Still refuses spoken-for ids.

A real run renders the .note AND marks its questions used in state/used_questions.json.`;
const args = cli(USAGE, { values: ['n', 'out', 'target', 'difficulty', 'name', 'qids', 'title'], bools: ['dry', 'untimed', 'rebuild'], noop: ['timed'] });
const flag = args.flag;
const skillArg = args.positional[0];
if (!skillArg || args.positional.length > 1) {
  console.error(USAGE);
  console.error('skills: ' + [...new Set(rwIndex.map(r => r.skill))].sort().join(' · '));
  process.exit(2);
}
const N = numberFlag(args, 'n', 25);
const outDir = flag('out', `${ROOT}/out`);
const target = flag('target', null);
const dry = args.has('dry');
// TIMED BY DEFAULT now. It was off originally because R1's habit --
// work out the meaning before reading the options -- is deliberately slower than
// instinct, and a stopwatch would have trained against the page. That was
// right then and is wrong now: the early sheets all came back at 21-24 out of
// 25, so knowledge is no longer the binding constraint. What is unmeasured is
// rate, and R&W is 54 questions in 71 minutes -- about 79 seconds each. Several
// returned pages said only "took a while", which is not a number.
const timed = !args.has('untimed');
const DIFFS = (flag('difficulty', 'Medium,Hard')).split(',').map(s => s.trim());

if (!rwIndex.length) {
  console.error('data/rw_index.json is missing or empty — index the R&W bank first.');
  process.exit(1);
}

// ---- skill resolution ------------------------------------------------------
// Case-insensitive and whitespace-insensitive, because the bank is not
// self-consistent: "Cross-Text Connections" appears 50 times and "Cross-text
// Connections" twice, in College Board's own metadata. The index records what the
// PDF says -- correcting the source would hide it -- so the tolerance lives here.
//
// SEVERAL skills, comma-separated, because a target need not be one CB skill. R6
// is "central ideas, inference, quantitative evidence" in the plan, which is two
// bank skills; building it on one would silently drop half the target. The
// resolution below runs per name so a typo in the second still fails loudly.
const skills = [...new Set(rwIndex.map(r => r.skill))];
const resolve = (arg) => {
  const exact = skills.filter(s => skillKey(s) === skillKey(arg));
  const near = exact.length ? exact : skills.filter(s => skillKey(s).includes(skillKey(arg)));
  if (!near.length) {
    console.error(`no such R&W skill: ${arg}\nknown:\n  ` + skills.sort().join('\n  '));
    process.exit(1);
  }
  return { canonical: exact[0] ?? near[0], all: near };
};
const asked = skillArg.split(',').map(x => x.trim()).filter(Boolean).map(resolve);
const wanted = new Set(asked.flatMap(a => a.all.map(skillKey)));
// DEDUPE, because two arguments can resolve to the SAME canonical skill and a
// duplicated lane serves the same question twice. "Form, Structure, and Sense"
// contains commas, so passing it in the comma-separated list splits into three
// arguments that each resolve back to it -- and the 2026-09-24 mixed set came
// out of --dry with one question three times. A sheet that asks the same
// question twice is a broken sheet, so this is guarded in two places: here, and
// by qid in the round-robin below.
const skillNames = [...new Map(asked.map(a => [skillKey(a.canonical), a.canonical])).values()];
// Ten skills joined with " + " is a 150-character h1 and a cover page that
// overflows -- found building the 2026-09-24 Hard-only mixed set. Past three
// skills the list stops being a title and becomes a table of contents, so the
// cover gets a short label and the full list stays in the console output and in
// the per-question footers, which is where it is actually useful.
const domains = [...new Set(skillNames.map(n =>
  rwIndex.find(r => skillKey(r.skill) === skillKey(n)).domain))];
const domain = domains.join(' + ');
const skillList = skillNames.join(' + ');
const skillName = flag('title', null) ?? (skillNames.length > 3
  ? `Hard mixed — ${domains.length === 4 ? 'all four domains' : domains.join(' + ')}`
  : skillList);

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '');
// The stem drives BOTH the used-questions key and the remote folder route, so it
// has to start with RW: push_note.mjs files anything matching ^RW into
// Note/SAT/English and refuses names it cannot place.
//
// The default stem is a function of the SKILL LIST, not of the set, so two sets
// over the same skills collide (2026-11-01: CS01's R&W half landed on an earlier
// set's key, erased its 20-question record and re-served 5 of them). claimStem()
// below now refuses that; --name is how a second set over the same skills gets
// its own identity, and how the hand-named sets (RW-cs01-2026-11-06, ...) are
// rebuilt.
const nameFlag = flag('name', null);
if (nameFlag !== null && !/^RW-[A-Za-z0-9][A-Za-z0-9-]*$/.test(nameFlag)) {
  console.error(`--name must look like RW-<label> (letters, digits, hyphens): push_note routes on ^RW. Got ${nameFlag}`);
  process.exit(2);
}
const stem = nameFlag ?? `RW-${target ? `${target.toLowerCase()}-` : ''}${slug(skillNames.join('-'))}`;

// ---- selection -------------------------------------------------------------
const taken = spokenFor(stem);
const pool = rwIndex
  .filter(r => wanted.has(skillKey(r.skill)) && DIFFS.includes(r.difficulty) && !taken.has(r.qid))
  .sort((a, b) => a.qid.localeCompare(b.qid));      // deterministic: same sheet, same questions

// Interleave the difficulties rather than serving all the Mediums and then all
// the Hards. A blocked set is meant to make the SHAPE of the question type
// visible, and a sheet that gets uniformly harder measures stamina instead.
// Round-robin over every (skill, difficulty) lane, so a two-skill set alternates
// instead of serving one skill and then the other, and neither skill is starved
// if the other has the bigger pool.
const lanes = [];
for (const n of skillNames) for (const d of DIFFS) {
  lanes.push(pool.filter(r => skillKey(r.skill) === skillKey(n) && r.difficulty === d));
}
const chosen = [];
const qidsFlag = flag('qids', null);
if (qidsFlag) {
  for (const id of qidsFlag.split(',').map(x => x.trim()).filter(Boolean)) {
    const r = rwIndex.find(x => x.qid === id);
    if (!r) { console.error(`--qids: ${id} is not in data/rw_index.json`); process.exit(1); }
    if (r.leak === 'True' || r.leak === true) { console.error(`--qids: ${id} is a leak row (answer on the question page)`); process.exit(1); }
    if (taken.has(id)) { console.error(`--qids: ${id} is already spoken for by another sheet`); process.exit(1); }
    chosen.push(r);
  }
}
for (let round = 0; !qidsFlag && chosen.length < N; round++) {
  let progressed = false;
  for (const lane of lanes) {
    if (chosen.length >= N) break;
    const q = lane[round];
    if (!q) continue;
    progressed = true;                 // the lane HAD a row; a dup is not exhaustion
    if (chosen.some(c => c.qid === q.qid)) continue;
    chosen.push(q);
  }
  if (!progressed) break;
}

console.log(`domain: ${domain}`);
const variants = asked.reduce((n, a) => n + a.all.length - 1, 0);
console.log(`skill:  ${skillList}${variants ? `  (+${variants} spelling variant)` : ''}`);
console.log(`pool:   ${pool.length} unused at ${DIFFS.join('+')}`);
console.log(`chose:  ${chosen.length}` + (!qidsFlag && chosen.length < N ? `  — ASKED FOR ${N}, POOL IS SHORT` : ''));
for (const d of DIFFS) console.log(`          ${d}: ${chosen.filter(c => c.difficulty === d).length}`);
if (!chosen.length) { console.error('nothing to build.'); process.exit(1); }
// Before --dry exits, so a dry run shows a collision too; before buildNote, so a
// refused build leaves no .note behind.
claimStem(stem, chosen.map(q => q.qid), { rebuild: args.has('rebuild'), dry });
if (dry) { for (const c of chosen) console.log(`  ${c.qid}  ${c.difficulty}`); process.exit(0); }

// ---- the rule card ---------------------------------------------------------
// Authored, never generated — the same rule as content/targets/. If the target
// has no card yet the sheet still builds, and says so rather than inventing one.
// The tick grid IS the diagnosis, so its options have to be this target's actual
// failure modes. "Decided before the end of the sentence" is R3's trap and means
// nothing on Command of Evidence; a grid of options that cannot apply produces a
// page of unticked boxes and tells us nothing. Targets declare their own in
// frontmatter; the default below is only for a set built without a card.
let TRAPS = [
  'had it', 'down to two, guessed',
  'knew it, took a while', 'misread the text',
  'a word I could not define', 'no method',
];
let cardPages = [];
if (target) {
  const hits = ['md'].map(e => `${ROOT}/content/rw/${target}.${e}`).filter(existsSync);
  if (hits.length) {
    const raw = readFileSync(hits[0], 'utf8');
    const fmEnd = raw.indexOf('\n---', 4);
    const hasFm = raw.startsWith('---') && fmEnd > 0;
    const body = hasFm ? raw.slice(fmEnd + 4) : raw;
    if (hasFm) {
      // Just enough YAML for a single top-level list. A real parser is not worth
      // adding for one key, and anything it silently mis-read would show up as a
      // wrong grid on the page rather than as an error.
      const fm = raw.slice(4, fmEnd).split('\n');
      const at = fm.findIndex(l => /^traps:\s*$/.test(l));
      if (at !== -1) {
        const items = [];
        for (const l of fm.slice(at + 1)) {
          const m = l.match(/^\s+-\s+(.*\S)\s*$/);
          if (!m) break;
          items.push(m[1].replace(/^["']|["']$/g, ''));
        }
        if (items.length) TRAPS = items;
      }
    }
    cardPages = body.split('<!-- PAGE -->').map(p => p.trim()).filter(Boolean);
    console.log(`card:   content/rw/${target}.md — ${cardPages.length} page(s), ${TRAPS.length} traps`);
  } else {
    console.log(`card:   none at content/rw/${target}.md — building without one`);
  }
}

// ---- pages -----------------------------------------------------------------
const pages = [];
const foot = (s) => `${esc(stem)} · ${s}`;

pages.push(page({
  inner: `<h1${skillName.length > 34 ? ' class="long"' : ''}>${esc(skillName)}</h1>
<p><em>${chosen.length} questions from ${esc(domain)}, one per page, the official
explanation on the page after. ${DIFFS.join(' and ')} only — the easy ones are not
where anything is learned.</em></p>
<h3>How to run it</h3>
<ol>
<li><strong>Straight through, no stopping.</strong> Do not check an answer until
the end. Doing ${chosen.length} in a row is the point — it is what makes the shape
of the question type visible, and one-at-a-time does not do it.</li>
<li><strong>Circle your letter on the question page</strong> before you turn over.</li>
${timed ? '<li><strong>Write the seconds in the box.</strong></li>' : ''}
<li>Then go back through, check, and tick <em>what happened</em> on each solution
page. The tick is the diagnosis; the answer is not.</li>
<li><strong>Every word you cannot define goes on the last page the moment you meet
it</strong>, with nothing else. Not afterwards — afterwards never happens.</li>
</ol>
<h3>What happens after</h3>
<p>Afterwards, score it and count which trap fired, not how many you got
right. ${skillNames.length > 3
  ? 'Every question here is Hard, and Hard questions are where R&amp;W misses concentrate — so this sheet is nothing but the tail'
  : `${esc(skillName)} is a small closed rule set; what varies is
which way you get talked out of it`}.</p>
<blockquote><p>The R&amp;W section is 54 questions in 71 minutes. This sheet is
not remedial. It is making sure an intuition you cannot
currently distinguish from knowledge is actually knowledge.</p></blockquote>`,
  foot: foot(`cover · ${new Date().toISOString().slice(0, 10)}`),
}));

// The rule card sits AFTER the cover and BEFORE the questions: it is the thing the
// block opens by reading, and it is why this replaced a separate notes file.
cardPages.forEach((p, i) => pages.push(page({
  inner: md(p.replace(/<!--[\s\S]*?-->/g, '').trim()),
  foot: foot(`the rule · ${i + 1}/${cardPages.length}`),
})));

const CHOICES = ['A', 'B', 'C', 'D'];
chosen.forEach((q, i) => {
  const { qPng, aPng, hPng, extra } = cropImages(q);
  const n = i + 1;
  pages.push(page({
    // The answer circles go in the HEADER, where a sweep puts its time box, not
    // in a row under the question. An R&W stem can be a full paragraph plus four
    // sentence-length options, and a row below it costs the image ~30mm of height
    // -- which `object-fit: contain` pays for by shrinking the text sideways too.
    // The passage has to stay readable; the choice does not need much room.
    inner: `<div class="qhead"><h2>Question ${n} / ${chosen.length}</h2>
        <div class="answerbox">${timed ? timeBox() : ''}<span class="k">answer</span>${
          CHOICES.map(c => `<span class="choice">${c}</span>`).join('')}</div></div>
      <img class="qb rwq" src="${dataUri(qPng)}">`,
    foot: foot(`question ${n} · ${esc(q.qid)} · ${esc(q.difficulty)}`),
  }));
  pages.push(page({
    inner: `<h2>Question ${n} · answer${overleaf(extra)}</h2>
      ${hPng ? `<img class="qb rwh" src="${dataUri(hPng)}">` : ''}
      <img class="qb rwa" src="${dataUri(aPng)}">
      <div class="selfreview"><div class="srhead">what happened?</div>
        <div class="trapline">${TRAPS.map(esc).join(' &nbsp;·&nbsp; ')}</div>
        <div class="srwrite"></div><div class="srwrite2"></div><div class="srwrite3"></div></div>`,
    foot: foot(`answer ${n} · ${esc(q.qid)}`),
  }));
  extra.forEach((e, k) => pages.push(page({
    inner: `<h2>Question ${n} · answer (cont.)</h2><img class="qb rwa" src="${dataUri(e)}">`,
    foot: foot(`answer ${n} cont. ${k + 2} · ${esc(q.qid)}`),
  })));
});

// The vocabulary page is not decoration -- two of six R&W errors on one practice test
// were unknown words with the context work already done correctly, and the
// vocabulary system is "write it down the moment you meet it". A blocked set is
// exactly when you meet them, so the place to write has to be in your hand.
//
// But NOT on Standard English Conventions. A returned SEC page said so in the
// margin: there were no unknown words, and SEC was not testing vocabulary. Correct --
// SEC tests punctuation and clause structure, and a page asking for words nobody
// met teaches that the sheet asks for things that do not apply.
const WANTS_VOCAB = domain !== 'Standard English Conventions';
if (WANTS_VOCAB) pages.push(page({
  inner: `<h1>Words I could not define</h1>
<p><em>The word, and the sentence you met it in. Nothing else — the meaning gets
looked up afterwards, and writing it now is what stops you doing that.</em></p>
<div class="vocab">${Array.from({ length: 10 }, () => '<div class="vrow"></div>').join('')}</div>`,
  foot: foot('vocabulary'),
}));

pages.push(endPage(stem));

// ---- build -----------------------------------------------------------------
// R&W question crops are TALLER than maths ones -- a Command of Evidence stem can
// be a full paragraph plus four sentence-length options -- so they get most of the
// page and the answer row is a single line rather than a working grid. There is no
// working to do on an R&W question; there is a choice.
const html = document_(pages).replace('</style>',
  `.rwq { max-height: 178mm; object-fit: contain; object-position: left top; }
   .rwa { max-height: 93mm; object-fit: contain; object-position: left top; }
   /* "Question 10 / 12" wrapped to two lines once the time box joined the header:
      heading, box and four circles together exceed the column, and the heading is
      the only flexible thing there. nowrap plus a small shrink keeps it on one
      line -- a heading that reflows changes the page height question by question,
      which is exactly what the overflow guard is measuring against. */
   .qhead h2 { white-space: nowrap; flex: 0 1 auto; }
   .answerbox { display: flex; align-items: center; gap: 3mm; flex: 0 0 auto; }
   .answerbox .k { font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; opacity: .55; }
   .answerbox .choice { width: 8mm; height: 8mm; border: 1.1pt solid #000; border-radius: 50%;
     display: inline-flex; align-items: center; justify-content: center; font-size: 10pt; }
   /* The tick boxes are gone, and this is why. Across the first two sets 13
      solution pages were annotated and ZERO boxes ticked, while every writing
      line was used -- and the prose was far more useful than a tick would have
      been (a note explaining why the first plausible option almost won again is
      a diagnosis; a tick is a category). The trap names survive
      as a prompt, because naming the failure modes is what makes them findable,
      but they no longer cost six rows of page. */
   .trapline { font-size: 3.2mm; color: #555; line-height: 1.5; margin: 0 0 2.5mm; }
   .srwrite3 { margin-top: 3.5mm; border-bottom: 0.3mm solid #888; height: 7mm; }
   .vocab { margin-top: 6mm; }
   .vrow { border-bottom: .8pt solid #000; height: 11mm; }
   </style>`);

await buildNote(html, { stem, outDir });
saveUsed(stem, chosen.map(q => q.qid), { rebuild: args.has('rebuild') });
console.log(`\npush with:  node tools/push_note.mjs out/${stem}.note "RW${target ? ' ' + target : ''} ${skillName} — set.note"`);
