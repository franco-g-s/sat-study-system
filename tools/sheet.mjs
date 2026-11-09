// Shared machinery for every sheet this repo builds: page geometry, CSS, the
// markdown subset, question cropping, and the render->.note step.
//
// Extracted from build_note.mjs when the sweep generator needed the same page
// and the same overflow guard. Two copies of the CSS would drift, and the
// geometry is not arbitrary: the uneven margins dodge the device's own toolbar
// down the left edge, and were tuned by hand against the hardware.
import { X, XMOD } from './config.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkStamp, stampError } from './text_stamp.mjs';
import { runSwift } from './swift.mjs';
import { legibleImages } from './legible.mjs';
const katex = (await import('katex')).default;

export { ROOT } from './config.mjs';
import { ROOT } from './config.mjs';

// 216.8, not 216.7, and the tenth of a millimetre is load-bearing. The device is
// 1920x2560, an exact 0.75 aspect; 162.6 x 216.7 is 0.75035, so the rasteriser had
// to render slightly oversize and resize down to fit. That resample is what made
// the 5 mm grid uneven -- a cell period fixed at 59 device pixels came out 57, 58,
// 59 or 60 depending on where each line happened to land -- and it softened every
// question image on the way through. At 216.8 the geometry is exactly 4:3, one
// screenshot lands on 1920x2560, and no resampling happens at all.
export const PAGE_W_MM = 162.6, PAGE_H_MM = 216.8;
export const M_TOP = 5, M_BOTTOM = 7, M_LEFT = 14, M_RIGHT = 6;
// ---- the writing grid ------------------------------------------------------
// The cell is defined in DEVICE PIXELS, not millimetres, and this is the whole
// trick. Pages are rasterised a shade over 1920 wide and resized down to exactly
// 1920, so a 5.000mm cell period lands on a slightly different subpixel phase in
// every column; each line then rounds to 2, 3 or 4 pixels and the grid visibly
// varies in weight across the page. A period of exactly 59 device pixels makes
// every cell rasterise identically. Measured over 291 lines: 2 px thick on 95%
// of them, against three competing thicknesses before.
//
// 59 px is 4.9966mm -- 5mm to within 0.07%, or 0.19mm across the full 28 cells.
//
// The line is LIGHT on purpose. The .note palette has exactly one visible grey
// (RLE.gray, everything from 144 to 231), so lighter cannot be had by asking for
// a paler grey -- it either quantises to the same grey or vanishes to paper. What
// lightness buys is at the EDGES: at #d0d0d0 a pixel needs about half coverage to
// register at all, so the half-lit fringe that made lines look fat and uneven
// drops out instead of rounding up to a second grey row.
export const GRID_CELL_PX = 59;
export const GRID_LINE_PX = 2;
export const GRID_MM = GRID_CELL_PX * PAGE_W_MM / 1920;
export const GRID_LINE_MM = GRID_LINE_PX * PAGE_W_MM / 1920;
export const GRID_COLOUR = '#d0d0d0';
/**
 * Content column, rounded down to a whole number of cells, PLUS one line width.
 *
 * box-sizing is border-box, so the closing border eats into the last cell: with a
 * bare multiple of the cell size the final column measured 57 device pixels
 * against 59 everywhere else, which is visible as an obviously narrower strip at
 * the edge. Adding the line back puts the border outside the last full cell.
 */
// The +0.04 is sub-pixel slack. Millimetres reach device pixels through a CSS
// layout that rounds, so the closing line came out 1px against 2px everywhere
// else; half a pixel of slack lands it on the full width without moving anything.
export const GRID_W_MM =
  Math.floor((PAGE_W_MM - M_LEFT - M_RIGHT) / GRID_MM) * GRID_MM + GRID_LINE_MM + 0.04;

// ---- maths -----------------------------------------------------------------
/**
 * `$...$` and `$$...$$` become real typeset maths.
 *
 * Monospace maths was fine for a stray exponent and much worse for larger,
 * more complex equations, as the first sheet showed -- the sheets asked you to read
 * `33 · (0.4)^(x+3)` in monospace while the official questions beside them are
 * properly set, and the mismatch costs reading speed on a sheet whose whole
 * subject is speed.
 *
 * Extracted BEFORE the markdown pass and put back after: md() escapes HTML, and
 * KaTeX's output is HTML. The placeholder is a private-use codepoint, so nothing
 * in ordinary prose can collide with it.
 */
const MATH_TOKEN = '\uE000';
export function extractMath(text) {
  const out = [];
  const replaced = text
    .replace(/\$\$([^$]+?)\$\$/g, (_, tex) => {
      out.push(katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }));
      return `${MATH_TOKEN}${out.length - 1}${MATH_TOKEN}`;
    })
    .replace(/\$([^$\n]+?)\$/g, (_, tex) => {
      out.push(katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false }));
      return `${MATH_TOKEN}${out.length - 1}${MATH_TOKEN}`;
    });
  return { text: replaced, math: out };
}
const restoreMath = (html, math) =>
  html.replace(new RegExp(`${MATH_TOKEN}(\\d+)${MATH_TOKEN}`, 'g'), (_, i) => math[Number(i)]);

