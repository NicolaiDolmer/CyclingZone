// Refs #7153: actual components, fixture API, no live player data.
import {test,expect} from './e2e-base.js';
import {installNetworkMocks,login,stabilizePage,json,corsHeaders,evidenceShotPath} from './fixtures.js';
const RACE_ID = "00000000-0000-4000-8000-000000001307";

const SCHEDULED_RACE = {
  id: RACE_ID,
  name: "E2E Classic",
  race_type: "single",
  race_class: "ProSeries",
  stages: 1,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

// 9 ryttere — rider-8 (index 8) er skadet.
const SELECTION_RIDERS = Array.from({ length: 9 }, (_, i) => ({
  id: `sel-r${i}`,
  name: `Rider ${i}`,
  suitability: 70 - i,
  form: 55,
  fatigue: 10,
  injured: i === 8,
}));


test('voluntary rejoin starts empty, warns, saves only new picks',async({page},testInfo)=>{
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Override races-tabellen så RaceDetailPage finder SCHEDULED_RACE.
  // Følger race-detail.spec.js: registreres efter installNetworkMocks → vinder (LIFO).
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes(
      "vnd.pgrst.object"
    );
    return json(route, wantsObject ? SCHEDULED_RACE : [SCHEDULED_RACE]);
  });

  // race_results er tom — det er et scheduleret løb, ingen resultater endnu.
  await page.route("**/rest/v1/race_results**", (route) =>
    json(route, [])
  );

  // Stash PUT-body så vi kan assertere payload efter klikket.
  let capturedBody = null;

  // Override GET + PUT på selection-endpointet.
  // Registreres EFTER installNetworkMocks → matcher FØR fixtures' generiske **/api/** handler.
  await page.route(`**/api/races/${RACE_ID}/selection`, async (route) => {
    const request = route.request();

    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }

    if (request.method() === "PUT") {
      try {
        capturedBody = JSON.parse(request.postData() || "{}");
      } catch {
        capturedBody = {};
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders(request),
        body: JSON.stringify({ ok: true }),
      });
    }

    // GET
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({
        enabled: true,
        race: SCHEDULED_RACE,
        size: { min: 6, max: 8 },
        withdrawn: true,
        lineup_locked: false,
        selection: { rider_ids: ["sel-r7"], captain_id: "sel-r7" },
        riders: SELECTION_RIDERS,
        availableCount: 8,
      }),
    });
  });

  await login(page);
  await page.goto(`/races/${RACE_ID}`);

  // #4613: løbssiden er T3 (hero + faner), og siden åbner på Overblik.
  // Holdudtagelsen bor i Hold-fanen.
  await page.getByRole("tab", { name: "Hold" }).click();

  // Panelet loader og er synligt.
  const panel = page.getByTestId("race-selection-panel");
  await expect(panel).toBeVisible();


 await expect(panel.getByText('Gem en ny udtagelse for at annullere udtrækningen og erstatte den gamle udtagelse.')).toBeVisible();
 await expect(panel.getByRole('checkbox',{name:/Rider 7/})).not.toBeChecked();
 await expect(panel.getByRole('button',{name:/auto/i})).toBeDisabled();
 await panel.getByRole('checkbox',{name:/Rider 0/}).check();
 await panel.getByRole('combobox').first().selectOption('sel-r0');
 await page.screenshot({path:evidenceShotPath('pr-screens/7153/panel-'+testInfo.project.name+'.png'),fullPage:false});
 await panel.getByRole('button',{name:/gem udtagelse/i}).click();
 await expect(panel.getByText(/udtagelsen er gemt/i)).toBeVisible();
 expect(capturedBody.rider_ids).toEqual(['sel-r0']);
 await expect(panel.getByText('Gem en ny udtagelse for at annullere udtrækningen og erstatte den gamle udtagelse.')).toHaveCount(0);
});

const ABILITIES = Object.fromEntries(
  ["climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone", "acceleration",
    "recovery", "tactics", "positioning", "flat", "tempo", "durability", "aggression", "descending"]
    .map((k) => [k, 60])
);

