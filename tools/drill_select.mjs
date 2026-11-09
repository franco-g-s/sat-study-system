// Which questions go on the next spaced-retrieval drill.
//
// Pure: state in, picks out. No file reads, no clock -- `today` is injected so
// that "a cold re-sweep has fallen due" is testable, which is the one case the
// whole artifact exists for.
const key = (skill, type) => `${skill} :: ${type}`;

// A type's tier, and how many questions that tier is worth.
//
// Two questions where a VERDICT is being set, one where the point is only to
// keep a method warm. With one question a slip and a lost method look
// identical, and on a due re-sweep or a stuck type that difference is the
// entire output -- the reasoning when RS01 (a re-sweep sheet) was sized up
// from seven questions to fourteen.
const tierOf = (row, today) => {
  if (row.status === 'remediated' && row.resweep_due && row.resweep_due <= today) {
    return { tier: 1, quota: 2 };
  }
  if (row.status === 'stuck') return { tier: 2, quota: 2 };
  if (row.status === 'shaky') return { tier: 3, quota: 1 };
  if (row.status === 'slow') return { tier: 4, quota: 1 };
  return null;
};

const DAY = 86400000;

// Five apart: RS01's rule, and the gap it actually shipped with.
const MIN_TYPE_GAP = 5;

// Days since this type was last met. A type never met is maximally stale rather
// than zero-stale: the alternative sorts an untouched type to the BOTTOM, which
// is the opposite of what staleness is for.
const daysStale = (row, today) => {
  const dates = (row.encounters ?? []).map((e) => e.date).filter(Boolean).sort();
  if (!dates.length) return Infinity;
  return Math.round((Date.parse(today) - Date.parse(dates.at(-1))) / DAY);
};

// Re-use, when a type is exhausted: only questions answered WRONG or left
// blank, oldest attempt first. Never one answered right -- re-serving that
// measures recall of an answer, not survival of a method, and RS01 showed
// the re-used questions that had been FAILED were the sharpest reading on
// the sheet. Having seen a question before is fine, especially one first
// answered wrong with no method.
//
// "Got right" means the LATEST answer to that question, not any answer
// ever. Originally any past wrong made a question re-usable, so one
// failed on SW07 and then answered right on RS03 (34847f8a) was eligible --
// re-serving an answer the learner has most recently produced, the exact thing this
// rule forbids. The converse also holds: 20291f47 was right on RS03 and
// then blank on DR06, so the method did not survive and re-using it is the
// point. Found when the live-board smoke test stopped failing early on
// sheet size and reached its re-use assertion: the live board was re-using
// 62ec6574 and 053e5e9f, both last answered right.
//
// "Oldest first" is now by the LAST attempt at each question, so one
// failed three days ago waits behind one last seen three weeks ago --
// before, a question first failed long ago led the queue however recently
// it had been re-served.
//
// EXPORTED so the live-board smoke test asks the same question the selector
// does. The test once rebuilt "failed" from ANY past wrong/blank,
// which disagreed with this rule on 1be8b6b2 (wrong, wrong, then right) and
// kept the suite red for a week.
//
// And never within MIN_REUSE_GAP days of the last encounter with that
// question (DR08 once re-served two of DR07's blanks three hours after
// their worked solutions had been read). `today` is optional only so the bare
// latest-answer rule stays callable; selectDrill always passes it. An
// encounter dated AFTER `today` counts as too recent, not as stale.
//
// Returns { eligible, cooling }: cooling are failures held back by the gap, so
// a short type can say "cooling down" rather than "pool exhausted".
//
// Blind spot: the gap reads encounters in types.json, so a sheet that has been
// SERVED but not yet RECORDED is invisible to it. Record before building.
export const MIN_REUSE_GAP = 7;
export const reusableFailures = (row, all, today = null) => {
  const latest = new Map();
  for (const e of [...(row.encounters ?? [])]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => String(a.e.date).localeCompare(String(b.e.date)) || a.i - b.i)
    .map(({ e }) => e)) {
    latest.set(e.qid, e);
  }
  const failed = [...latest.values()]
    .filter((e) => e.answered === 'wrong' || e.answered === 'blank')
    .filter((e) => all.includes(e.qid))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const cooled = (e) => {
    if (today == null) return true;
    const days = Math.round((Date.parse(today) - Date.parse(e.date)) / DAY);
    return Number.isFinite(days) && days >= MIN_REUSE_GAP;
  };
  return {
    eligible: failed.filter(cooled).map((e) => e.qid),
    cooling: failed.filter((e) => !cooled(e)).map((e) => e.qid),
  };
};

