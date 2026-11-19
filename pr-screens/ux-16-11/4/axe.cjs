// axe-core (WCAG 2.1 AA) pr. side ved 390, lys og mørk. node axe.cjs <ud-fil.json>
const { chromium } = require('playwright');
const { AxeBuilder } = require('../../../frontend/node_modules/@axe-core/playwright');
const fs = require('fs'); const FLAGS = require('./prodflags.cjs');
const PAGES = ['/team','/squads/u23','/riders/rider-1','/training','/training?tab=report','/academy','/scouting','/notifications','/forum','/help','/patch-notes','/roadmap','/profile'];
(async () => { const b = await chromium.launch(); const out = {};
  for (const theme of ['light','dark']) { const ctx = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:theme});
    await ctx.addInitScript(FLAGS); await ctx.addInitScript(t=>{try{localStorage.setItem('cz-theme',t)}catch(e){}}, theme);
    const p = await ctx.newPage();
    for (const path of PAGES) { await p.goto('http://localhost:5173'+path,{waitUntil:'networkidle'}).catch(()=>{}); await p.waitForTimeout(2000);
      const r = await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa']).exclude('nav').analyze();
      out[`${path}|${theme}`] = r.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,ex:v.nodes.slice(0,3).map(n=>(n.any[0]?.message||n.failureSummary||'').slice(0,140)+' @ '+n.target.join(' ').slice(0,80))}));
      console.log(theme, path, out[`${path}|${theme}`].map(v=>`${v.id}:${v.n}`).join(' ')); }
    await ctx.close(); }
  fs.writeFileSync(process.argv[2], JSON.stringify(out,null,1)); await b.close(); })();
