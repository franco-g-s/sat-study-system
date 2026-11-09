// Build a SPACED-RETRIEVAL DRILL -- the "is it still there?" session.
//
//   node tools/build_drill.mjs                 # 16 questions, today's date
//   node tools/build_drill.mjs --n 20
//   node tools/build_drill.mjs --dry           # print the selection, write nothing
//
// This is the third kind of maths sheet and it exists because RS01 falsified the
// assumption the first two rest on. A sweep asks "which types are slow?"; a
// mixed set asks "did you finish the module?". Neither asks "is the method you
// were taught a fortnight ago still there?" -- and when that was first checked,
// the answer for four of seven remediated types was no. One remediation
// follow-up had a square root taken across an inequality correctly in 75 s;
// two weeks later that step was gone.
//
// Why it is not build_mixed.mjs with a status filter. A mixed set claims
// "finishing here means finishing there", and that claim holds only if the draw
// is REPRESENTATIVE. Biasing it toward weak types makes the set harder than a
// real module, at which point "questions reached" stops meaning "kept test
// pace" while still printing a comparable-looking number. Pacing rehearsal
// needs a representative draw; spaced retrieval needs a biased one. Status
// blindness in build_mixed.mjs is a feature, and this file is where the bias
// belongs.
//
// Why it emits markdown instead of pages. build_note.mjs already renders bank
// crops and hand-authored typeset questions on the same sheet -- R02FU1 was an
// authored discriminant question, sat and answered in 75 s. Emitting a
// target sheet means authored questions are an edit to this file's output
// rather than a second rendering path, which was a design requirement.
//
// It also doubles as the cold re-sweep. A due re-sweep is tier 1 here, and
// recording its encounters is what closes it -- no change to types_state.py,
// because `next` already gates the due list on status == 'remediated' and the
// verdict comes from `set-status` at review time.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { selectDrill, MIN_REUSE_GAP } from './drill_select.mjs';
import { cli, numberFlag } from './cli.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const yamlSafe = (s) => String(s).replace(/---/g, '- - -');

/**
 * The sheet's identity, used for BOTH the used_questions.json key and the
 * filename -- and they have to be the same string.
 *
 * They were not, and a rebuild of DR01 reproduced 1 of its 20 questions.
 * build_note.mjs keys used_questions.json by the markdown BASENAME, so
 * excluding a differently-spelled stem here meant spokenFor() treated the
 * sheet's own twenty questions as another sheet's and picked nineteen fresh
 * ones. push_note.mjs tells an untouched notebook from a written-on one by
 * checksum, so a build that silently changes its own contents defeats the
 * guard that protects the handwriting.
 */
export const drillStem = (id, date) => `${id}-${date}`;
export const drillBasename = drillStem;

/**
 * The target sheet, as markdown for build_note.mjs.
 *
 * The frontmatter carries WHY each question is on the sheet -- tier, days
 * stale, whether it is a re-use. Reviewing RS01 (a re-sweep sheet) meant re-deriving
 * every earlier baseline by hand because the sheet did not record its own intent; this is
 * that fix, and it is the difference between a review that reads the plan and
 * one that reconstructs it.
 */
