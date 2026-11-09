// Render the pages of a .note to PNG, so they can be LOOKED at.
//
//   node tools/note_render.mjs <file.note> <outdir> [--pages 1,3,5] [--scale 0.5]
//
// Two jobs, one renderer:
//
//   review    pull a written-on notebook back from the Supernote and see what was
//             actually written. No OCR: the page is an image and vision reads it,
//             including the working, the crossings-out and the number in the time
//             box. The footer carries the question id, so the learner can name one in
//             conversation and both sides know which page we mean.
//   verify    check that a notebook we just built says what we think it says.
//             Every automated check passed yesterday while the crops showed the
//             wrong questions. Rendering the artifact and looking at it is the
//             only check that would have caught it.
//
// xiehanzi's readNote deliberately returns MAINLAYER only -- it exists for
// grading handwriting. The sheet itself lives in LAYER1 (the device rewrites
// BGLAYER against its own template store, so the background layer is not a safe
// home), and a review needs both: ink over the question it answers.
import { X, XMOD } from './config.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
const { encode: encodePng } = await import(XMOD('fast-png/lib/index.js'));
const { decodeRle } = await import(`${X}/deliver/note/rle.js`);
const { SIGNATURE, PAGE_WIDTH, PAGE_HEIGHT } = await import(`${X}/deliver/note/write.js`);

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const [file, outDir] = args.filter(a => !a.startsWith('--'));
if (!file || !outDir) { console.error('usage: note_render.mjs <file.note> <outdir> [--pages 1,2] [--scale 0.5]'); process.exit(2); }
const scale = Number(flag('scale', 0.5));
const want = flag('pages') ? new Set(flag('pages').split(',').map(Number)) : null;

// ---- container -------------------------------------------------------------
const bytes = readFileSync(file);
if (bytes.subarray(0, SIGNATURE.length).toString('utf8') !== SIGNATURE) {
  console.error('not a Supernote .note file'); process.exit(1);
}
const tags = t => new Map([...t.matchAll(/<([A-Z_0-9]+):([^>]*)>/g)].map(m => [m[1], m[2]]));
const block = (addr) => {
  const len = bytes.readUInt32LE(addr);
  return bytes.subarray(addr + 4, addr + 4 + len);
};
const textBlock = (addr) => tags(block(addr).toString('utf8'));

const footer = textBlock(bytes.readUInt32LE(bytes.length - 4));
const layerBitmap = (addr) => {
  if (!addr) return null;
  const b = Number(textBlock(addr).get('LAYERBITMAP') ?? 0);
  return b > 0 ? block(b) : null;
};

// ---- palette ---------------------------------------------------------------
// Inverse of greyToPalette. `background` and `white` both render as paper; the
// two grey levels are what the 5 mm grid is drawn in, so they must survive or the
// working space comes out as a blank rectangle.
const GREY = { 97: 0, 98: 255, 99: 0x70, 100: 0xc0, 101: 255 };

mkdirSync(outDir, { recursive: true });
const stem = basename(file).replace(/\.note$/, '');
const W = Math.round(PAGE_WIDTH * scale), H = Math.round(PAGE_HEIGHT * scale);
const written = [];

for (let i = 1; ; i++) {
  const addr = footer.get(`PAGE${i}`);
  if (addr === undefined) break;
  if (want && !want.has(i)) continue;
  const meta = textBlock(Number(addr));

  const sheet = layerBitmap(Number(meta.get('LAYER1') ?? 0));
  const ink = layerBitmap(Number(meta.get('MAINLAYER') ?? 0));
  if (!sheet && !ink) { console.error(`page ${i}: no LAYER1 and no MAINLAYER`); continue; }

  const sheetPx = sheet ? decodeRle(sheet, PAGE_WIDTH, PAGE_HEIGHT) : null;
  const inkPx = ink ? decodeRle(ink, PAGE_WIDTH, PAGE_HEIGHT) : null;

  const grey = new Uint8Array(W * H);
  let inkCount = 0;
  for (let y = 0; y < H; y++) {
    const sy = Math.min(PAGE_HEIGHT - 1, Math.round(y / scale));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(PAGE_WIDTH - 1, Math.round(x / scale));
      const s = sy * PAGE_WIDTH + sx;
      let g = sheetPx ? (GREY[sheetPx[s]] ?? 255) : 255;
      if (inkPx) {
        const code = inkPx[s];
        // Handwriting wins wherever it is not paper. Ink under the question image
        // is exactly the case that matters, so it composites over, not under.
        if (code !== 98 && code !== 101 && code !== 0) { g = GREY[code] ?? 0; inkCount++; }
      }
      grey[y * W + x] = g;
    }
  }
  const out = join(outDir, `${stem}-p${String(i).padStart(2, '0')}.png`);
  writeFileSync(out, Buffer.from(
    encodePng({ width: W, height: H, data: grey, channels: 1, depth: 8 })));
  const frac = inkPx ? (inkCount / (W * H) * 100).toFixed(2) : '--';
  console.log(`${out}  ${W}x${H}  ink ${frac}%${sheet ? '' : '  [NO SHEET LAYER]'}`);
  written.push(out);
}
if (!written.length) { console.error('no pages rendered'); process.exit(1); }
