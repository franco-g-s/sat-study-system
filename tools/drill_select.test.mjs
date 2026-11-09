// Tests for the drill selector.
//
// The selector is pure on purpose: state in, a list of picks out, no file
// reads and no clock. `today` is injected because state/types.json is the
// system of record and a selector that consulted the real date could not be
// tested for the one case that matters most -- a cold re-sweep falling due.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDrill, reusableFailures } from './drill_select.mjs';

// Every guard here has been mutation-tested: the source was deliberately broken
// and the test confirmed to go red. Three lessons from doing it, because the
// suite looked complete before and was not:
//
//   1. Watching a test fail when you write it is necessary and NOT sufficient.
//      The five-apart test went red against the round-robin implementation, and
//      then the constraint was rewritten underneath it -- after which it passed
//      for the wrong reason and would have kept passing with the gap set to 1.
//   2. CHECK WHICH DIRECTION YOUR MUTANT MOVES THE BEHAVIOUR (raised in an
//      earlier review). A mutant that makes the code STRICTER looks identical from
//      outside to one that makes it correct. `MIN_TYPE_GAP = 1` made the lookback
//      zero, and slice(-0) returns the whole array, so the "loosened" constraint
//      was actually tighter and nothing reddened.
//   3. A determinism test cannot be broken by a deterministic mutant. Deleting
//      all three explicit sorts left the whole suite green, because stable sort
//      plus insertion order gives the same answer anyway. What makes them
//      load-bearing is that `types_state.py init` REBUILDS state/types.json, so
//      key order is not stable -- which is what the key-order test simulates.

// ---- fixtures --------------------------------------------------------------
// Deliberately small. The real board has 103 types; a fixture that mirrored it
// would test the fixture. There is a separate smoke test over the real file.
const typeRow = (over = {}) => ({
  skill: 'Skill A', type: 'type a', status: 'shaky', encounters: [], pool: 10, ...over,
});

const stateOf = (rows) => ({ types: rows });

// Every qid in a fixture needs an assignment or it cannot be drawn.
const assignFor = (rows, perType = 6) => {
  const out = {};
  for (const [key, r] of Object.entries(rows)) {
    for (let i = 0; i < perType; i++) {
      out[`${key.replace(/[^a-z0-9]/gi, '')}-q${i}`] = { skill: r.skill, type: r.type };
    }
  }
  return out;
};

test('a cold re-sweep that has fallen due gets two questions', () => {
  const rows = {
    'Skill A :: type a': typeRow({
      status: 'remediated',
      remediated_by: 'R01',
      resweep_due: '2026-09-10',
    }),
  };
  const { picks } = selectDrill({
    types: rows,
    assignments: assignFor(rows),
    spoken: new Set(),
    today: '2026-09-12',
    n: 16,
  });

  assert.equal(picks.length, 2, 'a due re-sweep is worth two questions, not one');
  assert.equal(picks[0].typeKey, 'Skill A :: type a');
  assert.equal(picks[0].tier, 1);
});

test('a stuck type gets two questions', () => {
  const rows = { 'Skill A :: type a': typeRow({ status: 'stuck' }) };
  const { picks } = selectDrill({
    types: rows, assignments: assignFor(rows), spoken: new Set(),
    today: '2026-09-12', n: 16,
  });
  assert.equal(picks.length, 2);
  assert.equal(picks[0].tier, 2);
});

test('a shaky type gets one question, not two', () => {
  const rows = { 'Skill A :: type a': typeRow({ status: 'shaky' }) };
  const { picks } = selectDrill({
    types: rows, assignments: assignFor(rows), spoken: new Set(),
    today: '2026-09-12', n: 16,
  });
  assert.equal(picks.length, 1, 'no verdict is being set, so one rep is the point');
  assert.equal(picks[0].tier, 3);
});

test('a slow type gets one question', () => {
  const rows = { 'Skill A :: type a': typeRow({ status: 'slow' }) };
  const { picks } = selectDrill({
    types: rows, assignments: assignFor(rows), spoken: new Set(),
    today: '2026-09-12', n: 16,
  });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].tier, 4);
});

