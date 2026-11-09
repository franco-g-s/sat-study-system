# state/

Your personal progress. Every file the tools write here (`*.json`) is
gitignored, so your results never end up in a commit by accident. Back the folder up some
other way if you care about it: it is the only record of what you have done.

The directory starts empty. Nothing needs to be copied in by hand.

| File | Created by | What it holds |
|---|---|---|
| `types.json` | `python3 tools/types_state.py init` (**run this once during setup**) | One row per maths question type: status (`unswept`, `fast`, `good`, `slow`, `shaky`, `stuck`, `remediated`), every timed encounter, and re-sweep due dates. This is the system of record. |
| `used_questions.json` | The first real build of any sheet (`build_sweep`, `build_note`, `build_rw_set`, `build_mixed`, `build_desmos`) | Sheet name, then the question IDs that sheet used. This is what stops a question from showing up on two sheets. |
| `untyped_encounters.json` | `types_state.py record-untyped` | Results for questions with no type: all Reading & Writing questions, plus maths questions that are Easy or `unmatched`. |
| `supernote_ledger.json` | `push_note.mjs` / `pull_note.mjs` / `rename_note.mjs` | The md5 this machine last pushed and pulled for each notebook. This is what stops a push from overwriting your handwriting. |

`build_drill.mjs`, `types_state.py show`, `types_state.py next` and
`types_state.py record` all expect `types.json` to exist. If you get a
`FileNotFoundError` or `ENOENT` on `state/types.json`, run `init`. Running it
again later is safe: it refreshes type metadata and keeps your encounters.

To start over, delete the JSON files here. If you have already pushed
notebooks, keep `supernote_ledger.json`.
