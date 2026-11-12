import { test, expect } from './e2e-base.js';
import type { Page, Route } from '@playwright/test';
import { installNetworkMocks, login, stabilizePage, evidenceShotPath, json, corsHeaders, raceResultsRoute } from './fixtures.js';

// #7864: a team with both a captain and a co-captain, plus a free role. The GC and
// Stage win team plans give the co-captain the captain's suggested plan and the free
// role his own role suggestion, instead of "ride sheltered, then ride in".
// CZ_SHOT_PHASE=before only captures screenshots (used once against the old code).
const PHASE=process.env.CZ_SHOT_PHASE==='before'?'before':'after';
const RACE='00000000-0000-4000-8000-000000078640';
const RIDERS=[
  {rider_id:'r1',name:'Rytter Et',race_role:'captain',abandoned:false,stage_fit:{2:80}},
  {rider_id:'r2',name:'Rytter To',race_role:'co_captain',abandoned:false,stage_fit:{2:75}},
  {rider_id:'r3',name:'Rytter Tre',race_role:'helper',abandoned:false,stage_fit:{2:60}},
  {rider_id:'r4',name:'Rytter Fire',race_role:'free_role',abandoned:false,stage_fit:{2:70}},
  {rider_id:'r5',name:'Rytter Fem',race_role:'helper',abandoned:false,stage_fit:{2:50}},
];
type OrderPut={breakaway_stance:string;riders:Array<{rider_id:string;plan:Array<{task:string;from?:{at:string;kom_index?:number}}>}>};
const visible=(locator:ReturnType<Page['locator']>)=>locator.filter({visible:true}).first();

async function setup(page:Page,language:string){
  await stabilizePage(page);
  await page.clock.setFixedTime(new Date('2026-11-12T10:00:00Z'));
  await installNetworkMocks(page);
  const ordersPuts:OrderPut[]=[];
  const profile=(stage_number:number)=>({race_id:RACE,stage_number,profile_type:'hilly',finale_type:'reduced_sprint',distance_km:170,elevation_gain_m:2100,climbs:[
    {name:'Côte du Premier',crest_km:80,length_km:4,avg_gradient:6,category:'3'},
    {name:'Côte du Décisif',crest_km:140,length_km:5,avg_gradient:7,category:'2'},
    {name:'Côte Finale',crest_km:158,length_km:3,avg_gradient:7,category:'3'},
  ],sprints:[],segments:[{kind:'flat',from_km:0,to_km:170}],weather:{kind:'sun',wind_exposure:0.1}});
  const race={id:RACE,name:'7864 Co-captain Preview',race_type:'stage_race',race_class:'OtherWorldTourA',stages:4,stages_completed:1,edition_year:2026,status:'running',engine_rules_revision:'s5_profiles_v3',season:{id:'season-e2e',number:1},pool_race:null};
  await page.route('**/rest/v1/races**',route=>json(route,(route.request().headers().accept||'').includes('vnd.pgrst.object')?race:[race]));
  await page.route('**/rest/v1/race_results**',raceResultsRoute([]));
  await page.route('**/rest/v1/race_stage_profiles**',route=>json(route,[1,2,3,4].map(profile)));
  await page.route('**/rest/v1/race_stage_schedule**',route=>json(route,[]));
  await page.route('**/api/feature-flags',route=>json(route,{flags:{tactics_ready_7864:true}}));
  await page.route(`**/api/races/${RACE}/stage-roles`,async(route:Route)=>{
    const request=route.request();
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:corsHeaders(request)});
    if(request.method()==='PUT')return json(route,{ok:true});
    return json(route,{enabled:true,intention_enabled:true,valid_efforts:['grupetto','save','normal','protect','all_out'],stages_completed:1,stage_count:4,riders:RIDERS,overrides:[],role_scope_choice:true,special_roles_allowed:true});
  });
  await page.route(`**/api/races/${RACE}/team-orders**`,async(route:Route)=>{
    const request=route.request();
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:corsHeaders(request)});
    if(request.method()==='PUT'){ordersPuts.push(request.postDataJSON() as OrderPut);return json(route,{ok:true});}
    return json(route,{stage_count:4,stages_completed:1,riders:RIDERS,stage_plan_enabled:true,atomic_stage_save:true,saved_stage_numbers:[],stages:[1,2,3,4].map(n=>({stage_number:n,locked:n===1,scheduled_at:null})),orders:[]});
  });
  await login(page);
  await page.addInitScript(lang=>localStorage.setItem('cz_lang',lang),language);
  await page.goto(`/races/${RACE}?tab=tactics`);
  await expect(page.getByTestId('stage-plan-board')).toBeVisible();
  return {ordersPuts};
}

for(const language of ['da','en']){
  test(`#7864 ${language}: co-captain rides the captain's plan, free role rides his own suggestion`,async({page},testInfo)=>{
    test.skip(testInfo.project.name==='mobile-webkit','evidence is captured on desktop and 375 px Chromium');
    const width=testInfo.project.use.hasTouch?375:1280;
    await page.setViewportSize({width,height:900});
    const f=await setup(page,language);
    const choices=page.getByTestId('team-plan-choices');
    await expect(choices.getByRole('button')).toHaveCount(5);
    await page.getByTestId('team-plan-gc').click();
    await expect(page.getByTestId('team-plan-gc')).toHaveAttribute('aria-pressed','true');
    const dir=`pr-screens/7864-delt-kaptajn/${language}-${testInfo.project.name}-${PHASE}`;
    // Clear the sticky race tabs so the first cards are not covered.
    await choices.evaluate(el=>{el.scrollIntoView({block:'start'});window.scrollBy(0,-120);});
    const multi=page.getByTestId('team-plan-multi-stage');await expect(multi).toBeVisible();
    const a=await choices.boundingBox(),b=await multi.boundingBox();
    if(!a||!b)throw new Error('missing layout');
    await page.screenshot({path:evidenceShotPath(`${dir}-cards.png`),scale:'css',clip:{x:a.x,y:a.y,width:a.width,height:b.y+b.height-a.y}});
    await visible(page.getByTestId('stage-plan-board').getByText('Rytter To',{exact:true})).evaluate(el=>el.scrollIntoView({block:'center'}));
    await page.screenshot({path:evidenceShotPath(`${dir}-plan.png`),scale:'css'});
    if(PHASE==='before')return;
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByTestId('team-plan-same-type')).toHaveText(language==='en'?'Copy to stages 3, 4':'Kopiér til etaperne 3, 4');
    await page.getByTestId('race-tactics-tab').getByRole('button',{name:language==='en'?'Save stage 2':'Gem etape 2',exact:true}).click();
    await expect.poll(()=>f.ordersPuts.length).toBe(1);
    const plan=(id:string)=>f.ordersPuts[0].riders.find(r=>r.rider_id===id)?.plan;
    expect(plan('r2')).toEqual(plan('r1'));
    expect(plan('r2')?.some(l=>l.task==='ride_in')).toBe(false);
    expect(plan('r4')?.[0]?.task).toBe('breakaway');
    expect(plan('r3')?.[0]?.task).toBe('shelter_leader');
  });
}
