# Design notes

Why the system is built the way it is. For how to use it, see
[how-it-works.md](how-it-works.md).

## The problem

A study plan that says "study completing the square on Tuesday" leaves the
real work to the moment when willpower is lowest. At 06:00, or in the evening
after a full working day, someone has to pick questions, decide how many,
find the solutions, and choose an order. That friction is enough to stop a
session from happening at all.

The systems people actually stick with share one property: **you show up, and
everything is already decided.** You don't have to work out what to do, how,
or in what order. This project applies that to the SAT. Each study block is
one self-contained notebook, built in advance and identical in structure
every time, so there is nothing to learn twice and nothing to decide.

There is a second, quieter problem: **drilling where teaching is needed.**
Doing twelve practice questions on a procedure you don't have produces twelve
wrong answers, not learning. And studying only the questions you got wrong
teaches you those questions, not the skill behind them. The design separates
*finding out what is weak*, *teaching it*, and *checking that it stayed*.

## Speed, not knowledge

The maths section allows about 95 seconds per question. For a student who
already knows most of the material, that is plenty when the method arrives
instantly and nowhere near enough when it doesn't: exploring takes three to
five minutes. The target is therefore **automaticity**, meaning instant
recognition of the question type and instant recall of the procedure. That
comes from many repetitions across many types, not from depth on one.

This is a hypothesis to check, not something to assume, so **every question
is timed**. Without a number, "slow" is just an impression. The timing can
also overturn the hypothesis: a sweep finished quickly with many wrong answers
means knowledge is the bottleneck for that skill, and the right response is
teaching, not drilling. Report it when the data argues against the plan.

One practice test isn't enough to diagnose this. A single test samples only
a fraction of the roughly 100 question types in the bank, chosen by whatever
happened to appear on that form. That is why the system starts with
**coverage**: meet every type once, timed, and spend remediation hours only
where the clock says to.

**Mechanical errors are kept separate.** A wrong answer with flawless working
(a slip, a misread, stopping one step early) says nothing about whether you
know the type, and drilling doesn't fix it. These outcomes are counted across
all types (`types_state.py mechanical`) and never change a type's status.

## Three layers

| Layer | Role |
|---|---|
| **College Board skill** (19) | Too coarse to act on: all of Advanced Math is three skills. Used only to filter the bank |
| **Type** (100) | What a sweep diagnoses and what carries a status |
| **Underlying skill** (34) | What remediation fixes. Many-to-many with types |

The underlying-skill layer exists because one weakness shows up in many
places. *Factor a quadratic* sits inside six types across two College Board
skills. Remediating each type separately would mean six sheets for one
weakness. Remediating the underlying skill once fixes all six, and that
difference is often what makes a study plan fit the hours available.

The underlying skills are the one part of the taxonomy written top-down, by
reading the 100 procedures rather than the questions. That makes them the
most likely part to be wrong. **Expect to correct them from the evidence your
sweeps produce.** `taxonomy.json` has a `_corrections` list for recording why.

## How the taxonomy was built

The types were derived by having a model **read cropped question images**,
one College Board skill at a time. The first attempt produced about 970
"types", which was a list of questions rather than a classification. Three
fixes, each of which generalises:

1. **Give a number, not an adjective.** "Granular" means anything. A cap on
   types per skill bounds the total by arithmetic.
2. **Batch by skill.** A tagger that sees 29 questions from 20 skills never
   sees a repeat, so it can't recognise one. Large single-skill batches can.
3. **Tag from images, not text.** About a fifth of question stems are under
   120 characters because the maths is an image. A text-only reader sees
   "If , what is the value of ?" and guesses.

