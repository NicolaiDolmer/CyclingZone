# Kontraktudløb → tvangsauktion — design-spor, ejer-besluttet 23/8

> Rod-årsag: kontraktudløb frigiver i dag rytteren tavst til fri-agent-poolen, og når han gensælges krediteres INGEN. Målt i prod for S2: 243 ikke-youth auktioner uden sælger-payout = **26.300.877 CZ$ destrueret på én sæson**, hvoraf 229 (26,1 mio.) på ryttere der eksisterede før S1→S2-skiftet. Til sammenligning er menneskeholdenes samlede lønsum 6,6 mio. Refs #2744.

## Beslutningsgrundlag (prod-tal, målt 23/8)

| Måling | Værdi | Kilde |
|---|---|---|
| Ryttere med `contract_end_season = 3` på menneskehold | **1.486** | `riders` ⋈ `teams` |
| Deres samlede markedsværdi | 133,7 mio. CZ$ | `sum(market_value)` |
| Menneskeholdenes samlede kontanter | 145,6 mio. CZ$ | `sum(teams.balance)` |
| Hold logget ind seneste 7 dage | **36** af 214 | `auth.users.last_sign_in_at` |
| Kontanter hos de 36 aktive | **12,5 mio. (8,6%)** | do. |
| Kontanter hos 126 hold inaktive 30+ dage | **103,8 mio. (71,3%)** | do. |
| De 36 aktives trupper | 707 seniorer, **364 udløber (51,5%)** | do. |
| Aktive hold der falder under 8 ryttere | **18 af 36** | do. |
| S3-løb i de første 7 dage | **128 af 471 (27%)** | `races.scheduled_for` |
| Median / snit markedsværdi, udløbende | 10.512 / 89.903 | percentil |
| Gennemsnitsløn, udløbende | 2.111 (**2,3%** af markedsværdi) | do. |

**Den vigtigste konklusion:** 71% af pengene ligger på hold hvor ingen har logget ind i en måned. Den reelle købekraft i markedet er 12,5 mio., ikke 145,6. Designet er kalibreret mod det tal.

## Nuværende adfærd (verificeret i kode, ikke antaget)

Rækkefølgen i `transitionToNextSeason` ([seasonTransition.js:1044-1160](../../../backend/lib/seasonTransition.js)):

1. **5b** sponsorkontrakter fornyes
2. **5b-2** AI-hold auto-fornyer (`aiContractAutoRenewal.js`)
3. **5c** kontraktudløb: `contract_end_season <= fromSeason.number` → `team_id = null` (`contractExpiryRelease.js`)
4. **6** sponsor-payout → lånerenter → **løn** → nødlån (`economyEngine.processSeasonStart`)
5. **6f** `detectAndNotifySquadsBelowMinimum` — **ren detekt+varsl, intet auto-fill**

Frigivelsen nulstiller `team_id`, `pending_team_id`, `salary`, `contract_length`, `contract_end_season`, `acquired_at`, sletter fremtidige race-entries og lukker transfer-listings. **Ingen pengebevægelse.**

Ved gensalg: `resolveAuctionSellerContext` sætter `actualSellerTeamId = null` når rytteren er ejerløs, og krediteringen i `finalizeAuctionRecord` er betinget af netop det felt ([auctionFinalization.js:1257](../../../backend/lib/auctionFinalization.js)). Køber debiteres, ingen krediteres.

**Vigtigt at bevare:** 5c kører FØR 6. Man betaler derfor aldrig løn for en rytter man har mistet. Det er ejer-krav og må ikke brydes.

## Ejer-beslutninger (designsession 23/8)

