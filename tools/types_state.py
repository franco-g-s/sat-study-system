#!/usr/bin/env python3
"""state/types.json — the sweep's system of record.

One row per type. What it holds and why:

  status    unswept -> fast | good | slow | shaky | stuck -> remediated
            a cold re-sweep then either holds it at remediated or sends it back
            to slow | shaky | stuck, which is what makes remediation falsifiable
            "good" is the majority case and is deliberately separate from
            "slow": folding them together sends remediation at types that are
            already fine, which is how the previous plan died.
  encounters every time the learner has met a question of this type: the
            question, the date, SECONDS, and whether it was right. The seconds are the whole
            point -- without a number "slow" is an adjective and the pivot to
            speed cannot be checked.
  primitives what remediation actually fixes. Many-to-many with types, so two
            slow types sharing one primitive is one sheet, not two.

Usage:
  types_state.py init            build/refresh rows from taxonomy + assignments
  types_state.py show [--skill S] [--status S]
  types_state.py next [--n 5]    which types to sweep next, and why
  types_state.py record <type-key> <qid> <seconds|-> <right|wrong|blank> [--date D]
     (`-` for seconds when the time box was left empty; the encounter still counts)
  types_state.py set-status <type-key> <status> [--note "..."]
  types_state.py plan            coverage: how much of the bank is swept
  types_state.py record-untyped <qid> <seconds|-> <outcome> [--answered A]
                 [--sheet MX01] [--trap "..."] [--note "..."] [--date D]
     for a question with NO type to record against: every R&W question, and
     maths questions assigned `unmatched` or never assigned (the Easy pool).
     Goes to state/untyped_encounters.json, never to types.json.
  types_state.py untyped [--skill S] [--section rw|maths] [--trap T]
     what has been recorded there -- "has this happened before?"
"""
import json, os, re, sys, argparse, statistics
from datetime import date, timedelta
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESWEEP_DAYS = 14
STATE = f'{ROOT}/state/types.json'
# Encounters that have no type to land on. Kept OUT of types.json on purpose:
# they must not move a type's status or the swept-surface figure, which is what
# recording six MX01 questions as typed encounters did (870 -> 912, 2026-09-11).
# Append-only, one row per question met, same seconds/outcome/answered axes as a
# typed encounter so the two can be read side by side.
UNTYPED = f'{ROOT}/state/untyped_encounters.json'
# 'revisit' was here until 2026-09-15, for a type whose remediation had been
# tried and failed. It was dropped because it was a status nothing acted on.
# drill_select.mjs gives tiers to remediated-and-due, stuck, shaky and slow, and
# `plan` counts primitives under slow/shaky/stuck -- `revisit` was in neither,
# so a failed re-sweep landed on a queue that printed it and nothing else. It is
# now demoted to `shaky` like any other type not yet mastered, which drills it
# and counts it. That R04 was already tried and failed survives in
# remediated_by / remediated_on and in the row's note.
STATUSES = ['unswept', 'fast', 'good', 'slow', 'shaky', 'stuck', 'remediated']

# What a cold re-sweep's verdict means for a type that is already 'remediated'.
# Together these must cover everything suggest() can return for a row with at
# least one encounter -- a verdict in neither set is a verdict that gets
# dropped, which is the bug these two constants exist to prevent recurring.
# 'shaky' was missing from the demotions and a failed re-sweep read as a passed
# one for two weeks. types_state.test.py asserts the cover.
RESWEEP_PASSED = ('fast', 'good')            # the remediation held
RESWEEP_FAILED = ('slow', 'shaky', 'stuck')  # it did not, and the type re-opens