test('types the learner is already fast or good on are not drawn', () => {
  const rows = {
    'Skill A :: type a': typeRow({ status: 'good' }),
    'Skill B :: type b': typeRow({ skill: 'Skill B', type: 'type b', status: 'fast' }),
    'Skill C :: type c': typeRow({ skill: 'Skill C', type: 'type c', status: 'unswept' }),
    // A remediation whose re-sweep is not due yet is also left alone: re-testing
    // inside the fortnight measures short-term memory, which is not the question.
    'Skill D :: type d': typeRow({
      skill: 'Skill D', type: 'type d', status: 'remediated', resweep_due: '2026-09-24',
    }),
  };
  const { picks } = selectDrill({
    types: rows, assignments: assignFor(rows), spoken: new Set(),
    today: '2026-09-12', n: 16,
  });
  assert.deepEqual(picks, []);
});

test('tiers are served in order regardless of how state lists them', () => {
  // Insertion order puts the shaky type first. Tier order must override it:
  // a due re-sweep is the only thing that falsifies a remediation, so it
  // outranks everything -- the same precedence `types_state.py next` prints.
  const rows = {
    'Skill A :: shaky one': typeRow({ type: 'shaky one', status: 'shaky' }),
    'Skill B :: due one': typeRow({
      skill: 'Skill B', type: 'due one', status: 'remediated', resweep_due: '2026-09-10',
    }),
  };
  const { picks } = selectDrill({
    types: rows, assignments: assignFor(rows), spoken: new Set(),
    today: '2026-09-12', n: 16,
  });
  // Tier order governs the FIRST round. It cannot govern the whole sheet,
  // because a tier-1 type contributes two questions and the second is held
  // back to round two by the spacing rule below.
  const firstRound = picks.slice(0, 2);
  assert.deepEqual(firstRound.map((p) => p.tier), [1, 3], 'the due re-sweep must lead');
});

test('within a tier the stalest type comes first', () => {
  // Staleness is what makes this spaced repetition rather than a worst-first
  // list. Both types are shaky; the one not touched since August is the
  // one at risk of having decayed.
  const rows = {
    'Skill A :: seen yesterday': typeRow({
      type: 'seen yesterday', status: 'shaky',
      encounters: [{ qid: 'x', date: '2026-09-11', seconds: 40, outcome: 'had-it', answered: 'right' }],
    }),
    'Skill B :: seen in august': typeRow({
      skill: 'Skill B', type: 'seen in august', status: 'shaky',
      encounters: [{ qid: 'y', date: '2026-08-14', seconds: 40, outcome: 'had-it', answered: 'right' }],
    }),
  };
  const { picks } = selectDrill({
    types: rows, assignments: assignFor(rows), spoken: new Set(),
    today: '2026-09-12', n: 16,
  });
  assert.equal(picks[0].typeKey, 'Skill B :: seen in august');
  assert.equal(picks[0].daysStale, 29);
});

test('a type with no unseen questions falls back to one answered wrong', () => {
  // Vieta has two unseen questions left and absolute value none, so without a
  // fallback the two types most in need of drilling are the two that starve.
  const rows = {
    'Skill A :: type a': typeRow({
      status: 'shaky',
      encounters: [
        { qid: 'gotright', date: '2026-08-30', seconds: 30, outcome: 'had-it', answered: 'right' },
        { qid: 'gotwrong', date: '2026-08-28', seconds: 90, outcome: 'no-method', answered: 'wrong' },
      ],
    }),
  };
  const assignments = {
    gotright: { skill: 'Skill A', type: 'type a' },
    gotwrong: { skill: 'Skill A', type: 'type a' },
  };
  const { picks } = selectDrill({
    types: rows, assignments,
    spoken: new Set(['gotright', 'gotwrong']),     // both already on other sheets
    today: '2026-09-12', n: 16,
  });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].qid, 'gotwrong');
  assert.equal(picks[0].reuse, true, 'the page footer has to say it is a re-use');
});

