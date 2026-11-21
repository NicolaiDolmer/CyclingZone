// UX-gennemgang 3/4 (løb), 16/11. Kør med preview-serveren oppe på :5173:
//   VITE_SUPABASE_URL=https://cycling-zone-e2e.supabase.co VITE_SUPABASE_ANON_KEY=e2e-anon-key npm run dev:preview --prefix frontend
//   node pr-screens/ux-16-11/3/shoot.cjs pr-screens/ux-16-11/3/raw [filter]
// Kontakterne følger prod 16/11: de tændte er sande, alt andet falsk (race_page_v6 SLUKKET).
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null;
const ON = ['ability_cap_per_date_enabled','academy_enabled','auto_accept_enabled','board_mandate_model_enabled','champion_jerseys_7824','condition_model_v2','day_form_6649','day_words_7725','development_curve_b','facilities_enabled','first_race_card','market_commitment_6181','peak_planner_enabled','potential_single_number','race_engine_v4','race_form_peaks','race_library_v2','rider_hover_card','rider_why_button','route_profile_hills','sale_escrow_enabled','scout_system_enabled','season_matrix_mobile','season_signup_enabled','stage_page_v2','stage_plan_v1','tactics_ready_7864','talent_marks_7879','training_catalog_v3','training_condition_per_date','training_daily_receipt','training_decision_card','training_fatigue_rules','training_groups','training_mobile_table','training_program_cells','training_programs','training_score_visible','training_train_now','training_train_now_instant','youth_squad_pages'];
const PAGES = [
  ['01-kalender','/planning?tab=calendar'],
  ['02-udtagelse-dag','/planning'],
  ['03-saesonmatrix','/planning?view=season'],
  ['04-formplan','/planning?tab=form'],
  ['05-strategi','/planning?tab=strategy'],
  ['06-loeb-kommende','/races/race-up-1'],
  ['07-loeb-kommende-hold','/races/race-up-1?tab=team'],
  ['08-loeb-kommende-taktik','/races/race-up-1?tab=tactics'],
  ['09-loeb-live-etape','/races/race-live-1'],
  ['10-loeb-live-stilling','/races/race-live-1?tab=standings'],
  ['11-loeb-live-taktik','/races/race-live-1?tab=tactics'],
  ['12-loeb-slut-etape','/races/race-done-2'],
  ['13-loeb-slut-endags','/races/race-done-1'],
  ['14-resultater','/resultater'],
  ['15-resultater-arkiv','/resultater?tab=archive'],
  ['16-resultater-point','/resultater?tab=points'],
  ['17-rangliste-ryttere','/standings?tab=riders'],
  ['18-rangliste-global','/standings?tab=global'],
  ['19-race-centre','/race-centre'],
  ['20-saesonslut','/seasons'],
  ['21-dashboard','/dashboard'],
];
const metricsFn = () => {
  const vw = window.innerWidth;
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; };
  const sel = 'a[href],button,[role=button],[role=tab],input:not([type=hidden]),select,textarea,[role=checkbox],[role=switch],summary';
  const small = [];
  document.querySelectorAll(sel).forEach(el => { if(!vis(el)) return; const r = el.getBoundingClientRect();
    if (r.width<44 || r.height<44) small.push({tag:el.tagName.toLowerCase(), w:Math.round(r.width), h:Math.round(r.height), y:Math.round(r.top+scrollY), txt:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,40)}); });
  const scrollers = []; document.querySelectorAll('body *').forEach(el => { if(!vis(el)) return; const s=getComputedStyle(el);
    if ((s.overflowX==='auto'||s.overflowX==='scroll') && el.scrollWidth > el.clientWidth+2) scrollers.push({tag:el.tagName.toLowerCase(), sw:el.scrollWidth, cw:el.clientWidth, y:Math.round(el.getBoundingClientRect().top+scrollY), txt:(el.textContent||'').trim().slice(0,40)}); });
  const gold = [...document.querySelectorAll('button,a')].filter(el => vis(el) && /bg-cz-accent\b/.test(el.className||'') ).map(el => (el.textContent||'').trim().slice(0,30));
  const firstRow = document.querySelector('main tbody tr, main [role=row]:not(:first-child)');
  const h1 = document.querySelector('h1');
  return { vw, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, hScroll: document.documentElement.scrollWidth>vw+1,
    h1: h1&&h1.textContent.trim().slice(0,60), firstRowY: firstRow? Math.round(firstRow.getBoundingClientRect().top+scrollY):null,
    gold, smallCount: small.length, small: small.slice(0,40), scrollers: scrollers.slice(0,10),
    words: (document.querySelector('main')||document.body).innerText.split(/\s+/).filter(Boolean).length };
};
(async () => {
  const browser = await chromium.launch();
  const res = fs.existsSync(`${OUT}/metrics.json`) ? JSON.parse(fs.readFileSync(`${OUT}/metrics.json`,'utf8')) : {};
  const VPS = [['390',{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}],['1440',{viewport:{width:1440,height:900},deviceScaleFactor:1}]];
  for (const theme of ['light','dark']) for (const [vpName, opts] of VPS) {
    const ctx = await browser.newContext({...opts, locale:'en-US', colorScheme: theme});
    await ctx.addInitScript(([on, theme]) => {
      try {
        localStorage.setItem('cz_consent_v1', JSON.stringify({version:1,necessary:true,analytics:false,marketing:false,email_marketing:false,updated_at:new Date().toISOString()}));
        localStorage.setItem('cz-theme', theme);
      } catch(e){}
      // Prod-kontakter 16/11: pak mockens fetch ind, så /api/feature-flags svarer som prod.
      // Mocken gemmer window.fetch som sin "rigtige" fetch og sætter sin egen bagefter;
      // getteren giver derfor native-varianten indtil mocken er sat, så der ikke opstår en løkke.
      const native = window.fetch.bind(window);
      let inner = null;
      const flagsResponse = () => {
        const flags = {}; on.forEach(k => flags[k] = true); flags.race_page_v6 = false; flags.planning_workbench = false;
        return new Response(JSON.stringify({ flags }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      const isFlags = input => /\/api\/feature-flags(\?.*)?$/.test(typeof input === 'string' ? input : (input && input.url) || String(input || ''));
      const wrapNative = async (input, init) => isFlags(input) ? flagsResponse() : native(input, init);
      const wrapMock = async (input, init) => isFlags(input) ? flagsResponse() : inner(input, init);
      Object.defineProperty(window, 'fetch', { configurable: true, get() { return inner ? wrapMock : wrapNative; }, set(v) { inner = v; } });
    }, [ON, theme]);
    const page = await ctx.newPage();
    for (const [name,path] of PAGES) {
      if (FILTER && !FILTER.test(name)) continue;
      try { await page.goto('http://localhost:5173'+path, {waitUntil:'networkidle', timeout:45000}); } catch(e) {}
      await page.waitForTimeout(2500);
      await page.keyboard.press('Escape').catch(()=>{});
      await page.waitForTimeout(300);
      const tag = `${name}-${vpName}-${theme}`;
      await page.screenshot({path:`${OUT}/${tag}.png`});
      if (theme==='light') await page.screenshot({path:`${OUT}/${tag}-full.png`, fullPage:true});
      res[tag] = { url: page.url(), ...(await page.evaluate(metricsFn)) };
      console.log(tag, res[tag].url.replace('http://localhost:5173',''), 'h', res[tag].docH, 'small', res[tag].smallCount, 'row', res[tag].firstRowY, 'gold', res[tag].gold.length);
    }
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/metrics.json`, JSON.stringify(res,null,1));
  await browser.close();
})();
