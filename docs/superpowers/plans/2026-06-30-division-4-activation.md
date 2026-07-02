# Division 4-aktivering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aktivér division 4 i Cycling Zone — udvid løbskataloget så division 4 kan fylde sin game-day-kvote, gør kalender-materialiseringen i stand til at forhåndsbygge en tier uden rigtige managere endnu, materialisér division 4's kalender, og lad nye managere automatisk falde igennem til division 4, når division 3 er fuld.

**Architecture:** Fire uafhængigt testbare lag, udført i rækkefølge fordi senere lag forudsætter tidligere: (1) katalog-data (CSV+JSON, ingen kodeændring), (2) en lille, bagudkompatibel `forceTiers`-parameter på den eksisterende rene materialiserings-funktion, (3) en engangs-køring der bruger (1)+(2) til at bygge division 4's kalender uden at røre division 1-3, (4) en kapacitets-bevidst ændring af signup-allokeringen, der falder igennem til division 4, når division 3 er mættet (rigtige managers, ikke AI). Hvert lag har sin egen test-pakke; ingen af dem kræver at de andre er færdige for at kunne testes isoleret (kun den faktiske prod-køring i lag 3 forudsætter at lag 1+2 er landet).

**Tech Stack:** Node.js (`node --test`), Supabase/Postgres (execute_sql/MCP til verifikation), eksisterende scripts (`backend/scripts/seedRacePool.js`, `backend/scripts/applyRacePoolArchetypes.js`, `backend/lib/tierCalendarMaterializer.js`).

**Spec:** `docs/superpowers/specs/2026-06-30-division-4-activation-design.md`

---

### Task 1: Løbskatalog-udvidelse (Class1/Class2)

**Files:**
- Modify: `scripts/race_pool_seed.csv`
- Modify: `database/seed/race_pool_archetypes.json`

Tilføjer 15 rigtige UCI-inspirerede Class1/Class2-løb (33 game-days), der lukker division 4's 16-game-day-hul med margin. `external_id`-værdierne nedenfor er forhåndsberegnet med samme algoritme som `racePoolImport.js:59`
(`sha256(lowercase(navn)|dato).slice(0,16)`), så de matcher præcis det
`seedRacePool.js` selv vil beregne ved import — ingen gæt nødvendigt.

- [ ] **Step 1: Tilføj de 15 nye rækker til `scripts/race_pool_seed.csv`**

Tilføj disse linjer til filen (samme `Dato,Løb,Etaper,Kategori,Type`-format som resten af filen; ingen header skal gentages):

```csv
9/2,Trofeo Camp de Morvedre Nuevo,1,Class 1 races,Endagsløb
23/3,Grand Prix Criquielion Nouveau,1,Class 1 races,Endagsløb
31/1,Rund um Köln Neu,1,Class 1 races,Endagsløb
12/4,Famenne-Ardenne Classique Nouvelle,1,Class 1 races,Endagsløb
5/2 - 8/2,Étoile de Bessèges Mineure,4,Class 1 races,Etapeløb
14/5 - 17/5,Giro d'Abruzzo Nuovo,4,Class 1 races,Etapeløb
9/8 - 11/8,Tour de l'Ain Nouveau,3,Class 1 races,Etapeløb
5/4,Paris-Camembert Mineur,1,Class 2 races,Endagsløb
17/3,La Roue Tourangelle Mineure,1,Class 2 races,Endagsløb
29/3,Cholet Agglo Classique,1,Class 2 races,Endagsløb
1/3,Antwerp Port Epic Mineur,1,Class 2 races,Endagsløb
23/6 - 25/6,Région Pays de la Loire Tour Mineur,3,Class 2 races,Etapeløb
12/2 - 15/2,O Gran Camiño Menor,4,Class 2 races,Etapeløb
24/3 - 27/3,Settimana di Coppi e Bartali Minore,4,Class 2 races,Etapeløb
11/10 - 13/10,Tour de la Provence Mineur,3,Class 2 races,Etapeløb
```