# What happened on one encounter. Right/wrong is scoring; this is the axis that
# decides the remedy, which is the only reason to record anything.
#
# The two marked mechanical=True are NOT type problems. A slip on a question
# whose method was sound says nothing about whether the learner knows the type, and one
# practice-test review found six of eleven attempted questions had flawless
# mathematics and the wrong answer. Letting those drive type status would send
# remediation at things already known, so they are counted separately and
# feed the pacing protocol instead.
OUTCOMES = {
    'had-it':      dict(label='had it — method arrived immediately',     mechanical=False),
    'slow-recog':  dict(label='knew it, took a while to see it',         mechanical=False),
    'slipped':     dict(label='right method, slipped in the working',    mechanical=True),
    'misread':     dict(label='misread the question or the figure',      mechanical=True),
    'wrong-method':dict(label='wrong method — thought it was something else', mechanical=False),
    'bailed':      dict(label='had a route, ran out of patience',        mechanical=False),
    'no-method':   dict(label="no method — didn't know how to start",    mechanical=False),
}

# Thresholds, in seconds. The real section is 44 questions in 70 minutes, which
# is 95 s each; these are set around that budget rather than around a feeling.
# A type that eats 150 s cannot appear twice on a form without costing another
# question, so "slow" starts well below the average, not at it.
FAST, GOOD = 55, 110

key = lambda skill, typ: f'{skill} :: {typ}'
skill_key = lambda s: re.sub(r'\s+', '', s or '').lower()


def _opt_seconds(v):
    """Seconds, or None when the time box was left empty.

    Pass `-` (or `none`) for an untimed encounter. Before this existed the
    argument was a required int, so a blank box had no honest representation and
    two conventions grew up side by side, neither of them marked: SW09 recorded
    a fabricated `0`, which halves a median (54s printed where the real one was
    103s), and a later review omitted the encounter entirely, which loses a real
    failure from n. Both are silent, and any cross-type aggregate mixed them.

    A count and an outcome are still recorded for an untimed encounter -- it
    happened, and it was answered right or wrong. Only the timing is unknown, and
    unknown is what it now says.
    """
    if v is None or str(v).strip().lower() in ('-', 'none', 'null', 'na', ''):
        return None
    return int(v)


def load():
    return json.load(open(STATE)) if os.path.exists(STATE) else None


def save(st):
    st['updated'] = date.today().isoformat()
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(st, open(STATE, 'w'), indent=1, ensure_ascii=False)


def suggest(row):
    """Status implied by the encounters.

    The first version flagged any recent non-right answer as 'stuck' and put 7 of
    9 types there on the very first sweep -- which threw away the difference
    between a type the learner half-has and one where "no clue" was written twice. Status now
    follows what HAPPENED, not whether the answer matched.

    Mechanical encounters are skipped entirely: they are counted elsewhere.
    Advisory either way; the review sees the working and overrides.
    """
    enc = [e for e in row['encounters'] if not OUTCOMES.get(e['outcome'], {}).get('mechanical')]
    if not enc:
        # Everything on this type was a slip or a misread: the method was there.
        return 'good' if row['encounters'] else 'unswept'
    last = enc[-1]['outcome']
    if last == 'no-method':
        return 'stuck'
    if last in ('wrong-method', 'bailed'):
        return 'shaky'
    if last == 'slow-recog':
        return 'slow'
    timed = [e['seconds'] for e in enc if e.get('seconds') is not None]
    if not timed:
        # The method was there and we have no timing evidence either way.
        # 'good' is the honest neutral: 'slow' would be an accusation built on
        # an absent measurement, which is the bug this whole change is about.
        return 'good'
    med = statistics.median(timed)
    return 'fast' if med <= FAST else 'good' if med <= GOOD else 'slow'


