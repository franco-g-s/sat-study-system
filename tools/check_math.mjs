// Mechanical check of every hand-written mathematical claim on a target sheet.
//
//   node tools/check_math.mjs content/targets/R05-rational-expressions.md [more.md ...]
//
// build_note.mjs runs this first and refuses to build on any failure, the way
// the overflow guard refuses a clipped page.
//
// WHY: hand-written answer keys were unverified.
// R05's answers page printed (x^2-25)/(x^2+3x-10) = (x-5)(x+5)/((x-5)(x+2)) =
// (x+5)/(x+2). The factorisation had the wrong signs, so the printed answer was
// wrong -- and a wrong answer key does not just mis-score, it teaches the wrong
// method with the authority of print. The learner caught it; nothing else would have.
// Bank answers come from the official key. Everything typed by hand came from
// nothing.
//
// THE MARKER -- an HTML comment, so it never renders:
//
//   <!-- CHECK 1: (x^2-25)/(x^2+3x-10) == (x-5)/(x-2) | x > 5 -->
//   <!-- CHECK 1: x^2+3x-10 == (x+5)(x-2) -->
//   <!-- CHECK 2: c = 7/24; 4^(8c) == nthRoot(4^7, 3) -->
//   <!-- CHECK 3: (x+4)/4 != x -->
//   <!-- CHECK 4: none -- a reading question, no algebra to check -->
//
//   `n`      the numbered answer it backs. Optional off an answers page.
//   `==`     an identity: both sides agree at random values of every free letter.
//            Chains are fine: `a == b == c`.
//   `!=`     NOT an identity: they differ somewhere. For "true or false" answers.
//   `v = k;` substitutions first, then the identity. This is how an equation's
//            SOLUTION is checked: substitute the answer back into the question.
//   `| cond` restricts the random values (`x > 5`, `x != 0 and y > 0`).
//   `none -- why`  an explicit, reasoned opt-out. The reason is required.
//
// Syntax is mathjs: `^` powers, implicit multiplication (`3x`, `(x-5)(x+2)`),
// sqrt, nthRoot(a, n), abs(x) (never |x| -- the bar introduces a condition),
// sin(30 deg), pi. A single letter before a bracket is multiplication
// (`x(x+1)`), never a function call.
//
// THE RULE that makes it a control rather than a convention: on a page headed
// "... answers" (Try it now, Warm-up, Answers), EVERY numbered answer needs at
// least one CHECK carrying its number. An answers page with no numbered items
// needs at least one CHECK. The check is only as good as the claim written in
// it, so write the claim from the QUESTION to the ANSWER -- the question's
// expression on the left, the printed answer on the right -- and one CHECK per
// printed intermediate step you would not bet a mark on. R05's bug passes a
// check that only compares the printed steps with each other, because
// (x-5)(x+5)/((x-5)(x+2)) = (x+5)/(x+2) is itself true.
import { readFileSync } from 'node:fs';
import { create, all } from 'mathjs';
const math = create(all);

const SAMPLES = 8;       // agreeing points required for an identity
const TRIES = 400;

// Deterministic, so a failure reproduces exactly.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

// `x(` is multiplication here. mathjs would call x as a function.
const prep = (e) => e.replace(/(^|[^A-Za-z_])([A-Za-z])\s*\(/g, '$1$2*(');

function freeVars(nodes) {
  const vars = new Set();
  for (const n of nodes) n.traverse((q, path, parent) => {
    if (!q.isSymbolNode) return;
    if (parent?.isFunctionNode && parent.fn === q) return;
    if (q.name in math) return;          // pi, e, i, ...
    // deg, cm, ... -- but a single letter is always a variable: m is a slope
    // far more often than a metre here, and h, t, b, s are units in mathjs too.
    if (q.name.length > 1 && math.Unit.isValuelessUnit(q.name)) return;
    vars.add(q.name);
  });
  return [...vars];
}

const num = (v) => {
  if (typeof v === 'number') return v;
  if (v?.isComplex) return Math.abs(v.im) < 1e-12 ? v.re : v;
  // A unit compares in SI base units, so `45 deg` equals atan(1) in radians.
  if (v?.isUnit) return v.value ?? v.toNumber();
  if (v?.isFraction || v?.isBigNumber) return Number(v);
  return v;
};
const close = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  try { return Number(math.abs(math.subtract(a, b))) <= 1e-9 * Math.max(1, Number(math.abs(a))); }
  catch { return null; }
};