- [ ] **Step 2: Dry-run seed-scriptet og verificér 15 nye rækker**

Run: `node backend/scripts/seedRacePool.js --dry-run`
Expected: output viser 15 nye upserts (de øvrige 121 rækker er uændrede/no-op, da deres `external_id` allerede findes). Ingen rækker foreslås slettet (vi bruger ikke `--prune`).

- [ ] **Step 3: Anvend seed-scriptet (skriver til race_pool)**

Run: `node backend/scripts/seedRacePool.js`
Expected: output bekræfter 15 indsatte rækker. `race_pool` har nu 136 rækker.

- [ ] **Step 4: Tilføj arketype/land-metadata til `database/seed/race_pool_archetypes.json`**

Filen er en flad JSON-liste af `{ external_id, name, country, terrain_archetype }`. Tilføj disse 15 objekter til arrayet (samme indrykning/stil som eksisterende entries):

```json
  { "external_id": "675cc3db58920886", "name": "Trofeo Camp de Morvedre Nuevo", "country": "Spain", "terrain_archetype": "flat_sprint" },
  { "external_id": "0d66fbfbeaf44973", "name": "Grand Prix Criquielion Nouveau", "country": "Belgium", "terrain_archetype": "puncheur" },
  { "external_id": "80bb2a632ae10e4d", "name": "Rund um Köln Neu", "country": "Germany", "terrain_archetype": "flat_sprint" },
  { "external_id": "92f20de262004754", "name": "Famenne-Ardenne Classique Nouvelle", "country": "Belgium", "terrain_archetype": "hilly_classic" },
  { "external_id": "459b40b640ed5b1a", "name": "Étoile de Bessèges Mineure", "country": "France", "terrain_archetype": "balanced_week" },
  { "external_id": "8fe98b9f788c3b06", "name": "Giro d'Abruzzo Nuovo", "country": "Italy", "terrain_archetype": "mountain_tour" },
  { "external_id": "8f40dfb81187fab3", "name": "Tour de l'Ain Nouveau", "country": "France", "terrain_archetype": "hilly_tour" },
  { "external_id": "b4b0dd1c17aeedc0", "name": "Paris-Camembert Mineur", "country": "France", "terrain_archetype": "hilly_classic" },
  { "external_id": "1b465e0459ee24eb", "name": "La Roue Tourangelle Mineure", "country": "France", "terrain_archetype": "flat_sprint" },
  { "external_id": "e06857d6c132e271", "name": "Cholet Agglo Classique", "country": "France", "terrain_archetype": "flat_sprint" },
  { "external_id": "3c0b2191b1672b4b", "name": "Antwerp Port Epic Mineur", "country": "Belgium", "terrain_archetype": "cobbled_classic" },
  { "external_id": "3721d97b66d6a76a", "name": "Région Pays de la Loire Tour Mineur", "country": "France", "terrain_archetype": "sprinters_week" },
  { "external_id": "4f43b6e0843c1380", "name": "O Gran Camiño Menor", "country": "Spain", "terrain_archetype": "mountain_tour" },
  { "external_id": "339f4f05e3d8d96b", "name": "Settimana di Coppi e Bartali Minore", "country": "Italy", "terrain_archetype": "hilly_tour" },
  { "external_id": "a15a0038c23d0c69", "name": "Tour de la Provence Mineur", "country": "France", "terrain_archetype": "hilly_tour" },
```

Husk komma efter den foregående sidste linje i filen, og fjern komma efter den sidste af disse 15, hvis de tilføjes som array-slutning.

- [ ] **Step 5: Dry-run arketype-scriptet**

Run: `node backend/scripts/applyRacePoolArchetypes.js`
Expected: output viser 15 ændringer (de nye løbs `terrain_archetype: ∅ → <værdi>` og `land ∅ → <værdi>`), 0 ukendte `external_id`, 0 ukendte arketyper (scriptet validerer arketype-navne mod `ARCHETYPE_PROFILES` FØR det rører DB — fejler højlydt hvis et navn er stavet forkert).

