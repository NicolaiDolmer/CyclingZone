import { test, expect } from './e2e-base.js';
import type { Page, Route } from '@playwright/test';
import { installNetworkMocks, login, stabilizePage, evidenceShotPath, json, corsHeaders, raceResultsRoute } from './fixtures.js';

const RACE='00000000-0000-4000-8000-000000007864';
const RIDERS=[
  {rider_id:'r1',name:'Rytter Et',race_role:'captain',abandoned:false,stage_fit:{2:70}},
  {rider_id:'r2',name:'Rytter To',race_role:'sprint_captain',abandoned:false,stage_fit:{2:60}},
  {rider_id:'r3',name:'Rytter Tre',race_role:'helper',abandoned:false,stage_fit:{2:95}},
  {rider_id:'r4',name:'Rytter Fire',race_role:'helper',abandoned:false,stage_fit:{2:80}},
];
type RoleOverride={stage_number:number;rider_id:string;race_role:string;effort:string};
type RolesPut={stages:number[];overrides:RoleOverride[]};
type OrderPut={breakaway_stance:string;riders:Array<{rider_id:string;plan:Array<{task:string;from?:{at:string;kom_index?:number}}>}>};
const visible=(locator:ReturnType<Page['locator']>)=>locator.filter({visible:true}).first();
async function multiPlanShot(page:Page,path:string){
  await visible(page.getByTestId('stage-plan-board').getByText('Rytter Et',{exact:true})).evaluate(el=>el.scrollIntoView({block:'center'}));
  await page.screenshot({path:evidenceShotPath(path),scale:'css'});
}

