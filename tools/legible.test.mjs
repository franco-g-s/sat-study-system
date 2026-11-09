// Tests for the legibility pass. Run: node --test tools/legible.test.mjs
import { XMOD } from './config.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, plan, legible, classCaps, MAX_SCALE, COL_PX, MERGE_GAP } from './legible.mjs';
const { encode, decode } = await import(XMOD('fast-png/lib/index.js'));

// A synthetic crop: white, with black bars standing in for lines of text.
function crop(W, H, bars) {
  const d = new Uint8Array(W * H).fill(255);
  for (const [y0, y1, x1] of bars)
    for (let y = y0; y <= y1; y++) for (let x = 10; x < x1; x++) d[y * W + x] = 0;
  return { grey: d, png: Buffer.from(encode({ width: W, height: H, data: d, channels: 1, depth: 8 })) };
}

test('lines of one paragraph merge; separate answer choices do not', () => {
  const { grey } = crop(1856, 400, [
    [10, 40, 1800], [50, 80, 900],          // paragraph: 9 px apart
    [80 + MERGE_GAP + 20, 150, 200],        // an answer choice, well clear
  ]);
  const bs = blocks(grey, 1856, 400);
  assert.equal(bs.length, 2);
  assert.equal(bs[0].r, 1800, 'a paragraph takes the width of its widest line');
});

// The R06 case: a one-line question drawn across a 1856 px crop it fills a
// quarter of. It must come out MAX_SCALE larger.
test('a short narrow question is enlarged to the maximum', () => {
  const [s] = plan([{ y0: 5, y1: 100, r: 480 }], 1856, 1e9);
  assert.equal(s, MAX_SCALE);
});

test('a full-width block is never enlarged and never shrunk', () => {
  const [s] = plan([{ y0: 5, y1: 100, r: 1850 }], 1856, 1e9);
  assert.equal(s, 1);
});

test('the height budget scales enlargement back, never below 1x', () => {
  const bs = [{ y0: 0, y1: 800, r: 1000 }, { y0: 850, y1: 900, r: 300 }];
  const tight = plan(bs, 1856, 950);        // barely more than the unscaled height
  for (const s of tight) assert.ok(s >= 1 && s < MAX_SCALE);
  const none = plan(bs, 1856, 100);         // already over budget: leave it alone
  assert.deepEqual(none, [1, 1]);
});

test('output is device width, and a narrow block really is drawn larger', () => {
  const { png } = crop(1856, 200, [[20, 60, 480]]);
  const r = legible(png);
  const out = decode(r.png);
  assert.equal(out.width, COL_PX);
  let right = 0;
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++)
    if (out.data[y * out.width + x] < 128) right = Math.max(right, x);
  // 480 px of source at the old scale lands at ~445 device px; 1.6x is ~712.
  assert.ok(right > 650, `ink reaches x=${right}, expected ~712`);
  assert.ok(r.grown);
});

test('class caps are read from the page stylesheet, last rule winning', () => {
  const caps = classCaps(`<style>.sweepa { max-height: 120mm; } .drillans { max-height: 74mm; }
    .sweepa { max-height: 74mm; object-fit: contain; }</style>`);
  assert.equal(caps.get('sweepa'), 74);
  assert.equal(caps.get('drillans'), 74);
});

test('pages already written on are left exactly as they were', async () => {
  const { legibleImages } = await import('./legible.mjs');
  const { png } = crop(1856, 200, [[20, 60, 480]]);
  const img = `<img class="qb sweepq" src="data:image/png;base64,${png.toString('base64')}">`;
  const html = `<style>.sweepq { max-height: 108mm; }</style>` +
    `<section class="page">${img}</section><section class="page">${img}</section>`;
  const out = legibleImages(html, { skipPages: new Set([0]), log: () => {} });
  const pages = out.split('<section class="page">').slice(1);
  assert.ok(pages[0].includes(img), 'the inked page was re-laid out');
  assert.ok(!pages[1].includes(img), 'the unwritten page was not');
});