/**
 * Evaluate one claim. Returns { ok, detail }. Pure apart from mathjs.
 */
export function checkClaim(claimText) {
  const text = claimText.trim();
  if (/^none\b/i.test(text)) {
    const why = text.replace(/^none\b\s*[-—–:]*\s*/i, '');
    return why.length >= 8
      ? { ok: true, none: true, detail: `opted out: ${why}` }
      : { ok: false, detail: 'a `none` CHECK must say why (at least a few words)' };
  }
  let body = text, cond = null;
  const bar = body.lastIndexOf('|');
  if (bar !== -1) { cond = body.slice(bar + 1).trim(); body = body.slice(0, bar).trim(); }
  const parts = body.split(';').map(s => s.trim()).filter(Boolean);
  const claim = parts.pop();
  const subs = {};
  try {
    for (const a of parts) {
      const m = a.match(/^([A-Za-z]\w*)\s*=\s*(.+)$/);
      if (!m) return { ok: false, detail: `cannot read substitution "${a}" (want: v = value)` };
      subs[m[1]] = num(math.evaluate(prep(m[2]), { ...subs }));
    }
  } catch (e) { return { ok: false, detail: `substitution: ${e.message}` }; }

  let op, sides;
  if (claim.includes('!=')) { op = '!='; sides = claim.split('!='); }
  else if (claim.includes('==')) { op = '=='; sides = claim.split('=='); }
  else return { ok: false, detail: 'no `==` or `!=` in the claim -- a bare `=` is ambiguous' };
  if (sides.length < 2 || (op === '!=' && sides.length !== 2) || sides.some(s => !s.trim()))
    return { ok: false, detail: 'malformed claim' };

  let nodes, condNode = null;
  try {
    nodes = sides.map(s => math.parse(prep(s.trim())));
    if (cond) condNode = math.parse(prep(cond));
  } catch (e) { return { ok: false, detail: `parse: ${e.message}` }; }
  const vars = freeVars(condNode ? [...nodes, condNode] : nodes).filter(v => !(v in subs));
  const compiled = nodes.map(n => n.compile());
  const condC = condNode?.compile();

  const r = rng(0x5a7 + claim.length);
  let agree = 0, differ = null;
  for (let t = 0; t < TRIES && agree < (vars.length ? SAMPLES : 1); t++) {
    const scope = { ...subs };
    // Non-integer values across both signs, so a coincidence at a nice integer
    // cannot pass and sign errors cannot hide -- and every other draw ten times
    // wider, so an inequality whose boundary sits at 7 or 20 is tested on both
    // sides of it rather than only inside.
    const spread = t % 2 ? 60 : 6;
    for (const v of vars) scope[v] = (r() * 2 - 1) * spread + 0.137;
    try {
      if (condC && !condC.evaluate({ ...scope })) continue;
      const vals = compiled.map(c => num(c.evaluate({ ...scope })));
      let allAgree = true, usable = true;
      for (let i = 1; i < vals.length; i++) {
        const c = close(vals[0], vals[i]);
        if (c === null) { usable = false; break; }
        if (!c) { allAgree = false; differ = { scope, vals }; }
      }
      if (!usable) continue;
      if (!allAgree) break;
      agree++;
    } catch { continue; }
  }
  const fmt = (d) => Object.entries(d.scope).map(([k, v]) => `${k}=${+Number(v).toFixed(4)}`).join(', ') +
    ' gives ' + d.vals.map(v => (typeof v === 'number' ? +v.toPrecision(8) : String(v))).join(' vs ');
  if (op === '==') {
    if (differ) return { ok: false, detail: `NOT equal: ${fmt(differ)}` };
    const need = vars.length ? SAMPLES : 1;
    if (agree < need) return { ok: false, detail: `only ${agree} usable sample point(s) of ${need} -- ` +
      'check the condition, or a side that is undefined almost everywhere' };
    return { ok: true, detail: vars.length ? `identity on ${agree} points (${vars.join(', ')})` : 'exact' };
  }
  if (differ) return { ok: true, detail: `differ, as claimed: ${fmt(differ)}` };
  return { ok: false, detail: 'claimed NOT equal, but they agree at every point tried' };
}