async function setup(page:Page,{on=true,language='da',failOrder=false,mountain=false,conflictRoles=false,multi=false,failFill=false,lostFillResponse=false,concurrentSave=false}:{on?:boolean;language?:string;failOrder?:boolean;mountain?:boolean;conflictRoles?:boolean;multi?:boolean;failFill?:boolean;lostFillResponse?:boolean;concurrentSave?:boolean}={}){
  await stabilizePage(page);
  await page.clock.setFixedTime(new Date('2026-11-10T10:00:00Z'));
  await installNetworkMocks(page);
  let flag=on;
  let served:RoleOverride[]=multi?[]:[{stage_number:3,rider_id:'r4',race_role:'helper',effort:'save'}];
  const savedOrders=new Map<number,OrderPut>(),markers=new Set(multi?[5]:[]);
  const stageCount=multi?6:3;
  const riders=multi?RIDERS.map(r=>({...r,stage_fit:{...r.stage_fit,3:r.rider_id==='r1'?99:50,5:60,6:r.rider_id==='r4'?99:50}})):RIDERS;
  type Fill={source_stage:number;plans:Array<{stage_number:number;overrides:RoleOverride[];order:OrderPut}>};
  const fills:Fill[]=[];
  const rolesPuts:RolesPut[]=[],ordersPuts:OrderPut[]=[];
  const profile=(stage_number:number)=>({race_id:RACE,stage_number,profile_type:multi&&stage_number===4?(mountain?'flat':'high_mountain'):(mountain?'high_mountain':'flat'),finale_type:mountain?'long_climb':'bunch_sprint',distance_km:160,elevation_gain_m:mountain?3200:300,climbs:mountain?(multi&&stage_number!==2?[
    {name:'Destination climb',crest_km:110,length_km:10,avg_gradient:7,category:'1'},
    {name:'Destination summit',crest_km:160,length_km:10,avg_gradient:8,category:'1',summit_finish:true},
  ]:[
    {name:'Col du Premier',crest_km:70,length_km:8,avg_gradient:7,category:'1'},
    {name:'Col du Décisif',crest_km:125,length_km:12,avg_gradient:8,category:'HC'},
    {name:'Mont Final',crest_km:160,length_km:10,avg_gradient:8,category:'1',summit_finish:true},
  ]):[],sprints:[],segments:[{kind:'flat',from_km:0,to_km:160}],weather:{kind:'sun',wind_exposure:0.1}});
  const race={id:RACE,name:'7864 Synthetic Preview',race_type:'stage_race',race_class:'OtherWorldTourA',stages:stageCount,stages_completed:1,edition_year:2026,status:'running',engine_rules_revision:'s5_profiles_v3',season:{id:'season-e2e',number:1},pool_race:null};
  await page.route('**/rest/v1/races**',route=>json(route,(route.request().headers().accept||'').includes('vnd.pgrst.object')?race:[race]));
  await page.route('**/rest/v1/race_results**',raceResultsRoute([]));
  await page.route('**/rest/v1/race_stage_profiles**',route=>json(route,Array.from({length:stageCount},(_,i)=>profile(i+1))));
  await page.route('**/rest/v1/race_stage_schedule**',route=>json(route,[]));
  await page.route('**/api/feature-flags',route=>json(route,{flags:{tactics_ready_7864:flag}}));
  await page.route(`**/api/races/${RACE}/stage-roles`,async(route:Route)=>{
    const request=route.request();
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:corsHeaders(request)});
    if(request.method()==='PUT'){
      const body=request.postDataJSON() as RolesPut;rolesPuts.push(body);
      if(conflictRoles&&rolesPuts.length===1){
        served=[...served.filter(row=>row.stage_number!==2),{stage_number:2,rider_id:'r1',race_role:'helper',effort:'normal'},{stage_number:2,rider_id:'r4',race_role:'captain',effort:'normal'}];
        return route.fulfill({status:409,contentType:'application/json',headers:corsHeaders(request),body:JSON.stringify({error:'stage_roles_conflict'})});
      }
      served=[...served.filter(r=>!body.stages.includes(r.stage_number)),...body.overrides.filter(r=>body.stages.includes(r.stage_number))];
      return json(route,{ok:true});
    }
    return json(route,{enabled:true,intention_enabled:true,valid_efforts:['grupetto','save','normal','protect','all_out'],stages_completed:1,stage_count:stageCount,riders,overrides:served,role_scope_choice:true,special_roles_allowed:true});
  });
  await page.route(`**/api/races/${RACE}/team-orders**`,async(route:Route)=>{
    const request=route.request();
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:corsHeaders(request)});
    if(request.method()==='PUT'){
      const body=request.postDataJSON() as OrderPut;ordersPuts.push(body);
      if(failOrder&&ordersPuts.length===1)return route.fulfill({status:400,contentType:'application/json',headers:corsHeaders(request),body:JSON.stringify({error:'save_failed'})});
      savedOrders.set(Number(new URL(request.url()).pathname.split('/').at(-1)),body);return json(route,{ok:true});
    }
    return json(route,{stage_count:stageCount,stages_completed:1,riders,stage_plan_enabled:true,atomic_stage_save:multi,saved_stage_numbers:[...markers],stages:Array.from({length:stageCount},(_,i)=>({stage_number:i+1,locked:i===0,scheduled_at:null})),orders:[...savedOrders].map(([stage_number,body])=>({stage_number,...body}))});
  });
  await page.route(`**/api/races/${RACE}/tactics-fill`,async(route:Route)=>{
    const request=route.request();
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:corsHeaders(request)});
    const body=request.postDataJSON() as Fill;fills.push(body);
    if(failFill&&fills.length===1)return route.fulfill({status:503,headers:corsHeaders(request),contentType:'application/json',body:JSON.stringify({error:'save_failed'})});
    if(concurrentSave&&fills.length===1){markers.add(6);savedOrders.set(6,{breakaway_stance:'let_go',riders:[]});served=[...served.filter(r=>r.stage_number!==6),{stage_number:6,rider_id:'r2',race_role:'captain',effort:'normal'},{stage_number:6,rider_id:'r1',race_role:'helper',effort:'normal'}];}
    const applied:number[]=[],preserved:number[]=[];
    for(const plan of body.plans){
      if(markers.has(plan.stage_number)||savedOrders.has(plan.stage_number)||served.some(r=>r.stage_number===plan.stage_number)){preserved.push(plan.stage_number);continue;}
      served=[...served,...plan.overrides];savedOrders.set(plan.stage_number,plan.order);markers.add(plan.stage_number);applied.push(plan.stage_number);
    }
    if(lostFillResponse&&fills.length===1)return route.fulfill({status:503,headers:corsHeaders(request),contentType:'application/json',body:JSON.stringify({error:'save_failed'})});
    return json(route,{ok:true,applied,preserved,locked:[]});
  });
  await login(page);
  await page.addInitScript(lang=>localStorage.setItem('cz_lang',lang),language);
  await page.goto(`/races/${RACE}?tab=tactics`);
  await expect(page.getByTestId('stage-plan-board')).toBeVisible();
  return {rolesPuts,ordersPuts,fills,orders:()=>savedOrders,setFlag(value:boolean){flag=value;},served:()=>served};
}

