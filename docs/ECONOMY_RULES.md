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
| `market_value = COALESCE(base_value,1000) + prize_earnings_bonus`, DB GENERATED | `database/2026-06-10-value-cutover-base-value.sql` | #1101, 10/6 | Live |
| `base_value` skrives af backfill/model v4 (`riderCareerNpv.js`) | `docs/GAME_INVARIANTS.md` | — | Live |
| `prize_earnings_bonus` = 3-sæsons-vindue af præmieindtjening, ÉN fast divisor (3) uanset hvor mange sæsoner der findes | `economyEngine.updateRiderValues` | ejer 8/6 (#1155) | Live ved præmie-udbetaling |
| — genberegnes ved **præmie-udbetaling** (`paySeasonPrizesToDate`) | `backend/lib/prizePayoutEngine.js` | R3 #895 | **Live, ubetinget** |
| — genberegnes ved **sæson-slut** | `economyEngine.processTeamSeasonEnd` | flag `SEASON_VALUE_RECALC_ENABLED` | **PT `false`** (#1155, 8/6) — se §10.1 |
| `valuation_type` frosset snapshot af `primary_type` | `riderValuation.js`, `riderCareerNpv.js` | #3345, ejer 4/8 | Live, undgår −24,5 % populations-shock |
| NPV-vækstrater frosset (trin 7) | `riderCareerNpv.js` (`FROZEN_NPV_RATE_BY_POTENTIAL`) | ejer 16/8 | Live, undgår median −12 % shock |
| Søndags-marked-sweep (blander model + observerede handler) | `marketValueSundaySweep.js` + `marketValueModelV1.json` | app_config-flag `market_value_sweep_enabled` | Kode findes; **nuværende on/off IKKE verificeret her** (ingen prod-værdi-læsning i denne opgave) |

**Startpris-loft på auktion** (`backend/lib/auctionRules.js`, `getAuctionStartPriceIssue`): egen rytter må udbydes for **maks 1× `market_value`**; bank/AI-ryttere skal udbydes for **mindst 1× `market_value`**. Ingen ejer-lås-dato fundet i koden for netop denne grænse. Kritiseret hårdt i kilde-dokumentet §3.1 (spærrer markedet fra at sige "denne rytter er mere værd") — forslaget om 5×-loft + 2-budgiver-krav + bank-reserve på 25 % er **ikke implementeret**, kun anbefalet.

---

## 2. Løn

**Formlen der rent faktisk kører (#3989, ejer-beslutning 20/8), verificeret i `backend/lib/economyConstants.js` + `contractSeed.js`:**

| Regel | Værdi | Fil |
|---|---|---|
| Løngrundlag | `current_production_value` (CPV), IKKE `market_value` | `contractSeed.computeFrozenSalary` |
| Sats | `SALARY_RATE_PRODUCTION = 0.35`, ét globalt tal | `economyConstants.js` |
| Divisions-skalering | **Ingen** — bevidst fjernet 20/8 (den gamle per-division-sats gjorde samme rytter dobbelt så dyr i D2 som D3) | samme fil |
| Gulv | 1 (aldrig 0) | `computeFrozenSalary` |
| Loft | Intet | — |
| Frysning | Ved signering/erhvervelse (auktion, transfer, akademi-promote, seed); rører sig ikke før forlængelse | #1309 |
| Fri agent (visning) | Samme formel, kun UI-estimat, ryttere uden hold har `salary = NULL` i DB | `marketUtils.resolveRiderSalary` + frontend `marketValues.js` (parity-test `salaryRateParity.test.js`) |
| Akademi/ungdom | **Samme `computeFrozenSalary`-formel som senior** siden #3989 (verificeret: `academyIntake.js`, `academyTransfer.js` importerer `computeFrozenSalary`, ikke `ACADEMY.SALARY_RATE`) | — |

**To ting der IKKE længere er lønformlen, selvom de står andre steder:**
- `SALARY_RATE = 0.067 × market_value` (den gamle formel) er stadig i `economyConstants.js`, men markeret i kodens egen kommentar som **"kun reference/legacy"**. `ACADEMY.SALARY_RATE` peger stadig på den, men er ubrugt af den faktiske akademi-signering (se test-kommentar i `academyTransfer.test.js`: "ikke længere ACADEMY.SALARY_RATE").
- `loen = A × (market_value/100.000)^eksponent` (#3393-formlen fra begge 14/8-specs, med `market_value` som grundlag) blev **eksplicit afvist** 20/8: kommentaren i `economyConstants.js` viser at den formel genindfører præcis den alders-/evne-inversion løn-decouplingen (#2428, juli) skulle fjerne, målt på konkrete eksempler. **#3393 står parkeret.**

Begge 14/8-specs (`vaerdi-og-loen-fundament-design.md` §5, `oekonomi-designkritik.md` §5.5) foreslår altså en lønformel der **ikke er den der kører**. De er historisk kontekst for hvorfor #3989 blev besluttet, ikke en beskrivelse af nutiden.

---

## 3. Sponsor, upkeep, gæld, præmie

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
| Søndags-markedssweep (marked blandet ind i modelværdi) | Kode live, on/off ikke verificeret her | `marketValueSundaySweep.js`, app_config `market_value_sweep_enabled` |
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
| 8 | Søndags-markedssweepets on/off-status i prod er ikke verificeret af denne fil (bevidst — se opgavens forbud mod at læse `app_config`-værdier) | §1, §4 |

---

## Kildedokumenter (afløst af denne fil som regelkilde)

- `docs/superpowers/specs/2026-08-14-vaerdi-og-loen-fundament-design.md` — lønformlen her (§5) er IKKE den der kører; resten (gate-tænkning, 75/25-blanding) er historisk kontekst for #3989.
- `docs/superpowers/specs/2026-08-14-oekonomi-designkritik.md` — kritikken og målingerne (§3, §6) er stadig gyldig evidens, men §5's reviderede design er **ikke** implementeret. Brug den som baggrund, ikke som beskrivelse af live adfærd.
- `docs/superpowers/specs/2026-07-14-salary-decoupling-design.md` — **historisk**: Slice A af dette design blev implementeret og senere overhalet af #3989 (20/8), som fjernede divisions-skaleringen designet her indførte.
- `docs/superpowers/specs/2026-08-23-kontraktudloeb-tvangsauktion-design.md` — gyldig plan, ikke bygget endnu. Brug som implementerings-spec når arbejdet starter, ikke som status.
- `docs/superpowers/specs/2026-08-07-board-mandate-rework-design.md` — de økonomiske dele er dækket i §6 her; resten af dokumentet (UI, tillids-model) er uden for denne fils scope.
- `docs/GAME_INVARIANTS.md` — fortsat SSOT for konstanterne selv; denne fil peger på den og lister kun de punkter hvor kode har flyttet sig siden.