def cmd_init(args):
    tax = json.load(open(f'{ROOT}/data/taxonomy.json'))
    assign_path = f'{ROOT}/data/type_assignments.json'
    assigns = json.load(open(assign_path))['assignments'] if os.path.exists(assign_path) else {}

    # type -> primitives, inverted from the primitive layer's appears_in
    prims = defaultdict(list)
    for p in tax['primitives']:
        for t in p['appears_in']:
            prims[t].append(p['name'])

    pool = Counter()
    for qid, a in assigns.items():
        pool[key(a['skill'], a['type'])] += 1

    st = load() or {'_note': __doc__.strip().split('\n')[0], 'types': {}}
    st['_thresholds_s'] = {'fast': FAST, 'good': GOOD, 'section_budget': 95}

    def upsert(skill, t):
        k = key(skill, t['name'])
        row = st['types'].setdefault(k, {
            'skill': skill, 'type': t['name'],
            'status': 'unswept', 'encounters': [], 'note': '',
        })
        row['procedure'] = t['procedure']
        row['cue'] = t['cue']
        row['primitives'] = prims.get(t['name'], [])
        row['pool'] = pool.get(k, 0)
        return k

    seen = set()
    for skill, entry in tax['skills'].items():
        for t in entry['types']:
            seen.add(upsert(skill, t))
    for ct in tax.get('cross_skill_types', []):
        for skill in ct['spans']:
            seen.add(upsert(skill, ct))

    stale = [k for k in st['types'] if k not in seen]
    for k in stale:
        st['types'][k]['note'] = (st['types'][k].get('note') or '') + ' [no longer in taxonomy]'

    unassigned = sum(1 for a in assigns.values() if a['type'] == 'unmatched')
    st['_coverage'] = {
        'types': len(st['types']),
        'questions_assigned': len(assigns),
        'questions_unmatched': unassigned,
    }
    save(st)
    print(f'{len(st["types"])} types, {len(assigns)} questions assigned, '
          f'{unassigned} unmatched, {len(stale)} stale rows flagged')
    empty = [k for k, r in st['types'].items() if r['pool'] == 0]
    if empty:
        print(f'{len(empty)} types with no question assigned yet:')
        for k in sorted(empty)[:20]:
            print('  ' + k)


def rows(st, args):
    out = []
    for k, r in sorted(st['types'].items()):
        if getattr(args, 'skill', None) and skill_key(args.skill) not in skill_key(r['skill']):
            continue
        if getattr(args, 'status', None) and r['status'] != args.status:
            continue
        out.append((k, r))
    return out


def cmd_show(args):
    st = load()
    for k, r in rows(st, args):
        enc = r['encounters']
        timed = [e['seconds'] for e in enc if e.get('seconds') is not None]
        t = f"{statistics.median(timed):.0f}s" if timed else '--'
        untimed = len(enc) - len(timed)
        # n counts every encounter; the median counts only the measured ones.
        # Printing the gap is the point -- a silently-shrunk median is what made
        # this hard to see in the first place.
        note = f" ({untimed} untimed)" if untimed else ''
        print(f"{r['status']:10s} {r['pool']:3d}q  n={len(enc)} med={t:>5s}{note}  {k}")