for(const language of ['en','da']){
  test(`#7864 ${language}: presets, price words, active stage save and reload`,async({page},testInfo)=>{
    const width=testInfo.project.use.hasTouch?375:1280;
    await page.setViewportSize({width,height:900});
    const f=await setup(page,{on:false,language});
    await expect(page.getByTestId('team-plan-choices')).toHaveCount(0);
    await expect(page.getByTestId('stage-plan-task-cost')).toHaveCount(0);
    await page.getByTestId('race-tactics-tab').screenshot({path:evidenceShotPath(`pr-screens/7864/${language}-${testInfo.project.name}-before.png`),scale:'css'});
    f.setFlag(true);await page.reload();
    const choices=page.getByTestId('team-plan-choices');await expect(choices).toBeVisible();
    await expect(choices.getByRole('button')).toHaveCount(5);
    await page.getByTestId('team-plan-gc').click();
    await expect(page.getByTestId('team-plan-gc')).toHaveAttribute('aria-pressed','true');
    await page.getByTestId('team-plan-sprint').click();
    await expect(page.getByTestId('team-plan-sprint')).toHaveAttribute('aria-pressed','true');
    await page.getByTestId('team-plan-stage').focus();await page.keyboard.press('Enter');
    await expect(page.getByTestId('team-plan-stage')).toHaveAttribute('aria-pressed','true');
    expect(f.rolesPuts).toHaveLength(0);expect(f.ordersPuts).toHaveLength(0);
    await expect(visible(page.getByTestId('stage-plan-task-cost').filter({hasText:language==='en'?'Very hard':'Meget hård'}))).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for(const button of await choices.getByRole('button').all())expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('race-tactics-tab').screenshot({path:evidenceShotPath(`pr-screens/7864/${language}-${testInfo.project.name}-after.png`),scale:'css'});
    await choices.scrollIntoViewIfNeeded();
    await page.screenshot({path:evidenceShotPath(`pr-screens/7864/${language}-${testInfo.project.name}-choices-viewport.png`),scale:'css'});
    await visible(page.getByTestId('stage-plan-board').getByText('Rytter Tre',{exact:true})).scrollIntoViewIfNeeded();
    await page.screenshot({path:evidenceShotPath(`pr-screens/7864/${language}-${testInfo.project.name}-plan-viewport.png`),scale:'css'});
    const save=page.getByTestId('race-tactics-tab').getByRole('button',{name:language==='en'?'Save stage 2':'Gem etape 2',exact:true});
    await save.click();
    await expect.poll(()=>f.ordersPuts.length).toBe(1);
    expect(f.rolesPuts).toHaveLength(1);expect(f.rolesPuts[0].stages).toEqual([2]);
    expect(f.rolesPuts[0].overrides.find(r=>r.rider_id==='r3')?.race_role).toBe('captain');
    expect(f.rolesPuts[0].overrides.find(r=>r.rider_id==='r2')?.race_role).toBe('helper');
    expect(f.served().find(r=>r.stage_number===3)?.effort).toBe('save');
    expect(f.ordersPuts[0].riders.find(r=>r.rider_id==='r3')?.plan.some(l=>l.task==='attack')).toBe(true);
    await page.reload();
    await expect(visible(page.getByTestId('stage-plan-task-cost').filter({hasText:language==='en'?'Very hard':'Meget hård'}))).toBeVisible();
    await expect(page.getByTestId('stage-plan-board').getByRole('button',{name:/^(Hard|Normal|Easy)$/})).toHaveCount(0);
  });
}

