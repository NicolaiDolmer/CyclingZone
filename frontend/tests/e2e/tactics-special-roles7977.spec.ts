import { test, expect } from './e2e-base.js';
import type { Page, Route } from '@playwright/test';
import { installNetworkMocks, login, stabilizePage, evidenceShotPath, json, corsHeaders, raceResultsRoute } from './fixtures.js';

const RACE='00000000-0000-4000-8000-000000007977';
const riders=Array.from({length:8},(_,i)=>({rider_id:`r${i+1}`,name:`Rider ${i+1}`,race_role:i===0?'captain':i===1?'sprint_captain':i===2?'hunter':'helper',abandoned:false,stage_fit:{2:70-i}}));
type Override={stage_number:number;rider_id:string;race_role:string;effort:string};
type Put={stages:number[];overrides:Override[]};
const visible=(locator:ReturnType<Page['locator']>)=>locator.filter({visible:true}).first();

async function setup(page:Page,allowed:boolean){
  await stabilizePage(page);await page.clock.setFixedTime(new Date('2026-11-10T10:00:00Z'));await installNetworkMocks(page);
  const race={id:RACE,name:'7977 Synthetic Preview',race_type:'stage_race',race_class:'OtherWorldTourA',stages:3,stages_completed:1,edition_year:2026,status:'running',engine_rules_revision:allowed?'s5_profiles_v3':'orders_gc_v1',season:{id:'season-e2e',number:1},pool_race:null};
  let served:Override[]=[{stage_number:3,rider_id:'r8',race_role:'helper',effort:'save'}];const puts:Put[]=[];
  await page.route('**/rest/v1/races**',route=>json(route,(route.request().headers().accept||'').includes('vnd.pgrst.object')?race:[race]));
  await page.route('**/rest/v1/race_results**',raceResultsRoute([]));
  await page.route('**/rest/v1/race_stage_profiles**',route=>json(route,[1,2,3].map(stage_number=>({race_id:RACE,stage_number,profile_type:'flat',finale_type:'bunch_sprint',distance_km:150,elevation_gain_m:300,climbs:[],sprints:[],segments:[{kind:'flat',from_km:0,to_km:150}],weather:{kind:'sun',wind_exposure:0.1}}))));
  await page.route('**/rest/v1/race_stage_schedule**',route=>json(route,[]));
  await page.route(`**/api/races/${RACE}/stage-roles`,async(route:Route)=>{
    const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:corsHeaders(req)});
    if(req.method()==='PUT'){
      const body=req.postDataJSON() as Put;puts.push(body);
      served=[...served.filter(r=>!body.stages.includes(r.stage_number)),...body.overrides.filter(r=>body.stages.includes(r.stage_number))];
      return json(route,{ok:true});
    }
    return json(route,{enabled:true,intention_enabled:true,valid_efforts:['grupetto','save','normal','protect','all_out'],special_roles_allowed:allowed,role_scope_choice:true,stages_completed:1,stage_count:3,riders,overrides:served});
  });
  await page.route(`**/api/races/${RACE}/team-orders**`,route=>{
    const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:corsHeaders(req)});
    if(req.method()==='PUT')return json(route,{ok:true});
    return json(route,{stage_count:3,stages_completed:1,riders,stage_plan_enabled:true,stages:[1,2,3].map(stage_number=>({stage_number,locked:stage_number===1,scheduled_at:null})),orders:[]});
  });
  await login(page);await page.goto(`/races/${RACE}?tab=tactics`);
  await expect(page.getByTestId('stage-plan-board')).toBeVisible();
  return {puts,served:()=>served};
}

test('#7977 special roles are selectable without preselection and save on only this stage',async({page},testInfo)=>{
  await page.setViewportSize({width:testInfo.project.use.hasTouch?375:1280,height:900});
  const f=await setup(page,true);const panel=page.getByTestId('race-tactics-tab');
  await visible(panel.getByRole('button',{name:'Skift Rider 4s rolle',exact:true})).click();
  const picker=visible(panel.getByRole('radiogroup')).locator('..').locator('..');
  await picker.screenshot({path:evidenceShotPath(`pr-screens/7977/${testInfo.project.name}-picker.png`),scale:'css'});
  await page.screenshot({path:evidenceShotPath(`pr-screens/7977/${testInfo.project.name}-viewport.png`),scale:'css'});
  await expect(visible(panel.getByRole('button',{name:/^Delt kaptajn/}))).toBeVisible();
  await expect(visible(panel.getByRole('button',{name:/^Luksushjælper/}))).toBeVisible();
  await visible(panel.getByRole('radio',{name:'Kun etape 2',exact:true})).click();
  await visible(panel.getByRole('button',{name:/^Delt kaptajn/})).click();
  await visible(panel.getByRole('button',{name:'Skift Rider 5s rolle',exact:true})).click();
  await visible(panel.getByRole('radio',{name:'Kun etape 2',exact:true})).click();
  await visible(panel.getByRole('button',{name:/^Luksushjælper/})).click();
  await panel.getByRole('button',{name:'Gem etape 2',exact:true}).click();
  await expect.poll(()=>f.puts.length).toBe(1);
  expect(f.puts[0].stages).toEqual([2]);
  expect(f.puts[0].overrides.find(r=>r.rider_id==='r4')?.race_role).toBe('co_captain');
  expect(f.puts[0].overrides.find(r=>r.rider_id==='r5')?.race_role).toBe('luxury_helper');
  expect(f.served().find(r=>r.stage_number===3)?.effort).toBe('save');
  await page.reload();
  await expect(visible(panel.getByText('Delt kaptajn',{exact:true}))).toBeVisible();
  await expect(visible(panel.getByText('Luksushjælper',{exact:true}))).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(testInfo.project.use.hasTouch?375:1280);
});

test('#7977 unsupported races do not offer new special role assignments',async({page})=>{
  await setup(page,false);const panel=page.getByTestId('race-tactics-tab');
  await visible(panel.getByRole('button',{name:'Skift Rider 4s rolle',exact:true})).click();
  await expect(panel.getByRole('button',{name:/^Delt kaptajn/})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:/^Luksushjælper/})).toHaveCount(0);
});