- [ ] **Step 6: Anvend arketype-scriptet**

Run: `node backend/scripts/applyRacePoolArchetypes.js --apply`
Expected: "Skrev 15 ændringer".

- [ ] **Step 7: Verificér med SQL**

```sql
select race_class, count(*), sum(stages) as game_days
from race_pool
where race_class in ('Class1','Class2')
group by race_class;
```

Expected: Class1 → 19 rækker (tidligere 12 + 7 nye), 42 game-days (27+15). Class2 → 20 rækker (12+8), 35 game-days (17+18).

- [ ] **Step 8: Commit**

```bash
git add scripts/race_pool_seed.csv database/seed/race_pool_archetypes.json
git commit -m "content: tilføj 15 Class1/Class2-løb til race_pool (lukker division 4-hul)"
```

---

### Task 2: `forceTiers`-parameter på tier-materialisering

**Files:**
- Modify: `backend/lib/tierCalendarMaterializer.js:53-126` (`buildTierMaterializationPlan`), `:132-218` (`materializeTierCalendars`)
- Test: `backend/lib/tierCalendarMaterializer.test.js`

`poolHasCalendar(tier, realManagerCount)` kræver i dag ≥1 rigtig manager for tier 3/4, før en pulje får en kalender. Division 4 har 0 rigtige managers lige nu, så vi kan ikke proaktivt forhåndsbygge kalenderen uden en eksplicit override. `forceTiers` er en ren, bagudkompatibel tilføjelse (default `[]` = uændret adfærd for alle eksisterende kald).

- [ ] **Step 1: Læs nuværende test-struktur for konteksten**

Run: `grep -n "buildTierMaterializationPlan\|poolHasCalendar" backend/lib/tierCalendarMaterializer.test.js | head -20`

(Ingen handling — bare bekræft hvordan eksisterende tests konstruerer `pools`-argumentet, så den nye test matcher stilen.)

- [ ] **Step 2: Skriv den fejlende test**

Tilføj til `backend/lib/tierCalendarMaterializer.test.js` (følg samme import-stil som resten af filen — `buildTierMaterializationPlan` er allerede eksporteret og importeret):

```js
test("forceTiers: en tier-4-pulje uden rigtige managers får alligevel en kalender, når tier 4 er i forceTiers", () => {
  const pools = [
    { id: 1, tier: 1, label: "Division 1", realManagerCount: 5 },
    { id: 8, tier: 4, label: "Division 4 — A", realManagerCount: 0 },
    { id: 9, tier: 4, label: "Division 4 — B", realManagerCount: 0 },
  ];
  const catalog = [
    { id: "r1", name: "Test Tour", race_class: "TourFrance", race_type: "stage_race", stages: 21 },
    { id: "r2", name: "Test Class2", race_class: "Class2", race_type: "single", stages: 1 },
  ];

  const { tierPlans } = buildTierMaterializationPlan({
    pools, catalog, quotas: { 1: 21, 4: 1 }, forceTiers: [4],
  });

  const tier4Plan = tierPlans.find((p) => p.tier === 4);
  assert.ok(tier4Plan, "tier 4 skal have en plan, selvom realManagerCount=0, fordi forceTiers inkluderer den");
  assert.equal(tier4Plan.pools.length, 2, "begge tier-4-puljer skal have fået samme plan");
});

test("forceTiers: uden flaget (default) springes en mandagsløs tier-4-pulje stadig over (uændret adfærd)", () => {
  const pools = [
    { id: 1, tier: 1, label: "Division 1", realManagerCount: 5 },
    { id: 8, tier: 4, label: "Division 4 — A", realManagerCount: 0 },
  ];
  const catalog = [
    { id: "r1", name: "Test Tour", race_class: "TourFrance", race_type: "stage_race", stages: 21 },
  ];

  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, quotas: { 1: 21, 4: 1 } });

  assert.equal(tierPlans.find((p) => p.tier === 4), undefined, "uden forceTiers er adfærden uændret: tier 4 uden managers får ingen plan");
});
```

