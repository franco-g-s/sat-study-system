#!/usr/bin/env python3
"""Validate and merge the per-chunk tagging outputs into data/type_assignments.json.

  merge_assignments.py                 dry run: validate, report, write nothing
  merge_assignments.py --write         write data/type_assignments.json
  merge_assignments.py --out PATH      write PATH instead (verification; implies --write)
  merge_assignments.py --write --allow-deletions
                                       write even though rows present in the
                                       current file would be dropped or retyped

Inputs, in order: every chunk output named in data/assign/tasks/_manifest.json,
then data/assign/manual.json as a final overlay. The merged file is meant to be
a pure function of those two. Anything corrected by hand goes in manual.json,
NEVER straight into type_assignments.json -- a row that lives only in the merged
file is deleted by the next re-merge. That happened on 2026-09-17: the two
`manual-post-cropfix` rows vanished on a re-merge and every check below passed.

Checks, all arithmetic over the whole corpus rather than a spot check:

  identity   the Question ID the tagger read OFF THE IMAGE must equal the one in
             the filename. This is the check that was missing yesterday, when a
             page-number shift put question 6585d841 in a file named 310c87fe
             and every pipeline check passed anyway.
  closure    every returned type must be a verbatim member of that chunk's label
             set, or "unmatched". Free text drifts -- "interpret slope" for
             "interpret slope or apply slope properties" -- and silently turns
             100 types into 130. Manual rows are held to the same rule against
             their skill's types in taxonomy.json.
  coverage   every question in the chunk appears exactly once, no extras.
  totals     against the CORPUS (every usable Medium/Hard question in
             qb_index.json), not against the chunks. Until 2026-09-28 this
             counted the merge's own universe -- the sum of the chunk tasks,
             1,155 -- while the corpus was 1,157, so a merge that dropped the two
             hand rows still "accounted for 1,155 of 1,155" and passed.
  no loss    the new merge against the file it would replace. A qid that would
             disappear, or change skill or type, is refused unless
             --allow-deletions is passed. Chunk-label-only changes are listed but
             allowed. This is the one check that can see a row which only ever
             existed downstream of the chunks.

Exits non-zero if any check fails. Writes nothing on failure.
"""
import json, os, sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = f'{ROOT}/data/type_assignments.json'
MANUAL = f'{ROOT}/data/assign/manual.json'


def taxonomy_types(tax, skill):
    """Every type name a question in `skill` may carry."""
    names = {t['name'] for t in tax['skills'].get(skill, {}).get('types', [])}
    for ct in tax.get('cross_skill_types', []):
        if skill in ct['spans']:
            names.add(ct['name'])
    return names


def apply_manual(merged, manual_rows, qb_by_qid, tax):
    """Overlay hand corrections onto the chunk merge. Returns (problems, notes).

    A manual row may ADD a question no chunk covers (the cropfix rows) or
    OVERRIDE a chunk's answer. Overrides are printed, because a manual row that
    silently masks a later re-tag is the same class of invisibility this file
    exists to close.
    """
    problems, notes = [], []
    for qid, r in sorted(manual_rows.items()):
        q = qb_by_qid.get(qid)
        if q is None:
            problems.append(f'manual: {qid} is not a question in qb_index.json')
            continue
        if r.get('skill') != q.get('skill'):
            problems.append(f"manual: {qid} says skill {r.get('skill')!r}, the index says {q.get('skill')!r}")
            continue
        allowed = taxonomy_types(tax, r['skill']) | {'unmatched'}
        if r.get('type') not in allowed:
            problems.append(f"manual: closure — {qid} type {r.get('type')!r} is not a type of {r['skill']!r}")
            continue
        row = {'skill': r['skill'], 'type': r['type'],
               'confidence': r.get('confidence', 'unknown'),
               'chunk': r.get('chunk', 'manual')}
        was = merged.get(qid)
        if was and (was['skill'], was['type']) != (row['skill'], row['type']):
            notes.append(f"manual OVERRIDES {qid}: {was['type']!r} ({was['chunk']}) -> {row['type']!r}")
        elif was:
            notes.append(f"manual row {qid} agrees with chunk {was['chunk']} — redundant, safe to remove")
        merged[qid] = row
    return problems, notes


def compare(old, new):
    """What replacing `old` with `new` would lose. Returns (dropped, retyped, relabelled).

    dropped    qids in old and not in new
    retyped    qids whose skill or type differs
    relabelled qids whose only difference is the `chunk` provenance label
    """
    dropped = sorted(set(old) - set(new))
    retyped, relabelled = [], []
    for q in sorted(set(old) & set(new)):
        a, b = old[q], new[q]
        if (a.get('skill'), a.get('type')) != (b.get('skill'), b.get('type')):
            retyped.append(q)
        elif a.get('chunk') != b.get('chunk'):
            relabelled.append(q)
    return dropped, retyped, relabelled