/**
 * KaTeX's stylesheet points at font files by relative URL, which an about:blank
 * page cannot fetch -- the same rule that turned ten practice images into broken
 * icons. The woff2 files are inlined and the other formats dropped, since
 * Chromium takes woff2 and carrying three copies of twenty fonts is pointless.
 */
let katexCssCache = null;
export function katexCss() {
  if (katexCssCache) return katexCssCache;
  const dist = `${ROOT}/node_modules/katex/dist`;
  const fonts = new Map(readdirSync(`${dist}/fonts`)
    .filter(f => f.endsWith('.woff2'))
    .map(f => [f, `data:font/woff2;base64,${readFileSync(`${dist}/fonts/${f}`).toString('base64')}`]));
  katexCssCache = readFileSync(`${dist}/katex.min.css`, 'utf8')
    .replace(/src:[^;}]+/g, (src) => {
      const m = src.match(/fonts\/([A-Za-z0-9_-]+\.woff2)/);
      return m && fonts.has(m[1]) ? `src:url(${fonts.get(m[1])}) format("woff2")` : 'src:local("")';
    });
  return katexCssCache;
}

// ---- markdown --------------------------------------------------------------
export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const inline = s => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

export function md(source) {
  const { text, math } = extractMath(source);
  // Wikilinks are for reading the CARD SOURCE, which sits next to other notes and
  // links into them. On a sheet they are noise: "[[R3]] was punctuation between
  // clauses" shipped with the brackets visible, and a Supernote page has nothing
  // to link to. Render the display text and drop the syntax.
  const unlinked = text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1');
  const out = restoreMath(mdRaw(unlinked), math);
  warnResidualMarkup(out);
  return out;
}

/**
 * Shout when markdown syntax survives into the output as literal characters.
 *
 * The renderer's emphasis handling does NOT nest: `**bold with *italic* inside**`
 * comes out with the asterisks still in it and the bold lost. That is invisible
 * from inside the pipeline -- the page builds, the overflow guard passes, the
 * .note ships -- and it was found the only way it can be found, by rendering a
 * page and reading it. This is the automated half of that check: it inspects the
 * OUTPUT for syntax that should have been consumed, rather than re-asking the
 * converter whether it did its job.
 *
 * A warning, not a refusal: `**` is legal inside a code span (`b**2`), so code
 * and math are stripped before looking. Anything left is a real mistake.
 */
function warnResidualMarkup(html) {
  const prose = html
    .replace(/<code[\s\S]*?<\/code>/g, '')
    .replace(/\$[^$]*\$/g, '')
    .replace(/<[^>]+>/g, '');
  for (const m of prose.matchAll(/\*\*?[^*\n]{0,80}?\*\*?/g)) {
    const ctx = m.input.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    console.error(`WARNING literal markdown survived rendering: ${JSON.stringify(m[0])}`);
    console.error(`  …${ctx.replace(/\s+/g, ' ').trim()}…`);
    console.error('  Emphasis does not nest here. Rewrite so bold and italic do not overlap.');
  }
}