- [ ] **Step 3: Kør testene og verificér at de fejler**

Run: `node --test --import ./backend/test-setup.js backend/lib/tierCalendarMaterializer.test.js`
Expected: FAIL på den første nye test ("forceTiers: en tier-4-pulje...") — `tierPlans.find(...)` returnerer `undefined`, fordi `forceTiers` endnu ikke findes som parameter. Den anden nye test passer allerede (den beskriver eksisterende adfærd).

- [ ] **Step 4: Implementér `forceTiers` i `buildTierMaterializationPlan`**

I `backend/lib/tierCalendarMaterializer.js`, modify funktionssignaturen og filtreringen (linje 53-71):

```js
export function buildTierMaterializationPlan({
  pools = [],
  catalog = [],
  from = new Date(),
  realDays = 28,
  quotas = TIER_GAME_DAY_QUOTA,
  density = TIER_DENSITY,
  overlapCaps = TIER_OVERLAP_CAP,
  slots = TIER_STAGE_SLOTS,
  baseSeed = 1,
  forceTiers = [],
} = {}) {
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const forced = new Set(forceTiers);

  const liveByTier = new Map();
  for (const p of pools) {
    if (!poolHasCalendar(p.tier, p.realManagerCount) && !forced.has(p.tier)) continue;
    if (!liveByTier.has(p.tier)) liveByTier.set(p.tier, []);
    liveByTier.get(p.tier).push(p);
  }
```

(Resten af funktionen er uændret — kun gate-betingelsen i loopet får et `|| forced.has(p.tier)`-tillæg.)

- [ ] **Step 5: Thread `forceTiers` gennem `materializeTierCalendars`**

I samme fil, modify I/O-wrapperens signatur og videregivelse (omkring linje 132-158):

```js
export async function materializeTierCalendars({
  supabase, seasonId, seasonStartDate = null, from = new Date(),
  baseSeed = 1, tiers = null, forceTiers = [], dryRun = true, log = () => {},
} = {}) {
```

og i kaldet til `buildTierMaterializationPlan` (omkring linje 158):

```js
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: catalog || [], from, baseSeed, forceTiers });
```

- [ ] **Step 6: Kør testene og verificér at de passerer**

Run: `node --test --import ./backend/test-setup.js backend/lib/tierCalendarMaterializer.test.js`
Expected: PASS — alle tests, inkl. de to nye.

- [ ] **Step 7: Kør hele backend-test-suiten for at udelukke regressioner**

Run: `npm test --prefix backend`
Expected: PASS (ingen andre tests kalder `buildTierMaterializationPlan`/`materializeTierCalendars` med positionelle argumenter, så den nye parameter er strengt additiv).

- [ ] **Step 8: Commit**

```bash
git add backend/lib/tierCalendarMaterializer.js backend/lib/tierCalendarMaterializer.test.js
git commit -m "feat: tilføj forceTiers til tier-materialisering (forhåndsbyg kalender uden managers)"
```

---

### Task 3: Materialisér division 4's kalender (prod-køring)

**Files:**
- Create: `backend/scripts/dev/materialize-division-4.mjs`

I modsætning til `apply-calendar-prestige.mjs` (som SLETTER og genopbygger ALLE divisioners løb) skal dette script KUN tilføje division 4 — ingen sletning, ingen rør ved division 1-3's allerede materialiserede løb. `materializeTierCalendars` er additiv af natur (indsætter kun "fresh" rækker via `existingKey`-dedup), så det er sikkert at køre flere gange.

- [ ] **Step 1: Skriv scriptet**

Create `backend/scripts/dev/materialize-division-4.mjs`:

