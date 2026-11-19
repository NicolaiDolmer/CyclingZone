// Gennemgang 4/4 (hold og udvikling): billeder + målinger ved 390 og 1440, lys og mørk.
// Kør med preview-serveren på :5173 (npm run dev:preview + falske VITE_SUPABASE_* fra playwright.config).
// node shoot.cjs <ud-mappe> [navn,navn,...]
const { chromium } = require('playwright');
const fs = require('fs');
const FLAGS = require('./prodflags.cjs');
const OUT = process.argv[2]; const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const PAGES = [
  ['team','/team'],['squad-u23','/squads/u23'],['squad-junior','/squads/junior'],['youth-races','/youth-races'],
  ['rider','/riders/rider-1'],['rider-training','/riders/rider-1?tab=training'],['rider-development','/riders/rider-1?tab=development'],['rider-scouting','/riders/rider-1?tab=scouting'],
  ['training','/training'],['training-weekplan','/training?tab=weekplan'],['training-development','/training?tab=development'],['training-report','/training?tab=report'],
  ['academy','/academy'],['graduation','/academy/graduation'],['scouting','/scouting'],
  ['notifications','/notifications'],['forum','/forum'],['forum-post','/forum/forum-post-1'],
  ['help','/help'],['patch-notes','/patch-notes'],['roadmap','/roadmap'],['settings','/profile'],
].filter(([n]) => !ONLY || ONLY.includes(n));
const metricsFn = () => {
  const vw = innerWidth; const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
  const sel = 'a[href],button,[role=button],[role=tab],input:not([type=hidden]),select,textarea,[role=checkbox],[role=switch],summary';
  const small = []; document.querySelectorAll(sel).forEach(el => { if(!vis(el)||el.closest('nav[aria-label]')&&el.closest('nav').getBoundingClientRect().top>innerHeight-80) return; const r = el.getBoundingClientRect(); if (r.width<44||r.height<44) small.push({w:Math.round(r.width),h:Math.round(r.height),y:Math.round(r.top+scrollY),txt:(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||'').trim().slice(0,40)}); });
  const overflow = []; document.querySelectorAll('body *').forEach(el => { if(!vis(el)) return; const r = el.getBoundingClientRect(); if (r.right>vw+1&&r.width<3000) { let p=el.parentElement,clip=false; while(p){const s=getComputedStyle(p); if(['auto','scroll','hidden','clip'].includes(s.overflowX)){if(p.getBoundingClientRect().right<=vw+1){clip=true;break;}} p=p.parentElement;} if(!clip) overflow.push({tag:el.tagName.toLowerCase(),right:Math.round(r.right),txt:(el.textContent||'').trim().slice(0,30)}); }});
  const emoji = (document.body.innerText.match(/\p{Extended_Pictographic}|[→←↔↑↓✓✕✦▲▼ⓘ]/gu)||[]);
  const emdash = (document.body.innerText.match(/ — /g)||[]).length;
  const golds = [...document.querySelectorAll('button,a')].filter(el=>vis(el)&&/bg-cz-accent(\s|$)/.test(el.className.toString())).map(el=>(el.textContent||'').trim().slice(0,30));
  const h1 = document.querySelector('h1'); const firstRow = document.querySelector('main tbody tr, main [role=row]:not(:first-child)');
  const shadows = [...document.querySelectorAll('main *')].filter(el=>vis(el)&&getComputedStyle(el).boxShadow!=='none').length;
  const fonts = new Set(); document.querySelectorAll('main *').forEach(el=>{ if(el.childElementCount===0&&el.textContent.trim()&&vis(el)){ const s=getComputedStyle(el); if(/Bebas/i.test(s.fontFamily)) fonts.add(el.textContent.trim().slice(0,30)); }});
  return { url: location.pathname+location.search, docH: document.documentElement.scrollHeight, hScroll: document.documentElement.scrollWidth>vw+1, h1: h1&&h1.textContent.trim().slice(0,60), h1Y: h1&&Math.round(h1.getBoundingClientRect().top+scrollY), firstRowY: firstRow?Math.round(firstRow.getBoundingClientRect().top+scrollY):null, smallCount: small.length, small: small.slice(0,40), overflow: overflow.slice(0,10), overflowCount: overflow.length, emoji: [...new Set(emoji)].join(''), emdash, golds, shadows, bebas:[...fonts].slice(0,10), errorText: /Something went wrong|Noget gik galt/i.test(document.body.innerText) };
};
(async () => {
  const browser = await chromium.launch(); const res = {};
  const VPS = [['390',{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}],['1440',{viewport:{width:1440,height:900},deviceScaleFactor:1}]];
  for (const theme of ['light','dark']) for (const [vp, opts] of VPS) {
    const ctx = await browser.newContext({...opts, locale:'en-US', colorScheme: theme});
    await ctx.addInitScript(FLAGS); await ctx.addInitScript(t => { try { localStorage.setItem('cz-theme', t); } catch(e){} }, theme);
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0,120)));
    for (const [name, path] of PAGES) {
      errs.length = 0;
      try { await page.goto('http://localhost:5173'+path, {waitUntil:'networkidle', timeout:45000}); } catch(e) {}
      await page.waitForTimeout(2200); await page.keyboard.press('Escape').catch(()=>{}); await page.waitForTimeout(300);
      const key = `${name}-${vp}-${theme}`;
      await page.screenshot({path:`${OUT}/${key}.png`});
      if (theme==='light') await page.screenshot({path:`${OUT}/${key}-full.png`, fullPage:true});
      res[key] = { ...(await page.evaluate(metricsFn)), pageErrors: [...errs] };
      const m = res[key]; console.log(key, m.url, 'h', m.docH, 'row', m.firstRowY, 'small', m.smallCount, 'emoji', m.emoji, 'gold', m.golds.length, errs.length?'ERR':'');
    }
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/metrics${ONLY?'-partial':''}.json`, JSON.stringify(res,null,1)); await browser.close();
})();
