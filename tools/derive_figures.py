#!/usr/bin/env python3
"""Write a `figures` field onto every bank row.

Why this exists: the taxonomy carries the *mathematics* of a question and
nothing anywhere said whether the question hands you a picture, a table or
neither. So `build_desmos.mjs` shipped a regression drill pointed at a type
where every question draws the line of best fit for you -- eight reps that
measured nothing, out of a study budget of a few spare hours a week, and the
pool count printed "8 of 9 unused" the whole time.

With this field a selector says "this drill needs questions with a table" as a
predicate instead of as a hope.

The rules are imported from `figure_probe.py` rather than restated, so the
derivation and the evidence for it cannot drift apart. Run the probe to see why
each rule is what it is -- in particular why /graph/ and /diagram/ are unusable
without the geometry gate.

    python3 tools/derive_figures.py            # show what would change
    python3 tools/derive_figures.py --write    # write it

PURELY ADDITIVE. No existing reader breaks, nothing regenerates, and crop_y /
question_y are NOT recomputed -- the crop filenames are built from those
(sheet.mjs:275), so re-deriving them mid-sweep would invalidate every built
sheet. This only adds a key.
"""
import argparse
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from figure_probe import GATE, MARKERS  # one definition, shared with the evidence

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# TWO INDEXES, TWO RULES, because the same measurement means different things
# in each. `question_y - crop_y` is the figure's height on a maths question and
# mostly the PASSAGE's height on Reading & Writing:
#
#   qb_index  median gap 178   23% clear the 250 gate   777/1833 mention a figure
#   rw_index  median gap 233   37% clear the 250 gate   138/1820 mention a figure
#
# So the rule inverts rather than failing.
#
# MATHS -- gate first, markers second. /graph/ alone is a coin flip (167 of 379:
# a stem that merely names a function's graph is often pure algebra), so the gate is what makes the
# markers usable. A row that clears the gate and matches nothing is a real
# figure of unknown kind.
#
# R&W -- markers first, gate as confirmation only. Here the markers are strong
# and the gate is the weak signal: table 76/83 confirmed (92%), graph 24/25
# (96%). Gating first would admit 677 rows while only 138 mention a figure, and
# ~560 text-only passages would land as "figure of unknown kind" -- this field's
# own defect, rebuilt inside it.
#
#   `diagram` is DROPPED on R&W: 12 of 31, and the misses are plainly prose --
#   "figure" meaning a person, a shape in a craft, a nested object.
#   `scatterplot` matches nothing there at all.
#
# The consequence worth knowing at the call site: on R&W an empty `figures` means
# "the text mentions no figure", which is weaker evidence than maths's "did not
# clear the gate". Positive predicates (`hasFigure(r,'table')`) are strong on
# both. `hasNoFigure` is strong on maths and merely suggestive on R&W.
RULES = {
    "data/qb_index.json": {"mode": "gate-first", "markers": None},
    "data/rw_index.json": {"mode": "marker-first", "markers": ("table", "graph")},
}
INDEXES = list(RULES)

REVIEW = "data/figures_review.json"
# Hand labels for rows the rules cannot decide, read off the crop. Applied AFTER
# the rules so a label always wins, and the row leaves the review queue.
OVERRIDES = "data/figures_overrides.json"

# Four states, and the distinction between the last two is the whole point.
#
#   []            confidently NO figure -- the gate was not cleared
#   ["graph", …]  a figure, and we know what kind
#   ["unknown"]   a figure, kind not determined -- cleared the gate, no marker
#   null          UNDECIDABLE -- no crop_y, so there is no gate to apply
#
# `null` is not `[]`. A row with no crop_y silently reading as "no figure" is
# the same failure shape as the defect this field exists to prevent: it looks
# like an answer and it is an absence. Selectors must treat null as "do not
# know" and exclude it from both "has a table" and "has no figure".
UNKNOWN_KIND = "unknown"


