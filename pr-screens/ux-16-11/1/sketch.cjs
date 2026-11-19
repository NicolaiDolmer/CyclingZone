// Før/efter-skitser til de 5 vigtigste fund. "Efter" er den RIGTIGE app i preview-mocken,
// hvor DOM'en er flyttet/omskrevet i browseren (ægte kit, fonte og data, P17). Ingen produktkode ændres.
// Kør: preview-serveren oppe på :5173, derefter `node sketch.cjs` fra denne mappe
// (eller med OUT=<mappe> hvis scriptet køres fra en kopi).
const { chromium } = require('playwright');
const path = require('path');
const { FLAGS, SCEN, initScript } = require('./lib.cjs');
const OUT = process.env.OUT || path.join(__dirname, 'foer-efter');
const BASE = process.env.BASE || 'http://localhost:5173';

// Hjælpere der injiceres i siden.
const HELPERS = () => {
  window.__h = {
    byText(sel, re) { return [...document.querySelectorAll(sel)].find(e => re.test(e.textContent.trim())); },
    card(el) { let p = el; while (p && !(/rounded-cz/.test(p.className || '') && /border/.test(p.className || ''))) p = p.parentElement; return p; },
    btn(re) { return [...document.querySelectorAll('button,a')].find(e => re.test(e.textContent.trim())); },
  };
};

const SKETCHES = [
  {
    file: '01-tilmelding-ejer-toppen',
    title: '1 · Tilmeldingskortet ejer toppen og guldet',
    line: 'En inaktiv manager ser først en spørgeskema-bøn, og guldet sidder på "Set your line-up" længere nede. Efter: kortet står først, og dets knap er sidens ene guld.',
    path: '/dashboard', scen: 'dormant',
    after: () => {
      const { byText, card, btn } = window.__h;
      const survey = card(byText('p,h2,h3,span,div', /^Help me decide what to build next$/)); if (survey) survey.remove();
      const signup = btn(/^Sign up for next season$/); const lineup = btn(/^Set your line-up$/);
      if (signup && lineup) { const c = signup.className; signup.className = lineup.className; lineup.className = c; signup.textContent = 'Keep my spot'; }
    },
  },
  {
    file: '02-velkommen-tilbage',
    title: '2 · "Welcome back": hvad skete der, mens du var væk',
    line: 'Det parkerede hold får én sætning om parkering, men intet om hvad der er sket. Efter: tre linjer om tiden væk og én guld-knap (tallene er eksempler).',
    path: '/dashboard', scen: 'parked',
    after: () => {
      const { byText, card, btn } = window.__h;
      const survey = card(byText('p,h2,h3,span,div', /^Help me decide what to build next$/)); if (survey) survey.remove();
      const h = byText('h2', /^Your team was parked$/);
      h.textContent = 'Welcome back. Your team was parked';
      const body = h.parentElement.querySelector('p');
      if (body) body.textContent = 'Return now and you race again this season, placed by your Global Rank.';
      const ul = document.createElement('ul');
      ul.style.cssText = 'margin:10px 0 0;padding:0;list-style:none;display:grid;gap:6px;font-size:14px;';
      [['Since 12 Oct', '9 races ran without you'], ['Contracts', '2 riders left when their contracts ran out'], ['Balance', '+86,000 CZ$ from sponsors']].forEach(([k, v]) => {
        const li = document.createElement('li'); li.style.cssText = 'display:flex;gap:8px;';
        li.innerHTML = `<span style="color:var(--text-3);min-width:96px">${k}</span><span style="color:var(--text-1);font-variant-numeric:tabular-nums">${v}</span>`;
        ul.appendChild(li);
      });
      (body || h).after(ul);
      const ret = btn(/^Return to the league$/); const lineup = btn(/^Set your line-up$/);
      if (ret && lineup) { const cl = ret.className; ret.className = lineup.className; lineup.className = cl; }
      const sub = card(byText('h2', /^Pick your race squad$/)); if (sub) sub.remove();
    },
  },
  {
    file: '03-ny-spiller-kom-i-gang-foerst',
    title: '3 · Ny spiller: "Get started" først, spørgeskemaet væk',
    line: 'Dag 1 starter med en bøn om at bedømme features, og tjeklisten ligger under folden (y ≈ 1.100 px). Efter: tjeklisten står øverst med næste trin som guld-knap.',
    path: '/dashboard', scen: 'new',
    after: () => {
      const { byText, card, btn } = window.__h;
      const survey = card(byText('p,h2,h3,span,div', /^Help me decide what to build next$/));
      const label = byText('p,h2,h3,span', /^Get started/);
      const gs = card(label) || label.parentElement;
      const wrap = gs.parentElement && /opacity/.test(gs.parentElement.className || '') ? gs.parentElement : gs;
      wrap.classList.remove('opacity-75');
      if (survey) survey.replaceWith(wrap);
      const already = byText('p,div,span', /^This week is already run\.$/); if (already) already.remove();
      const show = btn(/^Show me how$/); const lineup = btn(/^Set your line-up$/);
      if (show && lineup) { const cl = lineup.className; lineup.className = show.className; show.className = cl + ' mt-3'; show.textContent = 'Show me how to bid'; }
    },
  },
  {
    file: '04-login-autofill',
    title: '4 · Login: lad telefonen udfylde, vis kodeordet, vej tilbage',
    line: 'Felterne mangler autocomplete, kodeordsfeltet har falske prikker som pladsholder, og der er ingen vej tilbage til forsiden. Efter: autofill, "Show"-knap og "Home"-link.',
    path: '/login', anon: true,
    after: () => {
      const pw = document.getElementById('auth-password'); pw.placeholder = ''; pw.setAttribute('autocomplete', 'current-password');
      const em = document.getElementById('auth-email'); em.setAttribute('autocomplete', 'username');
      const wrap = pw.parentElement; wrap.style.position = 'relative';
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Show';
      b.style.cssText = 'position:absolute;right:4px;top:' + (pw.offsetTop + pw.offsetHeight / 2) + 'px;transform:translateY(-50%);min-height:44px;min-width:44px;padding:0 12px;font-size:14px;font-weight:600;color:var(--text-2);background:none;border:0;';
      wrap.appendChild(b);
      const home = document.createElement('a'); home.href = '/'; home.textContent = '‹ Home';
      home.style.cssText = 'position:absolute;left:16px;top:16px;min-height:44px;display:flex;align-items:center;padding:0 8px;font-size:14px;color:var(--text-2);';
      document.body.appendChild(home);
      // Autofill-tilstanden: browserens udfyldning vist som udfyldte felter.
      em.value = 'manager@example.com'; pw.value = 'xxxxxxxxxx';
    },
  },
  {
    file: '05-forside-slut-cta',
    title: '5 · Forsiden: "Open beta" uden "launch", og slut med "Create your team"',
    line: 'Siden siger "Open beta · free to play" men slutter med "Get the launch email / Notify me at launch". Efter: slutningen beder om holdet; e-mail er den stille vej.',
    path: '/', anon: true, scrollTo: '^(Get the launch email|Start your team today)$',
    after: () => {
      const { byText } = window.__h;
      const h = byText('h2', /^Get the launch email$/);
      const sec = h.closest('section') || h.parentElement.parentElement;
      // Det inderste element med teksten, så eyebrow-stilen (linje + versaler) bevares.
      const eyebrow = [...document.querySelectorAll('p,span,div')].filter(e => /^Prefer email\?$/.test(e.textContent.trim())).pop();
      if (eyebrow) eyebrow.textContent = 'Ready?';
      h.textContent = 'Start your team today';
      const p = h.nextElementSibling; if (p) p.textContent = 'Free to play, in your browser. Your first race can be this week.';
      const form = sec.querySelector('form');
      const cta = [...document.querySelectorAll('a')].find(a => /^Create your team$/.test(a.textContent.trim()));
      if (form && cta) {
        const box = document.createElement('div'); box.style.cssText = 'display:grid;gap:12px;margin-top:20px;';
        const c = cta.cloneNode(true); c.style.width = '100%'; box.appendChild(c);
        const mail = document.createElement('a'); mail.href = '#'; mail.textContent = 'Or get season news by email';
        mail.style.cssText = 'min-height:44px;display:flex;align-items:center;justify-content:center;color:var(--text-2);text-decoration:underline;font-size:15px;';
        box.appendChild(mail);
        (form.closest('div[class*=border]') || form).replaceWith(box);
      }
    },
  },
];