def merge_chunks(manifest):
    problems, merged, missing_chunks, per_chunk = [], {}, [], []
    for t in manifest:
        task = json.load(open(t['path']))
        outp = task['out']
        if not os.path.exists(outp):
            missing_chunks.append(t['task_id']); continue
        try:
            rows = json.load(open(outp))
        except Exception as e:
            problems.append(f"{t['task_id']}: unparseable output ({e})"); continue

        allowed = {l['name'] for l in task['labels']} | {'unmatched'}
        want = [q['qid'] for q in task['questions']]
        got = [r.get('qid') for r in rows]

        if Counter(got) != Counter(want):
            extra = sorted(set(got) - set(want)); absent = sorted(set(want) - set(got))
            dup = [q for q, c in Counter(got).items() if c > 1]
            problems.append(f"{t['task_id']}: coverage — {len(absent)} missing {absent[:4]}, "
                            f"{len(extra)} extra {extra[:4]}, {len(dup)} duplicated {dup[:4]}")

        n_mismatch = n_unmatched = 0
        for r in rows:
            qid, hdr, typ = r.get('qid'), r.get('header_qid'), r.get('type')
            if hdr and hdr != qid:
                problems.append(f"{t['task_id']}: IDENTITY — file {qid} but image header says {hdr}")
                n_mismatch += 1
                continue
            if typ not in allowed:
                problems.append(f"{t['task_id']}: closure — {qid} returned {typ!r}, not in the label set")
                continue
            if typ == 'unmatched':
                n_unmatched += 1
            merged[qid] = {
                'skill': task['skill'],
                'type': typ,
                'confidence': r.get('confidence', 'unknown'),
                'chunk': t['task_id'],
            }
        per_chunk.append((t['task_id'], len(rows), n_unmatched, n_mismatch))
    return problems, merged, missing_chunks, per_chunk


def main(argv):
    out_path = argv[argv.index('--out') + 1] if '--out' in argv else None
    write = '--write' in argv or out_path is not None
    out_path = out_path or TARGET
    allow_loss = '--allow-deletions' in argv

    man = json.load(open(f'{ROOT}/data/assign/tasks/_manifest.json'))
    tax = json.load(open(f'{ROOT}/data/taxonomy.json'))
    index = json.load(open(f'{ROOT}/data/qb_index.json'))
    qb_by_qid = {q['qid']: q for q in index}

    problems, merged, missing_chunks, per_chunk = merge_chunks(man)
    for tid, n, unm, mm in per_chunk:
        flag = '  <-- IDENTITY' if mm else ''
        print(f'{n:3d} tagged  {unm:3d} unmatched ({unm/n*100:4.1f}%)  {tid}{flag}')

    manual = json.load(open(MANUAL))['rows'] if os.path.exists(MANUAL) else {}
    m_problems, m_notes = apply_manual(merged, manual, qb_by_qid, tax)
    problems += m_problems
    print(f'\nmanual overlay: {len(manual)} row(s) from data/assign/manual.json')
    for n in m_notes:
        print('  ' + n)

    corpus = {q['qid'] for q in index
              if q.get('difficulty') in ('Medium', 'Hard') and not q.get('leak')
              and q.get('crop_y') is not None}
    absent = sorted(corpus - set(merged))
    print(f'\nchunks: {len(per_chunk)} merged, {len(missing_chunks)} not run')
    if missing_chunks:
        print('  not run: ' + ', '.join(missing_chunks))
    print(f'questions: {len(merged)} / {len(corpus)} of the corpus assigned, {len(absent)} outstanding')
    if absent:
        print('  outstanding: ' + ' '.join(absent[:20]) + (' ...' if len(absent) > 20 else ''))
    unm = sum(1 for v in merged.values() if v['type'] == 'unmatched')
    print(f'unmatched: {unm} ({unm/max(1,len(merged))*100:.1f}%)')

    # ---- no loss: the new merge against the file it would replace ----------
    old = json.load(open(TARGET))['assignments'] if os.path.exists(TARGET) else {}
    dropped, retyped, relabelled = compare(old, merged)
    if relabelled:
        print(f'\n{len(relabelled)} row(s) change only their chunk label (allowed):')
        for q in relabelled:
            print(f"  {q}  {old[q].get('chunk')!r} -> {merged[q].get('chunk')!r}")
    if dropped or retyped:
        print(f'\nthe merge would REMOVE {len(dropped)} and RETYPE {len(retyped)} row(s) '
              f'present in data/type_assignments.json:')
        for q in dropped:
            print(f"  removed  {q}  {old[q].get('type')!r}  (chunk {old[q].get('chunk')!r})")
        for q in retyped:
            print(f"  retyped  {q}  {old[q].get('type')!r} -> {merged[q].get('type')!r}  "
                  f"(was chunk {old[q].get('chunk')!r})")
        print('  A row that exists only in the merged file was added by hand: move it into\n'
              '  data/assign/manual.json. If the change is genuinely intended, pass --allow-deletions.')
        if not allow_loss:
            problems.append(f'no loss — {len(dropped)} removed, {len(retyped)} retyped '
                            f'(pass --allow-deletions if intended)')

    if problems:
        print(f'\n{len(problems)} PROBLEMS:')
        for p in problems[:40]:
            print('  ' + p)
        if len(problems) > 40:
            print(f'  ... and {len(problems)-40} more')
        return 1

    if write:
        out = {
            '_note': 'Question -> type. Tagged from cropped question IMAGES, one agent '
                     'per CB skill chunk, against a closed label set from taxonomy.json, '
                     'plus the hand corrections in data/assign/manual.json. Generated by '
                     'merge_assignments.py -- do not edit by hand, edit manual.json.',
            '_assigned': len(merged),
            '_pool': len(corpus),
            '_unmatched': unm,
            'assignments': dict(sorted(merged.items())),
        }
        json.dump(out, open(out_path, 'w'), indent=1, ensure_ascii=False)
        print(f'\nwrote {out_path}')
    else:
        print('\n(dry run — pass --write to save)')

    # Type coverage, which is what decides whether a sweep is possible for a skill.
    by_type = Counter((v['skill'], v['type']) for v in merged.values())
    thin = [(s, t, n) for (s, t), n in by_type.items() if n < 3 and t != 'unmatched']
    if thin:
        print(f'\n{len(thin)} types with fewer than 3 questions assigned:')
        for s, t, n in sorted(thin):
            print(f'  {n}  {s} :: {t}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
