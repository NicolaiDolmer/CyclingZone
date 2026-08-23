# Race Engine v4 — head-to-head-scorecard (v4 vs. v3, hele S3-kalenderen)

> Genereret 2026-08-23 af `node backend/scripts/headToHeadV4.js` (READ-ONLY mod prod, kun SELECT) · Refs #4030, #3855, PR #4094, PR #4072
> SSOT: [`docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md`](../superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md) §5 (virkeligheds-ankre) + §8c (gate-beslutning 25/8)
> Population: 6328 ryttere (ægte prod-eksport, `exportPopulationSnapshot.js`) · Kalender: S3, 392 unikke etaper på tværs af 138 løb (dedupet på `pool_race_id` — samme rute kører identisk i alle 15 divisioner, verificeret stikprøvevis)

**Gate-kontekst:** ejeren beslutter mandag aften (24/8) om v4 går live tirsdag 25/8 kl. 11 (beslutning 25, §8c). Dette dokument er beslutningsgrundlaget.

## Verdict-forslag: 🔴 RØD — ikke klar til 25/8-cutover

v3 kører tirsdag som planlagt (fallback, jf. §8c). v4 bør IKKE flippes 25/8. Anbefaling: fortsæt til F3-mekanikbølgen adresserer de 3 største afvigelser nedenfor, gen-kør dette scorecard, flip på første hviledag hvor scorecardet er grønt (§8c's egen fallback-klausul).

Begrundelse kort: v4 vinder klart på to af de mest citerede §5-mål (felt-favorit-win-rate inden for 25-40 %-båndet vs. v3's nuværende problem; descent attack-loftet er korrekt implementeret), men fejler hårdt på type-integritet (sprintere vinder ikke længere pålideligt flade etaper) og på gap-realisme i bjergene (top-10-spredning 4-5x for stor). Det er ikke støj — det er konsistent på tværs af to uafhængige kørselsmetoder (se metodologi).

## Metodologi: to kørsler, forskellige formål

Harnessen (`headToHeadV4.js`) kører v3 (`simulateStage`) og v4 (`simulateStageV4`) på **samme rute + samme startfelt + samme seed** pr. etape, og scorer begge mod §5-ankrene (`headToHeadAnchors.js`).

| Kørsel | Feltstørrelse pr. etape | Formål | Runtime (392 etaper) |
|---|---|---|---|
| **A. Fuld population** | 6328 ryttere (hele S3-populationen, hver etape) | Statistisk styrke, oprindelig F2-harness-adfærd | 3 min 11 s |
| **B. Realistisk felt** | 180 ryttere (deterministisk sample pr. etape, ny `--field-size=180`) | Flere §5-ankre er kalibreret mod virkelige feltstørrelser (~150-200 ryttere), ikke 6328 — sekund-baserede mål (feltsammenhæng, bjerg-spredning, nedkørsel/summit-ratio) forvrides af en unaturligt stor "peloton" | 2,2 s |

Begge kørsler er inkluderet nedenfor pr. anker. Hvor de to metoder er uenige, er det angivet eksplicit — det er selv et signal (typisk metodefølsomhed på små eller ustabile mål, ikke en modsigelse).

Kalenderdedup: S3 har 471 race-rækker fordelt på 15 divisioner, men alle divisioner kører samme kalender (samme `pool_race_id` = identisk rute/`demand_vector`, verificeret ved stikprøve af 2 divisions-instanser af "O Gran Camiño Menor"). Scorecardet måler derfor de 138 unikke løb (392 etaper) én gang hver, ikke 15x redundant.

GRØN/GUL/RØD-oversættelse af harnessens PASS/FAIL/N-A: **GRØN** = PASS (inden for bånd). **RØD** = FAIL, klar afvigelse fra båndet. **GUL** = enten N/A (mekanik ikke tilkoblet endnu / ikke målbart i denne harness-version — forventet, ikke en fejl), eller et FAIL der er metodefølsomt/grænsetilfælde (angivet eksplicit i begrundelsen).

## Scorecard pr. anker

### 1. Feltsammenhæng, flade etaper
**Bånd:** 80-95 % af feltet på vinderens tid · **Kilde:** #3917-målingen

| | Kørsel A (fuld pop.) | Kørsel B (realistisk felt) |
|---|---|---|
| v3 | 0,2 % (n=104) | 2,8 % (n=104) |
| v4 | 0,0 % (n=104) | 0,6 % (n=104) |

**🟡 GUL (begge motorer, begge kørsler) — metodeforbehold, ikke ignoreret.** Harnessens operationalisering tæller ryttere med **eksakt** vinderens tid (0,00 s gap), ikke "inden for en rimelig margin" — det er strengere end #3917's oprindelige måling formentlig mente (UCI-tidtagning giver hele bunch-gruppen samme registrerede tid). Begge motorer scorer nær-nul på dette specifikke mål ved begge feltstørrelser, så det diskriminerer ikke mellem v3/v4 — men v4 er konsekvent lidt værre end v3 i begge kørsler, hvilket er svagt, men retningsbestemt input til vurderingen: v4's flade-etape-finaler skaber IKKE mere sammenhæng end v3's.

### 2. Nedkørsels-gaps vs. summit-gaps (ratio)
**Bånd:** ≤ 0,5 ved p5-p10 · **Kilde:** #3426-målingen

| | Kørsel A | Kørsel B |
|---|---|---|
| v3 | 0,33 [GRØN] (n=42) | 0,42 [GRØN] (n=42) |
| v4 | 1,07 [RØD] (n=42) | 1,15 [RØD] (n=42) |

**🔴 RØD (v4).** Designintentionen (mor-spec §4 M3/M7) er at nedkørsler skal **komprimere** tidsforskelle relativt til bjergtoppe (dygtige nedkørere indhenter). v4 måler i stedet en ratio > 1 på begge kørsler — nedkørsels-gaps er lige så store eller **større** end summit-gaps. Det er den forkerte retning, ikke bare for stor en værdi. v3 klarer båndet fint i begge kørsler.

### 3. Descent attack-gevinst (10-20 s-loft)
**Bånd:** 10-20 s, aldrig omvendt fortegn · **Kilde:** ejer-valg 20/8

| | Kørsel A | Kørsel B |
|---|---|---|
| v3 | n/a — ingen sammenlignelig mekanik | n/a |
| v4 | 20 [GRØN] (n=478 angreb) | 20 [GRØN] (n=413 angreb) |

**🟢 GRØN (v4) — eneste rene "v4 er bedre" på en isoleret v4-mekanik.** Loftet rammer præcis den øvre grænse (20 s) på tværs af 400+ observerede angreb i begge kørsler — mekanikkens hårde cap virker som designet. v3 er strukturelt n/a (ingen egen mekanik at sammenligne mod).

### 4. Punch-korrelation (punch-evne vs. placering)
**Bånd:** spearman > 0,2 · **Kilde:** #3965-harnesset

| | Kørsel A | Kørsel B |
|---|---|---|
| v3 | 0,70 [GRØN] (n=66) | 0,62 [GRØN] (n=66) |
| v4 | 0,44 [GRØN] (n=66) | 0,45 [GRØN] (n=66) |

**🟢 GRØN (begge).** Begge motorer består klart. v3 korrelerer stærkere, men v4's 0,44-0,45 er solidt over tærsklen — punch-evne er en synlig, meningsfuld fordel i v4's punch-finaler.

### 5. Felt-favoritters win-rate
**Bånd:** 25-40 % (erstatter v3's nuværende 80-88 %-problem) · **Kilde:** v3-spec §2 + ejer-valg 20/8

| | Kørsel A | Kørsel B |
|---|---|---|
| v3 | 20,4 % [RØD] (n=392) | 42,6 % [RØD] (n=392) |
| v4 | 35,5 % [GRØN] (n=392) | 46,2 % [RØD] (n=392) |

**🟡 GUL (uenighed mellem kørsler) — v4's bedste resultat, men skrøbeligt.** I kørsel A (fuld population, den højere-effekt-metode) lander v4 midt i det ønskede 25-40 %-bånd — det oprindelige formål med denne ejer-beslutning (dæmpe favorit-dominans) ser ud til at lykkes. Men i kørsel B stiger v4 til 46,2 % (over båndet), og v3 fejler i BEGGE kørsler (for lavt i A, for højt i B) — hvilket antyder at selve favorit-definitionen (harnessens `favorite`-proxy, se `headToHeadObservers.js`) er feltstørrelses-følsom for begge motorer. Læs som "lovende retning, ikke et bekræftet PASS".

### 6. Samme-hold-top-10 (4+ fra ét hold)
**Bånd:** < 3 % af etaper · **Kilde:** v3-spec §2

| | Kørsel A | Kørsel B |
|---|---|---|
| v3 | 0,0 % [GRØN] (n=392) | 0,0 % [GRØN] (n=392) |
| v4 | 0,0 % [GRØN] (n=392) | 0,0 % [GRØN] (n=392) |

**🟢 GRØN (begge).** Intet problem her for nogen af motorerne.

### 7. Udbrudsrater pr. terræn
**Bånd:** race:gate-bånd (intet enkelt tal) · **Kilde:** race:gate + #3426

| | Kørsel A | Kørsel B |
|---|---|---|
| v3 | 17,1 % [GRØN] (n=392) | 28,8 % [GRØN] (n=392) |
| v4 | n/a — M5 er F3-scope | n/a |

**🟡 GUL (v4, forventet N/A).** v4 klassificerer endnu ikke udbrudssejre (M5/jagt-interesse-mekanikken er F3-scope, ikke bygget i F2). v3's tal er informative som baseline, ikke en dom over v4.

### 8. Sprinter-vinderrate på flade etaper
**Bånd:** ≥ 90 % (top-20 %-sprint-evne skal vinde) · **Kilde:** race:gate + #3149

| | Kørsel A | Kørsel B |
|---|---|---|
| v3 | 97,2 % [GRØN] (n=108) | 79,6 % [RØD] (n=108) |
| v4 | 45,4 % [RØD] (n=108) | 61,1 % [RØD] (n=108) |

**🔴 RØD (v4) — én af de tre største afvigelser.** v4 fejler dette anker HÅRDT i begge kørsler — sprinterne vinder kun 45-61 % af de flade etaper, ikke ≥ 90 %. Det betyder type-integriteten er brudt: en spiller der bygger en ren sprinterprofil kan ikke stole på at vinde flade etaper i v4 i dag. v3 er klart bedre i kørsel A, men falder OGSÅ under båndet i kørsel B (79,6 %) — v3 er heller ikke perfekt, men v4's fald er markant dybere.

### 9. ITT-korrelation (time_trial-evne vs. placering)
**Bånd:** spearman > 0,3 · **Kilde:** race:gate + #3149

| | Kørsel A | Kørsel B |
|---|---|---|
| v3 | 0,64 [GRØN] (n=43) | 0,67 [GRØN] (n=43) |
| v4 | 0,06 [RØD] (n=43) | 0,32 [GRØN] (n=43) |

**🟡 GUL (v4) — skrøbelig, ikke til at stole på endnu.** v4 svinger fra praktisk talt INGEN korrelation (0,06 — tæt på tilfældig) ved fuld population til lige akkurat over tærsklen (0,32) ved realistisk felt. v3 er stabilt stærk i begge (0,64-0,67). Denne inkonsistens er i sig selv et problem: ITT-udfald i v4 bør ikke afhænge dramatisk af feltstørrelse, hvis time_trial-evne reelt er den dominerende faktor.

### 10. Bonussekunder, GC-effekt bounded
**Bånd:** maks ~10 s/etape · **Kilde:** #2413-kravet

| | Kørsel A / B (strukturel, ikke etape-afhængig) |
|---|---|
| v3 | 10 s [GRØN] — `racePassages.js` `FINISH_BONUS_SECONDS=[10,6,4]`, strukturelt bounded |
| v4 | n/a — M9 er F3-scope, `tuning.bonusSeconds` defineret men ikke forbrugt endnu |

**🟡 GUL (v4, forventet N/A).**

### 11. Bjergetape top-10-spredning
**Bånd:** 180-240 s (~3-4 min, PCS-niveau) · **Kilde:** #2415

| | Kørsel A | Kørsel B |
|---|---|---|
| v3 | 27 s [RØD] (n=108) | 92 s [RØD] (n=108) |
| v4 | **977 s** [RØD] (n=108) | **1239 s** [RØD] (n=108) |

**🔴 RØD (v4) — DEN største afvigelse i hele scorecardet.** v4's bjergetaper spreder top-10 over **16-21 minutter**, mod et bånd på 3-4 minutter — det er 4-5x for meget. v3 fejler i modsat retning (for tæt: 27-92 sekunder, for lidt selektion), så INGEN af motorerne rammer båndet, men v4's fejl er langt mere alvorlig og synligt "forkert" for en spiller: se `docs/audits/films-v4-2026-08-23/02-bjergetape.txt` — vinderen soloerer 877 sekunder (14,6 min) foran nummer 2, og en stor gruppetto-klump ankommer 1482 sekunder (24,7 min) bagud på identisk tid. Det ligner ikke en professionel bjergetape.

### 12. GT-vindermargin
**Bånd:** 60-480 s (1-8 min) · **Kilde:** #2415

**🟡 GUL — IKKE MÅLT (begge motorer, begge kørsler).** Kræver akkumuleret GC over et helt etapeløb (flere etaper i træk med samme rytterfelt og kumulativ tid) — denne harness-version scorer etape-for-etape og har ikke en GC-akkumuleringslag. Se "Hvad kunne ikke måles" nedenfor.

## De 3 største afvigelser (prioriteret)

1. **Bjergetape top-10-spredning eksploderer i v4 (977-1239 s mod 180-240 s-båndet, 4-5x for højt).** Den enkeltstående mest alvorlige afvigelse — synligt i løbsfilmen `02-bjergetape.txt` som en 877-sekunders solosejr. Blokerer alene et grønt scorecard.
2. **Sprinter-vinderrate på flade etaper kollapser i v4 (45-61 % mod ≥ 90 %-båndet).** Type-integritet brudt: sprintere kan ikke stole på at vinde deres egen disciplin.
3. **Nedkørsel/summit-gap-ratio i v4 går i den forkerte retning (1,07-1,15 mod ≤ 0,5-båndet).** Nedkørsler komprimerer ikke gaps som designet — de udvider dem, eller matcher summit-gaps 1:1.

Delt rod-årsags-hypotese (ikke verificeret her — kræver F3-arbejde i selve motoren, uden for denne harness-sessions mandat): alle tre peger mod finale-/gruppeselektions-mekanikken (M2-M4) på lange, hårde etaper snarere end mod en enkelt isoleret mekanik — bjerg-spredning, nedkørsels-retning og sprint-integritet deler alle "hvor hårdt splitter feltet sig, og hvor godt reflekterer det virkelige evner" som fællesnævner.

## Hvad kunne ikke måles (og hvorfor)

- **GT-vindermargin (§5/#2415):** kræver akkumuleret klassement over et helt etapeløb (flere etaper, samme startfelt, kumulativ tid) — denne harness-version scorer isoleret pr. etape. Ville kræve en GC-akkumuleringslag oven på `runHeadToHead()`, som er en større, selvstændig harness-udvidelse (uden for denne sessions "minimal fix"-mandat).
- **TTT (mor-spec §8b punkt 21, M13):** S3-kalenderen indeholder **ingen** `profile_type=ttt`-etaper (verificeret ved fuld gennemgang af de 392 eksporterede etaper) — mekanikken kan derfor ikke scores mod den faktiske kalender uanset harness-modenhed. Ikke en harness-mangel; kalenderen har simpelthen ingen TTT-etaper i denne sæson.
- **Udbrudsrater pr. v4-terræn (anker 7, v4-side):** M5 (udbruds-/jagt-interesse-mekanikken) er eksplicit F3-scope — v4 F2 klassificerer endnu ikke om en sejr var en udbrudssejr. Forventet N/A, ikke en fejl.
- **Bonussekunders GC-effekt (anker 10, v4-side):** M9 er F3-scope — `tuning.bonusSeconds` er defineret i `RACE_V4_TUNING`, men ingen v4-mekanik forbruger den endnu.

## Håndplukkede løbsfilm

5 etaper valgt fra den ægte S3-kalender (ikke syntetiske fixtures), kørt med et realistisk 180-rytter-sample af den ægte population. Gemt som læsbare tekstfiler i [`docs/audits/films-v4-2026-08-23/`](films-v4-2026-08-23/):

| Fil | Etape | Hvorfor valgt |
|---|---|---|
| [`01-flad-sprint-etape.txt`](films-v4-2026-08-23/01-flad-sprint-etape.txt) | Giro della Penisola, etape 4 (200 km, flat/bunch_sprint) | Renest mulige flad-etape-arketype — 0 stigninger |
| [`02-bjergetape.txt`](films-v4-2026-08-23/02-bjergetape.txt) | Giro della Penisola, etape 16 (160 km, high_mountain/long_climb, 4 stigninger) | Viser anker 11's fejl direkte: 877 s solomargin |
| [`03-monument.txt`](films-v4-2026-08-23/03-monument.txt) | Polynormande Nouvelle (220 km, classic/long_climb, enkeltdags) | Liège-Bastogne-Liège-analog — hilly enkeltdags-monument |
| [`04-brostensklassiker.txt`](films-v4-2026-08-23/04-brostensklassiker.txt) | L'Enfer du Nord (255 km, cobbles/breakaway, enkeltdags) | Paris-Roubaix-analog |
| [`05-itt.txt`](films-v4-2026-08-23/05-itt.txt) | Volta Algarvia, etape 5 (39 km, itt/solo_tt) | Meningsfuld ITT-distance (ikke en 6 km-prolog) |

Hver film har en trailing note om sample-metodologien (180 af 6328 ryttere, deterministisk seedet). Tidslinje-events med lange rytter-id-lister (`peloton_splits`, `finale_attack`) er trunkeret til de 3 første + et antal-notat for læsbarhed — selve hændelserne er urørte, kun visningen er komprimeret (`summarizeEventParams`, `headToHeadV4.js`).

## Harness-ændringer denne session (ingen motor-mekanik rørt)

1. `backend/scripts/exportSeasonStageProfiles.js` (ny) — eksporterer en sæsons fulde `race_stage_profiles`-kalender, dedupet pr. `pool_race_id`.
2. `backend/scripts/headToHeadV4.js` — `runHeadToHead()` fik en valgfri `fieldSize`-parameter (+ CLI `--field-size=N`) der sampler et realistisk startfelt pr. etape i stedet for at bruge hele populationen på hver etape. Default (udeladt) er 100 % uændret F2-adfærd — verificeret af eksisterende + nye tests.
3. `formatFilmText`/`summarizeEventParams` (samme fil) — trunkerer lange rytter-id-lister i tidslinje-tekstfiler for læsbarhed.
4. `backend/scripts/exportHandpickedFilms.js` (ny) — genererer de 5 håndplukkede film fra ægte kalenderdata.

Alle ændringer er harness/eksport/formatering — ingen fil under `backend/lib/engine/v4/` er rørt. Verifikation: `npx tsc -p tsconfig.engine.json` (rent, ingen fejl) + `node --test` på alle rørte filer (59/59 pass, se PR).

## Rå data (ikke committet — for store/følsomme til repoet)

- `backend/scripts/out/population-snapshot-2026-08-23.json` (6328 ryttere, 3,4 MB, gitignored)
- `backend/scripts/out/season-3-stage-profiles.json` (392 etaper, gitignored)
- `backend/scripts/out/full-population-run-output.txt` / `realistic-field-run-output.txt` (fulde konsol-output fra begge kørsler, gitignored)

Reproducér: `node backend/scripts/exportPopulationSnapshot.js --out=<fil>` → `node backend/scripts/exportSeasonStageProfiles.js --season=3 --out=<fil>` → `node backend/scripts/headToHeadV4.js --population=<fil> --stages=<fil> --seed=<streng> [--field-size=180]`.