async function shoot(browser, s, mode) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', colorScheme: 'light', timezoneId: 'Europe/Copenhagen' });
  await ctx.addInitScript(initScript, { flags: FLAGS, scen: s.scen ? SCEN[s.scen] : null, anon: !!s.anon, theme: 'light' });
  await ctx.addInitScript(HELPERS);
  const page = await ctx.newPage();
  try { await page.goto(BASE + s.path, { waitUntil: 'networkidle', timeout: 45000 }); } catch (e) { /* skærmbillede alligevel */ }
  await page.waitForTimeout(2500);
  if (mode === 'after') await page.evaluate(s.after);
  await page.waitForTimeout(300);
  await page.evaluate((src) => {
    if (!src) { window.scrollTo(0, 0); return; }
    const re = new RegExp(src);
    const h = [...document.querySelectorAll('h2')].find(e => re.test(e.textContent.trim()));
    if (h) window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 140);
  }, s.scrollTo || null);
  await page.waitForTimeout(300);
  const buf = await page.screenshot();
  await ctx.close();
  return buf.toString('base64');
}

(async () => {
  const browser = await chromium.launch();
  for (const s of SKETCHES) {
    const before = await shoot(browser, s, 'before');
    const after = await shoot(browser, s, 'after');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#f4f2ec;font-family:'DM Sans',system-ui,sans-serif;color:#0e0f15;width:1000px}
      .band{background:#1a1f38;color:#fff;padding:22px 28px}
      .band h1{margin:0;font-size:26px;font-weight:700;letter-spacing:-.01em}
      .band p{margin:8px 0 0;font-size:16px;line-height:1.4;color:#d9d7e6}
      .row{display:flex;gap:40px;padding:24px 28px 28px;justify-content:center}
      .col{display:flex;flex-direction:column;align-items:center;gap:10px}
      .tag{font-size:15px;font-weight:700;padding:4px 12px;border-radius:999px}
      .b{background:#f3e3e3;color:#a81e1e}.a{background:#e3f0e6;color:#1e6b34}
      img{width:390px;height:844px;border:1px solid #e5e0d5;border-radius:5px;background:#fff}
    </style></head><body><div class="band"><h1>${s.title}</h1><p>${s.line}</p></div>
    <div class="row"><div class="col"><span class="tag b">Før</span><img src="data:image/png;base64,${before}"></div>
    <div class="col"><span class="tag a">Efter (skitse)</span><img src="data:image/png;base64,${after}"></div></div></body></html>`;
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.setContent(html);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${s.file}.png`, fullPage: true });
    await ctx.close();
    console.log('ok', s.file);
  }
  await browser.close();
})();