def cmd_plan(args):
    st = load()
    by = Counter(r['status'] for r in st['types'].values())
    tot_q = sum(r['pool'] for r in st['types'].values())
    swept_q = sum(r['pool'] for r in st['types'].values() if r['status'] != 'unswept')
    print('types by status:')
    for s in STATUSES:
        if by.get(s):
            print(f'  {s:12s} {by[s]:3d}')
    print(f'\nbank surface swept: {swept_q}/{tot_q} questions '
          f'({swept_q/max(1,tot_q)*100:.0f}%) via '
          f'{sum(1 for r in st["types"].values() if r["status"] != "unswept")}/'
          f'{len(st["types"])} types')

    # A type counts as swept on ONE encounter of any kind, and since 2026-09-09
    # an encounter can be untimed -- so a type can leave 'unswept' on evidence
    # that carries no timing at all. Recording six such questions on 2026-09-11
    # moved this figure 870 -> 912 without a single timed measurement behind the
    # difference.
    #
    # The headline is deliberately NOT redefined: what counts as swept is a
    # judgement about what the sweep is for, and it is not this script's to
    # make silently. Print the part that rests on no timing instead, so the
    # number can be read with its weakness visible -- the same reason `show`
    # prints '(1 untimed)' rather than quietly dropping it.
    blind = [r for r in st['types'].values()
             if r['status'] != 'unswept'
             and not any(e.get('seconds') is not None for e in r['encounters'])]
    if blind:
        blind_q = sum(r['pool'] for r in blind)
        print(f'  of which {blind_q} questions across {len(blind)} type(s) rest on '
              f'untimed encounters only — no timing evidence behind them')
    # Evidence that exists but is not on this board. Named here so a cold read of
    # `plan` cannot mistake the type board for everything the learner has been measured on.
    untyped = load_untyped()['encounters']
    if untyped:
        n_rw = sum(e['section'] == 'R&W' for e in untyped)
        print(f'  not on this board: {len(untyped)} untyped encounter(s) '
              f'({n_rw} R&W, {len(untyped) - n_rw} maths) -- see `types_state.py untyped`')
    # Where remediation would pay twice: one primitive under several bad types.
    bad = [(k, r) for k, r in st['types'].items() if r['status'] in ('slow', 'shaky', 'stuck')]
    shared = Counter(p for _, r in bad for p in r['primitives'])
    ranked = {p for p, n in shared.items() if n >= 2}
    # What the count MEASURES, printed with it (2026-09-22). A primitive is
    # tagged on a type where it is the question's TOPIC, not wherever the
    # solution REQUIRES it -- so an enabling step (factoring, completing the
    # square, clearing denominators) is undercounted: half the bank's questions
    # whose published solution factors sit in types not tagged `factor a
    # quadratic`. A factoring sheet was sized off this list at 1.1% and set
    # aside; the rationale text said 6.1% of the bank. Both are real numbers
    # measuring different things, and only one was ever shown. Until a
    # `requires` layer exists, say which one this is.
    if ranked:
        print('\nprimitives under two or more slow/shaky/stuck types — remediate these first:')
        print('  (Nx = weak TYPES tagged with it as their topic; q = weak surface, the pool of\n'
              '   those types. Not the questions whose solution REQUIRES it -- an enabling\n'
              '   step like factoring is undercounted here.)')
        for p, n in shared.most_common():
            if n >= 2:
                q = sum(r['pool'] for _, r in bad if p in r['primitives'])
                print(f'  {n}x  {q:3d}q ({q/max(1,tot_q)*100:4.1f}% of bank)  {p}')

    # ...and what that list CANNOT say. It ranks primitives, so a weak type
    # reaches it only through a primitive it shares with another weak type. Two
    # ways to be weak and invisible:
    #
    #   no primitive at all -- 21 of 103 types have `primitives: []`, because
    #     cmd_init inverts taxonomy.json's primitives[].appears_in and no
    #     primitive claims them. SW15 put `solve constraint equations on
    #     statistics` (pool 11) at shaky and it could never have appeared here.
    #   primitives that nothing else shares -- real, but singletons, so they
    #     fall under the n >= 2 cut.
    #
    # Either way the ranking used to print as a complete answer to "what do I
    # remediate next". It is not one, and the fix that would make it one is
    # filling the taxonomy, which is a naming judgement rather than a code
    # change. Printing the gap is what stops it being silent in the meantime.
    unranked = [(k, r) for k, r in bad if not (set(r['primitives']) & ranked)]
    if unranked:
        gap_q = sum(r['pool'] for _, r in unranked)
        print(f'\n{len(unranked)} slow/shaky/stuck type(s), {gap_q} questions of bank '
              f'surface, are NOT represented above:')
        for k, r in sorted(unranked, key=lambda x: -x[1]['pool']):
            why = 'no primitive in the taxonomy' if not r['primitives'] \
                else 'primitives shared with no other weak type'
            print(f'  {r["pool"]:3d}q  {r["status"]:6s} {k}\n        ({why})')

    # A status is suggest()'s reading of the LAST non-mechanical encounter, so a
    # sheet that recorded three questions on a type decided it by whichever was
    # printed last. SW15 saw `no-method`, then `wrong-method`, then `had-it`, and
    # settled on 'good' -- two of three failed. The docstring calls status
    # advisory and the reviewer overrides it, which works when a human is reading
    # the sheet; `plan` is also read cold, where nothing says a verdict was one
    # question's ordering from its opposite. Count those rather than re-deriving
    # the status: how to weigh disagreeing encounters is a real design question
    # and changing suggest() silently would move every type at once.
    # Deliberately a COUNT and not a list. The first version of this printed the
    # names and came to 35 of 103 types, which is wallpaper rather than a
    # warning -- three questions per type per sheet and some right, some wrong,
    # is the normal case. It is still worth one line, because the ranking above
    # is built on these statuses and reads as settled.
    #
    # Scoped to disagreement WITHIN THE LAST SHEET, which is the part that is
    # genuinely arbitrary. Across sheets, last-encounter-wins is not a bug: a
    # type that went no-method -> had-it -> had-it really has been learned, and
    # flagging that trajectory would be wrong. Inside one sheet, recorded on one
    # date, there is no time for learning and the order is whatever
    # build_sweep.mjs emitted.
    def _decided_by_sheet_order(r):
        enc = [e for e in r['encounters']
               if not OUTCOMES.get(e['outcome'], {}).get('mechanical')]
        if not enc:
            return False
        same_sheet = [e for e in enc if e['date'] == enc[-1]['date']]
        if len(same_sheet) < 2:
            return False
        return len({e['outcome'] in ('had-it', 'slow-recog') for e in same_sheet}) > 1
    coinflip = [k for k, r in st['types'].items()
                if r['status'] != 'unswept' and _decided_by_sheet_order(r)]
    lone = [k for k, r in st['types'].items()
            if r['status'] != 'unswept'
            and len([e for e in r['encounters']
                     if not OUTCOMES.get(e['outcome'], {}).get('mechanical')]) == 1]
    if coinflip or lone:
        print(f'\nhow settled the statuses above are: {len(coinflip)} type(s) took their '
              f'status from the\nlast of several disagreeing questions in one sheet, and '
              f'{len(lone)} rest on a single\nencounter. suggest() is last-encounter-wins '
              f'and the review is meant to override it.')


