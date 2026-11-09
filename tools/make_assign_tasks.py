#!/usr/bin/env python3
"""Split the 1,155 medium/hard questions into per-skill tagging chunks.

One task file per chunk. Each carries a CLOSED label set taken verbatim from
taxonomy.json, so a tagger cannot invent a near-miss name ("interpret slope"
for "interpret slope or apply slope properties") and silently fragment the
100 types into 130. Anything outside the set is rejected at merge time.

Chunks are per-skill and large (~35-47) on purpose: thin batching is what
produced 970 singleton types on the first attempt, because an agent that never
sees a repeat has no way to recognise one.
"""
import json, os, math, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHUNK_TARGET = 50          # ceil(pool / this) chunks, then split evenly

tax = json.load(open(f'{ROOT}/data/taxonomy.json'))
qb = json.load(open(f'{ROOT}/data/qb_index.json'))

sel = [q for q in qb if q.get('difficulty') in ('Medium', 'Hard')
       and not q.get('leak') and q.get('crop_y') is not None]

# The PDF text layer drops spaces at text-run boundaries, so skills are matched
# with whitespace removed rather than collapsed.
key = lambda s: re.sub(r'\s+', '', s or '').lower()
tax_by_key = {key(k): (k, v) for k, v in tax['skills'].items()}

# Cross-skill types belong to the label set of every skill they span, and to no
# other. Decided up front: four agents left to their own devices would each
# invent a local variant of the same type.
cross_for = {}
for ct in tax.get('cross_skill_types', []):
    for s in ct['spans']:
        cross_for.setdefault(key(s), []).append(
            {k: ct[k] for k in ('name', 'procedure', 'cue')})

by_skill = {}
for q in sel:
    by_skill.setdefault(key(q['skill']), []).append(q)

os.makedirs(f'{ROOT}/data/assign/tasks', exist_ok=True)
os.makedirs(f'{ROOT}/data/assign/out', exist_ok=True)

slug = lambda s: re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:44]
tasks, total = [], 0
for sk, qs in sorted(by_skill.items(), key=lambda kv: -len(kv[1])):
    if sk not in tax_by_key:
        sys.exit(f'FATAL: skill in bank but not in taxonomy: {qs[0]["skill"]!r}')
    name, entry = tax_by_key[sk]
    labels = [{k: t[k] for k in ('name', 'procedure', 'cue')} for t in entry['types']]
    labels += cross_for.get(sk, [])
    qs.sort(key=lambda q: q['qid'])
    n = max(1, math.ceil(len(qs) / CHUNK_TARGET))
    size = math.ceil(len(qs) / n)
    for i in range(n):
        part = qs[i * size:(i + 1) * size]
        if not part:
            continue
        tid = f'{slug(name)}-{i + 1:02d}'
        path = f'{ROOT}/data/assign/tasks/{tid}.json'
        json.dump({
            'task_id': tid,
            'skill': name,
            'labels': labels,
            'questions': [{'qid': q['qid'],
                           'image': f'{ROOT}/data/tagimg/{q["qid"]}.png',
                           'difficulty': q['difficulty']} for q in part],
            'out': f'{ROOT}/data/assign/out/{tid}.json',
        }, open(path, 'w'), indent=1, ensure_ascii=False)
        tasks.append({'task_id': tid, 'skill': name, 'n': len(part),
                      'labels': len(labels), 'path': path})
        total += len(part)

json.dump(tasks, open(f'{ROOT}/data/assign/tasks/_manifest.json', 'w'), indent=1)
for t in tasks:
    print(f'{t["n"]:3d} q  {t["labels"]:2d} labels  {t["task_id"]}')
print(f'\n{len(tasks)} chunks, {total} questions')
assert total == len(sel), (total, len(sel))
