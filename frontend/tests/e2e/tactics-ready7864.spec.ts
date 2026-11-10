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

async function setup(page:Page,{on=true,language='da',failOrder=false,mountain=false,conflictRoles=false}:{on?:boolean;language?:string;failOrder?:boolean;mountain?:boolean;conflictRoles?:boolean}={}){
  await stabilizePage(page);
  await page.clock.setFixedTime(new Date('2026-11-10T10:00:00Z'));
  await installNetworkMocks(page);
  let flag=on;
  let served:RoleOverride[]=[{stage_number:3,rider_id:'r4',race_role:'helper',effort:'save'}];
  let savedOrder:OrderPut|null=null;
  const rolesPuts:RolesPut[]=[],ordersPuts:OrderPut[]=[];
  const profile=(stage_number:number)=>({race_id:RACE,stage_number,profile_type:mountain?'high_mountain':'flat',finale_type:mountain?'long_climb':'bunch_sprint',distance_km:160,elevation_gain_m:mountain?3200:300,climbs:mountain?[
    {name:'Col du Premier',crest_km:70,length_km:8,avg_gradient:7,category:'1'},
    {name:'Col du Décisif',crest_km:125,length_km:12,avg_gradient:8,category:'HC'},
    {name:'Mont Final',crest_km:160,length_km:10,avg_gradient:8,category:'1',summit_finish:true},
  ]:[],sprints:[],segments:[{kind:'flat',from_km:0,to_km:160}],weather:{kind:'sun',wind_exposure:0.1}});
  const race={id:RACE,name:'7864 Synthetic Preview',race_type:'stage_race',race_class:'OtherWorldTourA',stages:3,stages_completed:1,edition_year:2026,status:'running',engine_rules_revision:'s5_profiles_v3',season:{id:'season-e2e',number:1},pool_race:null};
  await page.route('**/rest/v1/races**',route=>json(route,(route.request().headers().accept||'').includes('vnd.pgrst.object')?race:[race]));
  await page.route('**/rest/v1/race_results**',raceResultsRoute([]));
  await page.route('**/rest/v1/race_stage_profiles**',route=>json(route,[profile(1),profile(2),profile(3)]));
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
    return json(route,{enabled:true,intention_enabled:true,valid_efforts:['grupetto','save','normal','protect','all_out'],stages_completed:1,stage_count:3,riders:RIDERS,overrides:served,role_scope_choice:true,special_roles_allowed:true});
  });
  await page.route(`**/api/races/${RACE}/team-orders**`,async(route:Route)=>{
    const request=route.request();
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:corsHeaders(request)});
    if(request.method()==='PUT'){
      const body=request.postDataJSON() as OrderPut;ordersPuts.push(body);
      if(failOrder&&ordersPuts.length===1)return route.fulfill({status:400,contentType:'application/json',headers:corsHeaders(request),body:JSON.stringify({error:'save_failed'})});
      savedOrder=body;return json(route,{ok:true});
    }
    return json(route,{stage_count:3,stages_completed:1,riders:RIDERS,stage_plan_enabled:true,stages:[1,2,3].map(n=>({stage_number:n,locked:n===1,scheduled_at:null})),orders:savedOrder?[{stage_number:2,...savedOrder}]:[]});
  });
  await login(page);
  await page.addInitScript(lang=>localStorage.setItem('cz_lang',lang),language);
  await page.goto(`/races/${RACE}?tab=tactics`);
  await expect(page.getByTestId('stage-plan-board')).toBeVisible();
  return {rolesPuts,ordersPuts,setFlag(value:boolean){flag=value;},served:()=>served};
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
