# RIDER_GENERATION.md — SSOT for hvordan ryttere skabes

> **Ejer-krav 24/8 ([#4178](https://github.com/NicolaiDolmer/CyclingZone/issues/4178)):** reglerne for rytter-generering lå spredt som kodekommentarer i 9 moduler over ~3.100 linjer, med 16 frosne ejer-beslutninger og intet samlet sted. Konkret skade: AI-trupstørrelsen (24, ikke 8) stod begravet i `starterSquadAllocator.js:133` og blev fejlrapporteret til ejeren under #4172.
>
> **VEDLIGEHOLDELSESREGEL (bindende):** enhver ændring i hvordan ryttere skabes — navne, stats, nationalitet, trupstørrelser, AI-politik, akademi, derive-kæden — SKAL opdatere dette dokument i samme PR. Ændrer du en frossen konstant, skal issue-referencen med. Dette dokument er sandheden om *hvad reglerne er*; koden er sandheden om *hvordan de udføres*.
>
> Afgrænsning: rytter-**økonomi** (market_value, salary, kontrakter, præmier) bor i [`GAME_INVARIANTS.md`](GAME_INVARIANTS.md). Her handler det kun om *skabelsen*.

## Modul-ejerskab

| Modul | Ejer reglerne om |
|---|---|
| `lib/fictionalRiderGenerator.js` | navnevalg, tier-kvoter, nationalitetsfordeling, stat-sampling |
| `lib/fictionalRiderNames.js` | navne-clusters + ISO-landemapping |
| `lib/fictionalLaunchPopulation.js` | grund-seed for hele populationen |
| `lib/fictionalRiderMixPresets.js` | komposition-presets ([#1420](https://github.com/NicolaiDolmer/CyclingZone/issues/1420)) |
| `lib/starterSquadAllocator.js` | trupstørrelser, stat-vinduer pr. tier, værdilofter |
| `lib/aiTeamGenerator.js` | AI-fyld-politik ([#1688](https://github.com/NicolaiDolmer/CyclingZone/issues/1688)), AI-holdnavne |
| `lib/aiTeamNames.js` | AI-holdenes navne |
| `lib/academyGenerator.js` | akademi-ryttere |
| `lib/riderTypes.js` + `riderTypesBaseline*.json` | rytter-typer |

## 1. Determinisme-kontrakten

Al generering er deterministisk: samme seed giver samme ryttere. Det er en hard rule, fordi relaunch/replay skal kunne reproducere en population.

- Grund-seed: `LAUNCH_POPULATION.seed` i `fictionalLaunchPopulation.js`.
- Per-hold: `deriveTeamSeed(baseSeed XOR hash("<poolId>:<ordinal>"))`. AI-hold bruger `baseSeed + 1688` for kernen og `baseSeed + 1688 + 7` for halen, så AI-trupper ikke spejler start-trupperne.
- Ændrer du en navneliste, et tier-fraktion eller et stat-vindue, ændres hvilke ryttere en given seed producerer. Det er ufarligt for ryttere der allerede står i DB, men betyder at en re-generering ikke reproducerer den gamle population. Antag aldrig at en historisk seed kan genskabe historiske ryttere efter en listeændring.

## 2. Navne

**Struktur:** 22 clusters à 40 fornavne × 60 efternavne = **52.800 basis-kombinationer**, mappet fra 157 ISO-landekoder. Ukendte koder falder til `generic`.

**Unikhedskæden** (`makeUniqueName`, `fictionalRiderGenerator.js`):
1. 40 forsøg på `fornavn + efternavn`
2. derefter 40 forsøg på `fornavn + initial. + efternavn`
3. derefter **kastes** `"Navne-pool udtømt"` — hård fejl, ikke en stille degradering

Unikheden måles med `foldNameNordic` mod **alle** eksisterende rytternavne i DB, ikke kun mod den aktuelle batch.

**Kapacitet (målt 24/8, #4178):**

| Bestand | Andel med kunstigt mellem-initial |
|---|---|
| 10.000 | 0 % |
| 20.000 | 2,8 % |
| 30.000 | 9,1 % |
| 40.000 | 19,5 % |

**Hvornår skal listerne udvides?** Når andelen med mellem-initial nærmer sig 10 %, eller når en enkelt nationalitet overstiger ~40 % af sit clusters basis-kombinationer. Mål andelen med:

```sql
select nationality_code, count(*) as ryttere,
       round(100.0 * count(*) filter (where firstname like '% _.') / count(*), 0) as pct_initial
from public.riders group by nationality_code having count(*) >= 100 order by pct_initial desc;
```

**Historik:** før #4178 var der 15 clusters à 18×28 (~7.000 kombinationer). 34 % af alle ryttere bar et kunstigt initial, værst Argentina 68 %, Colombia 64 %, Spanien 64 %, Korea 53 %. Årsagen var at ES, CO, AR, MX, PE + 15 lande delte ét spansk cluster, mens Frankrig og Italien havde deres eget og derfor var rene (2 % og 6 %). Splittet i #4178: spansk → spansk + latinamerikansk; anglo → anglo (GB/IE) + nordamerikansk + oceanisk; slavisk → slavisk (CZ/SK/SI/HR) + polsk + østslavisk + balkan + baltisk.

**Bevar `anglo` som cluster-nøgle.** `boardMandateNames.js` bruger `NAME_CLUSTERS.anglo` som fallback for ukendt DNA. Omdøb eller fjern den ikke uden at rette den sti.

## 3. Trupstørrelser

| Konstant | Kerne | Hale | I alt | Gælder |
|---|---|---|---|---|
| `STARTER_SQUAD` | 8 | 4 | **12** | manager-holds start-trup |
| `AI_SQUAD` | 8 | 16 | **24** | AI-holds trup (ejer 2026-06-30: "op til 24 ryttere på holdene") |

Kernen er 8 = `MIN_RIDERS_FOR_RACE` (løbs-minimum) i begge tilfælde. AI-væksten ligger udelukkende i halen, så kerne-fairness-logikken er urørt. `STARTER_SQUAD` har desuden `YOUTH_PER_TEAM: 4`, `DOMESTIQUE_PER_TEAM: 4`, ungdomsalder 18-21 og `YOUNG_POTENTIAL_MIN: 4.0`.

## 4. AI-hold: fyld-politik (frossen, #1688)

- **Tier 1 og 2:** fyld **altid** op til `POOL_TARGET_SIZE` (24). Toppen skal være levende selv før spillere er rykket op dertil.
- **Tier 3 og 4:** fyld **kun** puljer med mindst én ægte manager. AI spildes ikke i tomme puljer der aldrig afvikler løb.
- **Ægte managere fortrænges aldrig** og tælles først. Mister en tier 3/4-pulje sin sidste manager, falder target til 0 og al AI trimmes.
- Idempotent: `reconcileAiTeamsForPool` top-up'er eller trimmer mod target ud fra det **live** antal, så en re-run aldrig duplikerer.

**Stat-vinduer og værdilofter pr. tier** (`starterSquadAllocator.js`):

| Tier | Stat-vindue kerne | Stat-vindue hale | Værdiloft |
|---|---|---|---|
| 1 | via `tierFractions` | — | 200.000 |
| 2 | via `tierFractions` | — | 100.000 |
| 3 | `STARTER_POOL_STAT_WINDOW` | `STARTER_TAIL_STAT_WINDOW` | — |
| 4 | 51-55 | 51-53 | — |

Tier 1/2 bruger den ægte arketype-generator med `tierFractions`; superstar og star er eksplicit sat til 0 (for stærke til AI-modstandere). Tier 3/4 bruger clamp-vindue-stien. Et sikkerhedsnet beregner værdi og primær type lokalt før en rytter accepteres og ruller om ved overskridelse af `valueCap` eller `typeShareCap`.

> **Incident 2026-06-30 ([#2065](https://github.com/NicolaiDolmer/CyclingZone/issues/2065)):** 100 % "solid" til hele tier 1-batchen (300 ryttere) gav gennemsnit 1,52 mio. CZ$ og enkelte over 8 mio. Værdilofterne stammer derfra. Rør dem ikke uden at simulere først.

## 5. Derive-kæden (data-hale-garanti)

Enhver nyskabt rytter skal igennem hele kæden, ellers står han med huller i data:

```
seedPhysiologyFromLegacy → deriveAbilities → computeRiderTypes → predictBaseValue
```

Kaldes som `deriveForRiderIds(supabase, insertedIds, { dryRun: false })` umiddelbart efter insert. Både batch- og single-varianten SKAL bruge `insertDeriveAndReadPool`, så start-truppernes balance ikke kan drifte mellem de to stier.

## 6. Kendte faldgruber

- **PostgREST-paginering:** `select()` uden `.range()` topper stille ved 1000 rækker. Brug `fetchAllRows` fra `supabasePagination.js` til alle loads der kan overstige det. Bed dette bidt under #4172 (rapporterede 1000 af 4.982 entries).
- **Navne-kollision mod markedet:** AI-trupper må ikke kollidere med markeds- eller start-ryttere. `fetchExistingFoldedNamesForAi` henter alle eksisterende navne før generering. Springes den over, fejler insert eller producerer dubletter.
- **`generateAiTeams.js` nægter at skrive til prod** (hardcoded ref-deny). Prod-AI-fyld sker via `reconcileAiTeamsForPool` (signup-stien) eller `relaunchOrchestrator`.
- **Simulér før ship:** rytter-generering er et balance-følsomt system. Kør en empirisk dry-run mod målpopulationen og et scorecard før ændringer merges, jf. den generelle regel for balance-systemer.

## 7. Relaterede dokumenter

- [`GAME_INVARIANTS.md`](GAME_INVARIANTS.md) — rytter-økonomi: værdi, løn, kontrakter, præmier
- [`MASTERPLAN.md`](MASTERPLAN.md) — prioriteret kø
- Issues: [#669](https://github.com/NicolaiDolmer/CyclingZone/issues/669) (navne-pools), [#1420](https://github.com/NicolaiDolmer/CyclingZone/issues/1420) (mix-presets), [#1688](https://github.com/NicolaiDolmer/CyclingZone/issues/1688) (AI-fyld), [#2065](https://github.com/NicolaiDolmer/CyclingZone/issues/2065) (værdiloft-incident), [#4172](https://github.com/NicolaiDolmer/CyclingZone/issues/4172) (D4-spredning), [#4178](https://github.com/NicolaiDolmer/CyclingZone/issues/4178) (navne-udvidelse + dette dokument)
