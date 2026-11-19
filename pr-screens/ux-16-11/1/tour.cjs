// Rundvisningen (onboarding-trin "Place your first bid", knappen "Show me how"): trin 1, trin 2 og efter "Done", 390 og 1440.
// Kør med preview-serveren oppe på :5173. Siden genindlæses efter klikket, fordi SPA-skiftet til /auctions fejler i mocken.
const { chromium } = require('playwright');
const OUT = process.env.OUT || require('path').join(__dirname, 'raw');
(async()=>{const b=await chromium.launch();
for (const [vp,o] of [['390',{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}],['1440',{viewport:{width:1440,height:900}}]]) for (const theme of ['light','dark']) {
const c=await b.newContext({...o,colorScheme:theme,locale:'en-US'});
await c.addInitScript((th)=>{localStorage.setItem('cz-theme',th);localStorage.setItem('cz_consent_v1',JSON.stringify({version:1,necessary:true,analytics:false,marketing:false,email_marketing:false,updated_at:new Date().toISOString()}));},theme);
const p=await c.newPage();
await p.goto('http://localhost:5173/dashboard',{waitUntil:'networkidle'}); await p.waitForTimeout(2500);
await p.getByRole('button',{name:/show me how/i}).first().click(); await p.waitForTimeout(1500);
await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(3000);
await p.screenshot({path:`${OUT}/tour-step1-${vp}-${theme}.png`});
const txt=await p.evaluate(()=>[...document.querySelectorAll('[role=dialog],[data-tour-popover],.driver-popover,[class*=tour]')].map(e=>e.innerText.slice(0,300)).join(' | '));
console.log(vp,theme,p.url(),txt.slice(0,400));
const btn=p.getByRole('button',{name:/next|got it|continue|done/i}).first();
try{await btn.click({timeout:3000});await p.waitForTimeout(2000);await p.screenshot({path:`${OUT}/tour-step2-${vp}-${theme}.png`});console.log(' step2',p.url()); await p.getByRole('button',{name:/done/i}).first().click(); await p.waitForTimeout(2000); await p.screenshot({path:`${OUT}/tour-after-done-${vp}-${theme}.png`}); console.log(' after done', p.url(), (await p.evaluate(()=>document.body.innerText)).slice(0,0));}catch(e){console.log(' no next')}
await c.close();}
await b.close();})();
