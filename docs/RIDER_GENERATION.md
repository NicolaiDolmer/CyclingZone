# RIDER_GENERATION.md — SSOT for hvordan ryttere skabes

> **Ejer-krav 24/8 ([#4178](https://github.com/NicolaiDolmer/CyclingZone/issues/4178)):** reglerne for rytter-generering lå spredt som kodekommentarer i 9 moduler over ~3.100 linjer, med 16 frosne ejer-beslutninger og intet samlet sted. Konkret skade: AI-trupstørrelsen (24, ikke 8) stod begravet i `starterSquadAllocator.js:133` og blev fejlrapporteret til ejeren under #4172.
>
> **VEDLIGEHOLDELSESREGEL (bindende):** enhver ændring i hvordan ryttere skabes — navne, stats, nationalitet, trupstørrelser, AI-politik, akademi, derive-kæden — SKAL opdatere dette dokument i samme PR. Ændrer du en frossen konstant, skal issue-referencen med. Dette dokument er sandheden om *hvad reglerne er*; koden er sandheden om *hvordan de udføres*.
>
> Afgrænsning: rytter-**økonomi** (market_value, salary, kontrakter, præmier) bor i [`GAME_INVARIANTS.md`](GAME_INVARIANTS.md). Her handler det kun om *skabelsen*.

## Sådan efterprøver du dette dokument

**Ingen påstand her hviler på nogens hukommelse.** Hver linje bærer enten en fil:linje-reference, et commit-hash eller en målekommando, så den kan verificeres uden at nogen skal huske hvad der blev besluttet hvornår.

Det er ikke pedanteri. Under #4178-arbejdet 24/8 fandt vi **fire kodekommentarer der sagde det stik modsatte af koden lige under dem** (se §7), og et frossent dokument der havde været forkert i en måned. Et SSOT der ikke kan efterprøves bliver bare den femte løgn.

Finder du en påstand her uden kilde, så stol ikke på den — verificér den og tilføj kilden.

## Modul-ejerskab

| Modul | Ejer reglerne om | Rolle |
|---|---|---|
| `lib/fictionalRiderGenerator.js` | navnevalg, tier-kvoter, nationalitetsfordeling, stat-sampling | produktion |
| `lib/fictionalRiderNames.js` | navne-clusters + ISO-landemapping | produktion |
| `lib/fictionalLaunchPopulation.js` | grund-seed for hele populationen | produktion |
| `lib/starterSquadAllocator.js` | trupstørrelser, stat-vinduer pr. tier, værdilofter | produktion |
| `lib/aiTeamGenerator.js` | AI-fyld-politik ([#1688](https://github.com/NicolaiDolmer/CyclingZone/issues/1688)) | produktion |
| `lib/aiTeamNames.js` | AI-holdenes navne | produktion |
| `lib/academyGenerator.js` | ungdomskandidater til akademiet ([#1308](https://github.com/NicolaiDolmer/CyclingZone/issues/1308)); genbruger generatorens PRNG og navne-logik | produktion |
| `lib/riderTypes.js` + `riderTypesBaseline*.json` | **klassifikation**, ikke skabelse: udleder type af `ability_caps` | derive-kæden |
| `lib/riderValuationModelV4.json` | værdimodellen der prissætter en nyskabt rytter | produktion, se §5 |
| `lib/fictionalRiderMixPresets.js` | komposition-presets ([#1420](https://github.com/NicolaiDolmer/CyclingZone/issues/1420)) | **kun dev-tooling** (`race:cockpit`), ikke en produktionsregel |

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

**AI-ryttere skabes ad TO forskellige veje**, afhængigt af tier. Det er den vigtigste skelnen i hele generatoren, og den er let at overse.

| Tier | Vej | `tierFractions` | Stat-vindue kerne | Værdiloft |
|---|---|---|---|---|
| 1 | arketype-generator | ja: superstar 0, star 0, solid 0,25 | 50-57 | 200.000 |
| 2 | arketype-generator | ja: superstar 0, star 0, solid 0 | 50-57 | 100.000 |
| 3 | clamp-vindue | nej | 50-57 | ingen |
| 4 | clamp-vindue | nej | **51-55** | ingen |

*Målt med `aiTierFractionsForTier(t)` og `aiStatWindowsForTier(t)` 24/8, ikke aflæst af kommentarer.*

- **Tier 1 og 2** går gennem den ægte arketype-generator. `superstar` og `star` er eksplicit sat til 0 (for stærke til AI-modstandere). Her betyder typefordeling og værdibalance noget.
- **Tier 3 og 4** går udenom arketyperne og klemmer stats ind i et smalt vindue. Tier 4-ryttere ligger inden for **fire point** (51-55), så de er bevidst svage og næsten ens. Typefordeling betyder derfor meget lidt for dem.
- `AI_TIER_STAT_WINDOWS` indeholder **kun** nøgler for tier 3 og 4; `aiStatWindowsForTier` falder tilbage til tier 3 for alt andet. Vinduet i rækken for tier 1/2 ovenfor er altså fallback-værdien og bruges ikke, fordi de tiers tager arketype-vejen.

Et sikkerhedsnet beregner værdi og primær type lokalt før en rytter accepteres, og ruller om ved overskridelse af `valueCap` eller `typeShareCap`. Det spejler derive-kæden i fire trin (type-bootstrap, ungdoms-baseline, `archetype_draw`, alder) — se kommentarblokken i `starterSquadAllocator.js:200-258`, som er nøjagtig og opdateret.

> **Incident 2026-06-30 ([#2065](https://github.com/NicolaiDolmer/CyclingZone/issues/2065)):** 100 % "solid" til hele tier 1-batchen (300 ryttere) gav gennemsnit 1,52 mio. CZ$ og enkelte over 8 mio. Værdilofterne stammer derfra. Rør dem ikke uden at simulere først.


## 5. Værdimodellen: V4 er den kanoniske

En nyskabt rytter prissættes af **`riderValuationModelV4.json`**. Det er ikke en formodning; her er kæden af beviser:

| Bruger | Model | Kilde |
|---|---|---|
| Derive-kæden der **skriver** `base_value` | **V4** | `backfillCores.js:203` (`deriveForRiderIds`) |
| Generatorens sikkerhedsnet | **V4** | `starterSquadAllocator.js:48` |
| `GET /riders/:id` — **spillervendt** | **V4** | `routes/api.js:1061` |
| `GET /admin/rider-valuation-preview` | v3 | `routes/api.js:9397` — kun admin |
| `balanceSnapshot.js`, dev-scripts, harnesses | v3 | analyse-værktøjer, ikke produktion |

**Den gamle v3 (`riderValuationModel.json`) rører intet spillere ser.** Den lever kun i et admin-preview og i analyse-scripts.

**Tidslinje** (fra git, ikke fra hukommelse):

- **25/7** — V4 føres ind og tages i brug (commit `ba2d29266`)
- **23/8 kl. 19:59** — commit `9768a1365` (#4135) ændrer *den eksisterende* model, den indfører ikke en ny:
  - niveau-korrektionen **c = 0,811** skrives permanent ind som `level_correction` (#3449), så den overlever sæsonskiftet i stedet for at være et engangs-gange på `riders.base_value`
  - **type-dæmpningen flippes aktiv** med k = 100 (#4000): `fit.offset` regulariseres n-vægtet mod 0, mens `fit.alpha` aldrig røres

Alle produktions-kaldere SKAL route deres indlæste V4-JSON gennem `applyTypeDampening()`. Det er dét der gør et cutover-flip til én linje i stedet for spredte ændringer.

> ⚠️ `GAME_INVARIANTS.md` siger at `base_value` bruger "model v3: `riderValuationModel.json`". **Det har været forkert siden 25/7.** Rettelsen kræver ejer-godkendelse, da filen er frossen — se §8.

## 6. Derive-kæden (data-hale-garanti)

Enhver nyskabt rytter skal igennem hele kæden, ellers står han med huller i data:

```
seedPhysiologyFromLegacy → deriveAbilities → computeRiderTypes → predictBaseValue
```

Kaldes som `deriveForRiderIds(supabase, insertedIds, { dryRun: false })` umiddelbart efter insert. Både batch- og single-varianten SKAL bruge `insertDeriveAndReadPool`, så start-truppernes balance ikke kan drifte mellem de to stier.

## 7. Kommentarer der lyver (status 24/8)

Fundet under #4178. De siger det stik modsatte af koden lige under dem, og de kostede et helt fejlspor i den session der fandt dem. Rettes de, så slet denne tabel.

| Sted | Påstår | Sandhed |
|---|---|---|
| `riderValuationTypeDampening.js:3` | "SLÅET FRA (TYPE_DAMPENING_ENABLED = false)" | Linje 27: `= true` siden 23/8 |
| `starterSquadAllocator.js:45` | "no-op indtil ... flippes ... ingen adfærdsændring her i dag" | Aktiv siden 23/8 |
| `routes/api.js:523` | samme "no-op"-tekst | Aktiv siden 23/8 |
| `routes/api.js:518` | V4 er "SHADOW, separat fil fra v3" | Bruges spillervendt i `GET /riders/:id` |

**Læren:** en kommentar om en feature-flag-tilstand bliver forældet i samme sekund flaget flippes. Skriv hvor flaget *bor*, ikke hvad det *står på*.

## 8. Åbne spørgsmål (ikke afklaret 24/8)

Ærligt markeret frem for at gætte. Et SSOT der lader som om alt er afklaret, er farligere end et der peger på sine egne huller.

**1. Er `TYPE_MEAN_ADJUST` stadig korrekt kalibreret?**
`fictionalRiderGenerator.js:156-164` justerer tier-basen pr. arketype (sprinter −1,5, rouleur +1,5 …) som modvægt mod **v3**-modellens type-offsets. Men den aktive model er V4, og 23/8 blev type-dæmpningen slået til, som netop regulariserer offsets mod 0. Modvægten kan derfor kompensere for noget der ikke længere er der.
*Målt 24/8:* i den nuværende generator er sprinter nr. 6 af 8 typer på værdi (rouleur er billigst), mod nr. 8 af 8 i den gamle prod-bestand. Skævheden ser altså mindre ud end frygtet, og den rammer kun tier 1/2, fordi tier 3/4 klemmes til et fire-points vindue. **Ikke hastende, men uafklaret.**

**2. Skal `GAME_INVARIANTS.md` rettes til V4?**
Se §5. Rettelsen er identificeret, men filen er frossen og kræver ejer-godkendelse.

**3. Bør `balanceSnapshot.js` bruge V4?**
Den bygger balance-snapshots med v3, mens prod prissætter med V4. Hvis snapshottet skal afspejle virkeligheden, er det formentlig en fejl. Hvis det bevidst er en historisk sammenligningsakse, er det korrekt. Ikke undersøgt.

## 9. Kendte faldgruber

- **PostgREST-paginering:** `select()` uden `.range()` topper stille ved 1000 rækker. Brug `fetchAllRows` fra `supabasePagination.js` til alle loads der kan overstige det. Bed dette bidt under #4172 (rapporterede 1000 af 4.982 entries).
- **Navne-kollision mod markedet:** AI-trupper må ikke kollidere med markeds- eller start-ryttere. `fetchExistingFoldedNamesForAi` henter alle eksisterende navne før generering. Springes den over, fejler insert eller producerer dubletter.
- **`generateAiTeams.js` nægter at skrive til prod** (hardcoded ref-deny). Prod-AI-fyld sker via `reconcileAiTeamsForPool` (signup-stien) eller `relaunchOrchestrator`.
- **Simulér før ship:** rytter-generering er et balance-følsomt system. Kør en empirisk dry-run mod målpopulationen og et scorecard før ændringer merges, jf. den generelle regel for balance-systemer.

## 10. Relaterede dokumenter

- [`GAME_INVARIANTS.md`](GAME_INVARIANTS.md) — rytter-økonomi: værdi, løn, kontrakter, præmier
- [`MASTERPLAN.md`](MASTERPLAN.md) — prioriteret kø
- Issues: [#669](https://github.com/NicolaiDolmer/CyclingZone/issues/669) (navne-pools), [#1420](https://github.com/NicolaiDolmer/CyclingZone/issues/1420) (mix-presets), [#1688](https://github.com/NicolaiDolmer/CyclingZone/issues/1688) (AI-fyld), [#2065](https://github.com/NicolaiDolmer/CyclingZone/issues/2065) (værdiloft-incident), [#4172](https://github.com/NicolaiDolmer/CyclingZone/issues/4172) (D4-spredning), [#4178](https://github.com/NicolaiDolmer/CyclingZone/issues/4178) (navne-udvidelse + dette dokument)