const ANSWERS = /^#{1,3}\s+(?:.*[—–-]\s*)?answers?\s*$/im;

/**
 * Every CHECK in a target sheet's source, plus the coverage rule for answers
 * pages. Returns { results, problems } -- problems non-empty means refuse.
 */
export function checkSheet(raw) {
  const pages = raw.split('<!-- PAGE -->');
  const results = [], problems = [];
  pages.forEach((p, i) => {
    const heading = p.match(/^#{1,3}\s+(.*)$/m)?.[1]?.trim() ?? '';
    const checks = [...p.matchAll(/<!--\s*CHECK(?:\s+(\d+))?\s*:\s*([\s\S]*?)-->/g)]
      .map(m => ({ n: m[1] ? Number(m[1]) : null, claim: m[2].trim() }));
    for (const c of checks) {
      const r = checkClaim(c.claim);
      results.push({ page: i + 1, heading, ...c, ...r });
      if (!r.ok) problems.push(`page ${i + 1} "${heading}" CHECK${c.n ? ' ' + c.n : ''}: ${c.claim}\n    -> ${r.detail}`);
    }
    if (!ANSWERS.test(p)) return;
    // Only the section under the answers heading: a page often carries on into
    // teaching prose with its own numbered list (R03's five-step procedure).
    const plain = p.replace(/<!--[\s\S]*?-->/g, '');
    const at = plain.search(ANSWERS);
    const rest = plain.slice(at).replace(/^.*\n?/, '');
    const section = rest.slice(0, rest.search(/^#{1,3}\s/m) === -1 ? undefined : rest.search(/^#{1,3}\s/m));
    const items = [...section.matchAll(/^(\d+)\.\s/gm)].map(m => Number(m[1]));
    if (!items.length && !checks.length)
      problems.push(`page ${i + 1} "${heading}": an answers page with no CHECK at all`);
    const covered = new Set(checks.map(c => c.n));
    // Markdown renumbers lists, so the source may say "1." for every item.
    // Coverage counts ITEMS, by position.
    items.forEach((_, k) => {
      if (!covered.has(k + 1))
        problems.push(`page ${i + 1} "${heading}": answer ${k + 1} has no CHECK ${k + 1}`);
    });
  });
  return { results, problems };
}

// ---- CLI -------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = 0;
  for (const f of process.argv.slice(2).filter(a => !a.startsWith('--'))) {
    const { results, problems } = checkSheet(readFileSync(f, 'utf8'));
    const opted = results.filter(r => r.none).length;
    console.log(`${f}: ${results.length} CHECK(s), ${results.filter(r => r.ok && !r.none).length} verified, ` +
      `${opted} opted out, ${problems.length} problem(s)`);
    for (const p of problems) console.log(`  ${p}`);
    if (process.argv.includes('--verbose'))
      for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} p${r.page} ${r.n ?? '-'}: ${r.claim}  [${r.detail}]`);
    bad += problems.length;
  }
  process.exit(bad ? 1 : 0);
}