```js
// Engangs-materialisering af division 4's kalender (16-game-day-hul lukket i
// Task 1; forceTiers landet i Task 2). IKKE destruktiv: rører kun tier 4,
// sletter intet. Kør: infisical run --env=prod -- node backend/scripts/dev/materialize-division-4.mjs [--apply]
import { createClient } from "@supabase/supabase-js";
import { materializeTierCalendars } from "../../lib/tierCalendarMaterializer.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Mangler SUPABASE_URL/SERVICE_KEY"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const APPLY = process.argv.includes("--apply");
const FROM = new Date("2026-06-28T00:00:00Z"); // samme ankerdato som apply-calendar-prestige.mjs

const { data: season, error: sErr } = await supabase.from("seasons").select("id, number, start_date").eq("status", "active").maybeSingle();
if (sErr || !season) { console.error("aktiv sæson:", sErr?.message); process.exit(1); }
console.log(`Aktiv sæson #${season.number} (${season.id})`);

const summary = await materializeTierCalendars({
  supabase, seasonId: season.id, seasonStartDate: season.start_date,
  from: FROM, dryRun: !APPLY, tiers: [4], forceTiers: [4],
  log: (m) => console.log(m),
});

console.log(`\n=== ${APPLY ? "APPLY" : "DRY-RUN"} SUMMARY ===`);
console.log(`races inserted: ${summary.racesInserted} · profiles: ${summary.stageProfiles} · stage-schedules: ${summary.stageSchedules}`);
for (const t of summary.tiers) {
  console.log(`tier ${t.tier}: kvote ${t.quota} · total ${t.totalGameDays} · quotaHit ${t.quotaHit} · tomme ${t.emptyDays} · overlap-dage ${t.overlapDays} · unplaced ${t.unplacedStages}/${t.unplacedSingles} · puljer ${t.pools.map((p) => `${p.pool_id}:+${p.inserted}`).join(" ")}`);
}
process.exit(0);
```

- [ ] **Step 2: Dry-run mod prod**

Run: `infisical run --env=prod -- node backend/scripts/dev/materialize-division-4.mjs`
Expected: `=== DRY-RUN SUMMARY ===` med `tier 4: kvote 56 · total ≥56 · quotaHit true` (efter Task 1's katalog-udvidelse). Hvis `quotaHit` er `false` eller `total < 56`, STOP — gå tilbage til Task 1, der mangler flere game-days end forventet (uventet afvigelse fra simuleringen i specen — undersøg før du fortsætter).

- [ ] **Step 3: Verificér quotaHit=true, kør derefter apply**

Run: `infisical run --env=prod -- node backend/scripts/dev/materialize-division-4.mjs --apply`
Expected: `=== APPLY SUMMARY ===` med `races inserted` > 0, `tier 4: ... quotaHit true · tomme 0`.

- [ ] **Step 4: Verificér med SQL at alle 8 division-4-puljer fik samme løb**

```sql
select league_division_id, count(*) as race_count, sum(stages) as game_days
from races r join league_divisions ld on ld.id = r.league_division_id
where ld.tier = 4
group by league_division_id
order by league_division_id;
```

Expected: 8 rækker (én pr. division-4-pulje), alle med samme `race_count` og `game_days` (matcher division 3's mønster, hvor alle 4 puljer fik identisk antal — "Division 3 kører samme løb, parallelt i sine 4 puljer", jf. `tierCalendarMaterializer.js:4`).

- [ ] **Step 5: Commit scriptet**

```bash
git add backend/scripts/dev/materialize-division-4.mjs
git commit -m "chore: tilføj engangsscript til division 4-kalender-materialisering"
```

(Selve prod-køringen i step 2-4 er en datahandling, ikke en kodeændring — intet at committe ud over scriptet selv.)

---

### Task 4: Dynamisk overflow division 3 → 4 ved signup

**Files:**
- Modify: `backend/lib/teamProfileEngine.js:173-220` (`pickDivisionForNewTeam`)
- Test: `backend/lib/teamProfileEngine.test.js`

`pickDivisionForNewTeam` placerer i dag ALTID nye managere i `MANAGER_ENTRY_DIVISION` (3), selv når alle 4 puljer er fulde (blød cap — vokser bare forbi `POOL_TARGET_SIZE`). Vi ændrer det til: hvis ALLE entry-puljer har ≥`POOL_TARGET_SIZE` rigtige managers, OG der findes mindst én `MAX_DIVISION`-pulje (4), fald igennem til den mindst-fyldte af dem. Findes ingen `MAX_DIVISION`-puljer (fx i en test eller pre-migration), er den gamle bløde-cap-adfærd uændret — graceful fallback.

- [ ] **Step 1: Læs den eksisterende "blød cap"-test for at forstå hvad der ændrer sig**

Run: `grep -n "blød cap" backend/lib/teamProfileEngine.test.js`

Bekræft: testen `"#1608 bund-op: blød cap — div-4-puljer må vokse forbi POOL_TARGET_SIZE når alle er fulde"` (linje ~366) seeder KUN entry-tier-puljer (`seedDiv4Pools()`, tier=`MANAGER_ENTRY_DIVISION`) — ingen separate `MAX_DIVISION`-puljer. Med den nye logik er dette netop "graceful fallback"-stien (ingen tier-4-puljer at falde igennem til), så testen forbliver gyldig UÆNDRET — den dækker nu fallback-casen i stedet for "den eneste adfærd". Ingen ændring af denne test krævet i Step 2.

- [ ] **Step 2: Skriv de fejlende tests for selve overflow-stien**

Tilføj til `backend/lib/teamProfileEngine.test.js` (efter den eksisterende "blød cap"-test, samme sektion):

```js
function seedMaxDivisionPools() {
  return Array.from({ length: 8 }, (_, index) => ({
    id: 100 + index,
    tier: MAX_DIVISION,
    pool_index: index,
    label: `Division 4 — ${String.fromCharCode(65 + index)}`,
  }));
}

