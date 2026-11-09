# Setup: from zero to your first sheet

This takes about 30–45 minutes. Most of that is exporting PDFs and waiting for
the indexer. Every stage ends with a **You should see** check. If what you see
is different, stop there: every later step depends on the earlier ones.

**Run every command from the repository root.** Several tools look for
`bank/` and `data/` relative to the current directory.

- [1. Requirements](#1-requirements)
- [2. Export the question bank](#2-export-the-question-bank)
- [3. Index the PDFs](#3-index-the-pdfs)
- [4. Initialise your state](#4-initialise-your-state)
- [5. Build your first sheet](#5-build-your-first-sheet)
- [6. Optional: Supernote Cloud delivery](#6-optional-supernote-cloud-delivery)
- [Troubleshooting](#troubleshooting)

---

## 1. Requirements

| Need | Why | Check |
|---|---|---|
| **macOS** | The PDF indexer and cropper use Apple's PDFKit through Swift | — |
| **Xcode Command Line Tools** (Swift) | Runs `tools/*.swift` | `swift --version` |
| **Node.js 22 or later** | Sheet builders. xiehanzi requires Node 22+ | `node --version` |
| **Python 3** (the system one is fine) | State tracker, normalisation, checks | `python3 --version` |
| `/usr/share/dict/words` | Used to rejoin words that PDF extraction split in two. Ships with macOS | `ls /usr/share/dict/words` |
| **[xiehanzi](https://github.com/franco-g-s/xiehanzi)** | Renders pages with Playwright Chromium and writes Supernote `.note` files. **Required for every build**, even without a Supernote | see below |

Install the Command Line Tools if `swift` is missing:

```sh
xcode-select --install
```

### xiehanzi

By default this repo looks for xiehanzi in a **sibling directory** named
`xiehanzi`. Clone it next to this repo:

```sh
cd ..
git clone https://github.com/franco-g-s/xiehanzi
cd xiehanzi
npm install
npm run build
npx playwright install chromium
cd ../sat-study-system
```

If you keep it somewhere else, point to it with an environment variable:

```sh
export SAT_XIEHANZI_DIR=/path/to/xiehanzi
```

Then install this repo's own dependencies (KaTeX for typeset maths, mathjs for
answer checking):

```sh
npm install
```

**You should see:**

```sh
ls ../xiehanzi/dist/deliver/note/write.js     # exists
npm run test:unit                              # ends with "fail 0"
```

---

## 2. Export the question bank

The questions come from College Board's free **SAT Suite Question Bank**. They
are copyrighted and are **not** included in this repo, so you download your
own copy.

1. Open the question bank. The educator version is linked from
   <https://satsuite.collegeboard.org/k12-educators/tools-resources/question-bank/overview>.
2. Choose **Assessment: SAT** and **Test: Math**.
3. Select **one domain** with all of its skills and all difficulties, then
   search.
4. Select all results and **export to PDF *with* correct answers and
   rationales**. The indexer needs the `Correct Answer:` line on each page. In
   an export without answers, every question is rejected.
5. Repeat for the other three Math domains, then for the four **Reading and
   Writing** domains.

If the site limits how many questions one export can hold, export in batches.
Any number of PDFs works, as long as every one has answers included.

Save the eight PDFs into a `bank/` folder at the repo root:

```
bank/
  Algebra.pdf
  Advanced Math.pdf
  Problem-Solving and Data Analysis.pdf
  Geometry and Trigonometry.pdf
  Craft and Structure.pdf
  Expression of Ideas.pdf
  Information and Ideas.pdf
  Standard English Conventions.pdf
```

These names are only a suggestion. The tools don't hard-code them. Each index row records the file name
its question came from, and crops are cut from `bank/<that name>`. So you can
use any names you like, but **don't rename or move a PDF after indexing it**.
The rest of this guide uses the names above.

If the question bank's interface has changed since this was written, the
requirements are still the same: one question per page, the `Question ID:`
header, the metadata table (Assessment / Test / Domain / Skill / Difficulty),
and the `Correct Answer:` line followed by the rationale.

**You should see:**

```sh
ls bank/*.pdf | wc -l      # 8, or more if you exported in smaller batches
```

---

## 3. Index the PDFs

This turns the PDFs into two JSON indexes: `data/qb_index.json` for maths and
`data/rw_index.json` for Reading & Writing. Keep the two separate. Every maths
tool assumes `qb_index.json` contains only maths.

### 3a. Extract each PDF

```sh
mkdir -p data/idx
for pdf in bank/*.pdf; do
  swift tools/index_export.swift "$pdf" > "data/idx/$(basename "$pdf" .pdf).json"
done
```

This loop handles any number of PDFs with any names. If your export came out
in several smaller files per domain, put them all in `bank/` and it works the
same. Each PDF takes from a few seconds to a minute, because Swift compiles
the script on every run.

**You should see** one line per file on stderr, like:

```
Algebra.pdf: 6xx pages -> 5xx questions, 5xx usable
```

"Usable" means the question has a difficulty and a located answer line. The
rest are kept in the index but marked, and no builder ever uses them. Expect
roughly 95% to be usable. A file showing `0 usable` was almost certainly
exported without answers.

### 3b. Merge into the two indexes

There is no merge tool. This snippet reads every extracted file and puts each
question into the maths or R&W index according to its **domain**, so file
names don't matter:

```sh
python3 - <<'EOF'
import glob, json
MATH = {"Algebra", "Advanced Math", "Problem-Solving and Data Analysis", "Geometry and Trigonometry"}
RW = {"Craft and Structure", "Expression of Ideas", "Information and Ideas", "Standard English Conventions"}
qb, rw, odd = [], [], []
for path in sorted(glob.glob("data/idx/*.json")):
    for r in json.load(open(path)):
        (qb if r["domain"] in MATH else rw if r["domain"] in RW else odd).append(r)
for out, rows in (("data/qb_index.json", qb), ("data/rw_index.json", rw)):
    ids = [r["qid"] for r in rows]
    json.dump(rows, open(out, "w"), ensure_ascii=False)
    print(f"{out}: {len(rows)} rows, {len(ids) - len(set(ids))} duplicate IDs")
print(f"{len(odd)} rows with no recognised domain (left out)")
EOF
```

**You should see** both files written, each with `0 duplicate IDs`. Expect
about 1,900 rows in each, though the bank changes over time. The last line
should show a small number. Rows with no recognised domain are usually ones
whose metadata the indexer couldn't read, and they would be unusable anyway.
If it is large, check that the export includes the metadata table.

### 3c. Locate the top of each question

`add_question_y.swift` finds where the metadata table ends, so that question
pages can be cropped without it. The table names the skill and shows the
difficulty, and the real test shows neither. The script writes to stdout, so
**write to a new file and then move it**. Redirecting straight onto the input
file would empty it.

```sh
swift tools/add_question_y.swift data/qb_index.json > data/qb_index.new.json && mv data/qb_index.new.json data/qb_index.json
swift tools/add_question_y.swift data/rw_index.json > data/rw_index.new.json && mv data/rw_index.new.json data/rw_index.json
```

**You should see**, for each file:

```
rows N: X located, Y no label, Z too close to the answer line
```

Rows without a located top fall back to a crop of everything above the answer
line, which still never includes the answer.

### 3d. Normalise the text (required)

PDF text extraction splits some words in two ("ver tical"), which makes text
searches quietly miss them. This step rejoins them and stamps
`data/text_normalised.json`. **Every builder checks that stamp and refuses to
run without it.**

Run it without arguments: the stamp is keyed by the exact path strings
`data/qb_index.json` and `data/rw_index.json`. Read the dry run first, then
write:

```sh
python3 tools/fix_split_words.py            # dry run: lists every proposed rejoin
python3 tools/fix_split_words.py --write
```

**You should see:**

```
stamped data/text_normalised.json for: data/qb_index.json, data/rw_index.json
```

### 3e. Classify figures (recommended)

This adds a `figures` field to each row (graph, table, scatterplot, diagram,
none), so a drill can say "only questions with a table". The builders run
without it, but tools that filter on figures will find nothing.

```sh
python3 tools/derive_figures.py             # dry run
python3 tools/derive_figures.py --write
```

**You should see** `wrote figures onto N rows, and M for review -> data/figures_review.json`.

If it stops with `overrides name qids absent from data/qb_index.json`, your
export doesn't contain some questions that `data/figures_overrides.json`
labels. The bank changes over time. See [Troubleshooting](#troubleshooting).

### 3f. Verify

This is the most important check. For every row it confirms that the page
really holds that question, that the crop area contains the question's
header, and that the crop area does **not** contain the answer line.

```sh
npm run verify
```

**You should see**, for each index:

```
checked N, mismatched 0, skipped 0
```

Any `MISMATCH`, `LEAK` or `CROP` line means that row's crop would be wrong.
Don't build sheets until this passes.

> **If you re-run 3a for any PDF**, re-run 3b–3f as well. The stamp from 3d
> covers the exact text of the index, so a re-extracted index is refused until
> it is normalised again.

---

## 4. Initialise your state

```sh
python3 tools/types_state.py init
```

This creates `state/types.json` from the shipped taxonomy and type
assignments, with one row per question type, all `unswept`. It doesn't read
your PDFs. See [`state/README.md`](../state/README.md) for every file that
appears in `state/` later.

**You should see:**

```
103 types, 1157 questions assigned, 80 unmatched, 0 stale rows flagged
```

There are 103 rows rather than 100 because one type spans four skills and gets
a row under each. Then check:

```sh
python3 tools/types_state.py next          # the biggest unswept types, with their cues
npm run check                              # taxonomy sanity checks, both should pass
```

---

## 5. Build your first sheet

Preview a sweep first. `--dry` prints the selection and doesn't build or
record anything:

```sh
node tools/build_sweep.mjs "Circles" --dry
```

**You should see** lines like:

```
skill: Circles
types with questions: N/M
selected 15 questions across K types
  <qid>  <type name>
  ...
```

If `types with questions` is much lower than the number of types, your export
is missing many of the question IDs in `data/type_assignments.json` (see
[Troubleshooting](#troubleshooting)).

Then build it for real:

```sh
node tools/build_sweep.mjs "Circles"
```

> A real build **uses up** its questions. They are recorded in
> `state/used_questions.json` under the sheet's name (`SW-circles`), and no
> other sheet will pick them. Rebuilding the same sheet is safe and
> reproduces the same questions.

**You should see:**

```
overflow check: all pages fit
pages: 32            (more if a solution runs onto a second page)
html:  .../out/SW-circles.html
note:  .../out/SW-circles.note  (… KB)
```

To check the result without a device, render pages to PNG:

```sh
node tools/note_render.mjs out/SW-circles.note out/check --pages 1,2,3
open out/check
```

### Getting the sheet in front of you

- **Supernote, via Cloud:** see step 6.
- **Supernote, by hand:** copy `out/SW-circles.note` into the device's `Note`
  folder however you normally move files (USB or the Supernote apps). Pages
  are laid out for a **1920 × 2560** screen (Supernote Manta). Other models
  have not been tested.
- **No Supernote:** every build also writes `out/<sheet>.html`, which opens
  in any Chromium-based browser, and `note_render.mjs` produces one PNG per
  page. Both are usable on a tablet or for printing. Printing has not been
  tuned or tested, so check a page before printing a whole set.

What to do with the sheet once you have written on it is covered in
[how-it-works.md](how-it-works.md#the-study-loop).

---

## 6. Optional: Supernote Cloud delivery

Push sends a built sheet to your Supernote through Supernote Cloud. Pull brings
the written-on notebook back. Both use xiehanzi's cloud client and its saved
session.

### Sign in once

In your xiehanzi checkout, put your Supernote Cloud credentials in `.env`
(copy `.env.example`):

```sh
cd ../xiehanzi
cp .env.example .env        # then fill in SUPERNOTE_EMAIL and SUPERNOTE_PASSWORD
node dist/cli.js login      # asks for an emailed code if your account requires one
cd ../sat-study-system
```

This saves a session token to `../xiehanzi/.supernote-session.json`. The token
eventually expires. When pushes start failing with "No Supernote session" or
an auth error, run `login` again.

### Environment variables

All optional. Defaults are set in `tools/config.mjs`.

| Variable | Default | What |
|---|---|---|
| `SAT_XIEHANZI_DIR` | `../xiehanzi` | The built xiehanzi checkout |
| `SAT_SUPERNOTE_SESSION` | `<xiehanzi>/.supernote-session.json` | Session file written by `xiehanzi login` |
| `SAT_REPLACED_DIR` | `out/replaced` | Where `push --replace` saves a copy of the remote file before overwriting it |

### Push, pull, look

```sh
node tools/push_note.mjs out/SW-circles.note --dry-run    # shows the folder it would use
node tools/push_note.mjs out/SW-circles.note
```

The remote folder is worked out from the file name: `SW…` goes to
`Note/SAT/Math/Sweeps`, `R<n>…` to `Note/SAT/Math/Remediation`, `RW…` to
`Note/SAT/English`, and `MX…` to `Note/SAT/Practice Tests`. Any name
containing "re-sweep" goes to `Note/SAT/Math/Re-sweeps`. To override it, pass
a folder starting with `Note/` as the second argument. A name that matches no
rule is refused, not guessed. Every builder ends by printing a ready-to-run
push command. The Desmos and retrieval-drill builders put the folder
(`Note/SAT/Math/Drills`) in that command for you.

**You should see** `routed to Note/SAT/Math/Sweeps`, then `UPLOADED  …`.
After the device syncs, the notebook appears there.

When you have written on it:

```sh
node tools/pull_note.mjs "Note/SAT/Math/Sweeps" --list
node tools/pull_note.mjs "Note/SAT/Math/Sweeps" "SW-circles.note"    # saved to out/pulled/
node tools/note_render.mjs out/pulled/SW-circles.note out/review --scale 0.55
```

`note_render.mjs` composites your ink over the sheet, so each PNG shows your
working on top of the question.

**Push protects your handwriting.** It won't overwrite a notebook that has
changed on the cloud. `--replace` is only allowed after you have pulled the
current version, and it saves a copy first. Supernote Cloud rejects
byte-identical uploads even after a delete. Use `tools/rename_note.mjs` to fix
a misnamed remote file instead of deleting and re-pushing it.

---

## Troubleshooting

**`data/qb_index.json is not normalised: …`**
The index changed after step 3d, or 3d was run with a different path string.
Run `python3 tools/fix_split_words.py --write` with no path arguments.

**`… does not exist` / `ENOENT … data/qb_index.json`**
`tools/sheet.mjs` loads the maths index when it starts, so **every builder
needs it, including the R&W builder.** Finish step 3 for the maths PDFs.

**`Cannot find module '…/xiehanzi/node_modules/…'` or `…/xiehanzi/dist/…`**
xiehanzi isn't where the tools expect it, isn't installed, or isn't built. Run
`npm install && npm run build` in the checkout, or set `SAT_XIEHANZI_DIR`.

**`browserType.launch: Executable doesn't exist`**
Playwright's Chromium is missing. Run `npx playwright install chromium` inside
the xiehanzi checkout.

**`xiehanzi dist is stale (predates the safe --replace)`**
Pull and rebuild xiehanzi (`git pull && npm run build`).

**Swift: `unable to open output file … ModuleCache … Operation not permitted`**
Your environment can't write to the default Clang module cache (common in
sandboxed shells). Point it at a writable folder:
`export CLANG_MODULE_CACHE_PATH="$PWD/out/.swift-module-cache"`. Builders that
crop through `tools/swift.mjs` already do this.

**`ENOENT … state/types.json` / `FileNotFoundError` from `types_state.py`**
Run `python3 tools/types_state.py init` (step 4).

**`derive_figures.py`: `overrides name qids absent from …`**
Your export doesn't contain some questions that `data/figures_overrides.json`
labels, because College Board adds and retires questions over time. The step
is optional. Skip it, or delete the missing IDs from a local copy of the
overrides file.

**A sweep finds few questions, or `nothing to sweep.`**
`data/type_assignments.json` maps question IDs from the export it was built
on. IDs missing from your export are skipped without a message. Newer
questions have no type, so sweeps and drills won't use them. Mixed sets and R&W
sets don't use types and are not affected.

**`unknown question id: …` when building a sample sheet**
The sample sheets in `content/targets/` list specific question IDs in
`<!-- QUESTIONS: … -->` markers. If your export doesn't have one, replace it
with an ID from your own index of the same type (see
[authoring.md](authoring.md)).

**`state/used_questions.json already has "…" with … DIFFERENT questions`**
A sheet with the same name already exists. To build a *new* sheet, give it a
unique name (`--name RW-…` for R&W). To deliberately replace that sheet's
questions, pass `--rebuild`.

**`OVERFLOW — content clipped on these pages`**
An authored page has too much on it. Split it with another `<!-- PAGE -->`.
The builder refuses to produce a sheet with hidden text.