export const drillMarkdown = ({ id, date, picks, shortfalls = [], relaxed = [] }) => {
  const types = new Set(picks.map((p) => p.typeKey));
  const reuses = picks.filter((p) => p.reuse).length;
  const due = picks.filter((p) => p.tier === 1).length;

  const fm = [
    '---',
    `id: ${id}`,
    `title: Retrieval drill ${id.replace(/^DR/, '')}`,
    `subtitle: ${picks.length} questions across ${types.size} types, timed, notes closed`,
    'kind: drill',
    `date: ${date}`,
    `n: ${picks.length}`,
    'selection: >',
    '  Status-weighted, stalest first. Two questions where a verdict is being set',
    '  (a cold re-sweep that has fallen due, or a stuck type) and one where the',
    '  point is only to keep a method warm.',
    'questions:',
    ...picks.flatMap((p) => [
      `  - qid: ${p.qid}`,
      `    type: ${yamlSafe(p.typeKey)}`,
      `    tier: ${p.tier}`,
      `    days_stale: ${p.daysStale === Infinity ? 'never met' : p.daysStale}`,
      `    reuse: ${p.reuse}`,
    ]),
    shortfalls.length
      ? ['shortfalls:', ...shortfalls.map(
        (s) => `  - ${yamlSafe(s.typeKey)} wanted ${s.wanted} got ${s.got} (${s.reason})`,
      )].join('\n')
      : 'shortfalls: none',
    relaxed.length
      ? ['relaxed:', ...relaxed.map((r) => `  - position ${r.at}: ${r.constraint}`)].join('\n')
      : 'relaxed: none',
    '---',
  ].join('\n');

  const cover = `# Retrieval drill — is it still there?

**${picks.length} questions across ${types.size} types.** Every one is a type the
board says is weak, or one a remediation sheet claimed to fix. Nothing here is new
material.

## What this is for

A sweep found out which types were slow. A remediation sheet taught the method.
**This asks whether the method is still there** — which is a different question,
and when it was first checked, the answer for four of seven types was no.

> **A miss here is the sheet working.** If everything on this were easy there
> would be no reason to run it.
${due ? `
**${due} of these questions close a cold re-sweep** that has fallen due. Those are
the ones that can overturn a verdict, so they carry two questions each rather than
one — with a single question a slip and a lost method look identical.
` : ''}${reuses ? `
**${reuses} ${reuses === 1 ? 'question is one' : 'questions are ones'} you have met before**, and in every
case ${reuses === 1 ? 'it is one you got wrong or left blank' : 'they are ones you got wrong or left blank'}. Nothing you answered correctly is ever
re-served — that would measure whether you remember an answer, not whether a
method survived.
` : ''}`;

  const howTo = `## How to run it

1. **Notes closed.** Do not look back at the remediation sheets. That destroys the measurement, and the measurement is the only thing this sheet produces.
2. **Stopwatch, lap, write the seconds in the box before you turn the page.** A page without a number tells us nothing.
3. **Three minutes is the cap.** Write the time, move on. A question that runs past it is almost never one more time would have solved.
4. **Don't mark yourself right or wrong.** The answer key does that.
5. On the solution page, tick what happened and add a line if there is one. That line is consistently the most useful thing on the page.

**The goal is speed.** Not "did you get it" — you have been taught all of these.
Whether the method arrives in forty seconds or two minutes is the whole result.

<!-- QUESTIONS: ${['label=Drill', ...picks.map((p) => p.qid)].join(', ')} -->`;

  const stop = `## Stop here

Nothing after this page.

Two things I cannot read off the paper:

1. **Which ones arrived and which ones you rebuilt.** A type you reconstructed from scratch in forty seconds and a type you recognised instantly both look like "40 s" in the box, and they need different follow-ups.
2. **Whether any question felt familiar as a question** rather than as a type — whether you remembered the answer. That is the one thing that would make a re-used question worth less than it looks, and you are the only one who can tell me.`;

  return [fm, '', '<!-- PAGE -->', '', cover, '<!-- PAGE -->', '', howTo, '', '<!-- PAGE -->', '', stop, ''].join('\n');
};