test('#7864 climb names and named decisive attack are visible and saved',async({page},testInfo)=>{
  const width=testInfo.project.use.hasTouch?375:1280;
  await page.setViewportSize({width,height:900});
  const f=await setup(page,{on:false,mountain:true});
  const profile=page.getByTestId('race-stage-profile-row');
  await expect(profile.getByTestId('tactics-climb-names')).toHaveCount(0);
  await profile.evaluate(element=>element.scrollIntoView({block:'center'}));
  await profile.screenshot({path:evidenceShotPath(`pr-screens/7864/climbs-${testInfo.project.name}-before.png`),scale:'css'});
  f.setFlag(true);await page.reload();
  const names=profile.getByTestId('tactics-climb-names');
  for(const name of ['Col du Premier','Col du Décisif','Mont Final'])await expect(names.getByText(name,{exact:true})).toBeVisible();
  await names.getByRole('button',{name:/Col du Premier/}).focus();
  await page.keyboard.press('Enter');
  await expect(profile.locator('p').filter({hasText:/^Col du Premier$/})).toBeVisible();
  for(const name of ['Col du Décisif','Mont Final']){
    await names.getByRole('button',{name:new RegExp(name)}).click();
    await expect(profile.locator('p').filter({hasText:new RegExp(`^${name}$`)})).toBeVisible();
  }
  if(testInfo.project.use.hasTouch)for(const button of await names.getByRole('button').all())expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await profile.evaluate(element=>element.scrollIntoView({block:'center'}));
  await page.screenshot({path:evidenceShotPath(`pr-screens/7864/climbs-${testInfo.project.name}-viewport.png`),scale:'css'});
  await profile.screenshot({path:evidenceShotPath(`pr-screens/7864/climbs-${testInfo.project.name}-after.png`),scale:'css'});
  await page.getByTestId('team-plan-stage').click();
  await page.getByTestId('race-tactics-tab').getByRole('button',{name:'Gem etape 2',exact:true}).click();
  await expect.poll(()=>f.ordersPuts.length).toBe(1);
  expect(f.ordersPuts[0].riders.find(r=>r.rider_id==='r3')?.plan.find(leg=>leg.task==='attack')?.from).toEqual({at:'kom',kom_index:1});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('#7864 partial save keeps the team plan and retries only the missing orders',async({page})=>{
  const f=await setup(page,{failOrder:true});
  await page.getByTestId('team-plan-stage').click();
  const save=page.getByTestId('race-tactics-tab').getByRole('button',{name:'Gem etape 2',exact:true});
  await save.click();await expect.poll(()=>f.ordersPuts.length).toBe(1);
  await expect(page.getByTestId('team-plan-stage')).toHaveAttribute('aria-pressed','true');
  await page.getByTestId('race-tactics-tab').getByRole('button',{name:'Gem resten',exact:true}).click();await expect.poll(()=>f.ordersPuts.length).toBe(2);
  expect(f.rolesPuts).toHaveLength(1);
  expect(f.ordersPuts[1]).toEqual(f.ordersPuts[0]);
});

test('#7864 an accepted server draft replaces the cached captain after conflict',async({page})=>{
  const f=await setup(page,{conflictRoles:true});
  await page.getByTestId('team-plan-gc').click();
  const panel=page.getByTestId('race-tactics-tab');
  await panel.getByRole('button',{name:'Gem etape 2',exact:true}).click();
  await panel.getByRole('button',{name:'Hent den nye',exact:true}).click();
  await expect(page.getByTestId('team-plan-gc')).toContainText('Rytter Fire');
  await page.getByTestId('team-plan-gc').click();
  await panel.getByRole('button',{name:'Gem etape 2',exact:true}).click();
  await expect.poll(()=>f.ordersPuts.length).toBe(1);
  expect(f.served().find(row=>row.stage_number===2&&row.rider_id==='r4')?.race_role).toBe('captain');
  expect(f.served().find(row=>row.stage_number===2&&row.rider_id==='r1')?.race_role).toBe('helper');
});

test('#7864 same-type stages rebuild their own plan and preserve a saved empty reset',async({page},testInfo)=>{
  const width=testInfo.project.use.hasTouch?375:1280;await page.setViewportSize({width,height:900});
  const f=await setup(page,{multi:true,mountain:true,language:'en'});
  const panel=page.getByTestId('race-tactics-tab');
  await panel.getByRole('button',{name:'Intentions for stage 3',exact:true}).click();
  await multiPlanShot(page,`pr-screens/7864/multi-${testInfo.project.name}-before.png`);
  await panel.getByRole('button',{name:'Intentions for stage 2',exact:true}).click();
  await page.getByTestId('team-plan-stage').click();
  const copy=page.getByTestId('team-plan-same-type');await expect(copy).toContainText('3, 6');
  await copy.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));
  await expect(copy).toBeInViewport();
  expect(await copy.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})).toBe(true);
  if(testInfo.project.use.hasTouch)expect((await copy.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.getByTestId('team-plan-multi-stage').screenshot({path:evidenceShotPath(`pr-screens/7864/multi-${testInfo.project.name}-controls.png`),scale:'css'});
  if(testInfo.project.use.hasTouch)await copy.click();else{await copy.focus();await page.keyboard.press('Enter');}
  expect(f.fills).toHaveLength(0);expect(f.rolesPuts).toHaveLength(0);
  await page.getByTestId('race-tactics-tab').getByRole('button',{name:'Save tactics',exact:true}).click();
  await expect.poll(()=>f.fills.length).toBe(1);
  await expect(page.getByTestId('team-plan-multi-stage')).toHaveCount(0);
  expect(f.fills[0].plans.map(p=>p.stage_number)).toEqual([3,6]);
  const stage3=f.fills[0].plans[0];
  expect(stage3.overrides.find(r=>r.rider_id==='r1')?.race_role).toBeUndefined(); // unchanged base captain
  expect(stage3.order.riders.find(r=>r.rider_id==='r1')?.plan.find(l=>l.task==='attack')?.from).toEqual({at:'kom',kom_index:0});
  expect(f.ordersPuts[0].riders.find(r=>r.rider_id==='r3')?.plan.find(l=>l.task==='attack')?.from).toEqual({at:'kom',kom_index:1});
  expect(f.orders().has(5)).toBe(false);expect(f.served().some(r=>r.stage_number===5)).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await panel.getByRole('button',{name:'Intentions for stage 3',exact:true}).click();
  await expect(panel).not.toContainText('untouched');
  await multiPlanShot(page,`pr-screens/7864/multi-${testInfo.project.name}-after.png`);
  await page.reload();await expect(page.getByTestId('stage-plan-board')).toBeVisible();
  expect(f.fills).toHaveLength(1);
});