def cmd_mechanical(args):
    """Slips and misreads, across every type.

    These are the errors drilling does not touch, and the only way to see them is
    to count them across the whole corpus rather than per type -- one misread is
    noise, one a week is a habit. This is the number the pacing protocol is
    supposed to move.
    """
    st = load()
    rows = []
    for k, r in st['types'].items():
        for e in r['encounters']:
            if OUTCOMES.get(e['outcome'], {}).get('mechanical'):
                rows.append((e['date'], e['outcome'], e['qid'], k, e.get('note', '')))
    rows.sort()
    total = sum(len(r['encounters']) for r in st['types'].values())
    print(f'{len(rows)} mechanical errors in {total} encounters '
          f'({len(rows)/max(1,total)*100:.0f}% of questions met)')
    for d, o, q, k, note in rows:
        print(f'  {d}  {o:8s} {q}  {k}')
        if note:
            print(f'            "{note}"')
    if not rows:
        print('  none recorded')
    # Bails are tracked here too, though they are not mechanical. The cap is
    # doing its job when you abandon something you genuinely could not finish;
    # it is costing you when you abandon something you could. Only the answer
    # key can tell those apart, and only over several sweeps.
    bails = [(e['date'], e['qid'], k, e.get('answered'), e.get('note', ''))
             for k, r in st['types'].items() for e in r['encounters']
             if e['outcome'] == 'bailed']
    print(f'\n{len(bails)} bails at the 3-minute cap')
    for d, q, k, ans, note in sorted(bails):
        print(f'  {d}  {q}  {k}  -> {ans}')
        if note:
            print(f'            "{note}"')


