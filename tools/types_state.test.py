#!/usr/bin/env python3
"""Tests for cmd_record's status transitions.

Run: python3 tools/types_state.test.py

Everything here is about ONE question: what does an encounter do to a type's
status. That is the whole control surface of the sweep -- `next`, `plan` and
drill_select.mjs all read status and nothing else -- so a status that does not
move is a type that never gets fixed, and a status that moves for the wrong
reason sends remediation at something the learner already knows.

Two properties of the module shape the fixtures:

  1. STATE is a module constant pointing at the live study data, with no
     env override. Every test reassigns types_state.STATE to a scratch file.
     Never let this suite touch state/types.json.
  2. suggest() is a WHOLE-ROW function: it drops mechanical encounters and reads
     the last of what is left. So on a remediated row, a mechanical re-sweep is
     judged by an encounter from BEFORE the remediation -- usually the failure
     the remediation sheet was written to fix. That is why the fixtures carry a
     prior sheet ending in wrong-method: without it the mechanical tests pass
     for the wrong reason.

Mutation-tested, per the lessons in drill_select.test.mjs. The two mutants that
matter, and what must go red:

  - Restore the original whitelist at the post-remediation branch,
    `suggest(r) if suggest(r) in ('slow', 'stuck') else 'remediated'`
    -> `a failed re-sweep demotes` and `a bailed re-sweep demotes` go red.
  - Widen it naively instead, to ('slow', 'shaky', 'stuck'), dropping the
    mechanical guard -> `a slip on a re-sweep is not a verdict` goes red.
    That mutant is the tempting one-word fix, and it LOOSENS the code into a
    false demotion. Check the direction, not just the colour.
"""
import json, os, re, sys, argparse, tempfile, traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import types_state as ts

SCRATCH = os.path.join(tempfile.mkdtemp(prefix='types_state_test.'), 'types.json')
ts.STATE = SCRATCH
UNTYPED_SCRATCH = os.path.join(os.path.dirname(SCRATCH), 'untyped_encounters.json')
ts.UNTYPED = UNTYPED_SCRATCH

KEY = 'Skill A :: type a'

# The remediation sheet R04 ran, ending on the failure it was written to fix.
# Anything that skips the new encounter falls back onto this.
PRIOR_SHEET = [('wrong-method', 80, 'wrong'), ('had-it', 50, 'right')]


def fixture(status, prior=PRIOR_SHEET, **over):
    """One row, written to the scratch state file."""
    row = {
        'skill': 'Skill A', 'type': 'type a', 'status': status, 'note': '',
        'pool': 5, 'primitives': ['p'],
        'encounters': [dict(qid=f'p{i}', date='2026-09-02', seconds=s,
                            outcome=o, answered=ans, note='')
                       for i, (o, s, ans) in enumerate(prior)],
        'remediated_on': '2026-09-02', 'remediated_by': 'R04',
        'resweep_due': '2026-09-16',
    }
    row.update(over)
    json.dump({'updated': '2026-09-15', 'types': {KEY: row}},
              open(SCRATCH, 'w'))


def record(outcome, seconds=70, answered='wrong', on='2026-09-15'):
    """Run `record` against the fixture; return (row, printed line)."""
    import io, contextlib
    args = argparse.Namespace(type_key=KEY, qid='q1', date=on,
                              seconds=seconds, outcome=outcome,
                              answered=answered, note='')
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        ts.cmd_record(args)
    return json.load(open(SCRATCH))['types'][KEY], buf.getvalue().strip()


# ---- the suite -------------------------------------------------------------
TESTS = []
test = lambda fn: TESTS.append(fn) or fn


@test
def a_failed_re_sweep_demotes():
    """The filed bug. wrong-method reads as shaky, and shaky was not in the
    whitelist, so the verdict was dropped and the type stayed remediated --
    printing `remediated -> remediated`, which reads as a pass."""
    fixture('remediated')
    row, out = record('wrong-method')
    assert row['status'] == 'shaky', f"expected shaky, got {row['status']}"
    assert 'FAILED' in out, out


@test
def a_bailed_re_sweep_demotes():
    """The other outcome suggest() maps to shaky. Same branch, same drop."""
    fixture('remediated')
    row, _ = record('bailed')
    assert row['status'] == 'shaky', f"expected shaky, got {row['status']}"


