#!/usr/bin/env python3
"""Probe the bank for how a `figures` field could be derived.

Written to support a schema change after a drill technique shipped with no
bank questions it could actually use. This is the evidence, re-runnable, not a
one-off paste into a chat window.

The question it answers: can we tell, from what is ALREADY in qb_index.json,
whether a question hands you a picture, a table, or neither? If we can, a
selector can say "this drill needs questions with a table" as a predicate
instead of as a hope -- which is the general case of the DS01 defect, where a
Desmos regression drill was built entirely out of questions that draw the line
of best fit for you.

THE FINDING, IN ONE LINE: text markers alone are not enough, but
`question_y - crop_y` -- the vertical extent of the question body, already in
every row -- separates figure from no-figure cleanly, and gating the text
markers on it turns an unusable signal into a usable one.

    node/python  ->  python3 tools/figure_probe.py
"""
import json
import os
import re
import statistics
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
idx = json.load(open(f'{ROOT}/data/qb_index.json'))
ok = [r for r in idx if r.get('crop_y') is not None]
gap = lambda r: r['question_y'] - r['crop_y']

# The geometry gate. A question with a figure has to leave room for it, so the
# distance between the top of the crop and the question text is the figure's
# height plus a constant. 250 sits in the valley between the two modes; it is
# not tuned to anything and the exact value barely matters, which is the point.
GATE = 250

# Markers, in the order of how much they can be trusted ALONE.
MARKERS = {
    'scatterplot': r'scatterplot|line of best fit',
    'table':       r'\btables?\b',
    'graph':       r'\bgraphs?\b|\bgraphed\b|shaded region|xy-plane',
    'diagram':     r'\bfigure\b|triangle|circle|rectangle|parallel lines|not drawn to scale',
}
MARKERS = {k: re.compile(v, re.I) for k, v in MARKERS.items()}

# A separate, independent channel: when the cropper's OCR runs over a plotted
# axis it picks the tick labels up as a run of bare numbers inside the question
# body. Rare (30 rows) but almost perfectly specific -- 29 of the 30 also clear
# the geometry gate. Useful as a cross-check on the gate, not as a primary rule.
TICKS = re.compile(r'(?:\b\d{1,4}\b[ ,]+){6,}')


def main():
    print(f'bank: {len(idx)} rows, {len(ok)} with crop_y ({len(idx) - len(ok)} without)\n')

    # 1. Why text alone fails.
    print('1. THE TEXT MARKERS, UNGATED')
    for name, pat in MARKERS.items():
        hit = [r for r in ok if pat.search(r['text'])]
        print(f'   {name:12} {len(hit):5} rows   median gap {statistics.median(map(gap, hit)):6.1f}')
    print(f'   {"ALL ROWS":12} {len(ok):5} rows   median gap {statistics.median(map(gap, ok)):6.1f}')

    g = [r for r in ok if MARKERS['graph'].search(r['text'])]
    big = [r for r in g if gap(r) > GATE]
    print(f'\n   /graph/ is a COIN FLIP on its own: {len(big)} of {len(g)} have a figure.')
    print('   The other half are algebra with no picture at all --')
    for r in [r for r in g if gap(r) <= GATE][:2]:
        snippet = re.sub(r'\s+', ' ', r['text'])[120:210]
        print(f'     {r["qid"]} gap={gap(r):.0f}  ...{snippet}...')
    print('   A stem that merely names a function\'s graph is the trap, and "graph" is')
    print('   the single most common figure word in the bank. A rule built on it alone would')
    print(f'   have marked {len(g) - len(big)} figure-less questions as having a graph.')
    d = [r for r in ok if MARKERS['diagram'].search(r['text'])]
    print(f'   /diagram/ is worse: {sum(1 for r in d if gap(r) > GATE)} of {len(d)}, and its median gap '
          f'({statistics.median(map(gap, d)):.0f}) sits BELOW')
    print(f'   the bank median ({statistics.median(map(gap, ok)):.0f}) -- "triangle" and "circle" are mostly prose.')
    print('   Neither marker is usable ungated. scatterplot and table are.\n')

    # 2. The geometry gate.
    print('2. THE GEOMETRY GATE (question_y - crop_y)')
    fig_words = re.compile('|'.join(p.pattern for p in MARKERS.values()), re.I)
    withf = [gap(r) for r in ok if fig_words.search(r['text'])]
    nof = [gap(r) for r in ok if not fig_words.search(r['text'])]
    print(f'   text mentions a figure : median {statistics.median(withf):6.1f}  (n={len(withf)})')
    print(f'   text mentions none     : median {statistics.median(nof):6.1f}  (n={len(nof)})')
    tick = [r for r in ok if TICKS.search(r['text'])]
    print(f'   independent check -- OCR\'d axis ticks: {len(tick)} rows, '
          f'{sum(1 for r in tick if gap(r) > GATE)} of them clear the gate\n')

    # 3. The buckets.
    print(f'3. BUCKETS (gate at {GATE}, then markers)')
    c, multi = Counter(), 0
    for r in ok:
        if gap(r) <= GATE:
            c[('none',)] += 1
            continue
        hits = tuple(sorted(k for k, p in MARKERS.items() if p.search(r['text'])))
        if not hits:
            hits = ('figure-of-unknown-kind',)
        if len(hits) > 1:
            multi += 1
        c[hits] += 1
    for k, v in c.most_common():
        print(f'   {v:5}  {" + ".join(k)}')
    print(f'\n   NEEDS MORE THAN ONE LABEL: {multi} rows.')
    print('   This is the answer to "single value or set": a set. `graph + table`')
    print('   and `graph + scatterplot` are real, and "has a table" as a predicate')
    print('   has to be true for a question that also has a graph.')
    print(f'\n   The hand-review tail is the {c[("figure-of-unknown-kind",)]} rows that clear the gate and match')
    print('   no marker, plus the 92 rows with no crop_y to gate on. Everything')
    print('   else is a rule.')


if __name__ == '__main__':
    main()
