#!/usr/bin/env python3
"""Tests for the taxonomy residue sweep. Run: python3 tools/check_taxonomy.test.py"""
import copy, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
spec = importlib.util.spec_from_file_location('ct', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'check_taxonomy.py'))
ct = importlib.util.module_from_spec(spec); spec.loader.exec_module(ct)

tax = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'taxonomy.json')))
fails = 0
ran = 0
def check(name, cond):
    global fails, ran
    ran += 1
    print(('ok    ' if cond else 'FAIL  ') + name)
    fails += not cond

_, hits, _ = ct.sweep(tax)
check('the live taxonomy carries no unreviewed residue', hits == [])

# The original defect must be caught.
bad = copy.deepcopy(tax)
ty = next(t for t in bad['skills']['Area and volume']['types']
          if t['name'] == 'expression building with a constraint')
ty['procedure'] = 'substitute the stated relationship (h = r + 4) into the formula'
_, hits, _ = ct.sweep(bad)
check('h = r + 4 is flagged', any(h[1] == ty['name'] and h[2] == 'procedure' for h in hits))

# Rewording a reviewed string re-flags it: the allowlist is keyed on the text.
bad = copy.deepcopy(tax)
ty = next(t for s in bad['skills'].values() for t in s['types'] if t['name'] == 'triangle angle sum')
ty['procedure'] = 'use 180 degrees, and the 72 in the diagram'
_, hits, _ = ct.sweep(bad)
check('an edited reviewed string is flagged again', any(h[1] == 'triangle angle sum' for h in hits))

for s, want in [('first day $X', ['unit']), ('given mean = median', ['eq']),
                ('solve for x', []), ('multiply by 1.5', ['num 1.5'])]:
    check(f'flags({s!r}) == {want}', ct.flags(s) == want)

print(f'{ran}/{ran} passed' if not fails else f'{fails} of {ran} failed')
sys.exit(1 if fails else 0)
