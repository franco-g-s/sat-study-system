// Enumerate Khan's digital-SAT math lessons, then pull each article's text.
// Uses the Chromium already installed for xiehanzi. Reads only; nothing is redistributed.
import { join } from 'node:path';
import { ROOT as REPO, XMOD } from './config.mjs';
const { chromium } = await import(XMOD('playwright/index.mjs'));
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const ROOT = 'https://www.khanacademy.org/test-prep/v2-sat-math';
const mode = process.argv[2] ?? 'index';

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent:
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
const page = await ctx.newPage();

async function textOf(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3500);
  return page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    main.querySelectorAll('script,style,noscript,nav,header,footer').forEach(n => n.remove());
    return main.innerText.replace(/\n{3,}/g, '\n\n');
  });
}

if (mode === 'index') {
  await page.goto(ROOT, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .map(a => ({ href: a.getAttribute('href'), text: (a.innerText || '').trim() }))
      .filter(l => l.href && l.href.includes('/v2-sat-math/')));
  writeFileSync('/tmp/khan_links.json', JSON.stringify(links, null, 1));
  const lessons = links.filter(l => /\/a\/v2-sat-lesson-/.test(l.href));
  console.log(`links on course page: ${links.length}`);
  console.log(`direct lesson articles: ${lessons.length}`);
  const units = [...new Set(links.map(l => (l.href.match(/\/v2-sat-math\/([^/]+)/) || [])[1]).filter(Boolean))];
  console.log(`units: ${units.length}`);
  units.forEach(u => console.log('  ' + u));
}
if (mode === 'fetch') {
  const map = JSON.parse(readFileSync(join(REPO, 'tools', 'khan_map.json'),'utf8'));
  const tier = process.argv[3] ?? 'medium';
  mkdirSync(join(REPO, 'reference', 'khan'), { recursive: true });
  const H = 'x0fcc98a58ba3bea7';
  for (const [id, m] of Object.entries(map)) {
    if (!m || id.startsWith('_')) continue;
    const url = `${ROOT}/${H}:${m.unit}-${tier}/${H}:${m.slug}-${tier}/a/v2-sat-lesson-${m.slug}`;
    try {
      const t = await textOf(url);
      const bad = t.length < 800 || /Page not found|Oops/i.test(t.slice(0, 400));
      writeFileSync(`${REPO}/reference/khan/${id}-${m.slug}-${tier}.txt`, `SOURCE: ${url}\n\n${t}`);
      console.log(`${bad ? 'THIN ' : 'ok   '} ${id} ${m.slug}-${tier}  ${t.length} chars`);
    } catch (e) { console.log(`FAIL  ${id} ${m.slug}-${tier}  ${e.message.slice(0,60)}`); }
  }
}
await browser.close();