def figures_for(row, rule):
    crop_y, question_y = row.get("crop_y"), row.get("question_y")
    gate_ok = None if crop_y is None or question_y is None else (question_y - crop_y) > GATE
    text = row.get("text") or ""
    allowed = rule["markers"] or tuple(MARKERS)
    hits = sorted(k for k in allowed if MARKERS[k].search(text))

    if rule["mode"] == "gate-first":
        if gate_ok is None:
            return None            # no gate to apply, and the gate is the rule
        if not gate_ok:
            return []
        return hits or [UNKNOWN_KIND]

    # marker-first: the marker decides, the gate only confirms.
    if not hits:
        return []
    if gate_ok:
        return hits
    if gate_ok is None:
        # No geometry at all, so nothing overrules the marker -- and nothing
        # confirms it either. Undecidable, not "no figure": the reasoning below
        # is that the GEOMETRY wins, and absent geometry wins nothing.
        return None
    # Marker says figure, geometry says the question body is too short to hold
    # one. The geometry wins here, and the rows are NOT sent for review.
    #
    # That looked wrong at first -- the gate is the weak signal on R&W, which is
    # why this branch is marker-first at all. But its weakness is asymmetric: it
    # over-admits (a long passage is not a figure) and under-admits almost
    # never, because a short question body genuinely cannot contain one. Reading
    # the rows settled it. Every one is the marker matching prose:
    #
    #   "table" as furniture, as tableware, or as the periodic table
    #   "graphs" used in a passage's prose, not pointing at a figure
    #
    # None is a figure, and we know that. `null` would mean "undecidable" and
    # spend a human's attention on rows that are already decided, which is a
    # different way of being dishonest about what is known.
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    review, counts, totals = [], Counter(), Counter()
    opath = os.path.join(ROOT, OVERRIDES)
    overrides = json.load(open(opath)) if os.path.exists(opath) else {}
    applied = Counter()
    for rel in INDEXES:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            print("skip %s (absent)" % rel)
            continue
        rows = json.load(open(path))
        rule = RULES[rel]
        hand = overrides.get(rel, {})
        seen = set()
        for row in rows:
            figs = figures_for(row, rule)
            if row.get("qid") in hand:
                figs = hand[row["qid"]]["figures"]
                applied[rel] += 1
                seen.add(row["qid"])
            row["figures"] = figs
            key = "%s / null (undecidable)" % rel.split("_")[0].split("/")[-1] if figs is None \
                  else "%s / %s" % (rel.split("_")[0].split("/")[-1], " + ".join(figs) or "none")
            counts[key] += 1
            totals[rel] += 1
            # Emit the undecidable and the unlabelled as a list rather than
            # letting them default quietly into the "no figure" bucket.
            if figs is None or figs == [UNKNOWN_KIND]:
                # A row sheet.mjs's loader drops (no crop_y, or an answer leak)
                # can never reach a builder, so it needs no human -- but it
                # stays listed, marked, rather than silently becoming [].
                reachable = bool(row.get("crop_y")) and not row.get("leak")
                review.append({
                    "reachable": reachable,
                    "index": rel,
                    "qid": row.get("qid"),
                    "reason": ("marker matched but geometry did not confirm"
                               if rule["mode"] == "marker-first" else
                               "no crop_y to gate on") if figs is None
                              else "clears the gate, matches no marker",
                    "gap": (row["question_y"] - row["crop_y"])
                           if row.get("crop_y") is not None else None,
                    "skill": row.get("skill"),
                    "text": (row.get("text") or "")[:160],
                })
        missing = set(hand) - seen
        assert not missing, "overrides name qids absent from %s: %s" % (rel, sorted(missing))
        if args.write:
            # Atomic: a sheet build reading a half-written index during the
            # sweep would be a self-inflicted version of the bug being fixed.
            tmp = path + ".tmp"
            with open(tmp, "w") as fh:
                json.dump(rows, fh, ensure_ascii=False)
            os.replace(tmp, path)

    for rel, n in totals.items():
        print("%-22s %5d rows" % (rel, n))
    print()
    for key, n in counts.most_common():
        print("  %5d  %s" % (n, key))

    decided = sum(n for k, n in counts.items()
                  if "null (undecidable)" not in k and not k.endswith(UNKNOWN_KIND))
    for rel, n in applied.items():
        print("  %5d  hand-labelled from %s (%s)" % (n, OVERRIDES, rel))
    print("  %5d  in the review queue that a builder can actually reach"
          % sum(1 for r in review if r["reachable"]))
    print("\n  %d decided, %d listed for review (%d undecidable, %d unlabelled)"
          % (decided, len(review),
             sum(n for k, n in counts.items() if "null (undecidable)" in k),
             sum(n for k, n in counts.items() if k.endswith(UNKNOWN_KIND))))

    # A derivation that silently stops deriving is worse than one that errors.
    assert decided > 0.8 * sum(totals.values()), (
        "only %d of %d rows were decided by rule -- the markers or the gate have "
        "stopped matching, do not write this" % (decided, sum(totals.values()))
    )

    if args.write:
        with open(os.path.join(ROOT, REVIEW), "w") as fh:
            json.dump(review, fh, indent=1, ensure_ascii=False)
        print("\nwrote figures onto %d rows, and %d for review -> %s"
              % (sum(totals.values()), len(review), REVIEW))
    else:
        print("\n(dry run -- pass --write to apply)")


if __name__ == "__main__":
    main()
