// Renderer skitserne (s1-s5.html) til PNG ved 390 × 844, DPR 2.
// Kør fra repo-roden: node pr-screens/ux-16-11/3/sketches/render.cjs
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  for (const n of ['s1', 's2', 's3', 's4', 's5']) {
    await p.goto('file://' + path.join(__dirname, n + '.html'));
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    const fonts = await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
    await p.screenshot({ path: path.join(__dirname, n + '.png') });
    console.log(n, fonts.join(','));
  }
  await b.close();
})();
