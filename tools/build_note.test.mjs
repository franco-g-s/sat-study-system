// Tests for the target-sheet build. Run: node --test tools/build_note.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberLabels } from './sheet.mjs';

// A QUESTIONS label numbers across ALL its markers, not within each one.
//
// R05's two follow-ups are on separate pages, so they are two markers, and each
// used to count its own list -- both rendered pages were headed "Follow-up
// 1 / 1". Cosmetic, but the numbering is the only thing on the page telling
// the learner where they are in a set, and "1 / 1" on the second of two is a small lie
// on a sheet whose whole value is that what is printed can be trusted.

test('two markers sharing a label number continuously across both', () => {
  const specs = [
    { at: 1, qids: ['ea6d05bb'], label: 'Follow-up' },
    { at: 2, qids: ['c81b6c57'], label: 'Follow-up' },
  ];
  numberLabels(specs);
  assert.deepEqual(
    specs.map(s => [s.labelStart + 1, s.labelTotal]),
    [[1, 2], [2, 2]],
    'the second follow-up did not read 2 / 2');
});

test('a single marker is unchanged', () => {
  const specs = [{ at: 1, qids: ['a', 'b', 'c'], label: 'Drill' }];
  numberLabels(specs);
  assert.equal(specs[0].labelStart, 0);
  assert.equal(specs[0].labelTotal, 3);
});

test('different labels keep separate counters', () => {
  const specs = [
    { at: 1, qids: ['a', 'b'], label: 'Drill' },
    { at: 2, qids: ['c'], label: 'Follow-up' },
    { at: 3, qids: ['d'], label: 'Drill' },
    { at: 4, qids: ['e'], label: 'Follow-up' },
  ];
  numberLabels(specs);
  const got = specs.map(s => `${s.label} ${s.labelStart + 1} / ${s.labelTotal}`);
  assert.deepEqual(got, [
    'Drill 1 / 3', 'Follow-up 1 / 2', 'Drill 3 / 3', 'Follow-up 2 / 2',
  ]);
});

test('multi-question markers offset by their own length, not by one', () => {
  const specs = [
    { at: 1, qids: ['a', 'b', 'c'], label: 'Drill' },
    { at: 2, qids: ['d', 'e'], label: 'Drill' },
  ];
  numberLabels(specs);
  assert.equal(specs[1].labelStart, 3, 'second marker must start at 4, not 2');
  assert.equal(specs[1].labelTotal, 5);
});

test('BANK specs carry no qids and are left untouched', () => {
  // A BANK marker pushes { at, specs } with no qids and no label. Writing
  // labelStart onto it would be harmless but numbering it would not be, since
  // BANK questions are numbered by their own expansion.
  const specs = [
    { at: 1, specs: ['algebra::linear'] },
    { at: 2, qids: ['a'], label: 'Drill' },
  ];
  numberLabels(specs);
  assert.equal('labelStart' in specs[0], false);
  assert.equal(specs[1].labelTotal, 1);
});

test('document order decides the numbering', () => {
  // build_note expands bankSpecs REVERSED, so that it can splice pages in from
  // the end without invalidating earlier indices. Numbering computed in that
  // order would count backwards, which is why numberLabels is called before
  // the reverse and this test exists to say so.
  const specs = [
    { at: 10, qids: ['late'], label: 'Follow-up' },
    { at: 99, qids: ['later'], label: 'Follow-up' },
  ];
  numberLabels(specs);
  assert.equal(specs[0].labelStart, 0, 'the earlier page must be number 1');
  assert.equal(specs[1].labelStart, 1);
});

test('an empty qids list does not consume a number', () => {
  const specs = [
    { at: 1, qids: [], label: 'Follow-up' },
    { at: 2, qids: ['a'], label: 'Follow-up' },
  ];
  numberLabels(specs);
  assert.equal(specs[1].labelStart, 0);
  assert.equal(specs[1].labelTotal, 1);
});
