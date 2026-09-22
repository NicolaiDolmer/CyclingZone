# Økonomi-, værdi- og løn-reglerne — SSOT

> **Læs denne FØR enhver opgave der rører rytterværdi, løn, sponsor, upkeep, auktion/marked eller bestyrelsens økonomi.** Ejer-direktiv 25/8 ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)):
> *"Det maa ALDRIG NOGENSINDE ske, at du ikke bruger et ssot dokument, naar vi rent faktisk har lavet et."*

Reglerne lå spredt over mindst 5 design-dokumenter i `docs/superpowers/specs/`, hvoraf flere foreslår **indbyrdes modstridende** formler for samme ting. Denne fil er kilden til hvad der rent faktisk kører i dag. Den DUPLIKERER ikke `docs/GAME_INVARIANTS.md`s konstanter — den peger på dem og siger hvad der er sket SIDEN de blev skrevet. Alt heri er verificeret mod kode 25/8; intet er gættet. Hvor jeg ikke kunne verificere et ejer-godkendt mål, står det som et åbent punkt i §10, ikke som en påstand.

---

## 0. De tre tal (den hyppigste fejlkilde)

Spillere og kode taler om "rytterens værdi" som ét tal. Det er mindst **tre**, og de flytter sig efter helt forskellige regler:

| Tal | Hvad det er | Rører sig |
|---|---|---|
| `market_value` | Køb/salg-pris, karriere-NPV + elite-præmie. Basis for tvangssalgs-kredit og (indtil #3989) den gamle løn-kobling | Ved værdi-sweep/backfill, ikke løbende |
| `current_production_value` (CPV) | "Hvad leverer han I ÅR" — sæson-0-produktionsleddet, **ingen** fremtid, **ingen** elite-præmie. Dagens løn-basis | Ved samme sweep som `base_value` |
| `salary` | Faktisk lønudgift på en kontrakt | **Frosset ved signering** (#1309). Rører sig ALDRIG af at `market_value` eller CPV ændrer sig bagefter — kun ved ny signering/forlængelse |

**Fælden:** en ændring af rytterens `market_value` (fx et søndags-sweep) flytter **ingen** eksisterende løn. Og en formel der bruger `market_value` som løngrundlag (§2) er en anden beslutning end en der bruger CPV — to specs i denne fil foreslår det første, koden gør det andet (se §2).

**Anden fælde: koden bruger ofte en FROSSET version af et tal, ikke den friske model.** To eksempler, begge ejer-besluttede, ingen af dem midlertidige fejl:
- `riders.valuation_type` er en **frosset snapshot** af `primary_type` fra før 4/8-reklassificeringen (#3345, ejer-beslutning 4/8). Værdimodellen læser `valuation_type ?? primary_type`, ALDRIG live `primary_type` alene — reklassificering af en rytters type flytter altså ikke hans værdi.
- NPV-vækstraterne i karriereprojektionen er frosset til en gammel tabel (`FROZEN_NPV_RATE_BY_POTENTIAL`, `backend/lib/riderCareerNpv.js`, ejer-beslutning 16/8) — uafhængigt af hvad den LIVE progressions-motor (træning/aldring) bruger. Begge frysninger findes for at et enkelt motor-skridt ikke skulle flytte hele populationens formue uden ejer-godkendelse; begge fjernes samlet ved det planlagte refit (#3750/#3449/#3353), ikke hver for sig.

---

## 1. Rytterværdi (`market_value`)

| Regel | Kilde/kode | Låst | Status |
|---|---|---|---|
| `market_value = COALESCE(base_value,1000)`, DB GENERATED | `database/schema.sql` (`riders.market_value`) | #1101, 10/6 · ændret ved #2594-cutover | Live. **Rettet 20/9 (#5443):** dokumentet sagde tidligere `+ prize_earnings_bonus`; det er ikke længere sandt i prod. Bonussen røg ud af den genererede kolonne ved v4-cutoveren (#2594), fordi v4 prissætter forventede præmier selv og bonussen dermed dobbelt-talte |
| `base_value` skrives af backfill/value-sweep/progression fra den valgte værdimodel (`riderCareerNpv.js`) | `docs/GAME_INVARIANTS.md` | — | Live |
| `prize_earnings_bonus` = 3-sæsons-vindue af præmieindtjening, ÉN fast divisor (3) uanset hvor mange sæsoner der findes | `economyEngine.updateRiderValues` | ejer 8/6 (#1155) | Kolonnen **vedligeholdes** ved præmie-udbetaling, men indgår **ikke** i `market_value` (se rækken ovenfor). Den er i dag et rent regnskabstal |
| — genberegnes ved **præmie-udbetaling** (`paySeasonPrizesToDate`) | `backend/lib/prizePayoutEngine.js` | R3 #895 | **Live, ubetinget** |
| — genberegnes ved **sæson-slut** | `economyEngine.processTeamSeasonEnd` | flag `SEASON_VALUE_RECALC_ENABLED` | **PT `false`** (#1155, 8/6) — se §10.1 |
| Hvilken værdimodel `base_value` (PRISEN) regnes med | app_config-nøgle `rider_valuation_model` (`riderValuationModelSelect.js`) | #5443, ejer 20/9 | `v4` = modellen der har kørt siden cutover. `v5` = den nye (se §1.1). Læses ved hver værdi-kørsel; fail-safe til `v4` |
| Hvilken værdimodel `current_production_value` (LØNGRUNDLAGET) regnes med | app_config-nøgle `rider_production_value_model` (samme modul) | #5443 ejer-beslutning 2, 20/9 aften | **Egen nøgle, seedet `v4`.** Prisen og løngrundlaget vælger model hver for sig — se §2 |
| `valuation_type` frosset snapshot af `primary_type` | `riderValuation.js`, `riderCareerNpv.js` | #3345, ejer 4/8 | Live **under v4**. Indgår ikke i v5's beregning (se §1.1). Kolonnen droppes først i en senere, ejer-gatet migration |
| NPV-vækstrater frosset (trin 7) | `riderCareerNpv.js` (`FROZEN_NPV_RATE_BY_POTENTIAL`) | ejer 16/8 | Live, undgår median −12 % shock |
| Søndags-marked-sweep (blander model + observerede handler) | `marketValueSundaySweep.js` + `marketValueModelV1.json` | app_config-flag `market_value_sweep_enabled` | **SLUKKET.** Verificeret i prod 30/8: `market_value_sweep_enabled = 'off'`, `market_value_global_weight = 0`, og `market_value_sunday_sweep_log` er tom. Den har aldrig kørt. Se §9 |
| Kadence: værdier genberegnes KUN søndag, fra kl. 06 dansk tid | `sundayValueSweep.js` | ejer 30/8 (#4419); søndags-kadencen selv: ejer 6/8 (#3448) | Live. Se §9 for hele billedet |

### 1.1 Værdimodel v5 — værdien regnes på de samme evner som ratingen (#5443, ejer 20/9)

**Ejer-beslutning 22/9 (#5443 + #5435):** Det kommende samlede skift skal bruge bedste rolle nu, samme rating som spilleren skal se. Tabellen nedenfor beskriver den eksisterende v5-kandidat, ikke det godkendte slutdesign. Re-fit, admin-preview og visningsskift leveres separat; ingen modelkontakt flippes med datadelen.

**Datakontrakt (1a):** `riders.best_role` og `best_role_rating` caches af `riderValueRefresh.js` fra maksimum af de afrundede `displayRecipes`-ratings. Ved lighed vælges første rolle i opskrifternes faste rækkefølge; ingen brugbare evner giver NULL, mens nul er en gyldig rating. Naturlig identitet, priser og løngrundlag bruger fortsat deres eksisterende input. Cachen følger den eksisterende refresh-kadence i §9.1, ikke en ny natlig værdikørsel. Rolleændringer alene skriver kun de to cachefelter. Den ekstraordinære kørsels backup/rollback medtager dem også.

Migration: `database/2026-09-22-5443-best-role-data.sql`, nullable kolonner uden populationsskrivning. Den skal være anvendt før næste refresh. `backend/scripts/dev/bestRoleBackfill5443.mjs` beregner et read-only backfill-forslag, også før migrationen; `--compare-stored` sammenligner efter migrationen. `--out=<fil.json>` gemmer kun under gitignoreret `balance-internals/`. Scriptet har ingen apply-sti. Visning og `ratingGolden.5321.json` ændres først i det senere ejer-godkendte skift.

**Problemet den løser.** Værdimodellen havde sin egen vægttabel, adskilt fra den opskrift rytterens rating er bygget af. For flere roller betød det at prisen kun bevægede sig når én bestemt evne bevægede sig, mens rating-tallet spilleren så var bygget af flere. Oveni lå to midlertidige frysninger fra august: en frossen `valuation_type` (#3345) og en type-dæmpning (#4000). Nettoresultatet var ryttere hvis værdi kunne stå stille mens rytteren udviklede sig i sin egen rolle — meldt af spillerne i #5416.

**Hvad v5 ændrer, kvalitativt** (tal og fordelinger ligger i `balance-internals/`, ikke her):

| # | Ændring | Kode |
|---|---|---|
| 1 | Værdien læser rollens evner med **rating-tallets egen opskrift** — ét regnestykke, én tabel, så de to tal ikke kan skride fra hinanden | `weights/displayRecipes.js` (`roleOutputRaw`), model-felt `weights_source` |
| 2 | Den frosne `valuation_type` indgår **ikke**; rytterens faktiske primær-type bruges | model-felt `type_source` |
| 3 | Type-dæmpningen (#4000) er **ude** — den rettede en skæv stikprøve der ikke findes efter re-fittet | model-felt `type_dampening` |
| 4 | Koefficienter og skala er **genfittet** mod den nuværende typefordeling | `riderValuationModelV5.json` |
| 5 | `FROZEN_NPV_RATE_BY_POTENTIAL` **bliver stående** (uændret) | `riderCareerNpv.js` |

**Punkt 5 er en bevidst beslutning, ikke en forglemmelse.** Karriere-fremskrivningens hældning styres i dag af det skjulte potentiale gennem en frossen rate-tabel. Målt 20/9 er det en **modelfejl at fjerne den alene**: den undervurderer unge ryttere markant. Tabellen afløses først når træningsscoren kan bære fremskrivningen (#4851, #2798) — planlagt midt i S4, og den kræver score-historik for hele bestanden.

**Aktivering er ejerens ene skridt.** Modellen ligger klar i repoet, men app_config-nøglen `rider_valuation_model` seedes `v4`, og koden falder fail-safe tilbage til `v4` ved enhver læsefejl. En merge flytter derfor ingen værdi. Tørkørsel mod hele populationen: `backend/scripts/dev/valuationV5DryRun5443.mjs` (read-only, skriver kun lokalt).

**Rækkefølge ved tænding** (hard regel, jf. §9.1): når nøglen er flippet, regner **også den førstkommende søndagskørsel** med v5 — nøglen læses pr. kørsel. Ejer-beslutning 3 (20/9 aften) gjorde selve begivenheden til én **ekstraordinær kørsel uden for søndagen**, med ejerens ordrette "kør" og spillerbeskeden ude først. Hele rækkefølgen, låsene og rollback-vejen: [`docs/runbooks/5443-ekstraordinaer-vaerdikoersel.md`](runbooks/5443-ekstraordinaer-vaerdikoersel.md). Søndags-pipelinen er uændret: værdi-refresh FØRST, markedsblend SIDST.

**Alle produktions-læsere går gennem ÉN kontakt.** `riderValuationModelSelect.js` er det eneste sted i `backend/lib` og `backend/routes` der kender model-filerne. Søndagskørslen, sæson-transitionen, backfill/heal-stien og startruppens cap-gate læser nøglen pr. kørsel; api.js's læse-flader (rytterkort, værdi-trend, scouting, admin-preview) bruger en kort cache. Vagt: `valuationModelReaders.test.js` fejler hvis en fil uden for modulet indlæser en model-JSON direkte. Det hul kostede tre oversete læsere i første omgang (#5443, 20/9 aften).

---

**Startpris-loft på auktion** (`backend/lib/auctionRules.js`, `getAuctionStartPriceIssue`): egen rytter må udbydes for **maks 1× `market_value`**; bank/AI-ryttere skal udbydes for **mindst 1× `market_value`**. Ingen ejer-lås-dato fundet i koden for netop denne grænse. Kritiseret hårdt i kilde-dokumentet §3.1 (spærrer markedet fra at sige "denne rytter er mere værd") — forslaget om 5×-loft + 2-budgiver-krav + bank-reserve på 25 % er **ikke implementeret**, kun anbefalet.

---

## 2. Løn

**Formlen der rent faktisk kører (#3989, ejer-beslutning 20/8), verificeret i `backend/lib/economyConstants.js` + `contractSeed.js`:**

| Regel | Værdi | Fil |
|---|---|---|
| Løngrundlag | `current_production_value` (CPV), IKKE `market_value` | `contractSeed.computeFrozenSalary` |
| Hvilken model CPV regnes af | app_config-nøgle `rider_production_value_model`, **egen nøgle, seedet `v4`** | `riderValuationModelSelect.js` |
| Sats | `SALARY_RATE_PRODUCTION = 0.35`, ét globalt tal | `economyConstants.js` |
| Divisions-skalering | **Ingen** — bevidst fjernet 20/8 (den gamle per-division-sats gjorde samme rytter dobbelt så dyr i D2 som D3) | samme fil |
| Gulv | 1 (aldrig 0) | `computeFrozenSalary` |
| Loft | Intet | — |
| Frysning | Ved signering/erhvervelse (auktion, transfer, akademi-promote, seed); rører sig ikke før forlængelse | #1309 |
| Fri agent (visning) | Samme formel, kun UI-estimat, ryttere uden hold har `salary = NULL` i DB | `marketUtils.resolveRiderSalary` + frontend `marketValues.js` (parity-test `salaryRateParity.test.js`) |
| Akademi/ungdom | **Samme `computeFrozenSalary`-formel som senior** siden #3989 (verificeret: `academyIntake.js`, `academyTransfer.js` importerer `computeFrozenSalary`, ikke `ACADEMY.SALARY_RATE`) | — |

**Lønnen venter på sin egen nøgle (#5443 ejer-beslutning 2, 20/9 aften).** Ordret: *"Løn skal ikke følge værdi, løn skal følge potentielle resultater + omdømme + evner og den slags ting."* Det er allerede designet sådan — lønnen er en andel af CPV, ikke af `market_value` — men CPV regnes af **samme modelkæde** som prisen. En tænding af v5 ville derfor flytte fremtidige lønkrav midt i kontraktforlængelserne ved sæsonskiftet. Derfor har løngrundlaget sin egen app_config-nøgle, `rider_production_value_model`, seedet `v4`: prisen kan gå på v5, mens lønkravene står stille, indtil ejeren selv flipper den anden nøgle. Løbende kontrakter er under alle omstændigheder frosne ved signering (#1309) — nøglen styrer kun grundlaget for **nye** kontrakter. Vagt: `valuationWageModelSplit.test.js` (med pris=v5 og løn=v4 er CPV bit-identisk over en fixture-population). Omdømme i lønnen er eget design (#1099), ikke en del af dette.

**To ting der IKKE længere er lønformlen, selvom de står andre steder:**
- `SALARY_RATE = 0.067 × market_value` (den gamle formel) er stadig i `economyConstants.js`, men markeret i kodens egen kommentar som **"kun reference/legacy"**. `ACADEMY.SALARY_RATE` peger stadig på den, men er ubrugt af den faktiske akademi-signering (se test-kommentar i `academyTransfer.test.js`: "ikke længere ACADEMY.SALARY_RATE").
- `loen = A × (market_value/100.000)^eksponent` (#3393-formlen fra begge 14/8-specs, med `market_value` som grundlag) blev **eksplicit afvist** 20/8: kommentaren i `economyConstants.js` viser at den formel genindfører præcis den alders-/evne-inversion løn-decouplingen (#2428, juli) skulle fjerne, målt på konkrete eksempler. **#3393 står parkeret.**

Begge 14/8-specs (`vaerdi-og-loen-fundament-design.md` §5, `oekonomi-designkritik.md` §5.5) foreslår altså en lønformel der **ikke er den der kører**. De er historisk kontekst for hvorfor #3989 blev besluttet, ikke en beskrivelse af nutiden.

---

## 3. Sponsor, upkeep, gæld, præmie

**Præmieberettigelse (ejer præciseret 9/9, #4753/#5066):** AI- og bank-hold modtager
ingen kontant præmie, heller ikke når `race_results.team_id` er udfyldt. `prizePayoutEngine`
filtrerer dem før balance-RPC'en. Løb med kun ikke-berettigede resultater afsluttes som
afregnet uden pengeoverførsel. Historiske finansposteringer og resultater ændres ikke;
rytterens præmiebaserede værdi følger fortsat GAME_INVARIANTS. Lokalt verificeret i PR'en;
prod har historiske AI-udbetalinger, så tidligere tekst om ingen udbetaling var ikke håndhævet.

> **Sponsoren har fået sit eget SSOT-dokument 29/8: [`SPONSOR_RULES.md`](SPONSOR_RULES.md).** Kontrakternes
> tilstandsmaskine, de fem arketyper, divisions-tillægget (ejer-besluttet 29/8) og de seks op-/nedryknings-tilfælde
> står dér, ikke her. Dette afsnit dækker kun konstanterne.
>
> **Upkeep er under omlægning:** ejer-direktiv 29/8 ([#4385](https://github.com/NicolaiDolmer/CyclingZone/issues/4385))
> siger at den flade sæsonstart-opkrævning skal blive en løbende rejse-, bus- og personaleudgift pr. løbsdag.
> Designes nu, shippes efter 27/9. `UPKEEP_BY_DIVISION` er dermed eksplicit midlertidig.

Disse konstanter bor i `backend/lib/economyConstants.js` og er dokumenteret i `docs/GAME_INVARIANTS.md` — **denne fil duplikerer dem ikke**. To afvigelser fundet ved verifikation 25/8, begge nyere end GAME_INVARIANTS' tekst:

| Konstant | GAME_INVARIANTS.md siger | Kode siger i dag |
|---|---|---|
| `UPKEEP_BY_DIVISION` | `{1: 440_000, 2: 140_000, 3: 40_000}` | `{1: 220_000, 2: 70_000, 3: 20_000, 4: 0}` — halveret ejer-beslutning 23/8 |
| Akademi-lønprocent på `/rules`+`/help` | (ikke nævnt) | `rulesNumbers.js: academySalaryPct = 6.7` — viser den GAMLE 0,067-sats, ikke den reelle CPV×0,35-formel (§2) |

`SPONSOR_INCOME_BY_DIVISION`, `PRIZE_PER_POINT`, `DEBT_CEILING_BY_DIVISION`, `INITIAL_BALANCE` og `STAR_RIDER_MARKET_VALUE` stemmer overens mellem kode og GAME_INVARIANTS.md — verificeret, ingen afvigelse fundet.

---

## 4. Auktion og marked

| Mekanik | Status | Fil |
|---|---|---|
| Egen-rytter-loft 1×, bank/AI-gulv 1× | Live | `auctionRules.js` |
| Fair-play prisbånd (gulv+loft på spiller-til-spiller-handler) | Kode live, **konfig deaktiveret som default** (`floor_pct=0, cap_multiple=null`) — kræver ejeren sætter tal i `app_config` | `transferPriceBand.js`, #3133 |
| Søndags-markedssweep (marked blandet ind i modelværdi) | Kode live, **flag `off` + vægt 0, har aldrig kørt** (verificeret 30/8) | `marketValueSundaySweep.js`, app_config `market_value_sweep_enabled` |
| Bank-reserve 25 % i stedet for dikteret gulv | **Kun forslag** (designkritik §5.3b) | ikke implementeret |
| 23 spiller-til-spiller-handler nogensinde konkurrenceprissat (målt 14/8) | Historisk måling, ikke en løbende metrik | designkritik §3.1 |

`app_config`-nøgler fundet ved grep der styrer økonomi (ingen prod-værdier læst eller gengivet her): `market_value_sweep_enabled`, `market_value_global_weight`, `market_value_weekly_cap`, `transfer_price_floor_pct`, `transfer_price_cap_multiple`, `wage_deduction_mode`, `board_mandate_model_enabled`, `academy_enabled`.

---

## 5. Kontraktudløb (design besluttet 23/8, IKKE implementeret)

`docs/superpowers/specs/2026-08-23-kontraktudloeb-tvangsauktion-design.md` beskriver en tvangsauktion ved kontraktudløb (sælger krediteres, K1-K15). **Verificeret i kode 25/8: den kører ikke.** Live er stadig den tavse frigivelse:

| Regel | Live adfærd | Fil |
|---|---|---|
| Kontrakt udløber | `team_id`, `salary`, kontraktfelter nulstilles, **ingen kreditering** til den tidligere ejer | `contractExpiryRelease.js` (#2744) |
| Rækkefølge (bevares i BEGGE modeller) | Kontraktudløb kører FØR payroll — man betaler aldrig løn for en rytter man har mistet | `seasonTransition.js` fase 5c før 6 |
| `wage_deduction_mode` | `season_upfront` (default) — `daily` findes i kode men flip er gated til en sæsongrænse | `wageDeductionConfig.js`, #2840 |

`contractExpiryAuction.js` (modulet designet i spec'en) **findes ikke i repoet**. Design ≠ implementering her.

---

## 6. Bestyrelsens økonomiske dele (Mandat-modellen)

> **Bestyrelsen har fået sit eget SSOT-dokument 29/8: [`BOARD_RULES.md`](BOARD_RULES.md)** — inkl.
> adskillelses-kontrakten mellem bestyrelse og sponsor (§5), som er forudsætningen for
> [#4265](https://github.com/NicolaiDolmer/CyclingZone/issues/4265). Tabellen herunder er stadig gyldig,
> men den fulde ansvarsfordeling og konsekvens-lagenes tærskler står dér.
>
> **Verificeret 29/8 (var åbent i §6's sidste linje):** `board_mandate_model_enabled = 'off'` i prod
> siden 17/8 12:35. Migrationen kørte alligevel 23/8, og skyggetabellerne har ikke været opdateret siden.

Kun de dele af `2026-08-07-board-mandate-rework-design.md` der rører penge:

| Regel | Beslutning | Kilde |
|---|---|---|
| Mål-bonus/straf-valuta | **Kun tillid (confidence)**, ingen ny pengestrøm | ejer 7/8, §3.1 |
| Penge-effekt af bestyrelsen | Forbliver i lag 6-bonustilbud + `MAX_BOARD_MODIFIER = 1.20` på sponsor-loftet — uændret mekanik, se `docs/GAME_INVARIANTS.md` | ejer 7/8 |
| Sponsor-vækstmål | Re-pointes til `sponsor_contracts`-udbetalinger, ALDRIG det døde felt `teams.sponsor_income` | ejer 7/8, #3494 |
| Kill-switch | `board_mandate_model_enabled` i `app_config`, default OFF = gammel 3-tals-model er sandheden | `boardMandateFlag.js`, #3514 |

Om flaget faktisk står `true` i prod pr. 25/8 er **ikke verificeret** i denne opgave (ingen `app_config`-værdilæsning).

---

## 7. Hvad der håndhæver hvad

| Niveau | Hvad det fanger | Hvor |
|---|---|---|
| DB-constraint / GENERATED-kolonne | `market_value` kan ikke afvige fra `base_value + prize_earnings_bonus` | `database/2026-06-10-value-cutover-base-value.sql` |
| Frontend/backend paritets-test | Løn-satsen kan ikke drifte mellem de to codebaser | `frontend/src/lib/salaryRateParity.test.js` (bygget 31/8, #4479 — tabellen lovede den fra #3989 og frem, men filen fandtes ikke) |
| /rules- og /help-tallenes drift-guard | Player-facing lønprocent er pinnet til `SALARY_RATE_PRODUCTION`, altså den konstant der faktisk fryser kontrakten | `frontend/src/lib/rulesNumbers.test.js` (#4479 repinnede den fra legacy-`SALARY_RATE`) |
| Løftede-vagter-guard | Ingen SSOT-doc eller kodekommentar må navngive en testfil der ikke findes | `backend/lib/promisedTestFilesExist.test.js` (#4479) |
| Route-gate | Auktions-startpris uden for [gulv,loft] afvises | `auctionRules.getAuctionStartPriceIssue` |
| Fail-safe app_config-læsning | DB-fejl på et økonomi-flag falder ALTID til den nuværende, ikke en ny, adfærd | `wageDeductionConfig.js`, `transferPriceBand.js`, `marketValueSweepConfig.js` — samme mønster i alle tre |
| Simulér-før-ship-harness | Ingen løn-/værdiændring ships uden dry-run scorecard mod ægte population | `salaryDecouplingScorecard.js`-mønsteret, gentaget for hver økonomi-ændring siden |
| ~~Intet i dag~~ | ~~Der findes **ingen** CI/prod-invariant der fanger at et player-facing tal (fx `academySalaryPct`) driver fra den formel der faktisk kører~~ — **lukket 31/8 (#4479)** for løn-tallene: `salaryRatePct` og `academySalaryPct` er nu pinnet til `SALARY_RATE_PRODUCTION`. Gapet består stadig for de player-facing tal der slet ikke ligger i `RULES_NUMBERS` | `rulesNumbers.test.js` |

---

## 8. Kendte åbne modsigelser

| # | Modsigelse | Hvor |
|---|---|---|
| 1 | `SEASON_VALUE_RECALC_ENABLED = false` — GAME_INVARIANTS.md siger værdier genberegnes ved sæson-slut OG præmie-udbetaling; kun det sidste er sandt i dag | `economyConstants.js:198`, `economyEngine.js:1429` |
| 2 | ~~`/rules` og `/help` viser `academySalaryPct = 6.7` — den formel akademi-signering faktisk bruger siden #3989 er `CPV × 0,35`, ikke `market_value × 0,067`~~ — **lukket 31/8 (#4479):** både `salaryRatePct` og `academySalaryPct` er sat til 35 og pinnet til `SALARY_RATE_PRODUCTION`, og `rules.json` (en+da) siger nu "current production value" / "nuværende produktionsværdi" i stedet for markedsværdi. Rod-årsagen var at drift-guarden pinnede til den døde `SALARY_RATE` og derfor var grøn hele vejen | `rulesNumbers.js`, `academyTransfer.js` |
| 3 | `UPKEEP_BY_DIVISION` i GAME_INVARIANTS.md er den gamle værdi fra før 23/8-halveringen | `economyConstants.js:51` |
| 4 | To 14/8-specs (`vaerdi-og-loen-fundament`, `oekonomi-designkritik`) foreslår hver sin `market_value`-baserede lønformel; ingen af dem er den der endte med at ship'e (#3989 valgte CPV, ikke market_value) | §2 |
| 5 | Egen-rytter-auktionsloftet (1× værdi) findes stadig, selvom designkritikken (§3.1) kalder det roden til at "spillerdrevne værdier" ikke kan opstå — intet ejer-svar fundet i kode eller commits på om 5×-forslaget er accepteret eller afvist | `auctionRules.js` |
| 6 | Kontraktudløb→tvangsauktion er ejer-besluttet 23/8 men ikke bygget; hvornår den lander er ikke i `docs/NOW.md` | §5 |
| 7 | ~~NOW.md's "Værdier/løn"-sektion ikke fundet~~ — **afklaret 25/8:** NOW.md blev omskrevet mens denne fil blev researchet. Sektionen findes som "💰 Værdier/løn S3" og er den skriftlige bekræftelse af nuværende tilstand |
| 8 | ~~Søndags-markedssweepets on/off-status i prod er ikke verificeret~~ , **afklaret 30/8:** flaget står `off`, vægten `0`, og log-tabellen er tom. Sweepen har aldrig kørt i prod. Se §9 | §1, §4, §9 |

---

## 9. Værdiernes kadence + alle åbne værdi-planer

> **Tilføjet 30/8 på ejer-anmodning:** "vi gennemgår alle vores planer, issues mv. angående værdierne, sådan vi sikrer at intet af det planlagte gemmes". Alt herunder er verificeret mod kode + prod 30/8, ikke gættet.

### 9.1 Hvornår rytterværdier flytter sig (udtømmende liste)

| # | Hvad | Hvornår | Kode | Status |
|---|---|---|---|---|
| 1 | **Søndagens værdi-pipeline**: v4-genberegning af `base_value`/CPV/typer for hele populationen, derefter markedsblendet | Søndag fra **kl. 06** dansk tid, ét persisteret dato-claim pr. søndag. IKKE gated af træning | `sundayValueSweep.js` (#4419) | Live |
| 2 | `prize_earnings_bonus` (3-sæsons-vindue) genberegnes | Ved **præmie-udbetaling**, ubetinget, enhver ugedag | `prizePayoutEngine.js` | Live, se §1 |
| 3 | Nye ryttere får `base_value` ved oprettelse | Akademi-intake, startrup-allokering | `academyIntakePull.js`, `starterSquadAllocator.js` | Live (oprettelse, ikke opdatering) |
| 4 | Heal-sweep re-deriverer ryttere med `base_value` NULL | Løbende, kun strandede rækker | `riderDeriveHealSweep` (#1673) | Live |
| 5 | Ejer-kørt engangs-niveaukorrektion | Manuelt script, ejer-gated, aldrig automatisk | `scripts/marketValueLevelCorrectionApply.js` | Kørt 2 gange 23/8, se 9.3 |
| 6 | ~~Manuel "Træn i dag" opdaterede holdets egne rytterværdier med det samme~~ | ~~Enhver ugedag~~ | ~~`POST /api/training/run-today`~~ | **Fjernet 30/8 (#4419)** |
| 7 | Genberegning ved sæson-slut | `SEASON_VALUE_RECALC_ENABLED` | `economyEngine.processTeamSeasonEnd` | **Slukket** (`false`, #1155), se §8 punkt 1 |
| 8 | **Den ekstraordinære værdikørsel ved model-skiftet** — én engangs-undtagelse fra søndagsreglen | Ejer-gatet script, uden for søndagen, ejerens ordrette "kør" | `backend/scripts/riderValueExtraordinaryRun5443.js` + [runbook](runbooks/5443-ekstraordinaer-vaerdikoersel.md) | Bygget, ikke kørt. Ejer-beslutning 3 (#5443, 20/9 aften). Tørkørsel som default; `--apply` kræver bekræftelses-sætning + miljø-ack + at nøglen står på `v5`; backup før skrivning; dagen claimes i `rider_value_sunday_log`; `--rollback` fra backuppen |

**Punkt 6 var reelt et hul i søndags-reglen.** Kaldet stammede fra #1364 (25/7), altså før søndags-kadencen blev besluttet 6/8 (#3448), og blev ikke omfattet af omlægningen. Med ca. 50 manuelle træninger i døgnet betød det at værdier stadig flyttede sig midt i ugen, men kun for de hold der trykkede på knappen.

**Rækkefølgen i punkt 1 er en hard regel:** v4-refresh FØRST, markedsblend SIDST. Omvendt rækkefølge (eller en genstart der kører v4-refresh igen senere samme søndag) skriver blendet væk igen, tavst. Derfor claimes dagen i `rider_value_sunday_log` FØR første skrivning, og claimet dækker hele pipelinen.

**Fejler v4-refresh'en, frigives dagens claim igen** (tilføjet efter review 31/8). Markedsblendet springes helt over i den gren, og næste times tick kører hele den ordnede pipeline forfra samme søndag. Uden frigivelsen ville ét statement-timeout koste en hel uges værdiopdatering, fordi næste tick blot fandt claim-rækken. Retry er sikker: refresh'en genberegner rent fra v4 og skriver kun de ryttere hvis værdi faktisk afviger.

**Punkt 8 er en undtagelse, ikke en ny kadence.** Søndagsreglen står ved magt. Kørslen kan kun bruges én gang: backup-tabellen skal være tom, og dagen skal kunne claimes i den samme `rider_value_sunday_log` som søndagen bruger — begge dele gør et gentaget kald til en fejl. Den skriver gennem `refreshChangedRiderValues`, altså præcis søndagens egen funktion; der findes ingen formel i scriptet.

**Punkt 1 er bevidst IKKE gated af `daily_training_enabled`** (ejer-beslutning 31/8). Træning og værdiopdatering er to uafhængige systemer: der skal kunne trænes hver dag, og værdier skal opdateres hver søndag — aldrig andre dage — uanset træningens tilstand. Et review foreslog gaten, fordi værdi-refresh'en historisk lå bag trænings-sweepens flag-gate, men den kobling var et artefakt af hvor koden lå, ikke en spilregel. På sigt skal træningsscoren indgå i selve værdiberegningen; det bliver en input-afhængighed i modellen, ikke en gate på om jobbet kører. `no_active_season` er ligeledes ikke en gate — refresh'en har eget korrekt sæson-anker (seneste completed sæson) siden cutover-fixet 23/8, og en gate ville koste en hel uges opdatering hver gang en søndag falder mellem "Afslut sæson" og transitionen. `marketValueSundaySweep` beholder sit eget flag (`market_value_sweep`), som er den sweeps egen nødbremse.

### 9.2 Markedsdrevne værdier: hvad der er lovet, bygget og ikke tændt

**Lovet spillerne** (ejerens Discord-besked 11/8, #the-roadbook): næste værdiopdatering bruger 75 % gammel formel og 25 % ny, derefter gradvist mod 100 % spillerdrevne værdier. Retningen genåbnes ikke; den er bindende forudsætning.

**Bygget** (#3448/#3449, merged 23/8): blend-sweep med support-guard pr. rytter og ugentligt ændringsloft, kill-switch, dato-dedup. `marketValueModelV1.json` er den fittede markedsmodel.

**Stadig ikke tændt. Ejer-go 30/8 lød på søndag 6/9 med 15 % global markedsvægt** (uændret ugeloft ±25 %, derefter i skridt med scorecard + ejer-go pr. skridt). **Rettet 20/9 (#5443): det flip skete aldrig.** Verificeret read-only mod prod 20/9 — `market_value_sweep_ran = false` for både 6/9, 13/9 og 20/9, og blokkeren fra #4449 (runtime læser V1-artefaktet, ikke den nyere fittede markedsmodel) står stadig. Dokumentet lovede en tilstand der ikke findes; markedet har aldrig flyttet en eneste rytterværdi. Eksekvering: [#4449](https://github.com/NicolaiDolmer/CyclingZone/issues/4449). Næste skridt efter v5 (§1.1) er en gen-fittet markedsmodel mod den nye typefordeling — de gamle koefficienter er fittet på en typefordeling der ikke eksisterer længere. Tilstand verificeret i prod 30/8, uændret siden:

| Nøgle | Værdi |
|---|---|
| `market_value_sweep_enabled` | `off` |
| `market_value_global_weight` | `0` |
| `market_value_weekly_cap` | `0.25` |
| `market_value_sunday_sweep_log` | 0 rækker (aldrig kørt) |

**De to målte grunde til at "bare tænde den" ikke er svaret** (begge fra `docs/superpowers/specs/2026-08-14-vaerdi-og-loen-fundament-design.md`, målt mod prod):

1. Markedsmodel v1.1 ramte faktiske handler DÅRLIGERE end den simuleringsbaserede v4 (MAE 38.176 vs. 28.968 CZ$ på tidsbaseret holdout 10/8). Mere marked ville her have betydet mindre præcision. **Rensningen af datagrundlaget hjalp, men vendte det ikke:** v2-artefaktets eget holdout (78 handler, 17/8) giver v4 20.572 CZ$ / 14,5 % MAPE mod markedsmodellens 29.831 / 33,8 %.
2. Der er 128,9 mio. CZ$ i kontanter mod 360,3 mio. i rytterværdi (målt 14/8). Et marked med for få penge finder ikke den rigtige pris, det finder loftet for hvad nogen kan betale.

**Skelnen der løser det** (ejerens egen ramme 14/8): spillerdata er stærke til *præferencer* (rangorden, nationalitet, ryttertype) og svage til *kroneniveauet*. Markedsvægten bør derfor styre relativ prissætning, mens niveauet forbliver forankret.

### 9.3 Niveaukorrektionen (#3449/#3750)

Søndags-**gaten** måler den forhandlede kanal (accepterede transfer-tilbud mellem menneskehold) og foreslår en niveau-faktor `c`. Den **skriver aldrig værdier**. Selve korrektionen er et ejer-gatet engangs-script.

| Dato | Hændelse | Tal |
|---|---|---|
| 22/8 | Gate rød (`unstable_channel`) | spænd 0,225 over bånd ±0,15 |
| 23/8 | Gate grøn, `c = 0,811` | 80 kvalificerede handler |
| 23/8 | Korrektion anvendt 2 gange (ejer-kørt) | 6.775 ryttere: 425,7 mio. til 345,2 mio. CZ$ · 3.933 ryttere: 400,8 mio. til 325,0 mio. |
| 30/8 | Gate grøn, `c_candidate = 1,017` | 97 handler, rullende medianer 1,214 / 1,092 / 1,017 |

Læsningen 30/8: den forhandlede kanal ligger nu meget tæt på 1,0 mod de korrigerede værdier, altså managers betaler cirka det spillet vurderer. Kanalen er stadig i faldende drift (1,21 til 1,02 over tre vinduer), så niveauet har ikke sat sig endnu.

### 9.4 Åbne planer og issues om værdier (intet af det er tabt)

| Issue | Hvad | Status 30/8 |
|---|---|---|
| [#3448](https://github.com/NicolaiDolmer/CyclingZone/issues/3448) | Markedsdrevne værdier: blend-kadence og vej mod 100 % spillerdrevet | **Afklaret 30/8.** Modsigelsen mellem issuets 50/50 og udmeldingen 11/8 (75/25) er afgjort: **15 % global vægt fra søndag 6/9**, derefter i skridt, ingen dato for 100 %. Eksekvering i #4449 |
| [#4449](https://github.com/NicolaiDolmer/CyclingZone/issues/4449) | Tænd markedsblendet 6/9 med 15 % vægt | Åben. Blokkerende før flip: runtime skal læse v2-artefaktet (evidensvægt `Z = n/(n+K)`, kvalificeret evidens, `type_column`), tørkørsel mod prod, ejer-go på selve flippet, spillerkommunikation |
| [#3750](https://github.com/NicolaiDolmer/CyclingZone/issues/3750) | 739 bank-salg til mekanisk 25 % indgår som "markedsevidens", så modellen trænes delvist på sit eget tal | Åben, men **datasiden er løst**: `marketValueModelV2.json` (fittet 17/8) trænes kun på kvalificeret evidens, 391 af 1.288 handler overlevede filteret. Det der udestår er at RUNTIME bruger artefaktet, se #4449 |
| [#3353](https://github.com/NicolaiDolmer/CyclingZone/issues/3353) | Re-fit af v4 mod den caps-baserede ryttertype-klassifikation, fjerner #3345's frysning | Åben |
| [#4000](https://github.com/NicolaiDolmer/CyclingZone/issues/4000) | Typen skal fylde mindre i værdiformlen (regulariseret offset-tabel + alpha) | `claude:done`, flippet 23/8 sammen med niveaukorrektionen (PR #4135) |
| [#4195](https://github.com/NicolaiDolmer/CyclingZone/issues/4195) | Værdimodellen er så stejl i toppen at ét overall-point giver +20 mio.; 40-mio.-loftet brydes på 44 % af seeds | Åben, `needs-decision` |
| [#4417](https://github.com/NicolaiDolmer/CyclingZone/issues/4417) | Spiller-rapport: markedsværdi står uændret i 14 dage mens rytteren udvikler sig | Åben. Skal vurderes mod søndags-kadencen: én ugentlig opdatering forklarer trin på op til 7 dage, ikke 14 |
| [#4263](https://github.com/NicolaiDolmer/CyclingZone/issues/4263) | Spiller-rapport: værdi falder 240k på to måneder mens evnerne stiger, uden forklaring i UI | Åben. Delvist forklaret af niveaukorrektionen 23/8, men UI siger det ikke |
| [#4128](https://github.com/NicolaiDolmer/CyclingZone/issues/4128) | Evne står stille under sit loft; spilleren aflæser aktuel værdi som loftet | Åben |
| [#4001](https://github.com/NicolaiDolmer/CyclingZone/issues/4001) | Akademi-salg prissættes på symbolsk intake-værdi i op til 6 dage | Åben |
| [#3656](https://github.com/NicolaiDolmer/CyclingZone/issues/3656) | Lønnormalisering (absurd lave og absurd høje lønninger) | Åben, betinget: hænger på at værdierne har sat sig |
| [#4419](https://github.com/NicolaiDolmer/CyclingZone/issues/4419) | Søndag kl. 06 i eget job, ingen værdiopdatering ved manuel træning | Denne ændring |

**Ikke-merged arbejde der ikke må glemmes:** branchen `feat/3448-level-anchor` (tip `e3dd70f5`) ligger på origin uden PR. Den implementerer `a_floor_shift` i `predictMarketPrice`. Feltet står allerede som `0` i `marketValueModelV1.json` på main, men **ingen kode på main læser det**: sætter man det til et andet tal for at flytte prisniveauet, sker der ingenting, tavst og uden fejl.

---

## Kildedokumenter (afløst af denne fil som regelkilde)

- `docs/superpowers/specs/2026-08-14-vaerdi-og-loen-fundament-design.md` — lønformlen her (§5) er IKKE den der kører; resten (gate-tænkning, 75/25-blanding) er historisk kontekst for #3989.
- `docs/superpowers/specs/2026-08-14-oekonomi-designkritik.md` — kritikken og målingerne (§3, §6) er stadig gyldig evidens, men §5's reviderede design er **ikke** implementeret. Brug den som baggrund, ikke som beskrivelse af live adfærd.
- `docs/superpowers/specs/2026-07-14-salary-decoupling-design.md` — **historisk**: Slice A af dette design blev implementeret og senere overhalet af #3989 (20/8), som fjernede divisions-skaleringen designet her indførte.
- `docs/superpowers/specs/2026-08-23-kontraktudloeb-tvangsauktion-design.md` — gyldig plan, ikke bygget endnu. Brug som implementerings-spec når arbejdet starter, ikke som status.
- `docs/superpowers/specs/2026-08-07-board-mandate-rework-design.md` — de økonomiske dele er dækket i §6 her; resten af dokumentet (UI, tillids-model) er uden for denne fils scope.
- `docs/GAME_INVARIANTS.md` — fortsat SSOT for konstanterne selv; denne fil peger på den og lister kun de punkter hvor kode har flyttet sig siden.

### 1b development measurement (22 September)

The development-only `backend/scripts/dev/bestRoleRefitReport5443.mjs` fits role offsets from a season simulation using the same rounded best-role selection as 1a. It evaluates the candidate through the existing career-NPV engine with an explicit development adapter; production valuation dispatch and the committed v5 model are unchanged. Candidate files and per-rider reports remain under ignored `balance-internals/`.

The report distinguishes team cash balances from the sum of rider valuations. It records coverage, unsampled roles, losses and synthetic one-point role transitions. A one-point sensitivity probe is not a measured training strategy: time, training costs and ability caps are not simulated by that probe. The current run is uncalibrated and is not approval for activation. A calibration target and the response to role-switch discontinuities remain owner decisions.