test("overflow: alle entry-puljer ved POOL_TARGET_SIZE OG MAX_DIVISION-puljer findes → ny manager lander i MAX_DIVISION", async () => {
  const entryPools = seedDiv4Pools();
  const overflowPools = seedMaxDivisionPools();
  const teams = entryPools.flatMap((pool) =>
    seedTeams({ division: MANAGER_ENTRY_DIVISION, count: POOL_TARGET_SIZE, league_division_id: pool.id }),
  );
  const supabase = createSupabaseDouble({ leagueDivisions: [...entryPools, ...overflowPools], teams });

  const result = await upsert({
    supabase, userId: "user-overflow", name: "Overflow Team", managerName: "Manager",
  });

  assert.equal(result.team.division, MAX_DIVISION, "entry-tier mættet → fald igennem til MAX_DIVISION");
  assert.ok(
    overflowPools.some((p) => p.id === result.team.league_division_id),
    "holdet skal lande i en faktisk MAX_DIVISION-pulje",
  );
});

test("overflow: vælger den mindst-fyldte MAX_DIVISION-pulje (samme determinisme som entry-puljerne)", async () => {
  const entryPools = seedDiv4Pools();
  const overflowPools = seedMaxDivisionPools();
  const teams = [
    ...entryPools.flatMap((pool) =>
      seedTeams({ division: MANAGER_ENTRY_DIVISION, count: POOL_TARGET_SIZE, league_division_id: pool.id }),
    ),
    ...seedTeams({ division: MAX_DIVISION, count: 5, league_division_id: overflowPools[0].id }),
  ];
  const supabase = createSupabaseDouble({ leagueDivisions: [...entryPools, ...overflowPools], teams });

  const result = await upsert({
    supabase, userId: "user-overflow-2", name: "Least Filled Overflow", managerName: "Manager",
  });

  assert.notEqual(result.team.league_division_id, overflowPools[0].id, "fyldt MAX_DIVISION-pulje skal undgås");
  assert.ok(overflowPools.slice(1).some((p) => p.id === result.team.league_division_id));
});