def cmd_next(args):
    st = load()
    # Biggest unswept slice of the bank first: coverage is the thing that was
    # missing, and a type holding 40 questions is 40 questions of the real form.
    cand = [(r['pool'], k, r) for k, r in st['types'].items() if r['status'] == 'unswept']
    cand.sort(reverse=True)
    for pool, k, r in cand[:args.n]:
        print(f'{pool:3d}q  {k}\n      cue: {r["cue"]}')
    # Cold re-sweeps come first when they are due: one question on a remediated
    # type, notes closed, timed. It is the only thing that makes the pivot
    # falsifiable, and a due date nobody surfaces is a date nobody keeps.
    today = date.today().isoformat()
    due = [(k, r) for k, r in st['types'].items()
           if r.get('resweep_due') and r['resweep_due'] <= today and r['status'] == 'remediated']
    soon = [(k, r) for k, r in st['types'].items()
            if r.get('resweep_due') and r['resweep_due'] > today and r['status'] == 'remediated']
    if due:
        print(f'\n{len(due)} COLD RE-SWEEP(S) DUE — do these before more sweeping:')
        for k, r in due:
            print(f'  due {r["resweep_due"]}  {k}  (remediated {r.get("remediated_on")} by {r.get("remediated_by")})')
    if soon:
        print(f'\n{len(soon)} re-sweep(s) scheduled:')
        for k, r in sorted(soon, key=lambda x: x[1]['resweep_due']):
            print(f'  {r["resweep_due"]}  {k}  (by {r.get("remediated_by")})')

    # The revisit queue used to print here. It was the one place a failed
    # re-sweep appeared, and it was a dead end: `revisit` had no tier in
    # drill_select.mjs and no place in the primitive tally, so a type on it was
    # drilled zero times and counted for nothing. A failed re-sweep is now just
    # `shaky` -- see the note on STATUSES.


def resweep_verdict(row, outcome):
    """What a post-remediation encounter does to the status, and why.

    A cold re-sweep is the only thing that makes the pivot falsifiable, so its
    verdict is kept rather than collapsed back. Returns (status, explanation);
    an empty explanation is not an option -- a re-sweep whose result can be
    dropped without a word is not a measurement, and for two weeks that is
    exactly what a `shaky` verdict was.

    The mechanical guard is not decoration. suggest() SKIPS mechanical
    encounters, so after a slip it returns the verdict of the last
    non-mechanical one -- on a remediated row, usually the failure the
    remediation sheet was written to fix. Demoting on that would re-open a type
    on evidence the remediation has already answered, which is the one thing
    the OUTCOMES table above says must never drive type status. A slip says
    nothing about whether the learner knows the type: the re-sweep did not happen, the
    status holds, and resweep_due is left where it is so `next` asks again.
    """
    if OUTCOMES.get(outcome, {}).get('mechanical'):
        return row['status'], (f'cold re-sweep INCONCLUSIVE: {outcome} is mechanical, '
                               f'so the type was not tested — still due')
    verdict = suggest(row)
    if verdict in RESWEEP_FAILED:
        return verdict, 'cold re-sweep FAILED'
    if verdict in RESWEEP_PASSED:
        # A pass CLOSES the row (2026-10-01): returning row['status'] left it
        # `remediated` with resweep_due in the past, so `next` reported R09's
        # two passed types due forever. But only a COLD pass -- one on or after
        # the due date. A pass before then is a warm encounter: the spacing is
        # the measurement, so the status and the due date both stand.
        on = (row.get('encounters') or [{}])[-1].get('date')
        due = row.get('resweep_due')
        if due and on and on < due:
            return row['status'], (f'passed ({verdict}) but the re-sweep is not yet due '
                                   f'({due}) -- not cold, still due')
        return verdict, f'cold re-sweep PASSED ({verdict}) -- closed'
    return row['status'], (f'cold re-sweep verdict {verdict!r} is neither a pass nor a '
                           f'demotion — status left alone, check this by hand')


def cmd_record(args):
    st = load()
    r = st['types'].get(args.type_key)
    if not r:
        sys.exit(f'no such type: {args.type_key}')
    r['encounters'].append({
        'qid': args.qid, 'date': args.date or date.today().isoformat(),
        'seconds': args.seconds, 'outcome': args.outcome, 'answered': args.answered,
        'note': args.note or '',
    })
    was = r['status']
    # 'shaky' belongs here. Leaving it out froze the status: a type that went
    # shaky stayed shaky no matter what happened next, so quadratic solution
    # extraction sat on 'shaky' through two later encounters whose notes
    # said the learner did not know how to solve them. The queue is
    # driven by status, so a frozen status is a type that never gets fixed.
    if was in ('unswept', 'fast', 'good', 'slow', 'shaky', 'stuck'):
        r['status'] = suggest(r)
        why = ''
    elif was == 'remediated':
        r['status'], why = resweep_verdict(r, args.outcome)
        # remediated_on/by and resweep_due stay on the row as history; the pass
        # date is what says the remediation was tested and held.
        if r['status'] in RESWEEP_PASSED:
            r['resweep_passed_on'] = r['encounters'][-1]['date']
    else:
        # No status reaches here today -- the two branches above cover all of
        # STATUSES. It stays because 'revisit' DID reach here and was swallowed
        # without a word, which is the same defect as the one this function was
        # fixed for. A status added later must not inherit that silence.
        why = (f'{was} is not driven by encounters — status left alone; '
               f'the encounters now suggest {suggest(r)}')
    save(st)
    print(f'{args.type_key}: {was} -> {r["status"]}  (n={len(r["encounters"])})'
          + (f'  [{why}]' if why else ''))


