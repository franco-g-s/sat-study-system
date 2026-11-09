// Tests for the hand-written answer check. Run: node --test tools/check_math.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkClaim, checkSheet } from './check_math.mjs';

// The regression: R05's first printing. The wrong factorisation and the wrong
// final answer must both fail; the corrected ones must pass.
test('R05: the printed wrong answer fails, the corrected one passes', () => {
  assert.equal(checkClaim('(x^2-25)/(x^2+3x-10) == (x+5)/(x+2) | x > 5').ok, false);
  assert.equal(checkClaim('x^2+3x-10 == (x-5)(x+2)').ok, false);
  assert.equal(checkClaim('(x^2-25)/(x^2+3x-10) == (x-5)/(x-2) | x > 5').ok, true);
  assert.equal(checkClaim('x^2+3x-10 == (x+5)(x-2)').ok, true);
});

// Why the rule says "question on the left": the wrong printed chain is
// self-consistent, so checking it against itself proves nothing.
test('a self-consistent but wrong chain passes -- the reason for the rule', () => {
  assert.equal(checkClaim('(x-5)(x+5)/((x-5)(x+2)) == (x+5)/(x+2)').ok, true);
});

test('a solution is checked by substituting it back', () => {
  assert.equal(checkClaim('c = 7/24; 4^(8c) == nthRoot(4^7, 3)').ok, true);
  assert.equal(checkClaim('c = 7/32; 4^(8c) == nthRoot(4^7, 3)').ok, false);   // the misread index
});

test('a single letter before a bracket multiplies', () => {
  assert.equal(checkClaim('x(x+3)/(x+1) == (x^2+3x)/(x+1)').ok, true);
});

test('!= passes only when the two really differ', () => {
  assert.equal(checkClaim('(x+4)/4 != x').ok, true);
  assert.equal(checkClaim('(x+4)/4 != x/4 + 1').ok, false);
});

test('chains check every link', () => {
  assert.equal(checkClaim('x^3 - 9x == x(x^2-9) == x(x-3)(x+3)').ok, true);
  assert.equal(checkClaim('x^3 - 9x == x(x^2-9) == x(x-3)(x-3)').ok, false);
});

test('arithmetic with no letters is exact', () => {
  assert.equal(checkClaim('16/(28-20) == 2').ok, true);
  assert.equal(checkClaim('sin(30 deg) == 1/2').ok, true);
  assert.equal(checkClaim('5*3 + 2 == 18').ok, false);
});

test('a condition nothing satisfies fails rather than passing vacuously', () => {
  assert.equal(checkClaim('x == x | x > 100').ok, false);
});

test('a bare = and a reasonless none are refused', () => {
  assert.equal(checkClaim('x + x = 2x').ok, false);
  assert.equal(checkClaim('none').ok, false);
  assert.equal(checkClaim('none -- a reading question, nothing to compute').ok, true);
});

test('every numbered answer on an answers page needs its own CHECK', () => {
  const sheet = `<!-- PAGE -->

## Try it now — answers

1. $x = 3$
2. $y = 4$

<!-- CHECK 1: x = 3; 2x == 6 -->
`;
  const { problems } = checkSheet(sheet);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /answer 2 has no CHECK 2/);
});

test('teaching pages are not required to carry CHECKs, but any they carry run', () => {
  const { problems } = checkSheet(`## Move 1\n\nSome prose.\n<!-- CHECK: 2 + 2 == 5 -->\n`);
  assert.equal(problems.length, 1);
});

test('single letters that mathjs knows as units are still variables', () => {
  assert.equal(checkClaim('m*x + b == b + x*m').ok, true);
  assert.equal(checkClaim('h*t == t*h + 1').ok, false);
});

test('an inequality answer is checked on both sides of its boundary', () => {
  assert.equal(checkClaim('(x^2 < 49) == (-7 < x and x < 7)').ok, true);
  assert.equal(checkClaim('((x-5)^2 < 4) == (-2 < x and x < 2)').ok, false);   // forgot the +5
  assert.equal(checkClaim('((x-5)^2 < 4) == (3 < x and x < 7)').ok, true);
});

test('a numbered list under a LATER heading on the answers page is not an answer', () => {
  const { problems } = checkSheet(`## Answers

1. $x = 8$

<!-- CHECK 1: x = 8; 2x - 6 == 10 -->

## The whole procedure

1. Collect.
2. Isolate.
`);
  assert.deepEqual(problems, []);
});

test('angles in degrees compare with radians', () => {
  assert.equal(checkClaim('atan(1) == 45 deg').ok, true);
  assert.equal(checkClaim('asin(1/2) == 60 deg').ok, false);
});