@test
def a_no_method_re_sweep_still_demotes_to_stuck():
    """Was already in the whitelist. Guards against a rewrite losing it."""
    fixture('remediated')
    row, _ = record('no-method')
    assert row['status'] == 'stuck', f"expected stuck, got {row['status']}"


@test
def a_slow_re_sweep_still_demotes_to_slow():
    fixture('remediated')
    row, _ = record('slow-recog')
    assert row['status'] == 'slow', f"expected slow, got {row['status']}"


@test
def a_pass_before_the_re_sweep_is_due_is_not_cold_and_stays_due():
    """A pass two weeks early is a warm encounter, not a cold re-sweep: the
    spacing is the measurement. The status holds, resweep_due stays put so
    `next` still asks -- and the line says why, rather than printing a bare
    `remediated -> remediated`, which is exactly what a dropped verdict printed.
    (The fixture's re-sweep is due 2026-09-16; this records 2026-09-15.)"""
    fixture('remediated', prior=[('had-it', 40, 'right')])
    row, out = record('had-it', seconds=40, answered='right', on='2026-09-15')
    assert row['status'] == 'remediated', f"expected remediated, got {row['status']}"
    assert row['resweep_due'] == '2026-09-16', row
    assert 'resweep_passed_on' not in row, row
    assert 'passed' in out and 'not yet due' in out, out


@test
def a_passed_cold_re_sweep_closes_the_type():
    """The filed bug (2026-10-01, R09 via DR08): a pass on or after the due
    date returned the row's own status, so it stayed `remediated` with
    resweep_due in the past and `next` reported it due forever. A pass must
    close it to the verdict -- keeping remediated_on/by and resweep_due as
    history -- and `next` must stop listing it."""
    import io, contextlib
    for on, seconds, want in (('2026-09-16', 40, 'fast'), ('2026-10-01', 90, 'good')):
        fixture('remediated', prior=[('had-it', 40, 'right')])
        row, out = record('had-it', seconds=seconds, answered='right', on=on)
        assert row['status'] == want, f"{on}: expected {want}, got {row['status']}"
        assert row['resweep_passed_on'] == on, row
        assert (row['remediated_on'], row['remediated_by'], row['resweep_due']) == \
            ('2026-09-02', 'R04', '2026-09-16'), 'history must survive the close-out'
        assert 'PASSED' in out, out
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            ts.cmd_next(argparse.Namespace(n=5))
        assert 'COLD RE-SWEEP' not in buf.getvalue() and KEY not in buf.getvalue(), buf.getvalue()


@test
def a_slip_on_a_re_sweep_is_not_a_verdict():
    """The trap in the one-word fix.

    suggest() skips mechanical encounters, so after a slip it returns the
    verdict of the last NON-mechanical one -- here the wrong-method from the
    remediation sheet itself, nine days old. Widening the whitelist without
    this guard re-opens a type on evidence the remediation already answered,
    which is the precise thing the module docstring forbids.

    A slip says nothing about whether the learner knows the type. The re-sweep did not
    happen: status holds, and the row stays due so it gets re-run.

    The prior sheet here ENDS on the failure, deliberately. With a `had-it`
    after it the median carries the row to 'good' and the unguarded mutant
    passes the status assertion while only mislabelling the line -- a kill for
    the wrong reason, and the direction of the mutant left unchecked."""
    for outcome in ('slipped', 'misread'):
        fixture('remediated', prior=[('wrong-method', 80, 'wrong')])
        row, out = record(outcome, seconds=40)
        assert row['status'] == 'remediated', \
            f"{outcome}: expected remediated, got {row['status']}"
        assert 'INCONCLUSIVE' in out, f'{outcome}: {out}'
        assert row['resweep_due'] == '2026-09-16', \
            f'{outcome}: re-sweep must stay due, got {row["resweep_due"]}'


@test
def no_post_remediation_encounter_is_silent():
    """The general defect, not just today's instance: every outcome must either
    move the status or say in words why it did not."""
    for outcome in sorted(ts.OUTCOMES):
        fixture('remediated')
        row, out = record(outcome)
        if row['status'] == 'remediated':
            assert '[' in out and ']' in out, \
                f'{outcome}: status unchanged with no explanation: {out!r}'


