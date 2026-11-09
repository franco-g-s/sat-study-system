// Make every bank image legible on the device, not merely present on the page.
//
// Called from buildNote() on the final HTML, so every builder gets it without
// each one having to remember -- the same reason the overflow guard lives there.
//
// THE DEFECT: short question images rendered too small to read.
// Two drills on sheet R06 were lost to misread digits (y^6 read as y^5, a cube
// root's index 3 read as 4) with the method right both times. The crop was sharp
// enough; it was simply drawn small. Every bank crop was scaled to the full column
// width (145.6 mm) whatever it contained, which puts the bank's text at ~0.7x the
// PDF's own size: a radical index came out ~1 mm tall on the glass. The page is
// 1:1 on the Manta (1920 px at ~299 dpi = 162.6 mm), so those are physical mm.
//
// THE FIX, per BLOCK rather than per image
// A crop is split into blocks at its blank rows (a gap of MERGE_GAP px or more;
// the lines of one paragraph sit ~5-13 px apart at the crop scale, separate
// answer choices 22-50). Each block is then scaled on its own, up to MAX_SCALE,
// as far as its own ink width allows. So:
//   - a one-line question, a stacked expression, the answer choices "A. y^2" --
//     anything narrow -- is drawn 1.6x larger;
//   - a paragraph whose lines already run the full width stays where it was,
//     because the page is the limit and nothing reflows an image;
//   - nothing is ever drawn SMALLER than before.
// Scaling the whole image by its widest line (the first version of this fix) left
// every question with one full-width sentence in it unchanged -- half the bank --
// including its tiny stacked-fraction answer choices.
//
// Blocks keep their left offset (scaled), and only the right and bottom are
// trimmed, so nothing is ever cropped into. The ink threshold is pale (240) so
// faint gridlines and axis ticks count as ink.
//
// Height is budgeted: the image may grow to the smaller of its CSS class's
// max-height (read from the page's own stylesheet) and GROW_CAP_MM, or keep its
// old height if that was already larger. Over budget, every block's enlargement
// is scaled back by the same fraction, never below 1x. So a page that fitted
// before still fits, and a class cap never ends up shrinking full-width text.
//
// The image is composited at DEVICE resolution (1719 px for the 145.6 mm
// column), so the browser draws it 1:1 and no second resample happens.
import { XMOD } from './config.mjs';
const { decode, encode } = await import(XMOD('fast-png/lib/index.js'));

// The bank's text against the sheet's own: bank body text lands at ~2.6 mm per
// em at the old scale, our prose is 4.3 mm. 1.6x brings them level.
export const MAX_SCALE = 1.6;
// Column width the .qb rule draws at: 162.6 - 14 - 6 content, +3 mm right bleed.
export const COL_MM = 162.6 - 14 - 6 + 3;
export const COL_PX = Math.round(COL_MM / 162.6 * 1920);
// A question page's own cap is 108 mm (.sweepq): header, image, and a workspace
// of ~70 mm still fit.
export const GROW_CAP_MM = 108;
export const MERGE_GAP = 18;
const INK = 240, PAD = 6;
// Classes that are deliberately small: the bank's metadata header, shown for the
// Question ID, not to be read.
const SKIP = /\b(sweeph|rwh)\b/;

// The .note palette has one visible grey (144-231); anything paler is paper. A
// thin antialiased stroke -- a superscript, or the bank's own low-resolution
// raster maths, which is grey rather than black in the PDF -- therefore breaks up
// or vanishes. A gamma curve darkens the midtones so those strokes land on black,
// and leaves paper (255) and ink (0) exactly where they were.
const GAMMA = 2.2;
const LUT = Uint8Array.from({ length: 256 }, (_, g) => Math.round(255 * (g / 255) ** GAMMA));

/** Greyscale, darkened, as a flat Uint8Array. Alpha composites onto white. */
function toGrey(png) {
  const { width: W, height: H, data, channels: c, depth } = png;
  const max = depth === 16 ? 65535 : 255;
  const out = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += c) {
    let g = c >= 3 ? (data[i] + data[i + 1] + data[i + 2]) / 3 : data[i];
    if (c === 2 || c === 4) { const a = data[i + c - 1] / max; g = g * a + max * (1 - a); }
    out[p] = LUT[Math.round(g / max * 255)];
  }
  return out;
}

/**
 * Blocks of ink separated by blank runs of MERGE_GAP rows or more. Each block is
 * { y0, y1 } (inclusive) and `r`, the rightmost ink column + 1. Pure.
 */
export function blocks(grey, W, H) {
  const right = new Int32Array(H).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let x = W - 1; x >= 0; x--) if (grey[y * W + x] < INK) { right[y] = x; break; }
  }
  const out = [];
  let cur = null, blank = 0;
  for (let y = 0; y < H; y++) {
    if (right[y] < 0) { blank++; continue; }
    if (cur && blank < MERGE_GAP) { cur.y1 = y; cur.r = Math.max(cur.r, right[y] + 1); }
    else { cur = { y0: y, y1: y, r: right[y] + 1 }; out.push(cur); }
    blank = 0;
  }
  return out;
}

/**
 * Scale per block, relative to the old rendering (full crop width -> column).
 * `limit` is the height budget in old-scale source pixels. Pure.
 */
