# Realistisk parcours pr. løb — arketype-anker (design)

**Dato:** 2026-06-28 · **Status:** spec til review · **Branch:** `fix/stage-profile-seed-by-race-identity`

## 1. Problem (to uafhængige fejl)

**A. Konsistens-bug (allerede rettet på branchen, ikke shippet).** Hver division har parallelle
puljer der kører SAMME løb. Stage-profilerne (`race_stage_profiles`) blev seedet på den per-pulje/
per-sæson `races.id` → samme rigtige løb fik FORSKELLIGT parcours i hver pulje. Målt på prod:
Div 2 89/112 etape-slots divergerede, Div 3 78/84. Rettet ved at seede på løbets virkelige
identitet (`external_id`) via `seedIdentityFor` (+ `GENERATOR_VERSION` 1→2).

**B. Realisme-gap (denne spec).** Generatoren (`raceStageProfileGenerator.js`, #1102 "launch-sikker
motor") trækker terræn fra en **vægtet tilfældig fordeling** uafhængigt af løbets faktiske karakter.
Navnene er genkendelige fiktionaliseringer af ægte løb (`L'Enfer du Nord` = Paris-Roubaix/brosten,
`La Classica d'Autunno` = Lombardia/bjerg, `Le Mur de Huy` = Flèche/puncher), men parcourset matcher
ofte ikke: `Trofeo delle Tre Valli` (kuperet klassiker) blev genereret som flad. Katalogets
`country`-felt er tomt for alle 121 løb; der findes intet terræn-karakter-felt.

Konsistens (A) er løst. Denne spec løser realisme (B) — og folder de to sammen til **én** regen, så
prod kun skrives én gang. 0 løb er kørt i sæson 1, så der er ingen hast.

## 2. Mål / ikke-mål

**Mål**
- Hvert katalog-løb får et **terræn-arketype** der afspejler dets virkelige karakter, og som driver
  parcours-genereringen.
- Parcours varierer **pr. sæson** (ægte løb justerer rute hvert år), men er **identisk for alle
  grupper i en division inden for en sæson** (bevarer konsistens-fixet).
- `country` udfyldt for alle 121 løb (display/flag-metadata).
- Generatoren forbliver deterministisk, seeded og ren (ingen DB).

**Ikke-mål**
- Ikke fuld håndkuratering pr. etape (afvist: statisk + tung vedligehold).
- Ikke en geografisk/højde-model — `country` er metadata, ikke terræn-driver.
- Ikke ændringer i race-simulatoren eller demand-vektorerne (Plan 1-frosset).

## 3. Datamodel — to nye felter på `race_pool`

| Felt | Type | Rolle |
|---|---|---|
| `country` | text (nullable) | Display-metadata (flag/geografi i UI). Udledt fra navnene. |
| `terrain_archetype` | text (nullable) | Løbets karakter — **driveren**. Enum (se §4). NULL → generatoren falder tilbage til de nuværende generiske vægte (bagudkompatibelt). |

Migration tilføjer kolonnerne (additivt, `IF NOT EXISTS`). Værdierne er **version-styrede** (se §6),
ikke kun løs DB-state, så en katalog-rebuild bevarer dem.

## 4. Arketype-taksonomi

Arketypen bestemmer terræn. Endagsløb → ét profil (let seeded variation). Etapeløb → en
mål-terrænfordeling som generatoren sampler fra (bevarer "bygger-mod-bjergene"-buen og garantierne).
Vægtene nedenfor er start-defaults, tunbare ét sted (`ARCHETYPE_PROFILES`).

### 4.1 Endagsløb (1 etape → ét profil + finale)
| Arketype | Profil-vægte | Finale | Ægte forbillede |
|---|---|---|---|
| `flat_sprint` | flat 80, rolling 20 | bunch_sprint | Scheldeprijs, kyst-klassikere |
| `cobbled_classic` | cobbles 90, flat 10 | reduced_sprint / breakaway | Roubaix, E3, Nokere |
| `puncheur` | hilly 85, classic 15 | punch | Flèche Wallonne, Amstel-agtige |
| `hilly_classic` | hilly 50, classic 35, rolling 15 | reduced_sprint / punch / breakaway | Tre Valli, Coppa-løb |
| `mountain_classic` | mountain 60, high_mountain 30, hilly 10 | long_climb | Lombardia |
| `long_sprint_classic` | rolling 60, flat 25, hilly 15 | reduced_sprint | Milano-Sanremo |

### 4.2 Etapeløb (N etaper → fordeling + garantier)
Garantier indsættes først, resten fyldes fra vægtene, derefter ordnes med `STAGE_ORDER_HINT`
(flad tidligt → bjerg sent — uændret logik).

| Arketype | Garantier | Filler-vægte (flat/rolling/hilly/mountain/high_mtn/itt/ttt) | Ægte forbillede |
|---|---|---|---|
| `grand_tour` | ≥2 high_mountain summit, ≥1 itt, ≥3 flad; ttt mulig (1, tidlig) | 26/12/14/20/14/12/2 | Giro, Vuelta (21 etaper) |
| `mountain_tour` | ≥2 mountain summit, ≥1 flad | 16/14/14/34/16/6/0 | Tour des Alpes Suisses, Auvergne |
| `hilly_tour` | ≥2 hilly, ≥1 flad | 18/22/34/14/4/8/0 | Tirreno-agtige |
| `sprinters_week` | ≥1 mountain (GC), flest flad | 50/22/12/10/0/6/0 | Korte ProSeries-uger |
| `balanced_week` | ≥1 flad, ≥1 mountain | 30/20/18/18/4/10/0 | Standard-uge |

Garantierne erstatter den nuværende hårdkodede "≥1 flad + ≥1 bjerg" (som var korrekt for et
gennemsnitsløb, men forkert for fx en ren sprinter-uge eller en bjergrundt).

## 5. Generator-adfærd (`raceStageProfileGenerator.js`)

**5.1 Seed = løb-identitet + sæson.**
`seed = stableSeed(seedIdentityFor(race) + (race.season_id ? "::" + race.season_id : ""))`.
- Alle grupper i en sæson: samme `external_id` + samme `season_id` → identisk parcours (konsistens).
- På tværs af sæsoner: forskelligt `season_id` → nyt, men karakter-tro parcours (variation).
- Uden `season_id` (tests/legacy): seedes på identitet alene (bagudkompatibelt).
`seedIdentityFor` (external_id ?? pool_race_id ?? id, tom-streng som fraværende) er uændret.

**5.2 Arketype-drevet fordeling.**
- Ny eksporteret `ARCHETYPE_PROFILES` (data) + opslag `archetypeFor(race)` → fordeling/garantier.
- `buildSingle` bruger arketypens endagsløbs-profil i stedet for `SINGLE_PROFILE_WEIGHTS`.
- `buildStageRace` bruger arketypens garantier + filler-vægte i stedet for de hårdkodede.
- `terrain_archetype` NULL/ukendt → nuværende generiske vægte (uændret fallback) + en `log`/advarsel
  i backfill så manglende mærker er synlige.

**5.3 Uændret:** `DEMAND_VECTORS`, `FINALE_BY_PROFILE`, `STAGE_ORDER_HINT`, mulberry32-RNG,
returformen `{stage_number, profile_type, finale_type, demand_vector}`. `GENERATOR_VERSION` → 3
(stempler den arketype-seedede generation; intet runtime-guard afhænger af tallet).

## 6. Persistering af arketype + land (version-styret)

1. **Migration** `database/2026-06-28-race-pool-archetype-country.sql`: `ADD COLUMN IF NOT EXISTS
   country text`, `terrain_archetype text`. (Ejer merger — migration auto-applies i prod.)
2. **Data-fil** `database/seed/race_pool_archetypes.json`: array af `{external_id, name,
   country, terrain_archetype}` — de forfattede værdier, version-styret + editerbar uden ny migration.
3. **Apply-script** `backend/scripts/applyRacePoolArchetypes.js`: idempotent UPSERT af filen mod
   `race_pool` (match på `external_id`). Read-only dry-run default.
4. **Import-sti** (`racePoolImport.js` / kilde-CSV) får kolonnerne med, så fremtidige re-imports
   bærer dem (kataloget er importeret fra CSV — CSV'en er den langsigtede kilde-sandhed).

## 7. Forfatnings-/review-flow

1. Jeg udleder `country` + `terrain_archetype` for alle 121 løb ud fra de genkendelige ægte løb.
2. Præsenteres som review-tabel grupperet pr. klasse (Monuments/GT/WorldTour/ProSeries/Class1/Class2).
3. Ejeren retter (flytter løb mellem arketyper, justerer land).
4. Det rettede sæt skrives til `race_pool_archetypes.json` + anvendes via apply-scriptet.

## 8. Integration (de fire genererings-veje)

Alle fire tråder allerede `external_id` (konsistens-fixet). Tilføj `terrain_archetype` (fra katalog-
map) + `season_id` på race-objektet før `generateRaceStageProfiles`:
- `tierCalendarMaterializer.js` — katalog-select + map (har allerede external_id-map; tilføj archetype).
- `seasonCalendarMaterializer.js` — do.
- `backfillRaceStageProfiles.js` — katalog-map (har allerede external_id-map; tilføj archetype) + `season_id` er allerede på race-rækken.
- `api.js` ad-hoc enkelt-løb — uændret (intet katalog-id; falder tilbage til id-seed + generisk fordeling).

## 9. Test

- **Arketype→karakter:** hver endagsløbs-arketype giver sit karakteristiske terræn
  (`cobbled_classic`→cobbles, `puncheur`→hilly/punch …); hver etapeløbs-arketype opfylder sine
  garantier over mange seeds.
- **Sæson-variation:** samme løb, forskelligt `season_id` → forskelligt parcours; samme løb + samme
  `season_id`, forskellig `races.id` (puljer) → IDENTISK (konsistens bevaret).
- **Dækning:** hver `terrain_archetype`-værdi i data-filen findes i `ARCHETYPE_PROFILES`; hvert
  katalog-løb har en arketype efter forfatning (test/script-guard).
- **Materializer-integration:** udvid den eksisterende tier-materializer-test til at asserte at to
  puljer i samme tier får identisk arketype-drevet parcours pr. delt `pool_race_id`.
- **Diagnostik:** `checkStageProfileSeedDivergence.js` udvides med en sæson-akse (EFTER stadig 0
  kryds-pulje-divergens; logger arketype-dækning).

## 10. Regen + rollout (én prod-skrivning)

1. Migration merges (ejer) → kolonner findes i prod.
2. Forfat + review arketyper → `race_pool_archetypes.json` → apply-script kører → katalog beriget.
3. Generator + integration + tests grønne (CI).
4. Backup af `race_stage_profiles` (allerede taget: `backup_seedfix_20260628_race_stage_profiles`).
5. `backfillRaceStageProfiles.js --season 1` (ejer-go) → regenererer alle profiler, nu konsistente
   OG realistiske.
6. Verificér: `checkStageProfileSeedDivergence.js` (EFTER=0) + stikprøve af løb-navne vs parcours mod
   virkeligheden + integritets-tjek (profil-antal == etaper pr. løb).

## 11. Beslutninger truffet

- Arketype-anker driver generatoren (ikke fuld kuratering, ikke kun-ikoniske). — ejer 2026-06-28
- Variér pr. sæson (seed = identitet + sæson). — ejer 2026-06-28
- Jeg udkaster alle 121, ejer retter. — ejer 2026-06-28
- Udfyld `country` nu. — ejer 2026-06-28
- Persistér som version-styret data-fil + migration. — ejer 2026-06-28

## 12. Åbne punkter (ikke-blokerende)

- Eksakte filler-vægte pr. arketype finjusteres når de første regen-stikprøver ses (samme
  "simulér-før-ship"-disciplin som balance-systemer).
- Om enkelte marquee-GT'er (Giro/Vuelta) skal have en fast håndsat etape-rygrad oven på arketypen
  (via `is_manual`) — kan tilføjes senere uden at ændre modellen.
