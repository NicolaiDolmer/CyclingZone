# Race Hub S3 — Fase 2 Holdstrategi (Lag 0) — design

> **Status:** udkast til review · **Dato:** 2026-06-25 · **Branch:** `feat/race-hub-s3-strategy` (isoleret worktree)
> **Relation:** implementerer Lag 0 fra master-designet `2026-06-23-race-hub-redesign-design.md` (§3.5, §5 Lag 0, §6) og slice **S3** fra eksekverings-programmet `2026-06-25-race-hub-program-design.md` (§4, §5 S3, §6 delt fundament). Bygger oven på S1+S2a (merged #1838) + #1839 (selectInChunks-paginering, merged).
> **Build-out, ikke live-blokerende.** `database/*.sql` auto-applies i prod ved merge → **EJER MERGER denne PR.**

## 1. Formål

Holdstrategi-laget er de **stående præferencer** der fodrer den proaktive entry-generator. Manageren sætter dem sjældent; assistenten bruger dem til at generere et bedre forslag til hele kalenderen, så finjustering bliver minimal. Fire byggeklodser:

1. **A-kæde** — rangordnet kerne-trup; prioriteres til mål-løbene.
2. **Faste rolle-regler** pr. rytter — "altid kaptajn" / "altid sprint-kaptajn hvis med".
3. **Kaptajn 1/2/3 pr. terræntype** — rangordnede kaptajn-kandidater pr. bucket (flad/bakke/bjerg/brosten/ITT).
4. **Mål-løb** — hvilke løb betyder mest.

Strategien er et **deterministisk præference-lag** oven på den eksisterende autopick. Den ændrer *hvem* assistenten foretrækker og *hvem* der får roller — aldrig binding-invarianten, pulje-invarianten eller manuelle redigeringer.

## 2. Låste beslutninger

| # | Beslutning | Kilde |
|---|------------|-------|
| L1 | **A-kæde = rangordnet array** (index = prioritet, 0 = top). Tiebreak bevarer generatorens determinisme. | D6 (program-spec) |
| L2 | **A-kæde-dybde = Fork A ("garantér kerne til mål-løb").** Ved mål-løb sorteres A-kæden FØRST (rang→score→rider_id); ved øvrige løb er rækkefølgen uændret (score→rider_id). A-kæden hviles IKKE aktivt ved ikke-mål-løb (træthedsdæmpningen i score gør det mildt). Lav risiko, ikke balance-følsom. | Ejer 25/6 |
| L3 | **terrainBucket-mapping:** flat+rolling→`flat`, hilly+classic→`hilly`, mountain+high_mountain→`mountain`, cobbles→`cobbles`, itt+ttt→`itt`. | Ejer 25/6 |
| L4 | **AI-hold = samme generator, `strategy=null`** (ingen strategi-række). Tvunget af idempotens-kravet (null ≡ nuværende AI-adfærd). En auto-genereret AI-strategi = YAGNI, noteret som fremtidig udvidelse. | Master §8 → ejer-lock |
| L5 | **Idempotens-mekanismen er uændret:** manuelle entries (`is_auto_filled=false`) røres aldrig + låses som binding-vinduer; `mode=missing` bevarer dem. Strategi påvirker KUN auto-sættet. `strategy=null` ≡ bit-for-bit uændret (idempotens-test KRÆVET). | Hardening + ejer |
| L6 | **Rolle-præcedens:** per-rytter fast regel > kaptajn 1/2/3 pr. terræn > autopickens GC-kaptajn-fallback. `always_sprint_captain_if_present` → sprint-kaptajn hvis udtaget og ikke allerede kaptajn. | Afledt, låst her |
| L7 | **Strategi-gem skriver IKKE entries.** Det viser live preview-diff + tilbyder eksplicit "Regenerér forslag" (kalder `regenerate?mode=missing`). Beskytter manuelle redigeringer. | World-class + ejer-lock |
| L8 | **Stale rider/race-ids filtreres tavst** mod faktisk trup/kalender ved læsning (ingen fejl, ingen FK på array-indhold). | D6 / hardening |

## 3. Datamodel

To tabeller. Migration: `database/2026-06-25-team-race-strategy.sql` (idempotent: `CREATE TABLE IF NOT EXISTS` + `DROP POLICY IF EXISTS`; `schema_migrations`-insert via auto-migrate.yml). **Ejer merger.**

```sql
-- Holdets stående strategi (én række pr. hold).
CREATE TABLE IF NOT EXISTS public.team_race_strategy (
  team_id            UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  a_chain            JSONB NOT NULL DEFAULT '[]'::jsonb,   -- rangordnet array af rider_id (string)
  captain_priorities JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { flat:[rider_id], hilly:[...], mountain:[...], cobbles:[...], itt:[...] }
  target_race_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array af race_id (string)
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Faste rolle-regler pr. rytter (sparse — kun ryttere med en regel).
CREATE TABLE IF NOT EXISTS public.team_rider_role_rules (
  team_id   UUID NOT NULL REFERENCES public.teams(id)  ON DELETE CASCADE,
  rider_id  UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  role_rule TEXT NOT NULL CHECK (role_rule IN ('always_captain','always_sprint_captain_if_present')),
  PRIMARY KEY (team_id, rider_id)
);
CREATE INDEX IF NOT EXISTS idx_team_rider_role_rules_team ON public.team_rider_role_rules(team_id);
```

**RLS** (spejler scouting-l1 / sponsor-contracts-mønsteret): læs = eget team (authenticated), skriv = service_role (backend-endpoint, ingen klient-write-policy).

```sql
ALTER TABLE public.team_race_strategy   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_rider_role_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_race_strategy_select_own" ON public.team_race_strategy;
CREATE POLICY "team_race_strategy_select_own" ON public.team_race_strategy
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM public.teams WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "team_rider_role_rules_select_own" ON public.team_rider_role_rules;
CREATE POLICY "team_rider_role_rules_select_own" ON public.team_rider_role_rules
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM public.teams WHERE user_id = auth.uid()));

GRANT SELECT ON public.team_race_strategy   TO authenticated;
GRANT SELECT ON public.team_rider_role_rules TO authenticated;
```

> Backend læser via service_role (omgår RLS), men endpointet scoper altid til `req.team.id`. RLS er forsvar-i-dybden for evt. direkte klient-læsning. Skrivning sker kun via `PUT /api/races/strategy`.

## 4. terrainBucket — ny delt pure export

`backend/lib/raceTerrain.js` (ny fil, ren, node --test):

```js
export const TERRAIN_BUCKETS = Object.freeze(["flat","hilly","mountain","cobbles","itt"]);
const PROFILE_TO_BUCKET = { flat:"flat", rolling:"flat", hilly:"hilly", classic:"hilly",
  mountain:"mountain", high_mountain:"mountain", cobbles:"cobbles", itt:"itt", ttt:"itt" };
export function terrainBucket(profileType) { return PROFILE_TO_BUCKET[profileType] ?? "flat"; }
```

**Race-niveau bucket** (hvilken kaptajn-prioritetsliste gælder for ET løb): `raceTerrainBucket(stages)` = dominerende bucket over løbets **GC-etaper** (genbrug `gcStages`-konceptet: ikke-flade etaper hvis nogen findes, ellers alle). Et endagsløb → dets ene profils bucket; et bjerg-etapeløb → `mountain` (selv om de fleste etaper er flade). Konsistent med hvordan autopick allerede vælger kaptajn på GC-etaper. Tie → stabil rækkefølge efter `TERRAIN_BUCKETS`-index.

## 5. Præference-laget (autopick)

### 5.1 Strategi-objektet (team-niveau, til generator-kernen)
```
strategy = {
  aChain: [rider_id, ...],                 // rangordnet
  captainPriorities: { flat:[...], hilly:[...], mountain:[...], cobbles:[...], itt:[...] },
  roleRules: { rider_id: 'always_captain' | 'always_sprint_captain_if_present' },
  targetRaceIds: Set<race_id>
}  // eller null
```

### 5.2 `assignTeamAcrossRaces({ riders, races, lockedWindows, strategy=null })`
Uændret kronologi/binding. NYT: pr. løb udledes en **per-race preference** og gives til autopick:
```
preference = {
  aChain,                                  // team-niveau (uændret pr. løb)
  captains: captainPriorities[raceTerrainBucket(race.stages)] || [],
  roleRules,
  isTargetRace: targetRaceIds.has(race.race_id)
}  // null hvis strategy === null
```

### 5.3 `autopickTeamSelection({ riders, stages, sizeRule, preference=null })`
**`preference == null` → eksisterende kode-sti, byte-identisk output (idempotens).** Når preference er sat:

**(a) Holdudvælgelse (hvem):**
- `isTargetRace && aChain.length`: partitionér `available` (de der har abilities) i A-kæde-medlemmer (sorteret efter aChain-rang) + resten (sorteret score↓, rider_id↑). Konkatener A-kæde-blok FØRST. Tag top `max`.
- Ellers: score↓, rider_id↑ (uændret).
- Stale aChain-ids (ikke i `available`) ignoreres tavst.

**(b) Kaptajn (præcedens L6):**
1. `always_captain`: blandt `picked` med den regel → vælg én (aChain-rang→rider_id).
2. `captains`-liste (bucket): walk i rækkefølge, første der er i `picked` → kaptajn.
3. Fallback: eksisterende GC-kaptajn (bedst på `gcStages`).

**(c) Sprint-kaptajn:**
1. `always_sprint_captain_if_present`: blandt `picked` med den regel, ikke == kaptajn → sprint-kaptajn (aChain-rang→rider_id).
2. Fallback: eksisterende (bedste sprinter på flade etaper, ikke == kaptajn).

**(d) Determinisme:** alle tiebreaks ender i `rider_id`; aChain-rang er array-index. Hunter sættes ikke af generatoren (uændret).

## 6. Generator-integration (begge veje)

- **`runRaceEntryGenerator` (bulk, alle hold):** ny load af `team_race_strategy` + `team_rider_role_rules` for egnede hold (selectInChunks) → `strategyByTeam: Map`. Pass `strategy: strategyByTeam.get(team.id) ?? null`. Hold uden række → null → uændret. Additivt + idempotent.
- **`POST /api/races/distribution/regenerate` (ét hold):** load holdets strategi → pass til `assignTeamAcrossRaces`. Uændret mode/frys/lås-logik.

Begge bygger `strategy`-objektet via én delt loader `loadTeamStrategy({ supabase, teamId })` (henter + normaliserer + filtrerer stale ids mod holdets faktiske ryttere). Bulk-varianten loader for mange hold ad gangen (`loadStrategiesForTeams`).

## 7. API-endpoints

Alle flag-gated (`isRaceEngineV2Enabled`), `requireAuth`, scoped til `req.team.id`.

- **`GET /api/races/strategy`** — returnerer: `a_chain`, `captain_priorities`, `target_race_ids`, `role_rules` (rider_id→rule), holdets **roster** (id, navn, type, overall) + **suitability pr. bucket** pr. rytter (til kaptajn-board + auto-foreslå) + holdets **kommende løb** (id, navn, klasse, terrain bucket, dag, status via `deriveRaceStatus`) til mål-løb-markering. Stale ids filtreret.
- **`PUT /api/races/strategy`** — upsert `team_race_strategy` + erstat `team_rider_role_rules` (delete-then-insert for holdet). Body valideres: ukendte/fremmede rider_ids droppes tavst (robust mod roster-ændringer); malformed body → 400 `strategy_invalid_body`. Skriver IKKE entries.
- **`POST /api/races/strategy/preview`** — live preview-diff. Tager den (foreslåede) strategi i body, kører `assignTeamAcrossRaces` mod holdets **kommende, ikke-startede, ikke-manuelle** løb (manuelle/startede som lockedWindows), differ mod nuværende entries. Returnerer pr. løb: `added`/`removed` rider-navne + kaptajn-skift. Skriver intet. Bounded til kommende løb.

**Suitability pr. bucket** (serverside, til kaptajn-board): for den aktive sæson aggregeres `race_stage_profiles.demand_vector` pr. bucket (gennemsnit) → repræsentativ vektor pr. bucket; pr. rytter `terrainScore(abilities, avgBucketVector)` → 0-100. Ægte kalender-data. Buckets uden løb i sæsonen → null (UI viser "—").

## 8. Frontend — Lag 0 Holdstrategi

Ny route `/races/strategy` (master §4-routing) → `StrategyPage.jsx`. Ren logik i `frontend/src/lib/strategyLogic.js` (node --test: ranking-ops, diff-formatering, bucket-suitability-sortering, auto-foreslå-udvælgelse). Editorial navy/guld/Bebas, ingen AI-slop. EN-først copy (`races.json` en+da).

Sektioner:
1. **A-kæde (pecking-order):** rangordnet liste; tilføj fra roster + flyt op/ned + fjern. Viser navn + type + overall. Tom-tilstand forklarer formålet.
2. **Faste rolle-regler:** pr. rytter et valgfrit flag (ingen / altid kaptajn / altid sprint-kaptajn hvis med).
3. **Kaptajn 1/2/3 pr. terræn:** 5 terræn-grupper (Flad/Bakke/Bjerg/Brosten/ITT), hver en rangordnet liste (op til 3) med **ægte egnethedsdata** (delt `FitBar` mod bucket-suitability) + **"Auto-foreslå"**-knap (top-3 efter bucket-suitability).
4. **Mål-løb:** holdets kommende løb som markerbar liste (genbrug `deriveRaceStatus`-chip + terrain-glyf); marker som mål.
5. **Live preview-diff:** "Sådan ændrer din strategi udtagelserne" — pr. kommende løb hvad der ændres (kalder `/strategy/preview`). Vises før gem.
6. **Gem** → `PUT /strategy`; derefter eksplicit **"Regenerér forslag"** (kalder `regenerate?mode=missing`) — auto-skriver ikke (L7).

Adgang: link fra `RaceHubBoard` (delt bånd / pulje-header) til `/races/strategy`.

## 9. Delt fundament (genbrug, byg ikke om)

Genbrug uden ændring: `raceBindingWindow` + `windowsOverlap` (raceBinding), `deriveRaceStatus` + `poolRaceDayTotals` + `fitTier` + `freshnessTier` (raceHubLogic), `FitBar.jsx`, `selectionSizeForRace` + `suitabilityScore` + `terrainScore` + `gcStages`-mønster (autopick/simulator), `selectInChunks` (generator). Ny delt: `terrainBucket` (raceTerrain.js). `terrainBucket` genbruges senere i S4/S5 (terræn-DNA, rolle-hints).

## 10. Idempotens-kontrakt (KRÆVET test)

- `assignTeamAcrossRaces(args)` ≡ `assignTeamAcrossRaces({...args, strategy:null})` for samme fixture (dyb lighed).
- `autopickTeamSelection(args)` ≡ `autopickTeamSelection({...args, preference:null})`.
- Property: strategi med tom aChain/captainPriorities/roleRules/targetRaceIds ≡ null-adfærd.
- Stale-filter: aChain/captains/roleRules der peger på ryttere uden for `available` ændrer intet.
- Determinisme: to kørsler med samme input giver identisk output (ingen Date/random).

Adversariel verifikation (ultracode-workflow) FØR merge: blast-radius af generator-integrationen + uafhængig idempotens-refutation (strategy=null på ægte prod-lignende fixture).

## 11. Uden for scope (S3)

- **Aktiv hvile af A-kæden ved ikke-mål-løb** (Fork B) — fremtidig, balance-følsom.
- **Auto-genereret AI-strategi** (lettere variant) — YAGNI (L4).
- **S2b global cursor / 140-rekalibrering** — egen sim-gated slice.
- **Drag-and-drop med biblioteker** — op/ned-knapper er nok (ingen ny dep).

## 12. Proces / test-plan

- **TDD:** backend `node --test` (terrainBucket, raceTerrainBucket, autopick-preference, assignTeamAcrossRaces-strategi, idempotens, loadTeamStrategy-normalisering, preview-diff). Frontend `node --test` (strategyLogic). Skriv test før impl.
- **CI-gate-sæt:** `verify-local.ps1` + `npm run lint` + i18n-leak + tone/em-dash + warning-budget.
- **Playwright:** logget-ind verifikation via fixtures-mocks; core-smoke alle 3 projekter ved visuel ændring + snapshot-refresh.
- **Patch notes** (`PatchNotesPage.jsx`) + **help.json (en+da)** — ny mekanik (Holdstrategi).
- **FEATURE_STATUS.md** opdateres (ny Lag 0-flade + endpoints).
- **PR med fuld Brugerverifikation.** `database/*.sql` → **ejer merger.**
- Markér issue `claude:todo`→`claude:done` efter merge.