@test
def the_pass_and_fail_sets_cover_everything_suggest_can_return():
    """The bug was a whitelist that did not cover its own input domain. Assert
    the cover, rather than trusting the next reader to re-derive it.

    Kept in the test and NOT as a module-level assert: an assert that fires
    takes out the daily CLI over a disagreement about a constant."""
    reachable = set()
    for outcome in ts.OUTCOMES:
        for seconds in (10, 70, 300, None):
            reachable.add(ts.suggest({'encounters': [
                dict(qid='q', date='2026-09-15', seconds=seconds,
                     outcome=outcome, answered='wrong', note='')]}))
    covered = set(ts.RESWEEP_PASSED) | set(ts.RESWEEP_FAILED)
    assert reachable <= covered, f'suggest() can return {reachable - covered}, uncovered'
    assert not (set(ts.RESWEEP_PASSED) & set(ts.RESWEEP_FAILED)), 'pass/fail overlap'


@test
def a_status_encounters_do_not_drive_says_so():
    """No status reaches cmd_record's third branch today: the first two cover
    all of STATUSES. `revisit` did, and was swallowed without a word -- the same
    defect as the filed bug, one status over. This pins the guard so that a
    status added later cannot inherit the silence.

    Driven with a status deliberately absent from STATUSES, which is what a
    hand-edited row or a restored old backup would look like."""
    assert 'revisit' not in ts.STATUSES, 'dropped 2026-09-15; see the note on STATUSES'
    fixture('some-future-status')
    row, out = record('had-it', seconds=40, answered='right')
    assert row['status'] == 'some-future-status', f"got {row['status']}"
    assert 'some-future-status' in out and '[' in out, out


@test
def the_non_remediated_branch_is_unchanged():
    """Control. These take suggest() whole, including mechanical fallthrough."""
    for status in ('unswept', 'fast', 'good', 'slow', 'shaky', 'stuck'):
        fixture(status)
        row, _ = record('wrong-method')
        assert row['status'] == 'shaky', f"{status}: got {row['status']}"
    fixture('good')
    row, _ = record('no-method')
    assert row['status'] == 'stuck', row['status']


# ---- cmd_plan: what the ranking cannot say -------------------------------
def plan_state(*types):
    """A state file from (key, status, primitives, encounters) tuples.

    An encounter is an outcome, or an (outcome, date) pair when the test cares
    which sheet it came from -- which the settled-status count does, since
    disagreement inside one sheet means something different from disagreement
    across two."""
    st = {'updated': '2026-09-16', 'types': {}}
    for k, status, prims, enc in types:
        st['types'][k] = {
            'skill': k.split(' :: ')[0], 'type': k.split(' :: ')[1],
            'status': status, 'pool': 10, 'primitives': list(prims), 'note': '',
            'encounters': [dict(qid=f'q{i}', seconds=70, answered='wrong', note='',
                                outcome=e[0] if isinstance(e, tuple) else e,
                                date=e[1] if isinstance(e, tuple) else '2026-09-16')
                           for i, e in enumerate(enc)],
        }
    json.dump(st, open(SCRATCH, 'w'))


def plan_out():
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        ts.cmd_plan(argparse.Namespace())
    return buf.getvalue()


@test
def a_weak_type_with_no_primitive_is_named_not_swallowed():
    """The filed bug. 21 of 103 types carry `primitives: []`, so they can never
    reach a ranking built by counting primitives -- and the ranking printed as
    if it were the complete answer to what to remediate next."""
    plan_state(('S :: orphan', 'shaky', [], ['wrong-method']),
               ('S :: ranked a', 'slow', ['p'], ['slow-recog']),
               ('S :: ranked b', 'slow', ['p'], ['slow-recog']))
    out = plan_out()
    assert 'NOT represented above' in out, out
    assert 'S :: orphan' in out, out
    assert 'no primitive in the taxonomy' in out, out
    # Scope the negative to the unranked BLOCK. Asserting over the rest of the
    # output catches the provisional list further down, which legitimately names
    # every one-encounter type -- a kill for the wrong reason.
    block = out.split('NOT represented above')[1].split('\n\n')[0]
    assert 'S :: ranked a' not in block, \
        f'a ranked type must not also be listed as unranked:\n{block}'


@test
def a_weak_type_whose_primitive_is_a_singleton_is_named_too():
    """The second silence, and the one the filed report did not separate out:
    the ranking cuts at n >= 2, so a weak type with a real primitive that no
    other weak type shares is just as invisible as one with none."""
    plan_state(('S :: lonely', 'stuck', ['unique-prim'], ['no-method']),
               ('S :: ranked a', 'slow', ['p'], ['slow-recog']),
               ('S :: ranked b', 'slow', ['p'], ['slow-recog']))
    out = plan_out()
    assert 'S :: lonely' in out, out
    assert 'primitives shared with no other weak type' in out, out