test("overflow: division 3 har stadig plads → MAX_DIVISION-puljer IGNORERES, selvom de findes", async () => {
  const entryPools = seedDiv4Pools();
  const overflowPools = seedMaxDivisionPools();
  // Kun 5 rigtige managers i den første entry-pulje — langt under POOL_TARGET_SIZE.
  const teams = seedTeams({ division: MANAGER_ENTRY_DIVISION, count: 5, league_division_id: entryPools[0].id });
  const supabase = createSupabaseDouble({ leagueDivisions: [...entryPools, ...overflowPools], teams });

  const result = await upsert({
    supabase, userId: "user-no-overflow", name: "Still Division 3", managerName: "Manager",
  });

  assert.equal(result.team.division, MANAGER_ENTRY_DIVISION, "entry-tier har plads → ingen overflow, selvom MAX_DIVISION-puljer findes");
});
```

Tilføj `MAX_DIVISION` til de eksisterende imports øverst i filen (linje 6):

```js
import { INITIAL_BALANCE, MANAGER_ENTRY_DIVISION, MAX_DIVISION, POOL_TARGET_SIZE, SPONSOR_INCOME_BASE } from "./economyConstants.js";
```

- [ ] **Step 3: Kør testene og verificér at de tre nye fejler**

Run: `node --test --import ./backend/test-setup.js backend/lib/teamProfileEngine.test.js`
Expected: FAIL på alle tre "overflow:"-tests (nuværende kode kender ikke til `MAX_DIVISION`-fald-igennem — alle hold lander stadig i `MANAGER_ENTRY_DIVISION`). De eksisterende tests (inkl. "blød cap") forbliver PASS.

- [ ] **Step 4: Implementér overflow-logikken i `pickDivisionForNewTeam`**

I `backend/lib/teamProfileEngine.js`, erstat hele funktionen (linje 173-220):

```js
async function pickDivisionForNewTeam(supabase) {
  const { data: pools, error: poolsError } = await supabase
    .from("league_divisions")
    .select("id, tier")
    .in("tier", [MANAGER_ENTRY_DIVISION, MAX_DIVISION]);

  if (poolsError) {
    throw createHttpError(500, poolsError.message);
  }

  const allPools = pools || [];
  const entryPools = allPools.filter((p) => p.tier === MANAGER_ENTRY_DIVISION);
  const overflowPools = allPools.filter((p) => p.tier === MAX_DIVISION);

  if (entryPools.length === 0) {
    // Pre-migration / mock-edge: ingen puljer at sprede på. Hold kommer stadig ind i
    // entry-divisionen; pulje-referencen efter-allokeres når puljerne findes.
    return { division: MANAGER_ENTRY_DIVISION, leagueDivisionId: null };
  }

  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("league_division_id")
    .eq("is_ai", false)
    .eq("is_test_account", false)
    .eq("is_frozen", false);

  if (teamsError) {
    throw createHttpError(500, teamsError.message);
  }

  const counts = new Map(allPools.map((pool) => [pool.id, 0]));
  for (const team of teams || []) {
    if (counts.has(team.league_division_id)) {
      counts.set(team.league_division_id, counts.get(team.league_division_id) + 1);
    }
  }

  // #2055 overflow: hvis ALLE entry-puljer er ved/over POOL_TARGET_SIZE (rigtige
  // managers, AI tæller ikke med — den er evict-bar), og der findes mindst én
  // MAX_DIVISION-pulje, fald igennem dertil. Ellers: uændret blød-cap-adfærd i
  // entry-divisionen (graceful fallback, fx pre-migration/test-mock uden
  // MAX_DIVISION-puljer).
  const entryIsSaturated = entryPools.every((pool) => counts.get(pool.id) >= POOL_TARGET_SIZE);
  const targetPools = entryIsSaturated && overflowPools.length > 0 ? overflowPools : entryPools;
  const targetDivision = targetPools === overflowPools ? MAX_DIVISION : MANAGER_ENTRY_DIVISION;

  // Mindst-fyldte målpulje (deterministisk: laveste pulje-id ved lige fyldning).
  let chosenPoolId = targetPools[0].id;
  let chosenCount = counts.get(chosenPoolId);
  for (const pool of targetPools) {
    const count = counts.get(pool.id);
    if (count < chosenCount) {
      chosenPoolId = pool.id;
      chosenCount = count;
    }
  }

  return { division: targetDivision, leagueDivisionId: chosenPoolId };
}
```

- [ ] **Step 5: Kør testene og verificér at de passerer**

Run: `node --test --import ./backend/test-setup.js backend/lib/teamProfileEngine.test.js`
Expected: PASS — alle tests, inkl. de tre nye og alle eksisterende (specielt "blød cap"-testen, der nu dækker fallback-stien).

- [ ] **Step 6: Kør hele backend-test-suiten**

Run: `npm test --prefix backend`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/lib/teamProfileEngine.js backend/lib/teamProfileEngine.test.js
git commit -m "feat: fald igennem til division 4, når alle division-3-puljer er mættet"
```