test('a question answered right is never re-used', () => {
  // Invariant guard. Re-serving a question already answered right measures
  // whether the learner remembers an answer, not whether a method survived.
  const rows = {
    'Skill A :: type a': typeRow({
      status: 'stuck',
      encounters: [
        { qid: 'gotright', date: '2026-08-30', seconds: 30, outcome: 'had-it', answered: 'right' },
      ],
    }),
  };
  const { picks } = selectDrill({
    types: rows,
    assignments: { gotright: { skill: 'Skill A', type: 'type a' } },
    spoken: new Set(['gotright']),
    today: '2026-09-12', n: 16,
  });
  assert.deepEqual(picks, []);
});

test('re-use follows the LATEST answer to a question, not any past one', () => {
  // wrong then right: the learner has most recently produced the answer -- not re-used.
  // right then blank: the method did not survive -- re-used, which is the point.
  const rows = {
    'Skill A :: type a': typeRow({
      status: 'stuck',
      encounters: [
        { qid: 'fixed', date: '2026-09-04', seconds: 90, outcome: 'no-method', answered: 'wrong' },
        { qid: 'lost', date: '2026-09-04', seconds: 40, outcome: 'had-it', answered: 'right' },
        { qid: 'fixed', date: '2026-09-20', seconds: 60, outcome: 'had-it', answered: 'right' },
        { qid: 'lost', date: '2026-09-20', seconds: 200, outcome: 'bailed', answered: 'blank' },
      ],
    }),
  };
  const { picks } = selectDrill({
    types: rows,
    assignments: { fixed: { skill: 'Skill A', type: 'type a' }, lost: { skill: 'Skill A', type: 'type a' } },
    spoken: new Set(['fixed', 'lost']),
    today: '2026-09-28', n: 16,
  });
  assert.deepEqual(picks.map((p) => [p.qid, p.reuse]), [['lost', true]]);
});

test('a failed question is not re-used within a week of the last encounter with it', () => {
  // DR07 was done the morning of 2026-10-01 and DR08, dry-run hours later,
  // re-served both of its blank questions -- whose full worked solutions sit
  // on the page right after each question. A re-serve that soon measures recall
  // of the answer just read, not the method, and it reads as "recovered".
  const rows = {
    'Skill A :: type a': typeRow({
      status: 'stuck',                         // quota 2
      encounters: [
        { qid: 'today', date: '2026-10-01', seconds: 200, outcome: 'no-method', answered: 'blank' },
        { qid: 'sixdays', date: '2026-09-25', seconds: 200, outcome: 'no-method', answered: 'wrong' },
        { qid: 'week', date: '2026-09-24', seconds: 200, outcome: 'no-method', answered: 'wrong' },
        // Dated after `today` (a board read with an older date, as the smoke
        // test does): not "very stale" -- not yet a week since, either.
        { qid: 'future', date: '2026-10-05', seconds: 200, outcome: 'no-method', answered: 'wrong' },
      ],
    }),
  };
  const A = { skill: 'Skill A', type: 'type a' };
  const { picks, shortfalls } = selectDrill({
    types: rows,
    assignments: { today: A, sixdays: A, week: A, future: A },
    spoken: new Set(['today', 'sixdays', 'week', 'future']),
    today: '2026-10-01', n: 16,
  });
  assert.deepEqual(picks.map((p) => [p.qid, p.reuse]), [['week', true]],
    'exactly seven days is enough; six is not, nor is the same day');
  // A short type whose only remaining questions are cooling is NOT out of
  // questions -- calling it "pool exhausted" would send someone to the bank.
  assert.deepEqual(shortfalls, [
    { typeKey: 'Skill A :: type a', wanted: 2, got: 1, reason: 'cooling down' },
  ]);
});

test('a type that cannot fill its quota is reported, not silently shrunk', () => {
  // A silent cap reads as "covered everything". The whole board is built on
  // knowing what was left out.
  const rows = {
    'Skill A :: type a': typeRow({ status: 'stuck' }),     // quota 2
  };
  const { picks, shortfalls } = selectDrill({
    types: rows,
    assignments: { onlyone: { skill: 'Skill A', type: 'type a' } },
    spoken: new Set(),
    today: '2026-09-12', n: 16,
  });
  assert.equal(picks.length, 1);
  assert.equal(shortfalls.length, 1);
  assert.deepEqual(shortfalls[0], {
    typeKey: 'Skill A :: type a', wanted: 2, got: 1, reason: 'pool exhausted',
  });
});

