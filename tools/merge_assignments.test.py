#!/usr/bin/env python3
"""Tests for merge_assignments.py -- chiefly that a re-merge cannot silently lose rows.

Run: python3 tools/merge_assignments.test.py

The bug (2026-09-17): two rows added by hand to data/type_assignments.json
existed in no chunk output, so a re-merge rebuilt the file without them, exited
0, and `types_state.py init` then lowered two pool counts in the live record.
Every check passed because every check compared the merge against its own
inputs. These tests pin the check that compares it against what it replaces.

Nothing here writes data/type_assignments.json: every write goes to a scratch
path via --out, and the tests assert the real file is byte-identical after.
"""
import io, json, os, sys, tempfile, traceback, contextlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import merge_assignments as ma

SCRATCH = tempfile.mkdtemp(prefix='merge_assignments_test.')
REAL = ma.TARGET
REAL_BYTES = open(REAL, 'rb').read()

TAX = {
    'skills': {'Skill A': {'types': [{'name': 'type a'}, {'name': 'type b'}]}},
    'cross_skill_types': [{'name': 'cross', 'spans': ['Skill A', 'Skill B']}],
}
QB = {'q1': {'qid': 'q1', 'skill': 'Skill A'}, 'q2': {'qid': 'q2', 'skill': 'Skill A'}}


def row(t, chunk='c1', skill='Skill A'):
    return {'skill': skill, 'type': t, 'confidence': 'high', 'chunk': chunk}


def run(argv):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = ma.main(argv)
    return rc, buf.getvalue()


# ---- compare ---------------------------------------------------------------

def test_a_row_only_in_the_old_file_is_reported_dropped():
    dropped, retyped, relabelled = ma.compare({'q1': row('type a'), 'q2': row('type b', 'manual')},
                                              {'q1': row('type a')})
    assert dropped == ['q2'], dropped
    assert retyped == [] and relabelled == []


def test_a_type_change_is_a_retype_not_a_relabel():
    _, retyped, relabelled = ma.compare({'q1': row('type a')}, {'q1': row('type b')})
    assert retyped == ['q1'] and relabelled == []


def test_a_chunk_only_change_is_a_relabel():
    _, retyped, relabelled = ma.compare({'q1': row('type a', 'c1 (corrected)')}, {'q1': row('type a', 'c1')})
    assert retyped == [] and relabelled == ['q1']


# ---- apply_manual ----------------------------------------------------------

def test_manual_adds_a_row_no_chunk_covers():
    merged = {'q1': row('type a')}
    problems, _ = ma.apply_manual(merged, {'q2': row('type b', 'manual-x')}, QB, TAX)
    assert problems == [] and merged['q2']['chunk'] == 'manual-x'


def test_manual_override_is_announced():
    merged = {'q1': row('type a')}
    problems, notes = ma.apply_manual(merged, {'q1': row('type b', 'fix')}, QB, TAX)
    assert problems == [] and merged['q1']['type'] == 'type b'
    assert any('OVERRIDES q1' in n for n in notes), notes


def test_manual_rows_obey_closure():
    problems, _ = ma.apply_manual({}, {'q1': row('free text drift')}, QB, TAX)
    assert problems and 'closure' in problems[0], problems


def test_manual_cross_skill_type_is_allowed():
    problems, _ = ma.apply_manual({}, {'q1': row('cross')}, QB, TAX)
    assert problems == [], problems


def test_manual_skill_must_match_the_index():
    problems, _ = ma.apply_manual({}, {'q1': row('type a', skill='Skill B')}, QB, TAX)
    assert problems and 'index says' in problems[0], problems


def test_manual_qid_must_exist():
    problems, _ = ma.apply_manual({}, {'zz': row('type a')}, QB, TAX)
    assert problems and 'not a question' in problems[0], problems


# ---- the real corpus -------------------------------------------------------

def test_without_the_overlay_the_real_merge_refuses_and_writes_nothing():
    """The 2026-09-17 failure, replayed: the hand rows are not in any chunk."""
    out = os.path.join(SCRATCH, 'no-overlay.json')
    saved = ma.MANUAL
    ma.MANUAL = os.path.join(SCRATCH, 'absent-manual.json')
    try:
        rc, text = run(['--out', out])
    finally:
        ma.MANUAL = saved
    assert rc == 1, text
    assert 'removed  c178d4da' in text and 'removed  cf2be18d' in text, text
    assert not os.path.exists(out), 'a refused merge must write nothing'


def test_allow_deletions_is_the_explicit_override():
    out = os.path.join(SCRATCH, 'allowed.json')
    saved = ma.MANUAL
    ma.MANUAL = os.path.join(SCRATCH, 'absent-manual.json')
    try:
        rc, _ = run(['--out', out, '--allow-deletions'])
    finally:
        ma.MANUAL = saved
    assert rc == 0 and os.path.exists(out)


def test_the_real_merge_is_a_pure_function_of_its_inputs():
    """Chunks + manual.json reproduce the committed file row for row.

    Only provenance labels may differ. If this goes red, someone edited
    type_assignments.json by hand -- move the edit into manual.json.
    """
    out = os.path.join(SCRATCH, 'pure.json')
    rc, text = run(['--out', out])
    assert rc == 0, text
    old = json.load(open(REAL))['assignments']
    new = json.load(open(out))['assignments']
    dropped, retyped, _ = ma.compare(old, new)
    assert (dropped, retyped) == ([], []), (dropped, retyped)
    assert set(new) == set(old)


def test_the_suite_never_touched_the_real_file():
    assert open(REAL, 'rb').read() == REAL_BYTES


# The real-merge tests replay the image-tagging pass, whose task manifest is not
# shipped (it points at local question crops). Without it they are skipped.
NEEDS_MANIFEST = {
    'test_without_the_overlay_the_real_merge_refuses_and_writes_nothing',
    'test_allow_deletions_is_the_explicit_override',
    'test_the_real_merge_is_a_pure_function_of_its_inputs',
}
HAVE_MANIFEST = os.path.exists(os.path.join(ma.ROOT, 'data', 'assign', 'tasks', '_manifest.json'))

if __name__ == '__main__':
    tests = [(n, f) for n, f in list(globals().items()) if n.startswith('test_') and callable(f)]
    failed = 0
    for n, f in tests:
        if n in NEEDS_MANIFEST and not HAVE_MANIFEST:
            print(f'skip  {n} (no data/assign/tasks/_manifest.json)')
            continue
        try:
            f()
            print(f'ok    {n}')
        except Exception:
            failed += 1
            print(f'FAIL  {n}')
            traceback.print_exc()
    print(f'\n{len(tests) - failed} passed, {failed} failed')
    sys.exit(1 if failed else 0)