test('#7864 failed atomic fill retains drafts and retries no confirmed manual writes',async({page})=>{
  const f=await setup(page,{multi:true,failFill:true,language:'en'});
  await page.getByTestId('team-plan-stage').click();await page.getByTestId('team-plan-same-type').click();
  const panel=page.getByTestId('race-tactics-tab');await panel.getByRole('button',{name:'Save tactics',exact:true}).click();
  await expect(panel.getByTestId('tactics-save-status')).toBeVisible();expect(f.fills).toHaveLength(1);
  await panel.getByRole('button',{name:'Save the rest',exact:true}).click();
  await expect(page.getByTestId('team-plan-multi-stage')).toHaveCount(0);
  expect(f.fills).toHaveLength(2);expect(f.rolesPuts).toHaveLength(1);expect(f.ordersPuts).toHaveLength(1);
  expect(f.fills[1]).toEqual(f.fills[0]);
});

test('#7864 lost fill response is confirmed by matching role and order readback',async({page})=>{
  const f=await setup(page,{multi:true,lostFillResponse:true,language:'en'});
  await page.getByTestId('team-plan-stage').click();await page.getByTestId('team-plan-same-type').click();
  await page.getByTestId('race-tactics-tab').getByRole('button',{name:'Save tactics',exact:true}).click();
  await expect(page.getByTestId('team-plan-multi-stage')).toHaveCount(0);expect(f.fills).toHaveLength(1);
});