@test
def the_gap_line_is_absent_when_there_is_no_gap():
    """Guards the other direction: once the taxonomy is filled, this must stop
    printing rather than sit there claiming a gap of zero."""
    plan_state(('S :: a', 'slow', ['p'], ['slow-recog']),
               ('S :: b', 'shaky', ['p'], ['wrong-method']))
    out = plan_out()
    assert 'NOT represented above' not in out, out
    assert re.search(r'^  2x .*  p$', out, re.M), out


@test
def only_weak_types_are_reported_as_unranked():
    """`good` and `fast` types have no business in a remediation gap list, with
    or without primitives."""
    plan_state(('S :: fine', 'good', [], ['had-it']),
               ('S :: also fine', 'fast', [], ['had-it']))
    out = plan_out()
    assert 'NOT represented above' not in out, out


# Every negative test below pairs its subject with this, a type that genuinely
# WAS decided by sheet order. Without it the block does not print at all when
# the count is zero, so `'0 type(s)' in out` would be false and asserting its
# absence would pass just as well against a build with the whole feature
# deleted. With the control present the block prints, and the assertion is that
# the count is exactly 1 -- which fails if the subject is wrongly included.
COINFLIP_CONTROL = ('S :: control', 'good', ['p'],
                    [('no-method', '2026-09-16'), ('had-it', '2026-09-16')])


@test
def a_status_decided_by_sheet_order_is_counted():
    """SW15's case: no-method, then wrong-method, then had-it, all on one sheet,
    settling on 'good' because suggest() reads the last one. Two of three failed,
    and a different emission order would have produced a different status.

    Counted, not named: the live figure is 35 of 103 and a list that long is
    wallpaper. The status is not changed either -- how to weigh disagreeing
    encounters is a real design question and changing suggest() would move every
    type at once."""
    plan_state(('S :: coinflip', 'good', ['p'],
                [('no-method', '2026-09-16'), ('wrong-method', '2026-09-16'),
                 ('had-it', '2026-09-16')]))
    out = plan_out()
    assert '1 type(s) took their status from the' in out, out
    assert 'S :: coinflip' not in out.split('how settled')[1], 'should be counted, not listed'


@test
def a_status_from_one_encounter_is_counted():
    plan_state(('S :: single', 'shaky', ['p'], [('wrong-method', '2026-09-16')]))
    assert 'rest on a single' in plan_out()


@test
def learning_across_sheets_is_not_a_coin_flip():
    """The direction check that matters, and the reason this is scoped to one
    sheet. A type that went no-method on one date and had-it on two later dates
    has been LEARNED: last-encounter-wins is right there, and flagging it would
    tell the learner their best evidence is unreliable. Only same-day disagreement is
    arbitrary, because nothing can have changed inside one sheet."""
    plan_state(COINFLIP_CONTROL,
               ('S :: learned', 'good', ['p'],
                [('no-method', '2026-08-01'), ('had-it', '2026-09-01'),
                 ('had-it', '2026-09-16')]))
    out = plan_out()
    assert '1 type(s) took their status from the' in out, out


@test
def agreeing_encounters_in_one_sheet_are_not_counted():
    """Three consistent questions are a verdict, not a coin flip."""
    plan_state(COINFLIP_CONTROL,
               ('S :: settled', 'stuck', ['p'],
                [('no-method', '2026-09-16'), ('wrong-method', '2026-09-16'),
                 ('bailed', '2026-09-16')]))
    assert '1 type(s) took their status from the' in plan_out()


@test
def mechanical_encounters_do_not_make_a_status_look_unsettled():
    """A slip is not disagreement about whether the learner has the method -- suggest()
    skips them, so this must skip them too, or every type with one misread on
    its sheet reads as a coin flip."""
    plan_state(COINFLIP_CONTROL,
               ('S :: slipped once', 'good', ['p'],
                [('had-it', '2026-09-16'), ('slipped', '2026-09-16'),
                 ('had-it', '2026-09-16')]))
    assert '1 type(s) took their status from the' in plan_out()


