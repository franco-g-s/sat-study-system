# How it works

This page covers the study loop, the kinds of sheet, how results are recorded,
and a reference for every file in `tools/`. Setup is in [setup.md](setup.md).
The reasoning behind the design is in [design.md](design.md).

## Three layers

| Layer | Count | Role |
|---|---|---|
| **College Board skill** | 19 (maths) | College Board's own labels. Used only to filter the bank |
| **Type** | 100 | One recognisable kind of question with one fast procedure, e.g. *centre and radius from standard form*. **This is what gets timed and what carries a status** |
| **Underlying skill** | 34 | What remediation actually fixes, e.g. *factor a quadratic* or *complete the square*. One can appear in many types, and one type can use several. In the code these are called *primitives* |

Each type in `data/taxonomy.json` has a **cue** (the tell that lets you
recognise it within three seconds) and a **procedure** (one line describing
what a fast solver does). Both are printed on the solution page, never on the
question page: recognising the type is part of what is being measured.

A type is identified by `"<College Board skill> :: <type name>"`, for example
`"Circles :: centre and radius from standard form"`. That string is the key
you use when recording.

## The study loop

```
          ┌─────────────────────────────────────────────┐
          ▼                                             │
  next ──► sweep ──► record ──► plan ──► remediate / drill
                                              │
                         14 days later ◄──────┘
                         cold re-sweep ──► record
```

### 1. Pick what to sweep

```sh
python3 tools/types_state.py next
```

This lists the unswept types with the most questions in the bank first. Any
cold re-sweeps that are due are listed above them, and you should do those
first.

### 2. Sweep one skill

```sh
node tools/build_sweep.mjs "Nonlinear functions" --dry   # look first
node tools/build_sweep.mjs "Nonlinear functions"         # out/SW-nonlinear-functions.note
```

A sweep is a coverage check, not a lesson. It has about 15 medium or hard
questions from one skill, chosen by rotating through the types: every type
appears once before any appears twice, and types with more questions in the
bank come first. Each question page has a time box and space to work. The
page after it has the official answer and rationale, the type's cue and
procedure, and a "what happened?" checklist.

How to sit it (also printed on the cover): use a lap stopwatch, write the
seconds in the box before turning the page, cap each question at three
minutes, then turn over and tick what happened.

### 3. Record what happened

**You are the reviewer.** The sweep's cover mentions someone who reads the
pages and keeps the answer key. That can be a tutor, but it can just as well
be you, a day later. For each question page, read off:

- the **seconds** in the time box
- whether the answer matches the **Correct Answer** on the solution page
  (*right*, *wrong* or *blank*)
- **what happened**, which is one of seven outcomes, each pointing to a
  different fix:

| Outcome | Meaning | What fixes it |
|---|---|---|
| `had-it` | method arrived immediately | nothing |
| `slow-recog` | knew it, took a while to see it | reps across types; drill the cue |
| `slipped` | right method, slipped in the working | pacing habits, not drilling |
| `misread` | misread the question or figure | "write down what is being asked first" |
| `wrong-method` | had a route, and it was the wrong one | learn the right one |
| `bailed` | had a route, ran out of patience at the cap | judging when to move on, not maths |
| `no-method` | didn't know how to start | learn it from scratch |

Then record each one. Find the type key with `show`:

```sh
python3 tools/types_state.py show --skill "Nonlinear functions"

python3 tools/types_state.py record "<Skill :: type>" <qid> <seconds> <outcome> \
    --answered right --date 2026-03-14 --note "what actually stopped you"
```

- `seconds` can be `-` if the box was left empty. The encounter still
  counts, and its timing is recorded as unknown, not as zero.
- `--answered` **defaults to `wrong`**, so pass `--answered right` for a
  correct answer.
- The question ID is in each page's footer.

Status follows from the most recent encounter that wasn't a slip or misread:
`no-method` → **stuck**, `wrong-method` or `bailed` → **shaky**, `slow-recog`
→ **slow**. Otherwise it comes from the median time: ≤55 s **fast**, ≤110 s
**good**, above that **slow**. `slipped` and `misread` never move a type's
status. They are counted separately:

```sh
python3 tools/types_state.py mechanical     # slips, misreads and bails across everything
```

The status is a suggestion. If you know better (a right answer reached the
long way round, say), override it:

```sh
python3 tools/types_state.py set-status "<Skill :: type>" shaky --note "why"
```

Questions with **no type** go to a separate store so they can't move a
status. That covers every R&W question, plus maths questions that are Easy
(never assigned a type) or `unmatched`:

```sh
python3 tools/types_state.py record-untyped <qid> <seconds|-> <outcome> \
    --answered wrong --sheet RW-r03-boundaries --trap "chose before reading to the period"
python3 tools/types_state.py untyped --section rw      # "has this happened before?"
```

### 4. Decide what to fix