def cmd_set_status(args):
    st = load()
    r = st['types'].get(args.type_key)
    if not r:
        sys.exit(f'no such type: {args.type_key}')
    if args.status not in STATUSES:
        sys.exit(f'status must be one of {STATUSES}')
    was = r['status']
    r['status'] = args.status
    if args.note:
        r['note'] = args.note
    # A type marked 'remediated' must carry a re-sweep date, or it silently
    # never reappears in `next` and the remediation is never falsified.
    if args.status == 'remediated':
        if not args.remediated_by:
            sys.exit("status 'remediated' requires --remediated-by (e.g. R02)")
        on = args.date or date.today().isoformat()
        r['remediated_on'] = on
        r['remediated_by'] = args.remediated_by
        r['resweep_due'] = (date.fromisoformat(on)
                            + timedelta(days=RESWEEP_DAYS)).isoformat()
    save(st)
    print(f'{args.type_key}: {was} -> {args.status}'
          + (f"  (by {r['remediated_by']}, re-sweep {r['resweep_due']})"
             if args.status == 'remediated' else ''))


def _question(qid):
    """(section, index row) for a qid, from whichever bank index holds it."""
    for section, path in (('R&W', f'{ROOT}/data/rw_index.json'), ('Maths', f'{ROOT}/data/qb_index.json')):
        if os.path.exists(path):
            for q in json.load(open(path)):
                if q['qid'] == qid:
                    return section, q
    return None, None


def load_untyped():
    return json.load(open(UNTYPED)) if os.path.exists(UNTYPED) else {
        '_note': 'Encounters with no type to record against: R&W, and maths questions '
                 'that are unmatched or unassigned. Written by types_state.py '
                 'record-untyped; never counted in types.json statuses or coverage.',
        'encounters': [],
    }


def cmd_record_untyped(args):
    """Record a question that has no type. Refuses one that does.

    Skill, domain and difficulty are looked up, not typed in: a hand-typed skill
    is how "Cross-text" and "Cross-Text" become two skills. A maths question
    that HAS a type is refused and pointed at `record`, so nothing is ever
    counted twice or in the wrong place.
    """
    section, q = _question(args.qid)
    if q is None:
        sys.exit(f'{args.qid} is in neither data/rw_index.json nor data/qb_index.json')
    typ = 'n/a (R&W has no type layer)'
    if section == 'Maths':
        assign_path = f'{ROOT}/data/type_assignments.json'
        a = (json.load(open(assign_path))['assignments'].get(args.qid)
             if os.path.exists(assign_path) else None)
        if a and a['type'] != 'unmatched':
            sys.exit(f"{args.qid} has a type -- record it there instead:\n"
                     f"  types_state.py record '{key(a['skill'], a['type'])}' {args.qid} ...")
        typ = 'unmatched' if a else 'unassigned'
    d = args.date or date.today().isoformat()
    st = load_untyped()
    if any(e['qid'] == args.qid and e['date'] == d for e in st['encounters']):
        sys.exit(f'{args.qid} is already recorded for {d} -- not recording it twice')
    st['encounters'].append({
        'qid': args.qid, 'date': d, 'section': section,
        'domain': q.get('domain'), 'skill': q.get('skill'), 'difficulty': q.get('difficulty'),
        'type': typ,
        'seconds': args.seconds, 'outcome': args.outcome, 'answered': args.answered,
        'sheet': args.sheet or '', 'trap': args.trap or '', 'note': args.note or '',
    })
    st['updated'] = date.today().isoformat()
    os.makedirs(os.path.dirname(UNTYPED), exist_ok=True)
    json.dump(st, open(UNTYPED, 'w'), indent=1, ensure_ascii=False)
    print(f"{args.qid}: {section} · {q.get('skill')} · {q.get('difficulty')} · {typ} -> "
          f"{args.outcome}/{args.answered}  (untyped n={len(st['encounters'])})")


