import { pathToFileURL } from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
const root='C:/Dev/CyclingZone-worktrees/feat-7951-rytterside-top';
const {chromium}=await import(pathToFileURL(root+'/frontend/node_modules/@playwright/test/index.mjs'));
const fx=await import(pathToFileURL(root+'/frontend/tests/e2e/fixtures.js'));
const out='C:/Dev/CyclingZone-worktrees/feat-7951-rytterside-top/pr-screens/7952-static';mkdirSync(out,{recursive:true});
const scenario=process.env.SCENARIO||'core';
const browser=await chromium.launch();const results=[];
try {
for(const [stage,port,wt] of (process.env.AFTER_ONLY?[['after',51952,'feat-7951-rytterside-top']]:[['before',51951,'codex-6765-queue-baseline-20261109'],['after',51952,'feat-7951-rytterside-top']])){
 for(const [view,width,height,touch] of [['desktop',1280,900,false],['mobile',390,844,true],...(stage==='after'?[['landscape',844,390,true]]:[])]){
 const ctx=await browser.newContext({baseURL:`http://127.0.0.1:${port}`,viewport:{width,height},hasTouch:touch,isMobile:touch});
 const page=await ctx.newPage();const flagAssets=[];page.on('response',r=>{if(/\/assets\/dk-[^/]+\.svg/.test(r.url()))flagAssets.push({url:r.url(),status:r.status()})});await page.goto('/__worktree-id');const id=await page.locator('body').innerText();if(!id.includes(wt))throw Error('foreign server '+id);
 await fx.installNetworkMocks(page);await fx.stabilizePage(page);
 await page.route('**/api/feature-flags',r=>fx.json(r,{flags:{champion_jerseys_7824:true,talent_marks_7879:true}}));
 if(scenario!=='auction')await page.route('**/rest/v1/auctions*',r=>fx.json(r,r.request().headers().accept?.includes('vnd.pgrst.object')?null:[]));
 await page.route('**/rest/v1/transfer_listings*',r=>fx.json(r,scenario==='core'&&r.request().url().includes('rider-2')?{id:'fixture-listing',asking_price:1200000}:null));
 if(scenario==='retirement')await page.route('**/api/riders/*/retirement-status',r=>fx.json(r,{announced_retirement:true,retirement_after_season:1}));
 await page.route('**/api/display-flags',r=>fx.json(r,{rider_reputation_enabled:true}));
 await page.route('**/rest/v1/riders*',r=>{const match=new URL(r.request().url()).searchParams.get('id');const data=(match?fx.RIDERS.filter(x=>x.id===match.replace('eq.','')):fx.RIDERS).map(x=>x.id==='rider-2'?{...x,pending_team_id:null,pending_team:null}:x);return fx.json(r,r.request().headers().accept?.includes('vnd.pgrst.object')?(data[0]??{}):data)});
 await fx.login(page);
 for(const rider of (scenario==='core'?['rider-1','rider-2']:['rider-1'])){
 await page.goto('/riders/'+rider);await page.getByRole('tab',{name:/overblik/i}).waitFor({timeout:60000});await page.waitForTimeout(1200);
 const shot=`${out}/${stage}-${view}-${rider}-${stage==='after'?'final-'+scenario:'baseline-'+scenario}.png`;await page.screenshot({path:shot,fullPage:true});
 const rec={stage,view,width,height,rider,identity:id,screenshot:shot,flagAssets,text:await page.locator('main').innerText().catch(()=>page.locator('body').innerText())};
 if(stage==='after'){
 const marks=page.locator('[data-testid^="champion-jersey-profile"], [data-testid^="talent-mark-profile"]');rec.marks=[];
 for(const m of await marks.all()){await m.scrollIntoViewIfNeeded();const box=await m.boundingBox();await m.click();await page.mouse.move(0,0);await page.waitForTimeout(100);const opened=await page.getByRole('tooltip').count();if(rec.marks.length===0)await page.screenshot({path:`${out}/after-${view}-${rider}-mark-open${process.env.AFTER_ONLY?'-final':''}.png`});await page.keyboard.press('Escape');const afterEscape=await page.getByRole('tooltip').count();await page.keyboard.press('Enter');await page.waitForTimeout(100);const reopened=await page.getByRole('tooltip').count();await page.keyboard.press('Escape');rec.marks.push({name:await m.innerText(),box,opened,afterEscape,reopened,focused:await m.evaluate(e=>e===document.activeElement)});await m.evaluate(e=>e.blur());}
 if(stage==='after' && view==='mobile' && rider==='rider-2' && scenario==='core'){await page.getByTestId('rider-for-sale').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/after-mobile-rider-2-action-final.png`});}
 rec.scrollWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
 }
 results.push(rec);console.log(JSON.stringify({stage,view,rider,shot,marks:rec.marks,scrollWidth:rec.scrollWidth}));
 }
 await ctx.close();
 }
}
}finally{await browser.close();writeFileSync(out+'/observations-'+scenario+'.json',JSON.stringify(results,null,2));}