def untyped(qid, outcome='wrong-method', answered='wrong', **kw):
    """Run record-untyped against the scratch store; return the printed line."""
    import io, contextlib
    args = argparse.Namespace(qid=qid, seconds=kw.get('seconds', 60), outcome=outcome,
                              answered=answered, date=kw.get('date', '2026-09-28'),
                              sheet=kw.get('sheet', 'MX09'), trap=kw.get('trap', ''),
                              note=kw.get('note', ''))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        ts.cmd_record_untyped(args)
    return buf.getvalue()


def fresh_untyped():
    if os.path.exists(UNTYPED_SCRATCH):
        os.remove(UNTYPED_SCRATCH)


@test
def an_rw_question_is_recorded_with_its_skill_looked_up():
    """The filed gap: 11 of MX01's 20 had nowhere to go. Skill and difficulty
    come from the index, never from the command line."""
    fresh_untyped()
    untyped('de55ec71', trap='answered from the wrong text')
    e = json.load(open(UNTYPED_SCRATCH))['encounters'][0]
    assert (e['section'], e['skill'], e['difficulty']) == ('R&W', 'Boundaries', 'Easy'), e
    assert e['trap'] == 'answered from the wrong text' and e['sheet'] == 'MX09'


@test
def unmatched_and_unassigned_maths_questions_are_accepted():
    fresh_untyped()
    untyped('0b46bad5')          # assigned, type `unmatched`
    untyped('00ec9102')          # Easy, never assigned
    types = [e['type'] for e in json.load(open(UNTYPED_SCRATCH))['encounters']]
    assert types == ['unmatched', 'unassigned'], types


@test
def a_typed_maths_question_is_refused_and_pointed_at_record():
    """Otherwise the same question could be counted in two places."""
    fresh_untyped()
    try:
        untyped('c178d4da')
    except SystemExit as e:
        assert 'record' in str(e) and 'compare statistics across conditions' in str(e), e
    else:
        raise AssertionError('a typed question was accepted as untyped')
    assert not os.path.exists(UNTYPED_SCRATCH)


@test
def the_same_question_on_the_same_day_is_not_recorded_twice():
    fresh_untyped()
    untyped('de55ec71')
    try:
        untyped('de55ec71')
    except SystemExit:
        pass
    else:
        raise AssertionError('duplicate accepted')
    assert len(json.load(open(UNTYPED_SCRATCH))['encounters']) == 1


@test
def untyped_encounters_do_not_touch_the_type_board_or_coverage():
    """The inflation half of the issue: MX01's typed-but-untimed rows moved the
    swept figure 870 -> 912. Untyped rows must not move it at all, but plan
    must admit they exist."""
    plan_state(('S :: a', 'slow', ['p'], ['slow-recog']))
    before = plan_out()
    fresh_untyped()
    untyped('de55ec71')
    after = plan_out()
    assert before.split('\n')[:4] == after.split('\n')[:4], (before, after)
    assert 'not on this board: 1 untyped encounter(s) (1 R&W, 0 maths)' in after, after
    fresh_untyped()


@test
def the_ranking_says_what_it_counts_and_the_weak_surface_behind_it():
    """2026-09-22: a factoring sheet was sized off this list as if it counted
    questions that REQUIRE the primitive. It counts weak types tagged with it
    as their topic. The output must say so, and show the pool behind it."""
    plan_state(('S :: a', 'shaky', ['p'], ['wrong-method']),
               ('S :: b', 'slow', ['p'], ['slow-recog']))
    out = plan_out()
    assert 'weak TYPES tagged with it as their topic' in out, out
    assert 'REQUIRES' in out, out
    assert re.search(r'^  2x\s+20q \(100\.0% of bank\)  p$', out, re.M), out


@test
def the_live_state_file_was_never_touched():
    """The suite reassigns a module constant. If an import order ever undid
    that, this is the test that notices before the real data pays for it."""
    assert ts.STATE == SCRATCH, ts.STATE
    live = os.path.join(ts.ROOT, 'state')
    assert not ts.STATE.startswith(live), ts.STATE
    assert ts.UNTYPED == UNTYPED_SCRATCH and not ts.UNTYPED.startswith(live)


if __name__ == '__main__':
    failed = 0
    for fn in TESTS:
        try:
            fn()
            print(f'  ok    {fn.__name__.replace("_", " ")}')
        except Exception:
            failed += 1
            print(f'  FAIL  {fn.__name__.replace("_", " ")}')
            traceback.print_exc()
    print(f'\n{len(TESTS) - failed}/{len(TESTS)} passed')
    sys.exit(1 if failed else 0)
