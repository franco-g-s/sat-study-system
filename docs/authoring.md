# Authoring sheets

Sweeps, mixed sets, R&W sets and Desmos drills are generated. **Remediation
sheets and R&W rule cards are written by hand**, once, in a small markdown
dialect, and rendered by the builders. This page describes that dialect.

The shipped examples are the best reference:

- `content/targets/R05-rational-expressions.md`: a full remediation sheet
- `content/targets/R07-circle-equation-signs.md`: a shorter one
- `content/rw/R03.md`: an R&W rule card

## Maths sheets: `content/targets/<ID>-<slug>.md`

Build with:

```sh
node tools/build_note.mjs content/targets/R08-my-sheet.md          # → out/R08-my-sheet.note
node tools/build_note.mjs content/targets/R08-my-sheet.md --rebuild # after changing its questions
```

The output file is named after the source file, and that name is also the
sheet's key in `state/used_questions.json`. **Start the file name with `R`
and a digit** (`R08-…`) so `push_note.mjs` files it under Remediation.

### Frontmatter

```yaml
---
id: R08
title: Short title for the footer
kind: remediation
# Any other `key: value` lines are free-form notes for yourself and are ignored
# by the builder: subtitle, domain, primitive, types, built_from, ...
---
```

| Key | Effect |
|---|---|
| `id` | Printed in every page footer |
| `title` | Printed in every page footer |
| `kind` | `drill` adds the "what happened?" checklist to every question's solution page. Any other value, or none, leaves the solution pages for teaching |

### Page markers

Every marker is an HTML comment, so nothing extra shows on the rendered page.

| Marker | Effect |
|---|---|
| `<!-- PAGE -->` | Starts a new device page. Each page must fit: a page that would clip content stops the build |
| `<!-- WORKSPACE: 0.5 -->` | Adds a 5 mm writing grid at the bottom of the page, at least this fraction of the page tall |
| `<!-- TIMEBOX -->` | Puts a time box next to the page's **first** heading, for a hand-written question. The heading must be the first thing on the page |
| `<!-- QUESTIONS: label=Practice, 1a2b3c4d, 5e6f7a8b -->` | After this page, inserts a question page (time box and workspace) and a solution page for each question ID. `label=` is optional (default `Drill`). Numbering continues across every marker with the same label |
| `<!-- BANK: target=M03, difficulty=Medium, n=6 -->` | After this page, inserts `n` unused questions of that difficulty from the College Board skills that `target` maps to in `tools/bank_map.json`, taken in question-ID order. These have no time box |
| `<!-- SESSION 2 -->` | Prefixes the page's footer with "session 2", for a sheet split across two sittings |
| `<!-- CHECK … -->` | A machine-checked maths claim (see below) |

Question IDs are the 8-character `qid` values in your index. To find
candidates of one type:

```sh
python3 -c 'import json; a=json.load(open("data/type_assignments.json"))["assignments"]
print([q for q,v in a.items() if v["type"]=="centre and radius from standard form"])'
```

Any ID that isn't in your index stops the build with `unknown question id`.
College Board's bank changes over time, so the IDs in the sample sheets may
not all exist in your export. Swap those for others of the same type.

### Markdown subset

Supported: `#`, `##` and `###` headings; paragraphs; `-` and `1.` lists
(wrapped lines continue the item); `> ` blockquotes; tables; fenced code
blocks; `**bold**`, `*italic*`, `` `code` ``; and `[[wikilinks]]`, which
render as plain text.

**Maths** goes in `$…$` (inline) or `$$…$$` (display) and is typeset with
KaTeX.

**Emphasis does not nest.** `**bold with *italic* inside**` renders with
literal asterisks, and the builder prints a warning when that happens.

### `CHECK`: answer keys that verify themselves

A wrong printed answer teaches the wrong method. Every hand-written claim
can carry a check, and `build_note.mjs` refuses to build if any check fails:

```markdown
<!-- CHECK 1: x^2 + 3x - 10 == (x+5)(x-2) -->
<!-- CHECK 2: c = 7/24; 4^(8c) == nthRoot(4^7, 3) -->
<!-- CHECK 3: (x+4)/4 != x -->
<!-- CHECK 4: (x^2-25)/(x^2+3x-10) == (x-5)/(x-2) | x > 5 -->
<!-- CHECK 5: none -- a reading question, nothing to compute -->
```

- `==` means an identity: both sides are evaluated at random values of every
  free letter. Chains like `a == b == c` are allowed. `!=` means the two
  sides must differ somewhere.
- `v = k;` substitutes values first. This is how you check an equation's
  solution: substitute it back into the original.
- `| condition` restricts the random values (`x > 5`, `x != 0 and y > 0`).
- `none -- reason` opts out explicitly. The reason is required.
- The syntax is [mathjs](https://mathjs.org/): `^` for powers, implicit
  multiplication (`3x`, `(x-5)(x+2)`), `sqrt`, `nthRoot(a, n)`, `abs(x)`
  (never `|x|`), `sin(30 deg)`, `pi`.
- **The coverage rule:** on a page whose heading ends in "answers" (for
  example `## Try it now — answers`), every numbered answer needs at least one
  `CHECK` with its number.

Write each claim from the **question** to the **printed answer**. A check that
only compares the printed steps with each other passes when the first step is
wrong. You can check a file on its own with
`node tools/check_math.mjs content/targets/R08-my-sheet.md`.

### A shape that works

A remediation sheet should fit one study block (about 25–35 pages, 30–40
minutes):

1. **The idea, derived:** the general principle, not a single question.
2. **The trigger:** what in a question tells you this is the move.
3. **The procedure:** numbered steps short enough to write from memory.
4. **Practice right after each idea**, not saved for the end. Use a
   `QUESTIONS:` block of real bank questions, each with a time box.
5. **A check:** the quick sanity test that catches a wrong answer.

## R&W rule cards: `content/rw/<ID>.md`

A rule card is a few pages placed at the front of an R&W set, so opening the
set and reading the rule happen together.

```sh
node tools/build_rw_set.mjs "Boundaries" --n 25 --target R03
```

`--target R03` loads `content/rw/R03.md`. If the file doesn't exist, the set
builds without a card.

- **Frontmatter is optional.** The only key the builder reads is `traps:`, a
  YAML list that replaces the default "what happened?" checklist on every
  solution page. Name the specific ways this rule goes wrong:

  ```yaml
  ---
  traps:
    - had it
    - decided before the end of the sentence
    - a comma that sounded right
    - no method
  ---
  ```

- The body is split into pages on `<!-- PAGE -->` and uses the same markdown
  subset. Other markers (`QUESTIONS`, `CHECK`, `WORKSPACE`) are removed and
  have no effect on a card.