export function plan(bs, W, limit) {
  const want = bs.map(b => Math.max(1, Math.min(MAX_SCALE, W / Math.min(W, b.r + PAD))));
  // (measured from x = 0: slightly conservative, since the left margin is not scaled)
  const gaps = bs.map((b, i) => (i ? b.y0 - bs[i - 1].y1 - 1 : b.y0));
  const heights = bs.map(b => b.y1 - b.y0 + 1);
  // the gap above a block scales with that block, so spacing stays proportional
  const total = t => heights.reduce((s, h, i) =>
    s + (h + gaps[i]) * (1 + (want[i] - 1) * t), 0) + PAD;
  let t = 1;
  if (total(1) > limit) {
    const base = total(0), extra = total(1) - base;
    t = base >= limit ? 0 : (limit - base) / extra;
  }
  return want.map(s => 1 + (s - 1) * t);
}

// Bilinear, greyscale. Enlargement here is at most ~1.5 device px per source px.
function resample(src, W, x0, y0, w, h, ow, oh, dst, DW, dx, dy) {
  for (let y = 0; y < oh; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) * h / oh - 0.5));
    const ya = Math.floor(sy), yb = Math.min(h - 1, ya + 1), fy = sy - ya;
    const ra = (y0 + ya) * W + x0, rb = (y0 + yb) * W + x0;
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) * w / ow - 0.5));
      const xa = Math.floor(sx), xb = Math.min(w - 1, xa + 1), fx = sx - xa;
      const v = (src[ra + xa] * (1 - fx) + src[ra + xb] * fx) * (1 - fy) +
                (src[rb + xa] * (1 - fx) + src[rb + xb] * fx) * fy;
      dst[(dy + y) * DW + dx + x] = Math.round(v);
    }
  }
}

/** Max-height per CSS class, read from the page's own stylesheet (last rule wins). */
export function classCaps(html) {
  const caps = new Map();
  for (const m of html.matchAll(/\.([a-z][\w-]*)\s*\{[^}]*?max-height:\s*([\d.]+)mm/g))
    caps.set(m[1], Number(m[2]));
  return caps;
}

const k0 = W => COL_PX / W;

/** One crop -> { png, grown }, or null for an image with no ink at all. */
export function legible(pngBytes, capMm = Infinity) {
  const png = decode(pngBytes);
  const { width: W, height: H } = png;
  const grey = toGrey(png);
  const bs = blocks(grey, W, H);
  if (!bs.length) return null;
  // The left margin is kept at its old size rather than scaled with each block,
  // or an enlarged block would sit visibly indented from the text above it.
  let xL = W;
  for (let i = 0; i < grey.length && xL > 0; i++) if (grey[i] < INK) xL = Math.min(xL, i % W);
  const dx = Math.round(xL * k0(W));
  const oldMmPerPx = COL_MM / W;
  const oldH = H * oldMmPerPx;
  const limitMm = Math.max(Math.min(capMm, GROW_CAP_MM), Math.min(oldH, capMm));
  const scales = plan(bs, W, limitMm / oldMmPerPx);
  const k = k0(W);                                    // device px per old source px
  let y = 0;
  const placed = bs.map((b, i) => {
    const gap = i ? b.y0 - bs[i - 1].y1 - 1 : b.y0;
    y += Math.round(gap * k * scales[i]);
    const w = Math.min(W, b.r + PAD) - xL, h = b.y1 - b.y0 + 1;
    const f = Math.min(k * scales[i], (COL_PX - dx) / w);   // never wider than the column
    const at = { y0: b.y0, w, h, ow: Math.round(w * f), oh: Math.max(1, Math.round(h * f)), y };
    y += at.oh;
    return at;
  });
  const OH = y + Math.round(PAD * k);
  const out = new Uint8Array(COL_PX * OH).fill(255);
  for (const p of placed) resample(grey, W, xL, p.y0, p.w, p.h, p.ow, p.oh, out, COL_PX, dx, p.y);
  return {
    png: Buffer.from(encode({ width: COL_PX, height: OH, data: out, channels: 1, depth: 8 })),
    grown: scales.some(s => s > 1.02),
  };
}

/** Rewrite every bank <img> in the page HTML. */
//
// `skipPages` is a set of 0-based page indices to leave exactly as they were --
// pages of a --carry rebuild that already carry handwriting.
export function legibleImages(html, { log = console.log, skipPages = new Set() } = {}) {
  const caps = classCaps(html);
  const starts = [...html.matchAll(/<section class="page\b/g)].map(m => m.index);
  const pageAt = (off) => { let i = -1; while (i + 1 < starts.length && starts[i + 1] <= off) i++; return i; };
  let grown = 0, n = 0, kept = 0;
  const out = html.replace(
    /<img class="(qb\b[^"]*)" src="data:image\/png;base64,([A-Za-z0-9+/=]+)">/g,
    (tag, cls, b64, off) => {
      if (SKIP.test(cls)) return tag;
      if (skipPages.size && skipPages.has(pageAt(off))) { kept++; return tag; }
      const cap = Math.min(...cls.split(/\s+/).map(c => caps.get(c) ?? Infinity));
      const r = legible(Buffer.from(b64, 'base64'), cap);
      if (!r) return tag;
      n++; if (r.grown) grown++;
      return `<img class="${cls}" src="data:image/png;base64,${r.png.toString('base64')}">`;
    });
  log(`legibility: ${n} bank image(s) laid out at device resolution, ${grown} with enlarged blocks` +
    (kept ? `; ${kept} left as they were on pages already written on` : ''));
  return out;
}
