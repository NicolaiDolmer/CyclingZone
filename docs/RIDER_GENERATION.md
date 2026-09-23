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
| `lib/fictionalRiderGenerator.js` | navnevalg, tier-kvoter, nationalitetsfordeling, fødsels-tilstand (`mode`) | produktion |
| `lib/riderBirthPriors.js` | arketype-prior pr. evne + fødsels-markør ([#5269](https://github.com/NicolaiDolmer/CyclingZone/issues/5269)) — se §8b | produktion |
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
- **Navne og stats trækker fra ADSKILTE rng-understrømme** ([#4180](https://github.com/NicolaiDolmer/CyclingZone/issues/4180)). `makeUniqueName` bruger `makeRng(seed + 0x6a09e667)`, hovedstrømmen former alt andet. Konsekvens: at udvide, splitte eller omorganisere en navneliste ændrer **kun navne** — ikke én eneste rytters stats, krop, alder eller type. Verificeret med en forward-guard-test i `fictionalRiderGenerator.test.js`, som er kørt rød mod den gamle adfærd (211 af 400 ryttere flyttede sig dengang).
- Ændrer du derimod et **tier-fraktion, et stat-vindue eller vægtene** i hovedstrømmen, ændres hvilke ryttere en given seed producerer. Det er ufarligt for ryttere der allerede står i DB, men betyder at en re-generering ikke reproducerer den gamle population.
- Samme mønster findes for bi-typen (`secondaryRng`, [#3634](https://github.com/NicolaiDolmer/CyclingZone/issues/3634)). Reglen er generel: **et domæne der kan vedligeholdes uafhængigt, skal have sin egen understrøm**, ellers bliver vedligehold uforholdsmæssigt dyrt og enhver balance-diff blander to variable sammen.

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

Siden [#5269](https://github.com/NicolaiDolmer/CyclingZone/issues/5269) forgrener kæden på fødsels-markøren: en rytter født af spillets egne priors får evnerne REPRODUCERET fra `archetype_draw.birth.seed` i stedet for udledt af `stat_*`. Se §8b.

Kaldes som `deriveForRiderIds(supabase, insertedIds, { dryRun: false })` umiddelbart efter insert. Både batch- og single-varianten SKAL bruge `insertDeriveAndReadPool`, så start-truppernes balance ikke kan drifte mellem de to stier.

### 6.1 De mentale evner fødes med deres EGEN prior (#5268, 15/9)

`deriveAbilities` giver de fire mentale evner — `aggression`, `tactics`, `teamwork`, `leadership` — hver sin prior i stedet for at lægge et alders-led oveni en stat:

| Evne | Fødes af | Alder som input |
|---|---|---|
| `aggression` | rytterens fighter-profil + centreret støj | **nej** |
| `tactics` | fighter- + nedkørsels-profil + centreret støj | **nej** |
| `teamwork` | de allerede udledte `positioning` + `tactics` + `durability` + bred støj (spec H2) | **nej** |
| `leadership` | lille grundniveau + alders-rampe + lille træk på `tactics`/`positioning` + støj (spec L1) | ja (GDD D-030) |

Støjen er deterministisk og salted pr. (rytter, evne), så to ryttere med identisk profil ikke får identiske mentale tal — og så en re-derive af den samme rytter giver det samme tal igen (determinisme-kontrakten, §1).

**Måltallet (gate G-A1):** de fire skal fødes i samme spænd som `descending` og `positioning`. Målt mod hele prod-bestanden 15/9 (n = 8.150): fødsels-median 7-12 og fødsels-p90 22-25 mod descending/positioning på 7/21. Kørslen der måler det er `backend/scripts/dry-run-5268-mental-abilities.js --dry-run` (read-only).

> **De to nye evner vægter ingen PCM-stats** (ejer-beslutning 15/9: *"intet skal være vægtet på PCM-stats mere"*). `teamwork` og `leadership` fødes af andre AFLEDTE evner, omregnet med `abilityFrac` (præcis invers af `scoreFrac`), så de lever på samme skala som kilderne — det er gate G-A1. At kilderne selv er PCM-afledte på fallback-stien er eksisterende legacy: `abilityDerivation.js` er PCM-fallback-stien for den eksisterende bestand, og den PCM-frie fødselssti bygges i `fictionalRiderGenerator.js` ([#5269](https://github.com/NicolaiDolmer/CyclingZone/issues/5269)). Kontrakten mellem de to: **registret** (`abilityRegistry.js`) er sandheden om hvilke evner der findes, og den nye sti giver enhver mental evne den ikke kender en default-prior. Tilføj aldrig en evne kun det ene sted.

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

## 8b. Fødsel uden PCM (fra 15/9) — [#5269](https://github.com/NicolaiDolmer/CyclingZone/issues/5269)

**Ejer-beslutning 15/9, ordret:** *"Intet skal vaere vaegtet paa pcm stats mere. Spillet skal kunne holde sig selv oppe nu. Men ryttere skal stadig vaere de samme nu her inde i spillet. Det er bare fremadrettet det skal stoppe."*

Fra 15/9 fødes en NY rytter direkte i evne-rummet (1-99) fra spillets egne arketype-priors. `stat_*` skrives ikke — kolonnerne står `NULL` i `riders` — og er ikke længere input til nogen evne for en nyfødt. **Eksisterende ryttere er urørte:** ingen migration, ingen re-derivation, ingen ændring af `abilityDerivation.js`.

### Hvor priorerne kommer fra

`lib/riderBirthPriors.js` er ikke en ny kalibrering. Den er den ABILITY-RUMS-SPEJLING af de tabeller der allerede fandtes, så populationen ikke flytter sig. Den gamle kæde var en ren lineær afbildning:

```
stat ∈ [50,85]  →  pcmFrac = (stat − 50)/35  →  evne = 1 + 98·pcmFrac
```

altså faktor `98/35 = 2,8` og `evne(50) = 1`. `ARCHETYPES`, `TIERS` og `YOUTH_GEN_CONFIG` er skrevet om med præcis den faktor. `riderBirthPriors.test.js` beviser spejlingen numerisk mod begge sider — drifter den ene, fejler testen.

### De tre steder den bevidst afviger

1. **`aggression` mister sit alders-led.** I dag er den `0,85·pcmFrac(stat_ftr) + 0,15·youth`, dvs. op til +15 gratis evne-point til en 21-årig ([evne-skala-rapporten](audits/2026-09-15-3668-ability-scale-investigation.md) §1.2).
2. **`tactics` mister sit alders-led.** I dag er den `0,55·experience + 0,45·aggressionFrac` — et aldersmålerur (median 14 ved 16-21 år, 57 ved 31-33, §1.3). Nyfødte får `0,60·aggression + 0,40·descending`.
3. **`leadership` MÅ bruge alder** (design-beslutning D-030) — `AGE_CURVED` i `riderBirthPriors.js`. Evnen findes ikke i registret endnu; kurven aktiveres af sig selv den dag nøglen lander.

### Fødsels-markøren (hvorfor en heal-sweep ikke nulstiller kuldet)

`deriveForRiderIds` kaldes IGEN ved hver re-derive (`riderDeriveHealSweep` [#1673](https://github.com/NicolaiDolmer/CyclingZone/issues/1673), `starterSquadHealSweep`, backfill-scripts). Uden en markør ville PCM-fallbacken udlede evne 1 af en `NULL`-stat og nulstille hele årgangen.

Markøren ligger i `riders.archetype_draw` (jsonb, persisteres allerede) som et `birth`-felt ved siden af `primary`/`secondary` — **ingen migration**:

```json
{ "primary": "gc", "secondary": "tt", "birth": { "v": 1, "tier": "solid", "seed": 2285543883, "age": 27, "cap": 21 } }
```

`seed` gør trækket reproducerbart fra rækken alene. `age` er **fødsels**-alderen, ikke rytterens nuværende: ungdomsbåndets niveau er `baseAt16 + (alder − 16)·perYearOver16`, så en re-derive mod den nuværende alder ville løfte hans start-evner gratis hver sæson — uden træning og uden at nogen skrev det. Trækket reproducerer fødslen; udvikling ejes af `riderProgression.js`. (`hidden_potential` følger stadig den NUVÆRENDE alder, præcis som for alle andre ryttere.) `cap` (valgfri) er et evne-loft der følger rytteren — det er own-priors-stiens erstatning for `buildWeakStarterPool`s STAT-vindue ([#1487](https://github.com/NicolaiDolmer/CyclingZone/issues/1487)): `[50,57]` → loft 21, `[50,52]` → loft 7, tier 4 `[51,55]` → loft 15. Enhver eksisterende læser (`draw.primary`, `draw.secondary`) ser præcis det samme som før.

### Hvem bruger den nye sti

| Fødselsvej | Indgang | Status |
|---|---|---|
| Launch-population | `generateLaunchPopulation` → `generateFictionalRiders` | own-priors (default) |
| AI-fyld tier 1/2 | `generateAiRiderBatchWithCap` | own-priors (default) |
| AI-fyld tier 3/4 + start-trupper | `buildWeakStarterPool` | own-priors + persisteret evne-loft |
| Akademi-intake | `generateAcademyCandidates` → `academyIntake` | own-priors (ungdomsbåndet) |
| U23-trupper (+ juniorer) til AI-holdene | ENGANGS ved S4-cutover — `backend/scripts/generateYouthSquadsS4.js` ([#5518](https://github.com/NicolaiDolmer/CyclingZone/issues/5518)) | own-priors (U23-båndet for U23, akademibåndet for juniorer, se §8b2). Dry-run er default; `--apply` kræver `--owner-go` og er ikke kørt |
| Pool-import | `lib/racePoolImport.js` | **føder ingen ryttere** — modulet importerer LØB (`race_pool`) fra CSV. Ingen ændring. |

`mode: "pcm"` bevarer den gamle sti og er ikke fjernet: de golden-population-harnesses der kalibrerer balancen (`previewFictionalPopulation.js`, `simSecondaryArchetype3634.js`, `raceGate.js`) måler mod netop den fordeling og skal kunne sammenlignes med historikken indtil ejeren fjerner stien.

### Gates enhver ny kaldsted skal respektere

Enhver gate der prissætter eller vurderer en kandidat **før** insert skal se de evner `deriveForRiderIds` bagefter persisterer. Gør den ikke det, vurderer den en anden rytter end den der lander i DB'en — [#2065](https://github.com/NicolaiDolmer/CyclingZone/issues/2065)-klassen. Målt under #5269: uden spejlingen i `generateAiRiderBatchWithCap` passerede en tier-1-rytter med `base_value` 856.501 mod loftet 200.000.

Spejlingen er `isBornFromPriors(row) ? deriveBirthAbilities(row, { age }) : deriveAbilities(physiology, row)` og findes i dag i `backfillCores.js` (begge backfills), `starterSquadAllocator.js`, `balanceSnapshot.js`, `fictionalPopulationPreview.js` og `scripts/generateYouthSquadsS4.js` (§8b3).

### Fysiologi

En prior-født rytter seeder sin fysiologi fra sine EGNE evner (samme 0-99-skala som `seedPhysiologyFromLegacy` forventer) i stedet for filens 60-default, som ville gøre hver eneste nyfødt fysiologisk identisk. Profilen forbliver `version 1 / seeded_from_legacy` som resten af populationen. v2-arketype-seeding (`aero`) er Task D2 og hører ikke til her — den ville tænde fysiologi-stien i `abilityDerivation` for netop disse ryttere og give dem en anden evne-fordeling end resten af spillet.

## 8b2. U23-fødselsbåndet ([#5376](https://github.com/NicolaiDolmer/CyclingZone/issues/5376))

**Ryttere fødes stadig som 16-årige i akademiet.** Det her ændrer ikke hvor spillet får sine ryttere fra. Båndet gælder ÉN ting: engangs-genereringen af en U23-trup (6-9 ryttere, 19-22 år) til hvert AI-hold ved S4-cutover (§8b3), så U23-kalenderens løb har køreklare felter fra dag ét ([GDD D-054 §10.4](GAME_DESIGN_DOCUMENT.md), [U23-spec](superpowers/specs/2026-09-15-u23-kalender-og-trup-datamodel-design.md) §4.4 + §10.4). Efter cutover fyldes U23-truppen af akademiet, der graduerer opad — der er ingen løbende U23-fødsel.

**Hvorfor et eget bånd.** Akademiets bånd (`YOUTH_BIRTH_BAND`) er kalibreret til 16-21 år, hvor det er en TILSIGTET invariant at evnerne mætter mod loftet: G5 ([#3561](https://github.com/NicolaiDolmer/CyclingZone/issues/3561)/[#2064](https://github.com/NicolaiDolmer/CyclingZone/issues/2064) §2a) kræver at en ungdomsrytters NUVÆRENDE evne ikke løfter `ability_caps` over det loft hans potentiale tillader. Netop dét loft slår igennem i den øvre ende af U23-intervallet, og generator-rapportens §8b måler det: lånte U23-fødslen akademiets bånd, ville en 19-årig og en 22-årig fødes praktisk talt ens, og alderen holde op med at betyde noget i netop det interval U23-kalenderen kører i.

**Ejer-valg 18/9 — variant A, "løft loftet, behold rampen".** `U23_BIRTH_BAND` er AFLEDT af akademiets: forankring, alders-rampe og spredning arves uændret, og loftet er det eneste felt der afviger. Fravalgt blev et helt eget bånd med egen rampe og spredning (to bånd at holde i sync) og et alders-rampet loft der kun gav den ældste årgang luft. Prisen ejeren købte med: de tre år (19-21) der overlapper akademiets interval trækkes nu forskelligt alt efter hvor rytteren kommer fra. Det er tilsigtet og gælder kun engangs-kuldet.

**Akademiet er urørt.** `YOUTH_BIRTH_BAND` og G5-invarianten står som før; `riderBirthPriors.test.js` beviser både at akademiets bånd ikke muteres, og at loftet er den eneste forskel mellem de to bånd.

**Markøren har sin egen tier.** En U23-fødsel skriver `archetype_draw.birth.tier = "u23"`, ikke `"youth"`. Det er ikke kosmetik: `deriveBirthAbilities` vælger BÅND ud fra markørens tier, og enhver re-derive (heal-sweep, backfill) går igennem den. Bar markøren `"youth"`, ville hver sweep reproducere engangs-kuldet mod akademiets bånd og klippe rytterne ned — stille, og først synligt når nogen undrede sig over at U23-felterne var blevet svagere.

**Evne-siden.** `drawU23BirthAbilities()` + `makeU23BirthMarker()` er hele evne-siden og er rene funktioner uden DB, ur eller `Math.random`. Intet produktions-kaldsted (route, cron, sweep) kalder dem: den eneste kalder er engangs-generatoren nedenfor, som er et script der kun skriver med `--apply --owner-go`.

### 8b3. Engangs-generatoren (spec A6, [#5518](https://github.com/NicolaiDolmer/CyclingZone/issues/5518))

`backend/scripts/generateYouthSquadsS4.js` føder AI-holdenes ungdomstrupper. **Dry-run er default og read-only; `--apply` kræver `--owner-go` og køres først ved cutover efter ejer-go på dry-run-tallene.**

| Regel | Hvordan |
|---|---|
| Hvilke hold | Aktive AI-hold: `is_ai`, ikke bank/test/frossen, ikke på vej ud (`pending_removal_at`, `retired_at`, `parked_at`), med en pulje |
| U23-trup | 6-9 ryttere pr. hold (ejer-låst 15/9), sæsonalder 19-22 i målsæsonen, U23-båndet (markør-tier `u23`) |
| Juniorer | `--juniors=N` er PÅKRÆVET uden default (ejer-valg), 0 til juniortruppens loft; sæsonalder 16-18, akademibåndet (markør-tier `youth`) |
| Identitet | Akademiets egen generator (`generateAcademyCandidates`, own-priors): navn (unikt mod hele bestanden), nationalitet, potentiale, krop, to-delt anlæg og fødsels-seed. Alderen trækkes derefter i truppens interval, og markøren laves om med den alder, så re-derivationen reproducerer netop dette træk |
| Trup-felter | `squad` og `is_academy = true` skrives i samme insert; `generation_tag = 's<målsæson>'` |
| Kontrakt/løn | Start-truppens sammensætning: `computeFrozenSalary` på `current_production_value` efter derive, `pickStarterContractLength`, `computeContractEndSeason` fra målsæsonen |
| Spejlings-gate (§8b) | Hver kandidat køres før insert gennem præcis den kæde `deriveForRiderIds` persisterer, på målsæsonens alders-akse og med samme model-objekter. Ligger en kandidat over AI-tierens værdiloft, blokeres apply. Efter apply læses base_value/type tilbage og sammenlignes; en afvigelse giver exit 1. Eneste kendte forskel er `hidden_potential`, som hasher DB-id'et og ikke indgår i caps, type eller værdi |
| Alders-aksen | Apply nægter at køre medmindre målsæsonen er den AKTIVE sæson (`deriveForRiderIds` regner alder mod den aktive sæson, #4876-lektien) |
| Idempotens | Pr. trup: en eksisterende U23-født trup (markør-tier `u23`) eller eksisterende juniorer fødes ikke igen. Juniorerne kan derfor fødes i en senere kørsel. Ét insert pr. hold |
| Rollback | Apply skriver listen over indsatte rytter-id'er til `balance-internals/` |

Dry-run-tallene (antal, værdi- og evnefordeling, pr. hold) skrives kun til `balance-internals/` via `--out` (hard rule 17). Felt-gaten for ungdomsløb (C1) måles af `backend/scripts/measureYouthFieldGate.mjs`, som bruger samme plan-funktion, så måling og apply ikke kan se to forskellige kuld (YOUTH_RULES §2.3).

## 8c. Den synlige test af generatoren ([#5283](https://github.com/NicolaiDolmer/CyclingZone/issues/5283))

**Ejer-krav 15/9, ordret** (ved merge-go på PR #5278): *"Vi skal have lavet test inden naeste gang der laves nye ryttere, for at se at rytter generatoren virker ordentligt."* Gaten ligger FØR U23-ryttere genereres til AI-holdene ved S4-cutover ([GDD D-054 §10.4](GAME_DESIGN_DOCUMENT.md)).

Gaten har to halvdele, og de måler bevidst hver sin ting:

| Halvdel | Fil | Svarer på |
|---|---|---|
| Øjne | `backend/scripts/generatorVisibleTest5283.js` | *Hvordan ser populationen ud?* Read-only rapport: fordeling pr. arketype og pr. evne (min/p10/median/p90/max), lofterne, alder/potentiale/værdi, kompletthed, ungdomsbåndet, stikprøve. Kan ikke fejle. |
| Maskine | `backend/lib/riderBirthDistribution.test.js` | *Hvad må aldrig ændre sig?* 19 `node --test`-invarianter. Kan kun fejle. |

Rapporten køres med `npm run riders:generator-report --prefix backend` (n = 1.000, seed 20260918). Den skrives til `balance-internals/`, som er gitignoreret: rapporten er præcise fordelings- og balance-tal, og hard rule 17 ([#3436](https://github.com/NicolaiDolmer/CyclingZone/issues/3436)) holder dem ude af det offentligt læsbare repo — issue #5283 pkt. 3 siger det udtrykkeligt om netop denne tabel. Determinismen (§1) gør rapporten diffbar mod en senere kørsel uden at den behøver ligge i git: samme seed giver den samme fil, byte for byte.

Rapporten spejler `deriveForRiderIds`' kæde in-memory (§6/§8b's spejlings-krav) og rører hverken DB eller generatorens adfærd. Finder den en fejl, dokumenteres den i rapportens §9 og rettes i et eget spor — en test der retter det den måler, måler ikke længere noget.

**To fund står åbne i rapporten pr. 18/9** (begge dokumenteret, ingen rettet her): en betydelig del af alle evne-værdier lander på gulvet, drevet af `domestique`-tierens niveau; og en lille andel fødes med `tactics` over vækst-loftet i D-056. Det tredje fund — at akademiets bånd er mættet ved U23-aldrene — er LUKKET af [#5376](https://github.com/NicolaiDolmer/CyclingZone/issues/5376): U23-fødslen fik sit eget bånd (§8b2), og rapportens §8b står tilbage som referencen der forklarer hvorfor. Rapportens §8c måler produktions-båndet, og en **forward-guard** (`u23ProductionBandGuard()`) siger fra i §9 hvis alderen holder op med at flytte medianen eller loftet begynder at klippe dominerende igen — også når årsagen er en ændring på akademi-siden, som U23-båndet arver fra.

## 9. Kendte faldgruber

- **PostgREST-paginering:** `select()` uden `.range()` topper stille ved 1000 rækker. Brug `fetchAllRows` fra `supabasePagination.js` til alle loads der kan overstige det. Bed dette bidt under #4172 (rapporterede 1000 af 4.982 entries).
- **Navne-kollision mod markedet:** AI-trupper må ikke kollidere med markeds- eller start-ryttere. `fetchExistingFoldedNamesForAi` henter alle eksisterende navne før generering. Springes den over, fejler insert eller producerer dubletter.
- **`generateAiTeams.js` nægter at skrive til prod** (hardcoded ref-deny). Prod-AI-fyld sker via `reconcileAiTeamsForPool` (signup-stien) eller `relaunchOrchestrator`.
- **Simulér før ship:** rytter-generering er et balance-følsomt system. Kør en empirisk dry-run mod målpopulationen og et scorecard før ændringer merges, jf. den generelle regel for balance-systemer.

## 10. Relaterede dokumenter

- [`GAME_INVARIANTS.md`](GAME_INVARIANTS.md) — rytter-økonomi: værdi, løn, kontrakter, præmier
- [`MASTERPLAN.md`](MASTERPLAN.md) — prioriteret kø
- Issues: [#669](https://github.com/NicolaiDolmer/CyclingZone/issues/669) (navne-pools), [#1420](https://github.com/NicolaiDolmer/CyclingZone/issues/1420) (mix-presets), [#1688](https://github.com/NicolaiDolmer/CyclingZone/issues/1688) (AI-fyld), [#2065](https://github.com/NicolaiDolmer/CyclingZone/issues/2065) (værdiloft-incident), [#4172](https://github.com/NicolaiDolmer/CyclingZone/issues/4172) (D4-spredning), [#4178](https://github.com/NicolaiDolmer/CyclingZone/issues/4178) (navne-udvidelse + dette dokument)