test('n is a ceiling on the whole sheet', () => {
  const rows = {};
  for (const c of 'abcdef') rows[`Skill ${c} :: type ${c}`] = typeRow({ skill: `Skill ${c}`, type: `type ${c}`, status: 'shaky' });
  const { picks } = selectDrill({
    types: rows, assignments: assignFor(rows), spoken: new Set(),
    today: '2026-09-12', n: 3,
  });
  assert.equal(picks.length, 3);
});

test('two questions of the same type sit at least five apart', () => {
  // RS01's twin-template guard. If question 2 follows question 1 of the same
  // type, the first warms the learner up for the second and the second time is not a
  // cold measurement -- the effect that inflated SW10's direct-trig median.
  const rows = {
    'Skill Z :: due one': typeRow({
      skill: 'Skill Z', type: 'due one', status: 'remediated', resweep_due: '2026-09-10',
    }),
  };
  for (const c of 'abcdef') {
    rows[`Skill ${c} :: type ${c}`] = typeRow({ skill: `Skill ${c}`, type: `type ${c}`, status: 'shaky' });
  }
  const { picks } = selectDrill({
    types: rows, assignments: assignFor(rows), spoken: new Set(),
    today: '2026-09-12', n: 16,
  });

  const idx = picks.map((p, i) => [p.typeKey, i]).filter(([k]) => k === 'Skill Z :: due one').map(([, i]) => i);
  assert.equal(idx.length, 2, 'the due type should have contributed two questions');
  assert.ok(idx[1] - idx[0] >= 5, `same-type gap was ${idx[1] - idx[0]}, want >= 5`);
});

test('no two neighbouring questions come from the same CB skill', () => {
  // Two questions from one skill back to back cue each other even when the
  // types differ -- the same warm-up effect the five-apart rule exists for.
  const rows = {
    'Skill A :: one': typeRow({ skill: 'Skill A', type: 'one', status: 'shaky' }),
    'Skill A :: two': typeRow({ skill: 'Skill A', type: 'two', status: 'shaky' }),
    'Skill A :: three': typeRow({ skill: 'Skill A', type: 'three', status: 'shaky' }),
    'Skill B :: one': typeRow({ skill: 'Skill B', type: 'one', status: 'shaky' }),
    'Skill C :: one': typeRow({ skill: 'Skill C', type: 'one', status: 'shaky' }),
    'Skill D :: one': typeRow({ skill: 'Skill D', type: 'one', status: 'shaky' }),
  };
  const { picks } = selectDrill({
    types: rows, assignments: assignFor(rows), spoken: new Set(),
    today: '2026-09-12', n: 16,
  });
  const clashes = picks.filter((p, i) => i > 0 && picks[i - 1].skill === p.skill);
  assert.deepEqual(clashes.map((p) => p.typeKey), [], 'adjacent same-skill questions');
});

test('the same inputs always produce the same sheet', () => {
  // Invariant guard, load-bearing for push_note.mjs: it compares checksums to
  // tell an untouched notebook from a written-on one, so a rebuild that picked
  // different questions would defeat the safety check.
  const rows = {};
  for (const c of 'abcdefgh') {
    rows[`Skill ${c} :: type ${c}`] = typeRow({ skill: `Skill ${c}`, type: `type ${c}`, status: 'shaky' });
  }
  const args = { types: rows, assignments: assignFor(rows), spoken: new Set(), today: '2026-09-12', n: 16 };
  assert.deepEqual(selectDrill(args).picks, selectDrill(args).picks);
});