def cmd_untyped(args):
    enc = load_untyped()['encounters']
    if args.section:
        want = 'R&W' if args.section.lower() in ('rw', 'r&w') else 'Maths'
        enc = [e for e in enc if e['section'] == want]
    if args.skill:
        enc = [e for e in enc if skill_key(args.skill) in skill_key(e['skill'])]
    if args.trap:
        enc = [e for e in enc if args.trap.lower() in (e.get('trap') or '').lower()]
    by = defaultdict(list)
    for e in enc:
        by[(e['section'], e['skill'])].append(e)
    print(f'{len(enc)} untyped encounter(s)')
    for (sec, sk), es in sorted(by.items()):
        right = sum(e['answered'] == 'right' for e in es)
        print(f'\n{sec:5s} {sk}: {right}/{len(es)} right')
        for e in sorted(es, key=lambda e: e['date']):
            t = f"{e['seconds']}s" if e.get('seconds') is not None else '--'
            print(f"  {e['date']}  {e['qid']}  {e['difficulty'] or '':6s} {t:>5s}  "
                  f"{e['outcome']:12s} {e['answered']:5s}  {e.get('sheet') or ''}")
            for k in ('trap', 'note'):
                if e.get(k):
                    print(f'            {k}: {e[k]}')
    traps = Counter(e['trap'] for e in enc if e.get('trap'))
    repeated = [(t, n) for t, n in traps.most_common() if n > 1]
    if repeated:
        print('\ntraps named more than once:')
        for tname, n in repeated:
            print(f'  {n}x  {tname}')


ap = argparse.ArgumentParser()
sub = ap.add_subparsers(dest='cmd', required=True)
sub.add_parser('init').set_defaults(fn=cmd_init)
p = sub.add_parser('show'); p.add_argument('--skill'); p.add_argument('--status'); p.set_defaults(fn=cmd_show)
p = sub.add_parser('next'); p.add_argument('--n', type=int, default=8); p.set_defaults(fn=cmd_next)
sub.add_parser('plan').set_defaults(fn=cmd_plan)
sub.add_parser('mechanical').set_defaults(fn=cmd_mechanical)
p = sub.add_parser('record')
p.add_argument('type_key'); p.add_argument('qid'); p.add_argument('seconds', type=_opt_seconds)
p.add_argument('outcome', choices=sorted(OUTCOMES)); p.add_argument('--date')
p.add_argument('--answered', choices=['right', 'wrong', 'blank'], default='wrong')
p.add_argument('--note', default='')
p.set_defaults(fn=cmd_record)
p = sub.add_parser('record-untyped')
p.add_argument('qid'); p.add_argument('seconds', type=_opt_seconds)
p.add_argument('outcome', choices=sorted(OUTCOMES)); p.add_argument('--date')
p.add_argument('--answered', choices=['right', 'wrong', 'blank'], default='wrong')
p.add_argument('--sheet', default=''); p.add_argument('--trap', default='')
p.add_argument('--note', default='')
p.set_defaults(fn=cmd_record_untyped)
p = sub.add_parser('untyped')
p.add_argument('--skill'); p.add_argument('--section'); p.add_argument('--trap')
p.set_defaults(fn=cmd_untyped)
p = sub.add_parser('set-status')
p.add_argument('type_key'); p.add_argument('status'); p.add_argument('--note')
p.add_argument('--remediated-by'); p.add_argument('--date')
p.set_defaults(fn=cmd_set_status)
if __name__ == '__main__':
    a = ap.parse_args()
    a.fn(a)