| # | Spørgsmål | Beslutning |
|---|---|---|
| K1 | Hvad sker der ved udløb | **Tvangsauktion**, ikke tavs frigivelse |
| K2 | Hvem får pengene | **Den afgivende manager.** Fjerner pengesinket |
| K3 | Løn for udløbet rytter | **Ingen.** Rytteren SKAL ud af lønbasen før payroll (5c før 6 bevares) |
| K4 | Hvornår ligger bølgen | **Første uge af den NYE sæson** |
| K5 | Sluttider | Alle starter ved skiftet, synlige fra dag 1. Sluttider spredt over **7 dage** |
| K6 | Bølge-orden | **Stratificeret tilfældig** — hver dag samme blanding af dyre og billige. Ingen "vigtig dag", ingen spekulation |
| K7 | Startpris | **Lav, 25% af markedsværdi.** Budkrigen sætter prisen |
| K8 | Ingen bud | **Fri agent** (uændret adfærd) |
| K9 | Må afgivende manager byde? | **Nej.** Ellers er nettoomkostningen nul og mekanikken annulleres gratis |
| K10 | Trup-gulv i frigivelsen | **Nej.** Man kører underbemandet |
| K11 | Aktivt hold under 8 | **Gratis opfyldning til 8** med nygenererede bundryttere, 1-sæsons kontrakt, lav løn. Fyrer når bølgen lukker dag 7 |
| K12 | Inaktive hold | Hold der **hverken har logget ind i 60 dage eller kan stille op** afmeldes fra løb + sponsor. Tilmeld-knap bringer dem tilbage. **Deres kontrakter udløber alligevel** |
| K13 | AI-hold | **Uændret auto-fornyelse.** Deltager ikke i tvangsauktionen |
| K14 | Lønmodel | **`wage_deduction_mode` → `daily`** ved S3-slut |
| K15 | Varsling | **Udløbs-oversigt på Min trup** + **én samlet notifikation** + påmindelse en uge før |

### Hvorfor K9 er kritisk

Med lav startpris (K7) og provenu til den afgivende manager (K2) kan han byde på sin egen rytter, vinde uden modbud, betale 25% og modtage samme beløb. Nettoomkostning nul, rytteren beholdt. Uden K9 er hele mekanikken gratis at annullere for enhver der er logget ind.

### Hvorfor K10 + K11 hænger sammen

`MIN_RIDERS_FOR_RACE = 8` importeres **ikke i en eneste race-fil**. Et hold med 5 ryttere stiller op med 5 ([raceAutopick.js:89](../../../backend/lib/raceAutopick.js) bruger kun `rule.max`). Konsekvensen af at være underbemandet er sportslig, ikke teknisk. Gulvet er derfor ikke nødvendigt i selve frigivelsen — men aktive spillere skal ikke efterlades uden hold, deraf K11.

Bemærk asymmetrien vi bevidst accepterer: `getSquadRiskViolation` spærrer FRIVILLIGE afgange under 8 (fire callsites), mens tvangsauktionen ikke gør. Det er tilsigtet: K11 er sikkerhedsnettet i stedet.

## Leverance

### A. Tvangsauktion (kernen)

Ny modul `contractExpiryAuction.js`, kaldes fra fase 5c i stedet for den nuværende tavse frigivelse.

Pr. udløben rytter:
1. Frigør som i dag (`team_id = null` m.fl.) **men gem `previous_team_id` på auktionsrækken**
2. Opret auktion: `starting_price = round(market_value * 0.25)`, `current_bidder_id = null`, `seller_team_id = previous_team_id`
3. `calculated_end` = skiftetidspunkt + tildelt bølgedag (1-7) + tidspunkt inde i det åbne auktionsvindue

Bølge-tildeling (K6): sortér kandidaterne på `market_value` faldende, fordel round-robin over de 7 dage. Det giver jævn værdifordeling pr. dag uden RNG og er dermed deterministisk og testbart.

Kreditering: `resolveAuctionSellerContext` skal returnere `previous_team_id` som `actualSellerTeamId` for disse auktioner, så den eksisterende `if (actualSellerTeamId)`-blok krediterer uden ændring. Nyt `reason_code` skelnes fra almindeligt salg for at kunne måles.

Egen-bud-spærre (K9): afvis bud hvor `bidder_team_id === auction.seller_team_id` for auktioner af denne type. Skal ligge BÅDE i bud-endpointet og i finalize som defense-in-depth, samme mønster som `getAuctionBidSquadBlock`.

Uændret: ingen bud → `closeAuction` sætter `completed`, ingen penge flytter, rytteren forbliver fri agent (K8).

Ryttere i et aktivt etapeløb ved skiftet udskydes som i dag (`getRidersInActiveStageRace`) og fanges af næste transition — `<=`-gaten selv-heler.

### B. Opfyldning af aktive hold (K11)

Ny sweep, fyrer når bølgen lukker (skiftetidspunkt + 7 dage). For hvert **aktivt** menneskehold med under 8 ikke-akademi-ryttere: generér via `fictionalRiderGenerator` op til 8, med lav rating, `contract_length = 1`, løn efter normal formel.

Markør-gated + idempotent, samme disciplin som `runStarterSquadHealSweep`. Fyrer kun én gang pr. sæsonskifte pr. hold.

