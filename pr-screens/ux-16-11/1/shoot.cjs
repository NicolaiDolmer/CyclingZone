// UX-gennemgang 1/4 (16/11): første oplevelse og tilbagevenden.
// Kør med preview-serveren oppe på :5173 (VITE_PREVIEW_MOCK=1 + falske VITE_SUPABASE_* fra playwright.config).
// En fetch-wrapper lægger sig OVEN PÅ preview-mocken og svarer med prod-kontakterne 16/11
// og scenariets tilmeldings-/onboarding-status. Ingen produktkode ændres.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'raw');
const BASE = process.env.BASE || 'http://localhost:5173';
const { FLAGS, SCEN, initScript } = require('./lib.cjs');

const SHOTS = [
  // [navn, sti, scenarie, anonym, handling]
  ['landing', '/', null, true],
  ['login', '/login', null, true],
  ['signup', '/login', null, true, 'signup'],
  ['reset', '/reset-password', null, true],
  ['new-dashboard', '/dashboard', 'new', false],
  ['new-training', '/training', 'new', false],
  ['new-team', '/team', 'new', false],
  ['dormant-dashboard', '/dashboard', 'dormant', false],
  ['parked-dashboard', '/dashboard', 'parked', false],
  ['dormant-notifications', '/notifications', 'dormant', false],
  // Rundvisningen optages af tour.cjs: SPA-skiftet dashboard -> auktioner fejler i mocken (ikke set i Sentry),
  // så tour.cjs genindlæser siden, før trinene fotograferes.
];

(async () => {
  const only = process.argv[2];
  const browser = await chromium.launch();
  const metrics = {};
  const VPS = [['390', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['1440', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }]];
  for (const theme of ['light', 'dark']) for (const [vp, opts] of VPS) for (const [name, p, scenKey, anon, action, mockFlags] of SHOTS) {
    if (only && !name.startsWith(only)) continue;
    const ctx = await browser.newContext({ ...opts, locale: 'en-US', colorScheme: theme, timezoneId: 'Europe/Copenhagen' });
    await ctx.addInitScript(initScript, { flags: mockFlags ? null : FLAGS, scen: scenKey ? SCEN[scenKey] : null, anon, theme });
    const page = await ctx.newPage();
    const t0 = Date.now();
    try { await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 45000 }); } catch (e) {}
    await page.waitForTimeout(2500);
    if (action === 'signup') {
      const b = page.getByRole('button', { name: /create|sign up|opret|register/i }).or(page.getByRole('tab', { name: /create|sign up/i })).first();
      try { await b.click({ timeout: 3000 }); await page.waitForTimeout(800); } catch (e) { console.log('signup toggle not found'); }
    }
    if (action === 'submit') {
      try {
        const inputs = page.locator('form input');
        const vals = ['Example Racing', 'Alex Example', 'alex@example.com', 'secret123'];
        for (let i = 0; i < 4; i++) await inputs.nth(i).fill(vals[i]);
        await page.locator('form button[type=submit]').first().click(); await page.waitForTimeout(2500);
      } catch (e) { console.log('submit failed', e.message); }
    }
    if (action === 'tour2') {
      try { await page.getByRole('button', { name: /show me how/i }).first().click({ timeout: 4000 }); await page.waitForTimeout(2500);
        await page.getByRole('button', { name: /next|got it|continue/i }).first().click({ timeout: 4000 }); await page.waitForTimeout(2000); } catch (e) { console.log('tour2', e.message.slice(0,80)); }
    }
    if (action === 'tour') {
      try { await page.getByRole('button', { name: /show me how/i }).first().click({ timeout: 4000 }); await page.waitForTimeout(2500); } catch (e) { console.log('tour btn not found'); }
    }
    const base = `${OUT}/${name}-${vp}-${theme}`;
    await page.screenshot({ path: `${base}.png` });
    if (theme === 'light') await page.screenshot({ path: `${base}-full.png`, fullPage: true });
    const m = await page.evaluate(() => {
      const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const small = [];
      document.querySelectorAll('a[href],button,[role=button],[role=tab],input:not([type=hidden]),select,[role=checkbox]').forEach(el => { if (!vis(el)) return; const r = el.getBoundingClientRect(); if (r.width < 44 || r.height < 44) small.push({ w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top + scrollY), txt: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 40) }); });
      const heads = [...document.querySelectorAll('h1,h2,h3')].filter(vis).map(h => ({ tag: h.tagName, y: Math.round(h.getBoundingClientRect().top + scrollY), txt: h.textContent.trim().slice(0, 70) }));
      const gold = [...document.querySelectorAll('button,a')].filter(vis).filter(el => /bg-cz-accent(\s|$)/.test(el.className || '')).map(el => ({ y: Math.round(el.getBoundingClientRect().top + scrollY), txt: el.textContent.trim().slice(0, 40) }));
      return { url: location.href, docH: document.documentElement.scrollHeight, hScroll: document.documentElement.scrollWidth > innerWidth + 1, heads, gold, smallCount: small.length, small: small.slice(0, 40), words: (document.body.innerText || '').split(/\s+/).filter(Boolean).length };
    });
    m.loadMs = Date.now() - t0;
    metrics[`${name}-${vp}-${theme}`] = m;
    console.log(name, vp, theme, m.url, 'h', m.docH, 'small', m.smallCount, 'gold', m.gold.length);
    await ctx.close();
  }
  const f = `${OUT}/metrics${only ? '-' + only : ''}.json`;
  fs.writeFileSync(f, JSON.stringify(metrics, null, 1));
  await browser.close();
})();