Assignment to types then used a **closed label set**. The tagger had to pick
an exact type name or `unmatched`, and anything else was rejected at merge
time. Free text drifts ("interpret slope" for "interpret slope or apply slope
properties") and quietly turns 100 types into 130. `unmatched` is a
legitimate answer (80 of 1,157 questions), and forcing those questions into a
type would hide the gap. The tagger also had to read the question ID **off
the image**, as an identity check on the crop.

## The corpus

College Board's question-bank PDF export has properties that make this
possible:

- **One question per page**, each with `Question ID`, Domain, Skill,
  Difficulty, the `Correct Answer` line and a rationale.
- **Mathematics is rendered as images.** The text layer is used to *choose*
  questions, and the *page image* is what goes on a sheet.
- **Rationales can spill onto a following page with no `Question ID`.** That
  page continues the previous question. Treating it as a new question shifts
  every page-to-question mapping after it.
- **Keys are question IDs, never page numbers.** IDs survive any re-export,
  reordering or filtering. Page numbers survive none of them.

The page is exported once, *with* answers, and cropped. The part above the
`Correct Answer` line becomes the question image, and the rest becomes the
solution.

### Fail closed

The crop line moves by up to 400 pt depending on question length, so it has
to be detected rather than fixed. **A question whose answer line can't be
located is dropped**: never cropped at a guess, never shown uncropped.
Dropping about 5% of the bank costs nothing. Leaking one answer onto a
practice page costs the credibility of every sheet after it.

`verify_index.swift` then checks the **index**, not a sample of images. For
every row it confirms that the page really carries that question ID, that
the crop area contains the question header, and that the crop area does not
contain `Correct Answer`. Because it checks the coordinates every crop is
cut from, it covers crops that haven't been made yet.

### Lessons from the PDF text layer

- **Locate text from PDFKit selection bounds, never from a string offset.**
  `page.string` and PDFKit's character array are different arrays. Indexing
  one with an offset from the other put the crop line 29 pt too low on about
  150 pages, and the answer showed up on the question page.
- **Spaces disappear at text-run boundaries** (`Geometry andTrigonometry`),
  and some words are split (`ver tical`). Skills are compared with all
  whitespace removed. Split words are rejoined once, at index time, by a
  conservative dictionary rule, and stamped. Builders refuse an index that
  hasn't been normalised, because a search that silently misses a word
  produces confident wrong answers.
- **College Board's own labels aren't consistent** (`Cross-Text Connections`
  and `Cross-text Connections` both appear). The index keeps what the PDF
  says, and matching is case-insensitive.
- **The metadata table primes the answer.** It names the skill and shows the
  difficulty, and the real test shows neither. Question crops start below the
  table, and the table moves to the solution page.

## The sheets

**Sweep.** A coverage check. It rotates through every type in a skill, with
the most-populated types first, so if the question budget runs out the types
left uncovered are the small ones. The type name is **never on the question
page**: recognising the type in three seconds is the thing being measured.
The solution follows each question immediately, so the outcome is recorded
while the attempt is fresh.

**Remediation.** Written by hand, once. In order: derivation, trigger,
procedure, worked examples, and practice placed straight after each idea.
Practice questions carry a time box, because recognising a method you can't
reach under a clock isn't the goal. **One sheet per type, then move on**:
this keeps one hard topic from taking every hour. A type that is still weak
returns through drills, not through a second sheet.

**Cold re-sweep.** Fourteen days after a type is marked remediated, it comes
back with notes closed and timed. This is the only step that can show a
remediation didn't work, so a due re-sweep comes before more sweeping.

**Retrieval drill.** The one sheet *biased* towards weak types: remediated
and due first, then stuck, shaky and slow. It reuses a question only if you
got it wrong before, never one you got right. Repeating a question you
answered correctly would measure whether you remember an answer, not whether
a method survived.

**Mixed set.** A rehearsal for pacing, so it is **deliberately status-blind
and representative**. Biasing it towards weak types would make it harder than
a real module, and "questions reached" would stop meaning "kept test pace".
It runs R&W and maths as **separate sections with separate clocks**, at real
per-question rates, because that is how the test is run.

**R&W sets.** These need no taxonomy. The unit of work is "25 Boundaries
questions in a row", which is a filter on skill and difficulty. Difficulties
alternate instead of getting harder towards the end: a set that keeps getting
harder measures stamina rather than showing what the question type looks
like. A time box is on by default and `--untimed` removes it, for habits that
are deliberately slower than instinct, such as reading to the end of the
sentence before choosing.

## Statuses

`unswept → fast | good | slow | shaky | stuck → remediated`

**`good` is kept separate from `slow`.** It is the most common case, and
merging the two would send remediation at types that are already fine.
Status comes from the **most recent outcome that wasn't a slip or misread**
(*no method* → stuck, *wrong method* or *gave up* → shaky, *slow to
recognise* → slow), otherwise from median time. It is a suggestion. The
person reading the page sees the working and can override it.

## Reliability

- **Deterministic selection.** Selection sorts by question ID, never at
  random, and excludes questions used by other sheets but not the sheet's own
  record. Rebuilding a sheet picks the same questions. The `.note` writer is
  seeded by the sheet name, so an unchanged sheet rebuilds to the same pages.
  (Some covers print the build date, so a rebuild on a different day differs
  only in that line.)
- **Builds refuse rather than degrade.** If content overflows a page, a
  workspace is too small to write in, a `CHECK` fails, a type's cue contains
  details from one specific question, or the index isn't stamped, the build
  stops.
- **Handwriting is irreplaceable.** Push checks a local record of what was
  last pulled and pushed, not just the cloud copy, so a cloud copy that has
  reverted to a blank sheet can't be mistaken for an unwritten one.
- **Look at the output.** Several bugs during development passed every
  automated check because the checks validated the pipeline rather than the
  artifact: figure-only pages shifted page numbers, a crop cache served
  images from before a fix, and a crop line was "verified" against the same
  wrong coordinate it was computed from. Each was found by rendering a page
  and looking at it. `note_render.mjs` exists for exactly that, and crop file
  names include the page and crop line they came from, so a stale crop can
  never be reused.

## Delivery

Sheets are real Supernote `.note` notebooks: you open and write in them on
the device, with no PDF import. The page geometry matches the device screen
exactly (1920 × 2560), so no resampling happens. The writing grid is defined
in device pixels so every cell renders the same. Small print in question
images is enlarged block by block. Rendering and the `.note` format come from
[xiehanzi](https://github.com/franco-g-s/xiehanzi), a handwriting-practice
generator built on the same idea of one finished artifact per session.

Builds never call a model and never read personal notes at run time. Their
only inputs are the repo, your PDFs, `state/`, and the xiehanzi renderer. Everything that needs judgement (the taxonomy, the type assignments,
the authored sheets) is done once, ahead of time, and stored in the repo.

## Non-goals

- **Not a replacement for full practice tests.** Timed full-length tests
  belong on College Board's own app, which the paper format can't imitate.
- **Not automatic scheduling.** The state tracker suggests what to do next.
  When to study is up to you.
- **Not a content source.** No questions are included. You bring your own
  export.