test('#7864 a concurrent manual plan survives confirmation and retry',async({page})=>{
  const f=await setup(page,{multi:true,concurrentSave:true,language:'en'});
  await page.getByTestId('team-plan-stage').click();await page.getByTestId('team-plan-same-type').click();
  const panel=page.getByTestId('race-tactics-tab');await panel.getByRole('button',{name:'Save tactics',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Load the new one',exact:true})).toBeVisible();
  expect(f.orders().get(6)?.breakaway_stance).toBe('let_go');
  await panel.getByRole('button',{name:'Save the rest',exact:true}).click();await expect.poll(()=>f.fills.length).toBe(2);
  expect(f.fills[1].plans.map(p=>p.stage_number)).toEqual([6]);
  expect(f.orders().get(6)?.breakaway_stance).toBe('let_go');
  await panel.getByRole('button',{name:'Load the new one',exact:true}).click();
  await expect(page.getByTestId('team-plan-multi-stage')).toHaveCount(0);
});

test('#7864 an unsaved manual stage remains outside the batch and retains its own draft',async({page})=>{
  const f=await setup(page,{multi:true,language:'en'}),panel=page.getByTestId('race-tactics-tab');
  await panel.getByRole('button',{name:'Intentions for stage 3',exact:true}).click();
  await page.getByTestId('team-plan-break').click();
  await panel.getByRole('button',{name:'Intentions for stage 2',exact:true}).click();
  await page.getByTestId('team-plan-stage').click();
  await expect(page.getByTestId('team-plan-same-type')).toHaveText('Copy to stage 6');
  await page.getByTestId('team-plan-same-type').click();await panel.getByRole('button',{name:'Save tactics',exact:true}).click();
  await expect(page.getByTestId('team-plan-multi-stage')).toHaveCount(0);
  expect(f.fills[0].plans.map(p=>p.stage_number)).toEqual([6]);expect(f.orders().has(3)).toBe(false);
  await panel.getByRole('button',{name:'Intentions for stage 3',exact:true}).click();
  await expect(panel.getByText('You have unsaved changes',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Save stage 3',exact:true}).click();
  await expect.poll(()=>f.orders().has(3)).toBe(true);
  expect(f.orders().get(3)?.riders.filter(r=>r.plan?.[0]?.task==='breakaway')).toHaveLength(2);
});

test('#7864 a newly saved plan without role changes stays out of later batch targets',async({page})=>{
  const f=await setup(page,{multi:true,language:'en'}),panel=page.getByTestId('race-tactics-tab');
  await page.getByTestId('team-plan-save').click();
  await panel.getByRole('button',{name:'Save stage 2',exact:true}).click();
  await expect.poll(()=>f.ordersPuts.length).toBe(1);expect(f.rolesPuts).toHaveLength(0);
  await panel.getByRole('button',{name:'Intentions for stage 3',exact:true}).click();
  await page.getByTestId('team-plan-stage').click();
  await expect(page.getByTestId('team-plan-same-type')).toHaveText('Copy to stage 6');
});