// ---- against the real board -------------------------------------------------
// The fixtures above are small enough to reason about; this is the one that
// would catch a shape assumption that only the real file violates.
//
// Re-baselined 2026-09-28. It used to assert a FULL sheet with NOTHING relaxed.
// That was a claim about the board, not the selector, and the board is consumed
// by every sheet the learner sits: on 2026-09-22 adjacency had to be relaxed at position
// 15, and by 2026-09-25 the weak surface filled only 14 of 16, with five weak
// types' quotas exhausted (their unseen questions spent and no failed ones left
// to re-use). Checked which cause it was: no classification moved -- the picks
// are 14 distinct weak types across 11 skills -- the board simply got thinner.
// A test that goes red because the learner studied trains everyone to read red as normal.
//
// So this asserts what must hold on ANY board, however thin: a short sheet is
// short only because the bank ran out (and says so), an exhausted type really
// has nothing left, and every broken ordering rule is one the selector reported.
test('smoke: the real board — a short sheet is explained, and nothing is broken silently', async (t) => {
  const { readFileSync } = await import('node:fs');
  const root = new URL('..', import.meta.url).pathname;
  const state = JSON.parse(readFileSync(`${root}state/types.json`, 'utf8'));
  const assignments = JSON.parse(readFileSync(`${root}data/type_assignments.json`, 'utf8')).assignments;
  const used = JSON.parse(readFileSync(`${root}state/used_questions.json`, 'utf8'));
  const spoken = new Set(Object.values(used).flat());
  const n = 16;

  const { picks, shortfalls, relaxed } = selectDrill({
    types: state.types, assignments, spoken, today: '2026-09-12', n,
  });
  const exhausted = shortfalls.filter((s) => s.reason === 'pool exhausted');
  const cooling = shortfalls.filter((s) => s.reason === 'cooling down');
  t.diagnostic(`real board: ${picks.length}/${n} filled, ${exhausted.length} type(s) exhausted, ${cooling.length} cooling down, ${relaxed.length} constraint(s) relaxed`);

  assert.ok(picks.length > 0, 'the real board yields a sheet at all');
  assert.ok(picks.length <= n);
  if (picks.length < n) {
    // Short only because the bank ran out: nothing was cut for want of room.
    assert.deepEqual(shortfalls.filter((s) => s.reason === 'sheet full'), [],
      'a short sheet must not also have left weak types below the cut');
    assert.ok(exhausted.length + cooling.length > 0, 'a short sheet must say which types ran out');
  }

  // An exhausted type really has nothing left: every unseen or failed question
  // it owns is already on this sheet.
  const picked = new Set(picks.map((p) => p.qid));
  for (const s of [...exhausted, ...cooling]) {
    const row = state.types[s.typeKey];
    const own = Object.entries(assignments)
      .filter(([, a]) => `${a.skill} :: ${a.type}` === s.typeKey).map(([q]) => q);
    // The selector's own re-use rule, not a re-derivation: "failed" means the
    // LATEST answer was wrong or blank. Building it from any past failure
    // disagreed with selectDrill on 1be8b6b2 (wrong, wrong, right) and kept
    // this test red from 2026-10-26 to 2026-11-02.
    const failed = new Set(reusableFailures(row, own, '2026-09-12').eligible);
    const left = own.filter((q) => (!spoken.has(q) || failed.has(q)) && !picked.has(q));
    assert.deepEqual(left, [], `${s.typeKey} reported exhausted but still has ${left.join(' ')}`);
  }

  // Every invariant, restated against real data.
  // A re-used question's LATEST answer must be a failure.
  const lastAnswer = new Map();
  for (const r of Object.values(state.types)) {
    [...(r.encounters ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .forEach((e) => lastAnswer.set(`${r.skill} :: ${r.type}|${e.qid}`, e.answered));
  }
  for (const p of picks) {
    assert.ok(!(p.reuse && lastAnswer.get(`${p.typeKey}|${p.qid}`) === 'right'),
      `${p.qid} was last answered right and must not be re-used`);
    assert.ok(assignments[p.qid], `${p.qid} must be an assigned bank question`);
  }
  // Ordering rules may bend only where the selector said so.
  const reported = (i, what) => relaxed.some((r) => r.at === i && r.constraint.includes(what));
  for (let i = 1; i < picks.length; i++) {
    if (picks[i].skill === picks[i - 1].skill) {
      assert.ok(reported(i, 'skill adjacency'), `same skill at ${i} and not reported as relaxed`);
    }
  }
  const seen = new Map();
  picks.forEach((p, i) => {
    if (seen.has(p.typeKey) && i - seen.get(p.typeKey) < 5) {
      assert.ok(reported(i, 'type gap'), `${p.typeKey} repeated too close at ${i} and not reported`);
    }
    seen.set(p.typeKey, i);
  });
});

test('a type the sheet never reached is not reported as pool exhausted', () => {
  // Found by running it: with n=16 the real board reported thirteen types as
  // "pool exhausted" when they simply sat below the cut -- Vieta among them,
  // which has two unseen questions. A wrong reason with a plausible label is
  // the worst shape this can take, because it reads as a bank problem.
  const rows = {
    'Skill A :: first': typeRow({ skill: 'Skill A', type: 'first', status: 'stuck' }),
    'Skill B :: never reached': typeRow({ skill: 'Skill B', type: 'never reached', status: 'stuck' }),
  };
  const { picks, shortfalls } = selectDrill({
    types: rows, assignments: assignFor(rows), spoken: new Set(),
    today: '2026-09-12', n: 1,
  });

  assert.equal(picks.length, 1);
  assert.deepEqual(
    shortfalls.filter((s) => s.reason === 'pool exhausted').map((s) => s.typeKey),
    [],
    'neither type ran out of questions; the sheet ran out of room',
  );
  assert.deepEqual(shortfalls.map((s) => s.reason), ['sheet full', 'sheet full']);
});

test('a board too thin to space a type five apart says so', () => {
  // The five-apart test above passes even with MIN_TYPE_GAP set to 1, because
  // round-ordering alone spaces a type's two questions when the sheet is wide.
  // It was pinning the ordering, not the constraint. This pins the constraint:
  // three types cannot put two questions five apart, so the greedy pass has to
  // RELAX and report it -- and a sheet that broke its own rule silently would
  // make the seconds either side look comparable when they are not.
  const rows = {
    'Skill A :: stuck one': typeRow({ skill: 'Skill A', type: 'stuck one', status: 'stuck' }),
    'Skill B :: one': typeRow({ skill: 'Skill B', type: 'one', status: 'shaky' }),
    'Skill C :: one': typeRow({ skill: 'Skill C', type: 'one', status: 'shaky' }),
  };
  const { picks, relaxed } = selectDrill({
    types: rows, assignments: assignFor(rows), spoken: new Set(),
    today: '2026-09-12', n: 16,
  });

  assert.equal(picks.length, 4, 'stuck gives 2, the two shaky give 1 each');
  assert.deepEqual(relaxed, [{ at: 3, constraint: 'type gap' }]);
});

test('input key order does not change the sheet', () => {
  // The determinism test above cannot detect a lost tiebreak: V8's sort is
  // stable and object iteration is insertion-ordered, so the same input always
  // gives the same answer even with every explicit sort deleted. Three
  // sort-dropping mutants survived the whole suite.
  //
  // They are still load-bearing, and this is the scenario that proves it:
  // `types_state.py init` REBUILDS state/types.json from the taxonomy and the
  // assignments, so key order is not stable across the file's lifetime. Without
  // the tiebreaks, a reordered input silently reselects the sheet -- and
  // push_note.mjs tells an untouched notebook from a written-on one by
  // checksum.
  const rows = {};
  for (const c of 'abcdefgh') {
    rows[`Skill ${c} :: type ${c}`] = typeRow({ skill: `Skill ${c}`, type: `type ${c}`, status: 'shaky' });
  }
  const assignments = assignFor(rows);
  const reverse = (o) => Object.fromEntries(Object.entries(o).reverse());

  const forward = selectDrill({
    types: rows, assignments, spoken: new Set(), today: '2026-09-12', n: 16,
  });
  const backward = selectDrill({
    types: reverse(rows), assignments: reverse(assignments), spoken: new Set(), today: '2026-09-12', n: 16,
  });

  assert.deepEqual(
    backward.picks.map((p) => p.qid),
    forward.picks.map((p) => p.qid),
    'reordering the state file reselected the sheet',
  );
});

test('when several past failures are eligible, the oldest is re-used first', () => {
  // The rule is documented in drill_select.mjs and in the system notes,
  // and nothing tested it: every other re-use test has exactly one eligible
  // question, so dropping the date sort changed no outcome. It matters because
  // the point of a re-use is maximum time since that question was last seen.
  const rows = {
    'Skill A :: type a': typeRow({
      status: 'shaky',                        // quota 1, so the order decides
      encounters: [
        { qid: 'recentfail', date: '2026-09-05', seconds: 80, outcome: 'no-method', answered: 'blank' },
        { qid: 'oldfail', date: '2026-08-14', seconds: 90, outcome: 'wrong-method', answered: 'wrong' },
      ],
    }),
  };
  const { picks } = selectDrill({
    types: rows,
    assignments: {
      recentfail: { skill: 'Skill A', type: 'type a' },
      oldfail: { skill: 'Skill A', type: 'type a' },
    },
    spoken: new Set(['recentfail', 'oldfail']),
    today: '2026-09-12', n: 16,
  });

  assert.equal(picks.length, 1);
  assert.equal(picks[0].qid, 'oldfail', 'the August failure is the colder measurement');
});

test('golden master: the exact sheet, hand-derived', () => {
  // The suite could not see WHICH question a type contributed -- only the
  // shape and the order. Reversing the pick order within each type changed
  // every qid on a real sheet and left all 42 tests green (an earlier review
  // found the same hole in the MX suite).
  //
  // A golden master over the LIVE board would be brittle for the reason it
  // gave: spokenFor() legitimately shrinks the pool every time a sheet ships,
  // so the expectation would go red on correct behaviour and get deleted. That
  // argument does not apply here, because selectDrill is pure and this fixture
  // is frozen -- no real sheet can move it. This is the cheap, non-brittle test
  // that its CLI-driven suite had no equivalent of.
  //
  // The expectation below is DERIVED, not recorded. Tiers give A(2) B(2) C(1)
  // D(1); round one is a1 b1 c1 d1 by tier then staleness; a2 and b2 are held
  // to round two and then cannot sit 5 clear of their twins on a four-type
  // board, so both relax with the gap reported.
  const t = (skill, type, status, last, extra = {}) => ({
    skill, type, status, pool: 3,
    encounters: [{ qid: 'x', date: last, seconds: 60, outcome: 'had-it', answered: 'right' }],
    ...extra,
  });
  const rows = {
    'Skill A :: due': t('Skill A', 'due', 'remediated', '2026-08-20', { resweep_due: '2026-09-01' }),
    'Skill B :: stuck': t('Skill B', 'stuck', 'stuck', '2026-08-29'),
    'Skill C :: shaky': t('Skill C', 'shaky', 'shaky', '2026-09-01'),
    'Skill D :: slow': t('Skill D', 'slow', 'slow', '2026-08-13'),
  };
  const assignments = {
    a1: { skill: 'Skill A', type: 'due' }, a2: { skill: 'Skill A', type: 'due' },
    a3: { skill: 'Skill A', type: 'due' },
    b1: { skill: 'Skill B', type: 'stuck' }, b2: { skill: 'Skill B', type: 'stuck' },
    c1: { skill: 'Skill C', type: 'shaky' },
    d1: { skill: 'Skill D', type: 'slow' },
  };

  const { picks, relaxed } = selectDrill({
    types: rows, assignments, spoken: new Set(), today: '2026-09-12', n: 6,
  });

  assert.deepEqual(picks.map((p) => p.qid), ['a1', 'b1', 'c1', 'd1', 'a2', 'b2']);
  assert.deepEqual(picks.map((p) => p.tier), [1, 2, 3, 4, 1, 2]);
  assert.deepEqual(relaxed, [
    { at: 4, constraint: 'type gap' },
    { at: 5, constraint: 'type gap' },
  ]);
});