const SEASON_MATRIX_BODY = {
  enabled: true,
  season: { id: "season-e2e-1", number: 1 },
  ownPoolId: 2,
  readOnly: false,
  races: [
    { id: "r1", name: "Grand Prix de Namur", raceClass: "Class2", stages: 1, status: "scheduled", stagesCompleted: 0,
      gameDayStart: 12, gameDayEnd: 12, restGameDays: [], sizeMin: 6, sizeMax: 6, demandVector: { sprint: 1 } },
    { id: "r2", name: "Tour des Hauts Plateaux", raceClass: "ProSeries", stages: 4, status: "scheduled", stagesCompleted: 0,
      gameDayStart: 14, gameDayEnd: 17, restGameDays: [16], sizeMin: 6, sizeMax: 6, demandVector: { climbing: 0.6, tempo: 0.4 } },
    { id: "r3", name: "Giro Veneto", raceClass: "Class1", stages: 1, status: "scheduled", stagesCompleted: 0,
      gameDayStart: 20, gameDayEnd: 20, restGameDays: [], sizeMin: 6, sizeMax: 6, demandVector: { climbing: 1 } },
  ],
  riders: [
    { id: "rider-1", name: "Ada Pedersen", primaryType: "climber", secondaryType: null, abilities: ABILITIES, injured: false },
    { id: "rider-2", name: "Bo Madsen", primaryType: "sprinter", secondaryType: null, abilities: ABILITIES, injured: false },
    { id: "rider-3", name: "Cecilie Holm", primaryType: "allrounder", secondaryType: null, abilities: ABILITIES, injured: false },
  ],
  entries: [
    { raceId: "r1", riderId: "rider-1", raceRole: "captain" },
    { raceId: "r1", riderId: "rider-2", raceRole: "helper" },
    { raceId: "r2", riderId: "rider-1", raceRole: "captain" },
  ],
  dayDates: [
    { gameDay: 12, date: "2026-07-02" },
    { gameDay: 14, date: "2026-07-04" }, { gameDay: 15, date: "2026-07-05" },
    { gameDay: 16, date: "2026-07-06" }, { gameDay: 17, date: "2026-07-07" },
    { gameDay: 20, date: "2026-07-10" },
  ],
};


for(const mode of ['save','conflict','locked'])test('matrix voluntary rejoin '+mode,async({page},testInfo)=>{
 await stabilizePage(page);await installNetworkMocks(page);
 const body={...SEASON_MATRIX_BODY,withdrawnRaceIds:['r1'],races:SEASON_MATRIX_BODY.races.map(r=>({...r,lineupLocked:mode==='locked'&&r.id==='r1'}))};
 let captured;
 await page.route('**/api/races/selection/season**',route=>json(route,body));
 await page.route('**/api/races/selection/bulk',async route=>{
  const request=route.request();if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:corsHeaders(request)});
  captured=request.postDataJSON();
  if(mode==='conflict')return route.fulfill({status:409,contentType:'application/json',headers:corsHeaders(request),body:JSON.stringify({error:'selection_rider_bound',race_id:'r1',conflicts:[{rider_name:'Cecilie Holm',race_name:'Tour B'}]})});
  body.withdrawnRaceIds=[];body.entries=body.entries.filter(e=>e.raceId!=='r1').concat([{raceId:'r1',riderId:'rider-3',raceRole:'captain'}]);
  return json(route,{ok:true});
 });
 await login(page);await page.goto('/planning?view=season');
 await expect(page.getByRole('heading',{name:'Udtagelsesmatrix'})).toBeVisible();
 const cell=page.getByTitle(/Cecilie Holm, Grand Prix de Namur/);
 await cell.scrollIntoViewIfNeeded();await cell.click();
 const dialog=page.getByRole('dialog');
 if(mode==='locked'){
  await expect(dialog.getByText('Du trak holdet ud af løbet. Feltet er låst efter første etape.')).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(0);
 }else{
  await dialog.getByRole('option',{name:'C Kaptajn'}).click();
  await page.getByRole('button',{name:'Gem plan'}).click();
  if(mode==='conflict'){
   await expect(page.getByText(/Cecilie Holm.*Tour B/)).toBeVisible();
  }else{
   await expect(page.getByRole('button',{name:'Gem plan'})).toHaveCount(0);
   expect(captured.changes).toEqual([{raceId:'r1',rider_ids:['rider-3'],captain_id:'rider-3',sprint_captain_id:null,hunter_id:null,free_role_ids:[]}]);
  }
 }
 await page.screenshot({path:evidenceShotPath('pr-screens/7153/matrix-'+mode+'-'+testInfo.project.name+'.png'),fullPage:false});
});