```sh
python3 tools/types_state.py plan
```

This shows how many types are in each status, how much of the bank has been
swept, and **which underlying skills sit under two or more slow, shaky or
stuck types**, with the share of the bank behind them. An underlying skill
that several weak types share is the best target for a remediation sheet,
because one sheet fixes all of them.

Weigh the size of the bank behind it, not just how many questions you missed.
An underlying skill is worth a study block when the questions behind it are.

### 5. Remediate

A remediation sheet is **written by hand** (`content/targets/R…md`): a short
derivation, the trigger, the procedure, worked examples, and practice pages,
with a time box on each practice question.
[authoring.md](authoring.md) describes the format. Build it with:

```sh
node tools/build_note.mjs content/targets/R05-rational-expressions.md
```

Then mark the types it covers as remediated. This schedules a cold re-sweep
14 days later:

```sh
python3 tools/types_state.py set-status "<Skill :: type>" remediated --remediated-by R05
```

**One sheet per type, then move on.** If a type is still weak after its
sheet, the re-sweep sends it back to `shaky` and it returns through drills.
Don't write it a second sheet straight away.

### 6. Drill and re-sweep

```sh
node tools/build_drill.mjs --dry
node tools/build_drill.mjs                       # writes content/targets/DRnn-<date>.md
node tools/build_note.mjs content/targets/DR01-<date>.md
```

A retrieval drill is the only sheet chosen **from your state**. It ranks
types into tiers: remediated types whose re-sweep is due (two questions
each), then stuck (two), shaky (one) and slow (one). Within a tier, types you
haven't seen for longest come first, and repeats of the same type are spread
at least five positions apart. When a type has no fresh questions left, it
reuses one you previously got wrong or left blank, never one you got right.
Recording a drill question on a remediated type that is due **is** the cold
re-sweep: a pass closes the type, and a failure reopens it.

## The other sheets

| Sheet | Command | Drawn from | Timing |
|---|---|---|---|
| **Sweep** | `build_sweep.mjs "<skill>"` | Rotation across the types in one skill (medium and hard) | Per question |
| **Remediation / authored** | `build_note.mjs <file.md>` | Hand-written pages plus question IDs or skill filters you choose | Per question, on practice pages |
| **Retrieval drill** | `build_drill.mjs` then `build_note.mjs` | Your `state/types.json` | Per question |
| **Mixed set / timed module** | `build_mixed.mjs --n 20` / `--math-only --n 22` | A representative sample of both banks, **independent of your status** | One clock per section, at real test pace (32 min per 27 R&W, 35 min per 22 maths) |
| **R&W set** | `build_rw_set.mjs "<skill>[,<skill>]" --target R03` | Filter on R&W skill and difficulty (default Medium,Hard), difficulties alternated | Per question by default; `--untimed` removes it |
| **Desmos speed drill** | `build_desmos.mjs systems` / `--list` | Types that a fixed Desmos technique solves | 30 s target per question |

Mixed sets deliberately ignore your status. A set weighted towards weak types
would be harder than a real module, and "questions reached" would no longer
mean "kept test pace". They also run R&W and maths as **separate sections**,
not mixed together, because the test runs them separately.

Every builder accepts `--dry` (show the selection, change nothing) and
`--help`. Unknown flags are rejected, so a typo can't turn a dry run into a
real build.

## Safety rails

- **No question is used twice.** `state/used_questions.json` records every
  sheet's questions. Rebuilding a sheet keeps its own questions. A different
  sheet with the same name is refused unless you pass `--rebuild` (or give it
  a new name with `--name`).
- **Crops never show the answer.** See `verify_index.swift` below. Crop files
  are named after the page and crop line they came from, so a corrected index
  can never reuse an old, stale crop.
- **Nothing gets clipped.** A page whose content runs past the bottom stops
  the build.
- **Hand-written answers are checked.** `<!-- CHECK -->` markers on authored
  sheets are evaluated with mathjs before anything renders.
- **Handwriting is never overwritten.** `push_note.mjs` checks the cloud copy
  against a local record of what was last pulled and pushed.

## Tools reference

Run from the repo root. Node tools accept `--help`.

### Indexing (Swift, macOS)

| File | What it does |
|---|---|
| `index_export.swift` | One bank PDF → JSON rows (qid, domain, skill, difficulty, answer, pages, `crop_y`, `leak`, text). Writes to stdout |
| `add_question_y.swift` | Adds `question_y`, the top of the question below the metadata table, to an index. Writes to stdout |
| `verify_index.swift` | For every row: the page holds that question, and the crop area has its header but not its answer. Exits non-zero on any failure |
| `pdfcrop.swift` | Renders one page to PNG, cropped above, below, or between y-coordinates. Called by the builders |
| `crop_batch.swift` | Many crops in one process, read from a TSV manifest. Used to make tagging images |
| `fix_cropy.swift` | One-off repair that recomputes `crop_y` on an old index. `index_export.swift` already does this correctly, so new users don't need it |
| `answer_strip.swift` | Contact sheet of the answer row and footer from many rendered pages, for fast marking |

