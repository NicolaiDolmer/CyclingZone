// Compose a report from untouched browser screenshots; never redraw the UI.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const folder = path.resolve('pr-screens/2230');
const before = JSON.parse(await readFile(path.join(folder, 'before-measurements.json'), 'utf8'));
const after = JSON.parse(await readFile(path.join(folder, 'after-measurements.json'), 'utf8'));
if (before.protocol !== 2 || after.protocol !== 2 || before.browser !== after.browser) throw Error('Incomparable measurement protocol/browser');
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
const names = { landing: 'Forside', 'dashboard-empty': 'Dashboard · tom løbsdag', 'dashboard-race': 'Dashboard · dag med løb', 'dashboard-results': 'Dashboard · sene resultater' };
const rows = [];
for (const scenario of Object.keys(names)) for (const profile of ['desktop', 'mobile']) {
  const samples = [before, after].map(data => data.results.filter(r => r.scenario === scenario && r.profile === profile));
  if (samples.some(group => group.length !== 5)) throw Error('Expected five samples per group');
  rows.push({ scenario, profile, beforeCLS: median(samples[0].map(r=>r.cls)), afterCLS: median(samples[1].map(r=>r.cls)), beforeLCP: median(samples[0].map(r=>r.lcp)), afterLCP: median(samples[1].map(r=>r.lcp)) });
}
const html = `<!doctype html><html lang="da"><meta charset="utf-8"><title>#2230 før/efter</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f3f1;color:#1c2430;font:16px/1.45 Arial,sans-serif}.report{width:1280px;padding:32px;margin:auto}h1{font-size:30px;margin:0 0 8px}h2{font-size:19px;margin:0 0 12px}.sub{color:#4c5663;margin:0 0 22px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}.panel{padding:18px;background:white;border:1px solid #b9bfc6;border-radius:5px}.note{min-height:68px;margin:0 0 12px}.num{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:2px solid currentColor;border-radius:50%;font-weight:bold;margin-right:7px}.mobile{display:block;width:393px;height:852px;margin:auto;border:1px solid #8b939c}.desktop{display:block;width:100%;height:auto;border:1px solid #8b939c}table{width:100%;border-collapse:collapse;background:white;font-variant-numeric:tabular-nums}th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #ccd0d4}th{background:#e4e8ed}footer{margin-top:18px;font-size:14px;color:#4c5663}
</style><main class="report"><h1>Roligere indlæsning · #2230</h1><p class="sub">Rigtige browserskærmbilleder med faste testdata. Annoteringerne ligger uden for billederne; UI-pixels er uændrede.</p>
<div class="pair"><section class="panel"><h2>Før · mobil, mens resultater hentes</h2><p class="note"><span class="num">1</span>Korte skeleton-linjer reserverer mindre plads end den færdige liste.</p><img class="mobile" src="before-mobile-results-loading-viewport.png"></section>
<section class="panel"><h2>Efter · mobil, mens resultater hentes</h2><p class="note"><span class="num">2</span>Stille grå pladsholdere reserverer listens plads. Kortets overskrift og ramme bliver stående.</p><img class="mobile" src="after-mobile-results-loading-viewport.png"></section></div>
<div class="pair"><section class="panel"><h2>Før · desktop, indhold hentet</h2><img class="desktop" src="before-desktop-results-settled-viewport.png"></section><section class="panel"><h2>Efter · desktop, indhold hentet</h2><img class="desktop" src="after-desktop-results-settled-viewport.png"></section></div>
<h2>Sammenlignelig browsermåling · median af fem besøg</h2><table><thead><tr><th>Scenarie</th><th>Profil</th><th>CLS før → efter</th><th>LCP før → efter (ms)</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${names[r.scenario]}</td><td>${r.profile === 'mobile' ? 'Mobil' : 'Desktop'}</td><td>${r.beforeCLS.toFixed(3)} → ${r.afterCLS.toFixed(3)}</td><td>${r.beforeLCP} → ${r.afterLCP}</td></tr>`).join('')}</tbody></table>
<footer>LAB, ikke produktionstal. Chromium ${before.browser}; desktop 1280×900, mobil 393×852; fast ur 11/11/2026 kl.12 UTC; API 300ms, forsinkede resultatkort 3000ms. Resultat-scenariet ruller til kortet under indlæsning. Clarity følges hos spillerne efter release, Search Console over tid. En usædvanligt sen betinget stribe kan stadig flytte indhold, når dens synlighed bliver afgjort.</footer></main></html>`;
await writeFile(path.join(folder, 'comparison.html'), html);
await writeFile(path.join(folder, 'summary.json'), JSON.stringify(rows,null,2)+'\n');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(folder, 'comparison.html')).href);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await page.screenshot({ path: path.join(folder, 'annotated-before-after.png'), fullPage: true });
} finally { await browser.close(); }
console.log('Composed annotated-before-after.png from original browser screenshots. Browser stopped.');