---

### Task 5: End-to-end-verifikation (prod)

**Files:** Ingen kodeændringer — kun SQL-verifikation mod den allerede pushede prod-database.

- [ ] **Step 1: Bekræft at division 4's kalender stadig matcher division 3's mønster**

```sql
select ld.label, count(*) as race_count
from races r join league_divisions ld on ld.id = r.league_division_id
where ld.tier in (3, 4)
group by ld.label
order by ld.tier, ld.label;
```

Expected: alle 4 division-3-rækker viser samme `race_count` (46, uændret fra før dette arbejde), alle 8 division-4-rækker viser samme `race_count` som hinanden (nyt, fra Task 3).

- [ ] **Step 2: Bekræft AI-fyld virker uændret for division 4 (ingen kodeændring i Task 4/aiTeamGenerator nødvendig, men verificér antagelsen)**

```sql
select t.league_division_id, ld.label, count(*) filter (where t.is_ai) as ai_count
from teams t join league_divisions ld on ld.id = t.league_division_id
where ld.tier = 4
group by t.league_division_id, ld.label;
```

Expected (FØR nogen rigtig manager er landet i division 4 endnu): 0 rækker, eller alle `ai_count = 0` — `reconcileAiTeamsForPool` fylder kun AI når `realManagers.length > 0` (jf. spec afsnit 3). Dette er forventet, IKKE en fejl — AI-feltet bygges først, når den første rigtige manager lander der (samme automatik som division 3 allerede har).

- [ ] **Step 3: Opdatér `docs/NOW.md`**

Tilføj en linje under "Aktiv styring", der noterer at division 4 nu er live-klar (overflow-logik + kalender), og at AI-feltet bygger sig selv ved første ankomst — følg eksisterende close-out-budget (~1.200 tokens, trim ældre blokke direkte fremfor at arkivere).

- [ ] **Step 4: Patch notes**

Tilføj en linje til `PatchNotesPage.jsx` (eller noter eksplicit hvorfor ikke, jf. CLAUDE.md close-out-regel) — dette er en brugerrettet ændring (nye managere kan nu lande i division 4), så det kvalificerer til patch notes selvom det sker automatisk/usynligt for de fleste spillere.

- [ ] **Step 5: Push**

```bash
git push -u origin feat/division-4-activation
```

Opret PR — denne branch indeholder en database-skrivende prod-handling (Task 1+3's script-køringer er allerede udført direkte mod prod under planudførelsen, ikke via migration), så følg `feedback_git_push`-reglen: PR'en i sig selv indeholder ingen `.sql`-migration, men **ejeren bør stadig gennemgå og merge selv** givet at signup-allokeringslogikken (Task 4) er et live spilleradfærds-skift.