### Index post-processing (Python)

| File | What it does |
|---|---|
| `fix_split_words.py` | Rejoins words split by PDF extraction and stamps `data/text_normalised.json`. Required |
| `derive_figures.py` | Adds a `figures` field (graph, table, scatterplot, diagram, none, unknown) to both indexes |
| `figure_probe.py` | The evidence behind `derive_figures.py`'s rules. Read-only analysis |

### Sheet builders (Node)

| File | What it does |
|---|---|
| `build_sweep.mjs` | Sweep notebook for one College Board maths skill |
| `build_note.mjs` | Renders an authored markdown sheet (remediation, drill), expanding its question markers |
| `build_drill.mjs` | Chooses a spaced-retrieval drill from `state/types.json` and writes it as an authored sheet |
| `build_mixed.mjs` | Timed mixed set or maths-only module, status-blind and representative |
| `build_rw_set.mjs` | Reading & Writing set by skill and difficulty, with an optional rule card in front |
| `build_desmos.mjs` | Desmos technique speed drill |

### Shared modules

| File | What it does |
|---|---|
| `sheet.mjs` | Page geometry, CSS, the markdown subset, KaTeX, cropping, used-question tracking, the overflow check, and rendering to `.note` |
| `legible.mjs` | Scales up narrow parts of question images so small print is readable on the device |
| `check_math.mjs` | Evaluates `<!-- CHECK -->` claims on authored sheets. Also runs on its own |
| `drill_select.mjs` | The pure selection logic behind `build_drill.mjs` |
| `text_stamp.mjs` | Checks the normalisation stamp. Must match `fix_split_words.py` |
| `cli.mjs` | Strict argument parsing: unknown flags are errors and `--help` exits before doing anything |
| `config.mjs` | Paths and environment variables (`SAT_XIEHANZI_DIR`, `SAT_SUPERNOTE_SESSION`, `SAT_REPLACED_DIR`) |
| `swift.mjs` | Runs a Swift script with a module cache inside the repo |
| `ledger.mjs` | `state/supernote_ledger.json`: last pulled and pushed md5 for each notebook |

### Supernote (Node, optional)

| File | What it does |
|---|---|
| `push_note.mjs` | Uploads a `.note` to Supernote Cloud, choosing the folder from the file name. `--dry-run`, `--replace` |
| `pull_note.mjs` | Downloads a notebook into `out/pulled/`, or `--list`s a folder |
| `rename_note.mjs` | Renames a remote notebook without touching its contents |
| `note_render.mjs` | Renders `.note` pages to PNG with the handwriting on top of the sheet |

### State and data checks (Python)

| File | What it does |
|---|---|
| `types_state.py` | The state tracker: `init`, `next`, `show`, `record`, `set-status`, `plan`, `mechanical`, `record-untyped`, `untyped` |
| `check_taxonomy.py` | Fails if a type's cue or procedure contains details from a single question (numbers, equations). `build_sweep` runs it first |
| `check_primitives.py` | Fails if an underlying skill points to a type that doesn't exist |

### Rebuilding the taxonomy assignment (advanced)

`data/type_assignments.json` ships ready to use. These tools are only for
re-tagging a newer export, which means having a model read each question
image.

| File | What it does |
|---|---|
| `make_assign_tasks.py` | Splits medium and hard maths questions into per-skill tagging tasks, each with a closed set of labels from the taxonomy |
| `assign_prompt.md` | The instructions given to the image-reading tagger for one task |
| `merge_assignments.py` | Validates the tagger output (checks the ID read from the image, that every label is allowed, coverage, and that nothing is lost) and merges it into `data/type_assignments.json` |

### Lookup data

| File | What it does |
|---|---|
| `bank_map.json` | Maps short target codes (`M01`…`M17`) to College Board skills, for the `<!-- BANK: target=… -->` marker |
| `khan_map.json` | Maps targets to Khan Academy SAT lesson URLs |
| `khan_fetch.mjs` | Fetches those lessons' text into `reference/khan/` (gitignored) for reference while writing a sheet. Nothing is redistributed |

### Tests

`*.test.mjs` (run with `node --test`) and `*.test.py` (run with `python3`).
`npm run test:unit` runs the tests that need no data, and they pass in a fresh
checkout. `npm test` runs everything and needs a finished setup: the indexes,
`state/types.json`, `state/used_questions.json` (created by your first build)
and a built xiehanzi. After the setup guide through step 5 it passes, with a
handful of tests **skipped**: the ones that replay the original learner's
history or the image-tagging pass, whose working files aren't shipped. Each
skip prints why.