function mdRaw(text) {
  const out = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    if (l.startsWith('```')) {
      const buf = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++; out.push(`<pre>${esc(buf.join('\n'))}</pre>`); continue;
    }
    if (/^\|/.test(l)) {
      const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = r => r.split('|').slice(1, -1).map(c => c.trim());
      const head = cells(rows[0]);
      const bodyRows = rows.slice(2).map(cells);
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        bodyRows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^> /.test(l)) {
      const buf = []; while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>ature?\s?/, '').replace(/^>\s?/, ''));
      out.push(`<blockquote>${mdRaw(buf.join('\n'))}</blockquote>`); continue;
    }
    // A list item runs until the next item or a blank line. Without this, a
    // wrapped item dropped out of the list and became a separate paragraph --
    // which is why the three-mistakes page came out ragged, with the first line
    // of each point in the list and the rest hanging below it.
    const listItems = (isItem, strip) => {
      const buf = [];
      while (i < lines.length && isItem(lines[i])) {
        let item = strip(lines[i++]);
        while (i < lines.length && !/^\s*$/.test(lines[i]) &&
               !/^(#{1,3} |[-*] |\d+\. |\||> |```|<!--)/.test(lines[i])) item += ' ' + lines[i++].trim();
        buf.push(item);
      }
      return buf;
    };
    if (/^\d+\. /.test(l)) {
      const buf = listItems(x => /^\d+\. /.test(x), x => x.replace(/^\d+\.\s/, ''));
      out.push(`<ol>${buf.map(b => `<li>${inline(b)}</li>`).join('')}</ol>`); continue;
    }
    if (/^[-*] /.test(l)) {
      const buf = listItems(x => /^[-*] /.test(x), x => x.replace(/^[-*]\s/, ''));
      out.push(`<ul>${buf.map(b => `<li>${inline(b)}</li>`).join('')}</ul>`); continue;
    }
    const h = l.match(/^(#{1,3}) (.*)$/);
    if (h) { i++; out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,3} |[-*] |\d+\. |\||> |```)/.test(lines[i]))
      buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

// ---- the bank --------------------------------------------------------------
// Whitespace removed, not collapsed: the PDF text layer drops spaces at text-run
// boundaries, so "Linear equations in onevariable" must match "…in one variable".
export const skillKey = (x) => (x ?? '').replace(/\s+/g, '').toLowerCase();

// Every index is checked against data/text_normalised.json on the way in, and a
// stale digest THROWS rather than warning.
//
// The step it enforces is tools/fix_split_words.py, which rejoins words the PDF
// extraction split in half -- "cer tain" for "certain", "ver tical" for
// "vertical". Skipping it breaks nothing and errors nowhere; the text is merely
// wrong in the middle, so every marker, selector and grep over the corpus
// under-counts and the under-count reads as a fact. `grep vertical` returned 0
// while the bank held 36 of them (2026-09-12).
//
// Throwing is the point, and it is deliberately not overridable. A builder that
// runs on unnormalised text produces a sheet that looks perfect and drills the
// wrong questions -- the DS01 failure exactly, where eight reps were sat that
// measured nothing. No sheet is recoverable in a minute; a wrong sheet costs a
// study block and is not discovered until it has been sat. Re-stamping is one
// command and the error names it.
//
// checkStamp is called with TWO arguments on purpose: it re-reads the index
// itself rather than being handed the rows this function already parsed.
//
// The digest is over the RAW file, and `bankIndex` is a filtered view -- 1,833
// of 1,925, dropping leaked and crop-less rows. Hand it the filtered rows and
// the hash is e5d329b3 against the stamped fb302945, so the guard fires on every
// build forever and the obvious fix is to delete it. checkStamp now names that
// mistake instead of misreporting it as a stale index, but the version that
// cannot be made is better than the version that explains itself. Costs one
// extra read of a 2.4 MB file, measured at 18 ms.
const loadIndex = (relPath) => {
  const { ok, reason } = checkStamp(ROOT, relPath);
  if (!ok) throw new Error(stampError(relPath, reason));
  return JSON.parse(readFileSync(`${ROOT}/${relPath}`, 'utf8'))
    .filter(r => r.crop_y && !r.leak);
};

export const bankIndex = loadIndex('data/qb_index.json');
export const byQid = new Map(bankIndex.map(r => [r.qid, r]));

// Reading & Writing is a SEPARATE index, deliberately. `bankIndex` is maths and
// every maths consumer assumes that; folding 1,845 R&W rows into it would change
// what all of them mean without any of them saying so. Same row shape, so
// cropImages() and everything downstream work on it unchanged.
export const rwIndex = existsSync(`${ROOT}/data/rw_index.json`)
  ? loadIndex('data/rw_index.json')
  : [];
export const rwByQid = new Map(rwIndex.map(r => [r.qid, r]));

// ---- what the question actually shows you ----------------------------------
// `figures` is derived by tools/derive_figures.py. Four states, and the last
// two are the reason these helpers exist rather than each builder writing
// `r.figures.includes(...)` and getting it subtly wrong:
//
//   []            no figure, decided
//   ['graph']     a figure, kind known (also 'table', 'scatterplot', 'diagram')
//   ['unknown']   a figure, kind NOT determined
//   null/absent   undecidable -- no gate to apply (maths), or a marker the
//                 geometry would not confirm (R&W)
//
// The two indexes are derived by different rules, because `question_y - crop_y`
// is figure height on a maths question and passage height on R&W. Maths gates
// first; R&W takes the marker as the rule and the gate only as confirmation.
// The consequence HERE: on an R&W row an empty `figures` means "the text
// mentions no figure", which is weaker than maths's "did not clear the gate".
// hasFigure() is strong on both. hasNoFigure() is strong on maths and merely
// suggestive on R&W -- do not build a "needs a figure-free question" drill on
// R&W off it without checking a sample.
//
// A drill that needs a table must EXCLUDE the last two. `r.figures?.includes`
// would do that by accident; these say it on purpose, and they are why a
// technique like DS01's regressions drill fails loudly at build time instead of
// after eight reps that measured nothing have been sat.
export const figuresKnown = (r) => Array.isArray(r?.figures) && !r.figures.includes('unknown');
export const hasFigure = (r, kind) => figuresKnown(r) && r.figures.includes(kind);
export const hasNoFigure = (r) => figuresKnown(r) && r.figures.length === 0;

// Use this at the top of a technique, not after the sheet renders. It turns
// "my pool is empty because the bank has nothing like this" into an error that
// names the technique, which is the whole lesson of DS01.
export function requireFigure(pool, kind, technique) {
  const hits = pool.filter(r => hasFigure(r, kind));
  if (!hits.length) {
    throw new Error(
      `technique "${technique}" needs questions with a ${kind} and the bank has ` +
      `none in its pool (${pool.length} candidates, ${pool.filter(r => !figuresKnown(r)).length} ` +
      `of them undetermined). Re-check the type list before shipping it -- a rep ` +
      `that does not exercise the thing being drilled trains nothing.`
    );
  }
  return hits;
}

const usedPath = `${ROOT}/state/used_questions.json`;
export const loadUsed = () => existsSync(usedPath) ? JSON.parse(readFileSync(usedPath, 'utf8')) : {};
/**
 * Would writing `qids` under `stem` destroy another sheet's record?
 *
 * Pure: the used map in, a conflict or null out. Returns null when the key is
 * new or already holds exactly this set of questions (a stable rebuild of the
 * same sheet, which is the normal case and must stay frictionless). Returns
 * { stem, previous, next, overlap } when the key holds a DIFFERENT set.
 *
 * Why it exists (issue 2026-11-01): build_rw_set derived its stem from the
 * skill list, so a second set over the same skills got the same key.
 * saveUsed() then replaced the first set's twenty qids with the new eleven --
 * and because spokenFor() skips the current stem's own entry, five of the
 * eleven were questions the first set had already served. Silent: the build
 * reported success. build_sweep's `SW-<skill>` stem has the same shape, so the
 * guard lives here, under every builder, rather than in one of them.
 */
export function stemConflict(used, stem, qids) {
  const prev = used[stem];
  if (!prev) return null;
  const a = new Set(prev), b = new Set(qids);
  if (a.size === b.size && [...a].every(q => b.has(q))) return null;
  return { stem, previous: prev, next: qids, overlap: qids.filter(q => a.has(q)) };
}

export const describeConflict = (c) =>
  `state/used_questions.json already has "${c.stem}" with ${c.previous.length} DIFFERENT questions ` +
  `(${c.overlap.length} of the ${c.next.length} just chosen were served by it).\n` +
  `Writing would erase that sheet's record and re-serve its questions.\n` +
  `  - a NEW sheet: give it a unique name (build_rw_set --name RW-<label>-<date>)\n` +
  `  - deliberately REPLACING that sheet's questions: pass --rebuild\n` +
  `Nothing was built and no state was touched.`;

/**
 * Refuse, before anything is rendered, to build a sheet whose save would
 * overwrite a different record. Call it right after selection -- before a
 * --dry exit, so a dry run shows the collision too, and before buildNote, so a
 * refused build leaves no .note behind.
 *
 * On --dry it WARNS and carries on: a dry run consumes nothing, and the plan is
 * still worth seeing (the build_mixed suite dry-runs `--series 3` against a
 * record whose picks have since moved). The real run is the one that refuses.
 */
export function claimStem(stem, qids, { rebuild = false, dry = false } = {}) {
  const c = stemConflict(loadUsed(), stem, qids);
  if (!c) return;
  if (rebuild) {
    console.log(`--rebuild: replacing "${stem}" (${c.previous.length} questions -> ${c.next.length}, ${c.overlap.length} kept)`);
    return;
  }
  if (dry) {
    console.error(`WARNING (--dry): a real run would be REFUSED.\n${describeConflict(c).replace(/\nNothing was built.*$/, '')}`);
    return;
  }
  console.error(describeConflict(c));
  process.exit(1);
}

export function saveUsed(stem, qids, { rebuild = false } = {}) {
  if (!qids.length) return;
  const used = loadUsed();
  // Backstop for a builder that forgot claimStem(). Throwing here is late -- the
  // .note already exists -- but late is better than a silently erased record.
  const c = stemConflict(used, stem, qids);
  if (c && !rebuild) throw new Error(describeConflict(c));
  used[stem] = qids;
  mkdirSync(`${ROOT}/state`, { recursive: true });
  writeFileSync(usedPath, JSON.stringify(used, null, 1));
}
/**
 * Questions spoken for by OTHER sheets.
 *
 * Excluding a sheet's own entry is deliberate and was a bug before: with it
 * included, rebuilding a sheet skipped the very questions it already contains
 * and picked twelve different ones. That silently broke the reproducibility the
 * push safety check relies on — push compares checksums to tell an untouched
 * remote sheet from one written on, so a rebuild that legitimately differed
 * looked exactly like handwriting.
 */
export const spokenFor = (exceptStem) =>
  new Set(Object.entries(loadUsed()).filter(([k]) => k !== exceptStem).flatMap(([, v]) => v));

// setContent gives the page an about:blank origin, which blocks file:// subresources —
// the images silently render as broken icons. Inline them instead.
export const dataUri = (path) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;

const imgDir = `${ROOT}/out/img`;
/**
 * The cache key is every input the crop depends on, not just the question id.
 *
 * `<qid>-q.png` was not enough. When the page-number bug was fixed, the crops on
 * disk still carried the OLD page numbers -- 03ff48d2-q.png held question
 * e11294f9, with its answer showing, because the crop line belonged to a
 * different page -- and `if (existsSync(out)) return` served them straight back
 * into the next sheet. A corrected index and a poisoned cache look identical
 * from inside the pipeline. Naming the file after the page and the crop line
 * means a corrected index simply cannot hit a stale file.
 */
const cropName = (q, suffix) =>
  `${imgDir}/${q.qid}-p${q.pages[0]}y${Math.round(q.crop_y)}q${Math.round(q.question_y ?? 0)}-${suffix}.png`;

// The question band runs from just under the metadata table to just over the
// answer line. Both guards are small and explicit: 10pt above the "Question"
// label keeps the label itself with a little headroom, 12pt above the answer
// line clears its ascenders — the same guard pdfcrop uses everywhere else.
const LABEL_GUARD = 10, ANSWER_GUARD = 12;

// Crop resolution. At 2.6 a trimmed page is 1508px wide and lands in roughly
// 1730 device pixels on the Manta, so it was being UPSCALED -- soft text that no
// amount of resizing on the page could recover. 3.2 clears device resolution
// with headroom, which costs disk and nothing else.
const CROP_SCALE = '3.2';

/**
 * Crops a question into three images: the bank's metadata header, the question
 * itself, and the rationale.
 *
 * The header is separated rather than dropped. On the question page it primes the
 * answer — it names the domain and the skill, which is exactly the recognition
 * step being timed, and prints a difficulty the real test never shows. On the
 * solution page it costs nothing, and it keeps the Question ID visible in an
 * image somewhere in every notebook, which is the check that a crop matches its
 * label.
 */
export function cropImages(q) {
  mkdirSync(imgDir, { recursive: true });
  const pdf = `${ROOT}/bank/${q.file}`;
  const hPng = cropName(q, 'h');
  const qPng = cropName(q, 'q');
  const aPng = cropName(q, 'a');
  // Every argument explicit. An earlier version had a helper that always passed
  // crop_y as the sixth argument and appended the rest, so a band crop asked for
  // the strip between crop_y and crop_y+12 -- a sliver containing nothing but the
  // "Correct Answer" line. It built without complaint and the overflow guard
  // passed; only rendering the page and looking at it showed a question page with
  // no question on it.
  const crop = (out, args) => {
    if (existsSync(out)) return;
    runSwift(`${ROOT}/tools/pdfcrop.swift`, [pdf, q.pages[0], out, CROP_SCALE, ...args]);
  };
  const PAGE_TOP = 100000;   // clamped to the media box inside pdfcrop

  if (q.question_y == null) {
    // No located stem top means no safe band, so keep the whole page above the
    // answer line rather than guessing an edge.
    crop(qPng, ['above', q.crop_y]);
  } else {
    crop(qPng, ['band', q.crop_y + ANSWER_GUARD, q.question_y + LABEL_GUARD]);
    crop(hPng, ['band', q.question_y + LABEL_GUARD, PAGE_TOP]);
  }
  crop(aPng, ['below', q.crop_y]);
  const extra = q.pages.slice(1).map((pg, i) => {
    const out = cropName(q, `a${i + 2}p${pg}`);
    if (!existsSync(out)) runSwift(`${ROOT}/tools/pdfcrop.swift`, [pdf, pg, out, CROP_SCALE, 'full', '0']);
    return out;
  });
  return { qPng, aPng, hPng: q.question_y == null ? null : hPng, extra };
}

/**
 * Appended to an answer page's <h2> when the rationale runs onto a
 * continuation page. Without it a two-page question's answer page shows
 * "Correct Answer: B" and then white space, and reads as a missing rationale --
 * RW H1 Q20 (3233c162) was filed as exactly that on 2026-10-19, although the
 * rationale was on the very next page all along.
 */
export const overleaf = (extra) =>
  extra?.length ? ' <span class="overleaf">rationale continues overleaf &rarr;</span>' : '';

// ---- page shell ------------------------------------------------------------
export const CSS = `
@page { size: ${PAGE_W_MM}mm ${PAGE_H_MM}mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: "Iowan Old Style", "Palatino", Georgia, serif; color: #000;
       -webkit-font-smoothing: none; }
.page { width: ${PAGE_W_MM}mm; height: ${PAGE_H_MM}mm; position: relative; overflow: hidden;
        padding: ${M_TOP}mm ${M_RIGHT}mm ${M_BOTTOM}mm ${M_LEFT}mm;
        page-break-after: always; display: flex; flex-direction: column; }
.body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.body > :not(.workspace) { flex: 0 0 auto; }
h1 { font-size: 8.4mm; margin: 0 0 1mm; letter-spacing: -0.2mm; }
h1.long { font-size: 6.0mm; line-height: 1.12; }
h2 { font-size: 6.0mm; margin: 0 0 2.5mm; padding-bottom: 1mm; border-bottom: 0.4mm solid #000; }
h2 .overleaf { font-size: 3.6mm; font-weight: 400; font-style: italic; white-space: nowrap; }
h3 { font-size: 5.0mm; margin: 4mm 0 1.5mm; }
p, li, td, th { font-size: 4.3mm; line-height: 1.5; margin: 0 0 2.2mm; }
li { margin-bottom: 1.2mm; }
ul, ol { margin: 0 0 2.5mm; padding-left: 6mm; }
strong { font-weight: 700; }
em { font-style: italic; }
code { font-family: "SF Mono", Menlo, monospace; font-size: 3.9mm; background: #eee;
       padding: 0 0.6mm; border-radius: 0.6mm; }
pre { font-family: "SF Mono", Menlo, monospace; font-size: 4.1mm; line-height: 1.45;
      background: #f2f2f2; border-left: 0.8mm solid #000; padding: 2mm 3mm;
      margin: 0 0 2.8mm; white-space: pre-wrap; }
blockquote { margin: 0 0 2.8mm; padding: 2mm 3mm; border-left: 0.8mm solid #666;
             background: #f7f7f7; }
blockquote p { margin: 0; }
table { border-collapse: collapse; width: 100%; margin: 0 0 2.8mm; }
th, td { border: 0.3mm solid #000; padding: 1.4mm 2mm; text-align: left; margin: 0; }
th { background: #e8e8e8; font-weight: 700; }
/* A whole number of 5 mm cells, never a fraction of one: a half cell at the edge
   reads as a rendering fault rather than a margin. The content column is
   162.6 - 14 - 6 = 142.6 mm, so the grid is 140 mm -- 28 cells -- and is centred
   rather than left-aligned, because it is now narrower than everything above it.
   The height is snapped the same way, per page, in buildNote: it depends on how
   tall that page's question image turned out and cannot be known here. */
.workspace { width: ${GRID_W_MM}mm; margin: 3mm auto 0; flex: 1 1 auto;
  /* 5mm squared grid. The page is for maths, not prose, so columns matter as much
     as rows -- ruled lines only constrain one axis. Cell size, line weight and
     colour are all derived above; see the note there for why they are what they
     are. */
  background-color: #fff;
  background-image:
    repeating-linear-gradient(to right,  ${GRID_COLOUR} 0 ${GRID_LINE_MM}mm, transparent ${GRID_LINE_MM}mm ${GRID_MM}mm),
    repeating-linear-gradient(to bottom, ${GRID_COLOUR} 0 ${GRID_LINE_MM}mm, transparent ${GRID_LINE_MM}mm ${GRID_MM}mm);
  background-position: 0 0; }
  /* No closing border. The box is a whole number of cells plus one line width, so
     the gradient draws its own final line at the far edge and every line on the
     page comes from the same mechanism.
     This was measured as WORSE once, back when pages were rasterised oversize and
     resized down: that last line did not sit on the resampling grid. With the
     resize gone it is exact, and a border painted over a border-box edge landed
     two pixels short of where the arithmetic said, leaving one 57-pixel column
     against 59 everywhere else -- a narrow strip that was visible on the device. */
/* Bank images bleed into the right margin. The left margin is 14mm because the
   device's own toolbar lives there and cannot be written under; the right is only
   6mm and is ours to spend, so an image takes all but 3mm of it. */
.qb { width: calc(100% + 3mm); max-width: none; display: block; margin: 0 -3mm 2mm 0; }
/* The bank's metadata header, shown on the solution page only. Small: it is
   there for reference and for the Question ID, not to be read. */
.sweeph { max-height: 18mm; object-fit: contain; object-position: left top;
          margin-bottom: 3mm; }
.placeholder { border: 0.6mm dashed #000; padding: 3mm; margin: 3mm 0; background: #fafafa; }
.foot { flex: 0 0 auto; font-size: 3.1mm; color: #888; text-align: right;
        border-top: 0.3mm solid #ddd; padding-top: 1mm; }
.session2 .foot::before { content: "session 2 · "; }

/* Typeset maths sits a shade large next to this serif body text at default size,
   and display maths needs air around it rather than KaTeX's web-page margins. */
.katex { font-size: 1.02em; }
.katex-display { margin: 3mm 0; }

/* --- sweep --------------------------------------------------------------- */
/* The time box is the whole point of a sweep sheet: without a number, "slow" is
   an adjective and the pivot to speed cannot be checked. It sits top-right of
   the question, before the working, so filling it in is the act of turning the
   page. */
.qhead { display: flex; align-items: flex-start; justify-content: space-between;
         gap: 4mm; margin: 0 0 2.5mm; padding-bottom: 1mm; border-bottom: 0.4mm solid #000; }
.qhead h2 { border: 0; margin: 0; padding: 0; }
.timebox { flex: 0 0 auto; border: 0.5mm solid #000; border-radius: 1mm;
           padding: 1mm 2mm 1.4mm; text-align: center; min-width: 30mm; }
.timebox .lab { font-size: 2.9mm; letter-spacing: 0.3mm; text-transform: uppercase; color: #000; }
.timebox .rule { border-bottom: 0.35mm solid #000; height: 7mm; margin: 0.6mm 1mm 0.8mm; }
.timebox .unit { font-size: 3.1mm; color: #444; }
/* The self-review block, on the solution page.
   Right/wrong ticks are gone: the answer key scores that, and the time box plus
   the outcome says everything "knew it but slow" said. What is left is the one
   thing no file can reconstruct -- what happened in your head -- and it is asked
   as a closed set because each option implies a different remedy, with a free
   line because the best content on the first sweep was unprompted notes
   like having forgotten how a kind of equation works, or having misunderstood
   the question. */
.selfreview { margin: 3mm 0 0; border-top: 0.4mm solid #000; padding-top: 2mm; }
.srhead { font-size: 3.2mm; letter-spacing: 0.3mm; text-transform: uppercase;
          color: #444; margin: 0 0 1.8mm; }
.srgrid { display: flex; flex-wrap: wrap; }
.srgrid span { font-size: 3.7mm; width: 50%; margin-bottom: 1.4mm; }
.srgrid .box { display: inline-block; width: 4.4mm; height: 4.4mm;
               border: 0.4mm solid #000; margin-right: 1.6mm; vertical-align: -0.8mm; }
.srlabel { font-size: 3.0mm; color: #666; font-style: italic; margin: 1.6mm 0 0; }
.srwrite { margin-top: 0.5mm; border-bottom: 0.3mm solid #888; height: 7mm; }
/* Two lines, not one. Writing kept running past the end of the single rule and
   into the footer -- and that line is consistently the most useful thing on the
   sheet, so it should not be the most cramped. */
.srwrite2 { margin-top: 3.5mm; border-bottom: 0.3mm solid #888; height: 7mm; }
.typetag { font-size: 4.0mm; margin: 0 0 2mm; }
.typetag .k { font-size: 3.0mm; letter-spacing: 0.3mm; text-transform: uppercase; color: #555; }
`;

export const timeBox = () =>
  `<div class="timebox"><div class="lab">time</div><div class="rule"></div><div class="unit">seconds</div></div>`;

export const page = ({ inner, foot, cls = '' }) =>
  `<section class="page${cls ? ' ' + cls : ''}"><div class="body">${inner}</div>
    <div class="foot">${foot}</div></section>`;

/**
 * The last page of every notebook.
 *
 * Without one you risk flipping past the end and creating a new page on
 * the device, which then has to be cleaned up before the notebook can be pushed
 * again -- a written page is a page push refuses to replace.
 */
export const endPage = (id) => page({
  inner: `<h1>End of sheet</h1>
    <p><em>Nothing after this page. Don't turn over — a new page here has to be
    deleted before this notebook can be updated.</em></p>`,
  foot: `${esc(id)} · end`,
});

export const document_ = (pagesHtml) =>
  `<!doctype html><meta charset="utf-8"><style>${katexCss()}</style><style>${CSS}</style>${pagesHtml.join('\n')}`;

// ---- build -----------------------------------------------------------------
/**
 * Rasterise each page at exactly device resolution.
 *
 * xiehanzi's renderPageBitmaps deliberately renders a shade oversize and resizes
 * down, because its own sheets are not a 4:3 page. Ours now are, so the resize is
 * pure loss: it is what smeared the grid's cell period and what was softening the
 * question crops. This does the same job without it, and refuses rather than
 * resizing if a page does not land exactly on 1920x2560.
 */
async function renderPages(html) {
  const { chromium } = await import(XMOD('playwright/index.mjs'));
  const { decodePng } = await import(XMOD('image-js/lib/index.js'));
  const { rasterToPalette } = await import(`${X}/render/bitmap.js`);
  const { encodeRle } = await import(`${X}/deliver/note/rle.js`);
  const { PAGE_WIDTH, PAGE_HEIGHT } = await import(`${X}/deliver/note/write.js`);

  const cssW = (PAGE_W_MM / 25.4) * 96;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: Math.ceil(cssW), height: Math.ceil((PAGE_H_MM / 25.4) * 96) },
    deviceScaleFactor: PAGE_WIDTH / cssW,
  });
  const pg = await ctx.newPage();
  await pg.setContent(html, { waitUntil: 'load' });
  await pg.emulateMedia({ media: 'print' });
  const out = [];
  for (const el of await pg.locator('.page').all()) {
    const img = decodePng(await el.screenshot({ type: 'png' }));
    // Chromium rounds an element's clip rect outward, so a page that is 1920 wide
    // by construction arrives 1921x2562. CROP the extra rather than resize it:
    // the surplus is a pixel or two of blank margin, and cropping is exact where
    // resizing is the resampling this function exists to avoid. Anything SHORT is
    // a real geometry error and is refused.
    if (img.width < PAGE_WIDTH || img.height < PAGE_HEIGHT) {
      await browser.close();
      throw new Error(`page rasterised at ${img.width}x${img.height}, smaller than ` +
        `${PAGE_WIDTH}x${PAGE_HEIGHT}. Page geometry and device aspect have drifted apart.`);
    }
    let { data, channels } = img;
    if (img.width !== PAGE_WIDTH || img.height !== PAGE_HEIGHT) {
      const cropped = new data.constructor(PAGE_WIDTH * PAGE_HEIGHT * channels);
      for (let y = 0; y < PAGE_HEIGHT; y++) {
        const from = y * img.width * channels;
        cropped.set(data.subarray(from, from + PAGE_WIDTH * channels), y * PAGE_WIDTH * channels);
      }
      data = cropped;
    }
    out.push(encodeRle(rasterToPalette(data, channels)));
  }
  await browser.close();
  return out;
}

/**
 * Overflow check, then render, then write. `.page` has overflow:hidden, so text
 * running past the bottom is silently clipped: it looks right here and is simply
 * missing on the device. Refusing to build is the only honest response.
 */
export async function buildNote(html, { stem, outDir, seed = stem, carryFrom = null }) {
  mkdirSync(outDir, { recursive: true });
  // Read the handwriting FIRST: a page already written on must keep the
  // layout its ink was written over.
  let carried = [];
  if (carryFrom) {
    const { readNote } = await import(`${X}/deliver/note/read.js`);
    carried = readNote(readFileSync(carryFrom)).pages.map(p => p.writing);
  }
  // Every bank image trimmed to its ink and drawn up to 1.6x larger, before the
  // workspace is measured -- the grid takes whatever room the enlarged image
  // leaves. See legible.mjs for why: two R06 drills lost to misread digits.
  //
  // EXCEPT on a carried page with a writing layer. Enlarging moves the question
  // and the workspace by centimetres, not the pixel-level drift accepted for
  // --carry, and the working would land on the wrong lines. Those
  // pages keep the old rendering; unwritten and appended pages get the new one.
  const inked = new Set(carried.flatMap((w, i) => (w ? [i] : [])));
  html = legibleImages(html, { skipPages: inked });

  const { chromium } = await import(XMOD('playwright/index.mjs'));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 615, height: 819 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();

  // ---- snap each workspace to a whole number of grid cells -----------------
  // The width is fixed in CSS, but the height is whatever the flex box has left
  // over, and that depends on how tall this page's question image came out. So
  // it is measured, floored to a multiple of 5 mm, and baked back in as an
  // explicit height. Laying out twice is the price of never printing a half cell.
  let wsN = 0;
  html = html.replace(/class="workspace"/g, () => `class="workspace" data-ws="${wsN++}"`);
  await pg.setContent(html, { waitUntil: 'load' });
  await pg.emulateMedia({ media: 'print' });
  const measured = await pg.evaluate(([grid, line]) => {
    // mm are not a CSS unit the DOM reports back, so calibrate against a probe
    // rather than assuming a px-per-mm from the viewport arithmetic.
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:100mm';
    document.body.appendChild(probe);
    const pxPerMm = probe.getBoundingClientRect().height / 100;
    probe.remove();
    return [...document.querySelectorAll('.workspace')].map(el => ({
      i: Number(el.dataset.ws),
      // Same correction as the width: whole cells, then the closing border.
      mm: Math.floor(el.getBoundingClientRect().height / pxPerMm / grid) * grid + line + 0.04,
      cells: Math.floor(el.getBoundingClientRect().height / pxPerMm / grid),
    }));
  }, [GRID_MM, GRID_LINE_MM]);

  const tooSmall = measured.filter(m => m.cells < 2);
  if (tooSmall.length) {
    console.error(`WORKSPACE — ${tooSmall.length} grid area(s) snap to under two cells:`);
    for (const t of tooSmall) console.error(`  workspace ${t.i}: ${t.cells} cells`);
    console.error('The page has no usable room to write. Split it in the source.');
    process.exit(1);
  }
  for (const m of measured) {
    // Merge into any style already on the element rather than adding a second
    // style attribute: a target sheet's WORKSPACE marker emits min-height, and a
    // duplicate attribute is resolved by the parser rather than by us. min-height
    // is zeroed explicitly, or a percentage minimum would override the snap.
    html = html.replace(
      new RegExp(`data-ws="${m.i}"(\\s+style="([^"]*)")?`),
      () => `data-ws="${m.i}" style="min-height:0;height:${m.mm}mm;flex:0 0 auto"`);
  }
  writeFileSync(join(outDir, `${stem}.html`), html);

  // ---- overflow, against the final HTML ------------------------------------
  await pg.setContent(html, { waitUntil: 'load' });
  await pg.emulateMedia({ media: 'print' });
  const over = await pg.evaluate(() => [...document.querySelectorAll('.page')]
    .map((el, i) => {
      const body = el.querySelector('.body');
      return { i: i + 1, over: Math.round(body.scrollHeight - body.clientHeight) };
    }).filter(x => x.over > 2));
  await b.close();
  if (over.length) {
    console.error('OVERFLOW — content clipped on these pages:');
    for (const o of over) console.error(`  page ${o.i}: ${o.over}px past the bottom`);
    console.error('Split the page in the source. Refusing to build a sheet with hidden text.');
    process.exit(1);
  }
  console.log('overflow check: all pages fit');

  const backgrounds = await renderPages(html);
  const { writeNote } = await import(`${X}/deliver/note/write.js`);
  // Seeded by the stem so regenerating an unchanged sheet reproduces the same
  // bytes — push compares checksums to tell an untouched sheet from one written on.
  if (carryFrom) {
    console.log(`carrying handwriting from ${carried.length} pages (${inked.size} with a writing layer) ` +
      `into ${backgrounds.length}`);
    if (carried.length > backgrounds.length) {
      throw new Error(`the existing notebook has ${carried.length} pages and the rebuild has ` +
        `${backgrounds.length}. Appending only ever grows a notebook; a shorter rebuild would ` +
        `drop handwriting off the end.`);
    }
  }
  const note = writeNote(
    backgrounds.map((background, i) => carried[i] ? { background, writing: carried[i] } : { background }),
    { seed });
  const outPath = join(outDir, `${stem}.note`);
  writeFileSync(outPath, note);
  console.log(`pages: ${backgrounds.length}`);
  console.log(`html:  ${join(outDir, stem + '.html')}`);
  console.log(`note:  ${outPath}  (${(note.length / 1024).toFixed(0)} KB)`);
  return { outPath, pages: backgrounds.length };
}

/**
 * Number each QUESTIONS label across ALL its markers, not within each one.
 *
 * Mutates the specs in place, adding `labelStart` and `labelTotal`. Specs
 * carrying no `qids` (a BANK marker) are left alone.
 *
 * Two follow-ups on separate pages are two markers, and each used to count its
 * own list -- so R05's two follow-up pages were both headed "Follow-up 1 / 1".
 * The numbering is the only thing on the page telling the learner where they
 * are in a set, and "1 / 1" on the second of two is a small lie on a sheet whose whole
 * value is that what is printed can be trusted.
 *
 * MUST be called with specs in DOCUMENT order. build_note expands them
 * reversed, splicing pages in from the end so earlier indices stay valid, and
 * numbering computed in that order would count backwards.
 */
export function numberLabels(specs) {
  const totals = new Map();
  for (const spec of specs) {
    if (!spec.qids?.length) continue;
    totals.set(spec.label, (totals.get(spec.label) ?? 0) + spec.qids.length);
  }
  const seen = new Map();
  for (const spec of specs) {
    if (!spec.qids?.length) continue;
    spec.labelStart = seen.get(spec.label) ?? 0;
    seen.set(spec.label, spec.labelStart + spec.qids.length);
    spec.labelTotal = totals.get(spec.label);
  }
  return specs;
}