// ---- CLI -------------------------------------------------------------------
const nextId = () => {
  const dir = `${ROOT}content/targets`;
  const used = existsSync(dir)
    ? readdirSync(dir).map((f) => /^DR(\d+)-/.exec(f)).filter(Boolean).map((m) => Number(m[1]))
    : [];
  return `DR${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
};

const main = () => {
  // Parsed first: an ignored --help used to fall through to a real run, which
  // writes a DRnn target sheet into content/targets/ (see build_mixed, 2026-09-21).
  const args = cli(`usage: node tools/build_drill.mjs [--n 16] [--date YYYY-MM-DD] [--id DRnn] [--dry]

  --dry    print the selection; write nothing
  --id     REBUILD an existing drill instead of allocating the next number

Writes content/targets/DRnn-<date>.md. Questions are marked used later, by build_note.mjs.`, {
    values: ['n', 'date', 'id'], bools: ['dry'],
  });
  if (args.positional.length) {
    console.error(`build_drill.mjs takes no positional arguments, got: ${args.positional.join(' ')}`);
    process.exit(2);
  }
  const flag = args.flag;
  const n = numberFlag(args, 'n', 16);
  const dry = args.has('dry');
  // The date is an argument, not a clock read, so a rebuild reproduces the sheet.
  const date = flag('date', new Date().toISOString().slice(0, 10));

  const state = JSON.parse(readFileSync(`${ROOT}state/types.json`, 'utf8'));
  const assignments = JSON.parse(readFileSync(`${ROOT}data/type_assignments.json`, 'utf8')).assignments;
  const used = existsSync(`${ROOT}state/used_questions.json`)
    ? JSON.parse(readFileSync(`${ROOT}state/used_questions.json`, 'utf8')) : {};

  const id = flag('id', nextId());
  // This sheet's own questions must not be excluded, or a rebuild picks
  // different ones and push reads the difference as handwriting.
  const stem = drillStem(id, date);
  const spoken = new Set(Object.entries(used).filter(([k]) => k !== stem).flatMap(([, v]) => v));

  const { picks, shortfalls, relaxed } = selectDrill({
    types: state.types, assignments, spoken, today: date, n,
  });

  console.log(`${id} — ${picks.length} of ${n} questions, ${new Set(picks.map((p) => p.typeKey)).size} types`);
  for (const [i, p] of picks.entries()) {
    const stale = p.daysStale === Infinity ? 'never met' : `${p.daysStale}d stale`;
    console.log(`  ${String(i + 1).padStart(2)}. ${p.qid}  tier ${p.tier}  ${stale}${p.reuse ? '  RE-USE' : ''}  ${p.typeKey}`);
  }
  // Never a silent cap -- but the two reasons deserve different volume.
  // "Below the cut" happens on every run and is the budget working; a type the
  // BANK cannot supply is a standing limit on what can be drilled at all.
  const exhausted = shortfalls.filter((s) => s.reason === 'pool exhausted');
  const belowCut = shortfalls.filter((s) => s.reason === 'sheet full');
  const cooling = shortfalls.filter((s) => s.reason === 'cooling down');
  for (const s of exhausted) {
    console.log(`  EXHAUSTED: ${s.typeKey} wanted ${s.wanted}, got ${s.got} — no unseen or failed question left`);
  }
  for (const s of cooling) {
    console.log(`  COOLING: ${s.typeKey} wanted ${s.wanted}, got ${s.got} — its failed questions were met under ${MIN_REUSE_GAP} days ago`);
  }
  if (belowCut.length) {
    console.log(`  ${belowCut.length} more weak type(s) below the cut at n=${n} — they come up as these go quiet`);
  }
  for (const r of relaxed) {
    console.log(`  RELAXED at position ${r.at}: ${r.constraint}`);
  }
  if (picks.length < n) {
    console.log(`  asked for ${n}, filled ${picks.length} — the weak surface is thinner than the request`);
  }
  if (!picks.length) { console.error('nothing to drill.'); process.exit(1); }
  if (dry) return;

  const out = `${ROOT}content/targets/${drillBasename(id, date)}.md`;
  writeFileSync(out, drillMarkdown({ id, date, picks, shortfalls, relaxed }));
  console.log(`\nwrote ${out}`);
  console.log(`next:  node tools/build_note.mjs ${out.replace(ROOT, '')} out`);
  console.log(`then:  node tools/push_note.mjs out/${id}-${date}.note "Note/SAT/Math/Drills" "${id} retrieval drill.note"`);
};

if (process.argv[1] && fileURLToPath(new URL(`file://${process.argv[1]}`)) === fileURLToPath(import.meta.url)) {
  main();
}