export const selectDrill = ({ types, assignments, spoken = new Set(), today, n = 16 }) => {
  const byType = new Map();
  for (const [qid, a] of Object.entries(assignments)) {
    const k = key(a.skill, a.type);
    if (!byType.has(k)) byType.set(k, []);
    byType.get(k).push(qid);
  }

  // Tier first, then the type key, so a rebuild with the same inputs always
  // produces the same sheet -- which is what the push safety check relies on.
  const candidates = Object.entries(types)
    .map(([k, row]) => ({ k, row, stale: daysStale(row, today), ...(tierOf(row, today) ?? {}) }))
    .filter((c) => c.tier)
    .sort((a, b) => a.tier - b.tier || b.stale - a.stale || a.k.localeCompare(b.k));

  const groups = [];
  const picks = [];
  const shortfalls = [];
  for (const c of candidates) {
    const all = byType.get(c.k) ?? [];
    const unseen = all.filter((q) => !spoken.has(q)).sort();

    // Re-use, when a type is exhausted -- see reusableFailures() above.
    const { eligible: failed, cooling } = reusableFailures(c.row, all, today);

    const ordered = [
      ...unseen.map((qid) => ({ qid, reuse: false })),
      ...failed.map((qid) => ({ qid, reuse: true })),
    ];
    const seenHere = new Set();
    const mine = [];
    let sheetFull = false;
    for (const o of ordered) {
      if (picks.length + mine.length >= n) { sheetFull = true; break; }
      if (seenHere.size >= c.quota) break;
      if (seenHere.has(o.qid)) continue;
      seenHere.add(o.qid);
      mine.push({
        qid: o.qid, typeKey: c.k, skill: c.row.skill, tier: c.tier,
        daysStale: c.stale, reuse: o.reuse,
      });
    }
    // Why a type came up short decides whether anything is wrong. "The sheet
    // was already full" is the budget working; "the bank has nothing left" is
    // a real limit on what can be drilled at all. The first version reported
    // both as `pool exhausted`, which named thirteen healthy types as
    // starved -- including Vieta, which has two unseen questions.
    if (seenHere.size < c.quota) {
      const exhausted = !sheetFull && picks.length + mine.length < n;
      // Out of room, then out of questions only for now (failures waiting out
      // MIN_REUSE_GAP), then genuinely out.
      const reason = !exhausted ? 'sheet full'
        : cooling.some((q) => !seenHere.has(q)) ? 'cooling down' : 'pool exhausted';
      shortfalls.push({
        typeKey: c.k,
        wanted: c.quota,
        got: seenHere.size,
        reason,
      });
    }
    if (mine.length) groups.push(mine);
    picks.push(...mine);
  }

  // Ordering has to satisfy two constraints at once, so one greedy pass honours
  // both rather than two passes undoing each other:
  //
  //   1. a type's second question sits >= 5 after its first (RS01's
  //      twin-template guard -- question 2 must not be warmed up by question 1,
  //      the effect that inflated SW10's direct-trig median);
  //   2. no two neighbours share a CB skill, which cues in the same way even
  //      when the types differ.
  //
  // Priority is round first, then tier/staleness order, so round one is served
  // before any type's round two and the due re-sweeps still lead.
  const queue = groups
    .flatMap((g, gi) => g.map((item, round) => ({ item, gi, round })))
    .sort((a, b) => a.round - b.round || a.gi - b.gi);

  // A constraint that cannot be met is RELAXED AND REPORTED, never met
  // silently. On a thin board -- few types, one skill -- it is arithmetically
  // impossible, and a sheet that quietly broke its own rule would make the
  // seconds on it look comparable when they are not.
  const relaxed = [];
  const seq = [];
  while (queue.length) {
    const lastSkill = seq.length ? seq.at(-1).skill : null;
    // slice(-0) returns the WHOLE array, not none of it, so a lookback of zero
    // would silently mean "never repeat a type at all" -- the opposite of what
    // MIN_TYPE_GAP = 1 asks for. Not live at 5, but it made a mutation test
    // unfalsifiable, which is how it was found.
    const lookback = MIN_TYPE_GAP - 1;
    const recent = new Set(lookback > 0 ? seq.slice(-lookback).map((p) => p.typeKey) : []);
    const ok = (r) => r.item.skill !== lastSkill && !recent.has(r.item.typeKey);

    let i = queue.findIndex(ok);
    if (i === -1) {
      i = queue.findIndex((r) => !recent.has(r.item.typeKey));
      if (i !== -1) relaxed.push({ at: seq.length, constraint: 'skill adjacency' });
    }
    if (i === -1) {
      i = queue.findIndex((r) => r.item.skill !== lastSkill);
      if (i !== -1) relaxed.push({ at: seq.length, constraint: 'type gap' });
    }
    if (i === -1) {
      i = 0;
      relaxed.push({ at: seq.length, constraint: 'skill adjacency and type gap' });
    }
    seq.push(queue.splice(i, 1)[0].item);
  }

  return { picks: seq, shortfalls, relaxed };
};
