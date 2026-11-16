const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2]; const only = process.argv[3];
const PAGES = [
  ['auctions','/auctions'],['auction-history','/auctions/history'],['transfers','/transfers'],
  ['finance','/finance'],['sponsors','/sponsors'],['board','/board'],['watchlist','/watchlist'],
  ['klub','/klub'],['team','/team'],['rider-profile','/riders/rider-1'],
].filter(p=>!only||only.split(',').includes(p[0]));
const metricsFn = () => {
  const vw = innerWidth; const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
  const small=[]; document.querySelectorAll('a[href],button,[role=button],[role=tab],input:not([type=hidden]),select,[role=checkbox],summary').forEach(el=>{ if(!vis(el))return; const r=el.getBoundingClientRect(); if(r.width<44||r.height<44) small.push({w:Math.round(r.width),h:Math.round(r.height),y:Math.round(r.top+scrollY),t:(el.getAttribute('aria-label')||el.textContent||el.placeholder||'').trim().slice(0,40)});});
  const gold=[...document.querySelectorAll('button,a')].filter(el=>vis(el)&&/cz-accent/.test(el.className)&&/on-accent/.test(el.className)).map(el=>el.textContent.trim().slice(0,40));
  const fr=document.querySelector('tbody tr, [data-testid*=auction-row], [role=row]:not(:first-child)');
  return {docW:document.documentElement.scrollWidth, hScroll:document.documentElement.scrollWidth>vw+1, docH:document.documentElement.scrollHeight, h1:document.querySelector('h1')?.textContent.trim().slice(0,60), firstRowY: fr?Math.round(fr.getBoundingClientRect().top+scrollY):null, smallCount:small.length, small:small.slice(0,40), gold};
};
(async()=>{
  const browser=await chromium.launch(); const res={};
  for (const theme of ['light','dark']) for (const [vp,opts] of [['390',{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}],['1440',{viewport:{width:1440,height:900},deviceScaleFactor:1}]]) {
    const ctx=await browser.newContext({...opts,locale:'en-US'});
    await ctx.addInitScript((t)=>{try{localStorage.setItem('cz_consent_v1',JSON.stringify({version:1,necessary:true,analytics:false,marketing:false,email_marketing:false,updated_at:new Date().toISOString()}));localStorage.setItem('cz-theme',t);localStorage.setItem('cz_onboarding_tour_done','1');}catch(e){}},theme);
    const page=await ctx.newPage();
    for (const [name,path] of PAGES){
      try{await page.goto('http://localhost:5173'+path,{waitUntil:'networkidle',timeout:45000});}catch(e){}
      await page.waitForTimeout(2500); await page.keyboard.press('Escape').catch(()=>{}); await page.waitForTimeout(300);
      const f=`${OUT}/${name}-${vp}-${theme}`;
      await page.screenshot({path:f+'.png'}); if(vp==='390'&&theme==='light') await page.screenshot({path:f+'-full.png',fullPage:true});
      if(theme==='light'){res[`${name}-${vp}`]={url:page.url(),...(await page.evaluate(metricsFn))}; console.log(name,vp,page.url(),res[`${name}-${vp}`].docH,res[`${name}-${vp}`].firstRowY,res[`${name}-${vp}`].smallCount);}
    }
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/metrics${only?'-'+only.replace(/,/g,'_'):''}.json`,JSON.stringify(res,null,1)); await browser.close();
})();