Ingen exploit-flade: frivillige salg under 8 er allerede spærret, så opfyldningen kan kun udløses af tvangsauktionen.

### C. Afmelding af inaktive hold (K12)

Kriterie: `last_sign_in_at <= now() - 60 dage` **OG** under 8 ikke-akademi-ryttere. Begge betingelser skal være opfyldt.

Afmeldt hold: ude af race-entry-generering og sponsor-payout. Trup og balance røres ikke. Kontrakter udløber som normalt, så deres ryttere når markedet.

Tilbagevending: knap i UI. Krav for at kunne trykke: mindst 8 ryttere. Ved tilmelding genoptages løb og sponsor fra næste sæson.

Ved S3-slut rammer det 4 hold. Mekanikken er bevidst mild nu og bider når beta-kohorten ældes.

### D. Daily-løn (K14)

Flip `app_config.wage_deduction_mode` fra `season_upfront` til `daily`. Koden findes: `wageDeductionSweep.js` kører dagligt kl. 22, og `computeTeamDailyWage` trækker `round(salary / race_days_total)` pr. rytter.

**Hard constraint:** flippet må KUN ske på en sæsongrænse, før `processTeamSeasonPayroll` kører for den nye sæson. Sker det midt i en sæson hvor sæsonlønnen allerede er trukket upfront, dobbelttrækkes holdene. Advarslen står i `wageDeductionConfig.js`' header.

Kræver dry-run mod ægte population før flip (simulér-før-ship).

Daily-løn er også det der gør K3 bogstavelig: dagen rytteren forlader dig, stopper hans løn, og køber du en erstatning betaler du fra den dag.

### E. Varsling (K15)

- **Udløbs-oversigt** på Min trup: hvilke ryttere udløber, hvornår, markedsværdi, nedtælling til skiftet. T2 wide data-skabelon. Det er også fladen kontraktgebyret senere skal bo i
- **Én samlet notifikation** i stedet for en pr. rytter: "X ryttere i din trup udløber ved sæsonskiftet". Erstatter den nuværende `emitContractExpiringNotifications`-adfærd
- **Påmindelse en uge før** sæsonskiftet
- Ny notifikation ved salg: "din rytter blev solgt for X CZ$"
- Copy EN-først, DA under. Kort på fladen, forklaring i `help.json` (en+da)

## Rækkefølge

A og B skal ship'e sammen — A uden B efterlader 18 aktive hold underbemandede. C og E kan ship'e uafhængigt og før. D skal ligge præcis på S3→S4-grænsen sammen med A.

Alt skal være i produktion før S3-transitionen, hvor 1.486 kontrakter udløber.

## Bevidste fravalg

- **Intet trup-loft-arbejde.** `MAX_SQUAD_SIZE = 30` er den eneste rigtige cap; `DIVISION_SQUAD_LIMITS` (10-16) er ikke et loft men input til bestyrelsesmålet "hold på min. N ryttere". Aktive hold har 19,6 seniorer mens et løb udtager 6-8, så 12-14 pr. hold starter aldrig. Reelt problem, men eget issue: #4146
- **Intet kontraktgebyr i denne leverance.** Uden gebyr er forlængelse gratis, så tvangsauktionen vil primært fyre på hold hvor ingen har logget ind. Mekanikken bliver først god når gebyret følger med. Eget issue: #4145
- **Ingen mindstepris / bank-backstop.** Ingen bud betyder fri agent og nul kompensation (K8). Accepteret bagkant
- **AI-hold deltager ikke** (K13). AI-feltet er det der holder løbene fyldte, og dry-run 5/8 viste at flere AI-hold falder til 3-5 ryttere uden auto-fornyelsen

## Testkrav

- `contractExpiryAuction`: bølge-fordeling er deterministisk og jævn i værdi pr. dag; startpris = 25% afrundet; `previous_team_id` bevares
- Kreditering: sælger krediteres præcis én gang, idempotency-nøgle holder ved re-run
- K9: bud fra afgivende hold afvises i både endpoint og finalize
- 5c kører før 6: regressionstest på at et udløbet rytters løn ikke opkræves
- Opfyldning: idempotent, fyrer kun for aktive hold, kun én gang pr. skifte
- Afmelding: begge betingelser krævet; tilmelding spærret under 8 ryttere
- Daily-løn: sum over en hel sæson = sæsonlønnen (ingen drift fra afrunding)
