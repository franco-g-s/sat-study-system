#!/usr/bin/env python3
"""Every primitive's `appears_in` must name a type that exists.

The primitives are the one layer of the taxonomy written top-down -- by reading
the 100 procedures rather than the questions -- so they are the most likely part
to be wrong, and a mapping that names a type which does not exist fails silently:
`types_state.py plan` simply never surfaces that primitive, and the shared cause
it was meant to expose stays invisible. That is exactly how the SW01 exponent
cluster was missed.
"""
import os
import json, sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
t = json.load(open(f'{ROOT}/data/taxonomy.json'))
real = {ty['name'] for s in t['skills'].values() for ty in s['types']}
real |= {c['name'] for c in t.get('cross_skill_types', [])}

bad, covered = [], Counter()
for p in t['primitives']:
    for ty in p['appears_in']:
        if ty not in real:
            bad.append((p['name'], ty))
        else:
            covered[ty] += 1

print(f"{len(t['primitives'])} primitives, {len(real)} types")
orphan = sorted(real - set(covered))
print(f"types with no primitive mapped: {len(orphan)}")
for o in orphan:
    print(f'  {o}')
if bad:
    print(f'\n{len(bad)} appears_in entries naming a type that does not exist:')
    for p, ty in bad:
        print(f'  {p!r} -> {ty!r}')
    sys.exit(1)
print('\nall appears_in entries resolve')
