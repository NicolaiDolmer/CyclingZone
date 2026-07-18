# Søndags-årgangsmodellen — løbende rytter-tilgang (#2064) + tilbagevendende akademi-intake

> **Status:** ejer-godkendte rammer 19/7 (denne spec = nedfældning; afventer ejer-review af selve dokumentet).
> **Kilde-beslutninger:** ejer-svar 19/7 (natte-session) + addendum 16/7 (`2026-07-16-traening-ungdom-verdensklasse-addendum-design.md` §3 V1, beslutning 6) + 11/7-spec §5.3 (`2026-07-11-training-youth-depth-design.md`).
> **Afløser:** §5.3's rene sæson-transitions-trigger (ejer valgte søndags-rytme 19/7). Alt andet i §5.3 (kilde, aldersspredning, kalibrering, sim-krav) genbruges.

## 1. Ejer-beslutninger (låst 19/7)

1. **Søndag er intake-dag.** Hver søndag modtager hvert (menneske-)hold nye akademi-kandidater — drypvist.
2. **Sæsonens sidste søndag = Årgangsdagen** — den store dag med det største kuld ("lidt ekstra"). Sæsonskiftet sker samme dag, så pension, graduering, aldring og ny årgang samles i ét ritual.
3. **~12 kandidater pr. hold pr. sæson**, flest på Årgangsdagen.
4. **Talentfordeling:** flest små talenter, lav sandsynlighed for et meget stort.
5. **Facilitets-skalering (akademi-sporet, niveau 0-5): BÅDE flere kandidater OG bedre talent-odds.**
6. **Sæson = 28 dage** (eksisterende aftale; frossen konstant `daysPerSeason: 28` i `dailyTraining.js`) og skal ende på en søndag.
7. **Verdens-influx** (nye frie agenter til markedet — #2064's oprindelige kerne) kører på samme søndags-tick, kalibreret mod målt afgang.

## 2. Kadence og volumen

28-dages sæson, mandag-start → 4 søndage: S-søndag 1-3 = **drip**, S-søndag 4 = **Årgangsdag** (= transition-dag).

| Facilitets-niveau (akademi) | Drip pr. søndag (×3) | Årgangsdag | Sæson-total |
|---|---|---|---|
| 0-1 | 2 | 6 | 12 |
| 2-3 | 2 | 7-8 | 13-14 |
| 4-5 | 3 | 6-8 | 15-17 |

Tallene er *udgangspunkt* — endelige værdier låses af sim-scorecardet (§6). Kandidater er **tilbud** (eksisterende `academy_intake`-flow: offered → sign/afvis; 7-dages udløb via #2627-sweepen — en søndagskandidat udløber altså naturligt inden næste søndag + 1 dag). 12+ tilbud ≠ 12 ryttere: akademi-loftet (8 pladser + facilitets-ekstra-slots 0-5, `facilityConstants.js`) og signing-fee/løn gør valget reelt. Afviste → ungdomsauktion; usolgte → slettet (#2456). Kredsløbet er lukket.

**Talent-odds pr. kandidat (udgangspunkt, kalibreres i sim):**

| Potentiale-bånd | Niveau 0 | Niveau 5 |
|---|---|---|
| Lille | ~78 % | ~60 % |
| Mellem | ~19 % | ~32 % |
| Stort | ~3 % | ~8 % |

Ovenpå lægges årgangs-kvalitetsvariationen (±10 % seeded pr. sæson, ens for alle klubber, transparent — addendum-beslutning 6/#2493). Rå `potentiale` forbliver server-hidden (#1162); spilleren ser kun scout-vurderingen (talentspejder-båndet #1543).

## 3. Arkitektur

**Ny modul-fil `backend/lib/sundayIntakeTick.js`** — ét cron-entry (søndag ~10:00 Europe/Copenhagen):

1. **Idempotens-markør:** én række pr. (hold, søndags-dato) i ny tabel `academy_intake_ticks` (UNIQUE) — boot-run/replica-sikker (lærdom fra #2646-hændelsen: dagskvote/markør, aldrig pr.-boot-kvote).
2. **Drip:** for hvert menneske-hold med akademi: generér N kandidater (tabel §2) via eksisterende `academyGenerator.js` → `academy_intake` rows (status `offered`) med **`generation_tag` = aktiv sæson-id** (ny kolonne; stemples i ALLE ungdoms-kanaler — #2493-forberedelse).
3. **Årgangsdag-detektion:** er denne søndag sæsonens dag 28 → generér finale-kuldet i stedet for drippen. Kuldet ledsages af notifikation ("Årgangen af sæson N er ankommet") — genbrug notifikations-motoren.
4. **Verdens-influx (governor):** generér M frie agenter via `fictionalRiderGenerator` med §5.3's profil (mest journeymen 18-26, moderat potentiale; få sen-opdagede talenter). **M = f(målt afgang)**: pension-flag + #2456-sletninger + AI-trim i det rullende sæsonvindue, fordelt over sæsonens søndage. Med dagens afgang ≈ 0 er M ≈ 0 — governoren er selvkalibrerende og kan aldrig oversvømme markedet. Ingen fast konstant.
5. AI-hold får IKKE akademi-kandidater i v1 (AI-ungdom hører til tre-tier Fase 5/6, #2492); AI-fornyelse sker via verdens-influx + eksisterende reconcile.

**Berøringsflader (genbrug, ingen re-design):** `academyGenerator.js` (generering), `academy_intake`-flow + `academyIntakeExpirySweep.js` (#2627), `youthMarket.js`/auktion (#2648-kompensation uændret), `academyGraduation.js` (graduering ved 22), `facilityService.js` (niveau-opslag; akademi-sporets effekt-hook tændes hermed — `EFFECT_HOOKS.academy` er i dag `false`).

**Bugfix bundtet ind:** #1799 (akademi-signering lægger rytter på seniorholdet) fixes i samme slice som tick'et — signerings-flowet er alligevel åbent.

## 4. Sæsonskifte-afhængigheden (eksplicit)

Årgangsdagen forudsætter at **sæsonskiftet reelt sker på dag 28**. I dag er auto-transition slået fra (`SEASON_AUTO_TRANSITION_ENABLED=false`, 8/6-hændelsen) og S1 har kørt 28+ dage (start 22/6 → dag 28 = søndag 19/7). Denne pakke:

- **leverer** transition-day-hooken (Årgangsdags-kuld + generation_tag ved `transitionToNextSeason`),
- **kræver ikke** gen-armering af auto-transition — men gen-armering med guards (min-sæsonlængde 28 dage, max 1 transition/døgn, søndags-lås) er den naturlige opfølger og behandles som **separat ejer-beslutning** i #2449/#2376-sporet. Indtil da udløser admin/ejer transitionen manuelt på Årgangsdagen.
- **NB (akut, uden for denne pakke):** per 28-dages-aftalen er S1-finalen NU — S2-kalender (#2449) og transition skal ske snarest for at rytmen kan starte.

## 5. Økonomi- og invariant-respekt

- **Akademi-tilgang er lukket land (#2456, ejer-instruks 13/7):** ryttere kommer KUN ind i et akademi via (a) eget intake (denne spec) og (b) vundne ungdomsauktioner. Direkte signering af frie ungdomsryttere ind i akademiet blev fjernet med #2456/PR #2483 og må ikke genindføres — "talenter skal komme til ens eget akademi, ikke købes på fri transfer". Verdens-influx-agenterne (§3.4) lander derfor altid i den almindelige fri-agent-pool (senior-marked), aldrig som akademi-tilbud.
- Akademi-caps uændret: 8 basispladser (+0-5 facilitet), drift 5.000/plads/sæson (gold sink — flere aktive pladser = større sink, ingen ny guld-kilde), akademi-løn-rate 0.067, signing-fee-rate 0.25, ungdoms-mult 1.5 (`GAME_INVARIANTS.md`/#1308).
- Salary frossen ved signering (#1309) — uændret.
- v4-værdimodellen røres ikke; nye ryttere får værdi via eksisterende `predictBaseValue`/cpv-flow.
- Determinisme: kandidat-generering seedes pr. (hold, søndags-dato); årgangs-±10 % seedes pr. sæson (ens for alle).
- Migrationer: `generation_tag`-kolonne + `academy_intake_ticks`-tabel, additive/idempotente; applies under #2642-rammerne (merged → apply → verify).

## 6. Sim + scorecard (før-ship, obligatorisk)

Harness: udvid `progressionSimHarness.js`-mønstret; kør mod ægte population-snapshot + v4-værdier; seeds 2026/7/42.

| # | Gate | Mål |
|---|---|---|
| I1 | **Pool-stabilitet (C2).** 12 sæsoner, influx-governor + pension aktiv | Population ±10 % stabil; aldersfordeling stationær (ingen udtørring/eksplosion) |
| I2 | **Akademi-funnel.** Tilbud→sign→graduér/sælg/slip over 6 sæsoner | Stabil belægning ≤ loft; ingen perma-fyldt tvangs-afvisningsspiral |
| I3 | **Værdi-neutralitet.** Markeds-medianværdi (v4) over 12 sæsoner | Ingen inflations-/deflations-trend > ±5 %/sæson fra influx alene |
| I4 | **Facilitets-ROI.** Niveau 5 vs. 0: forventet kuld-værdi | Mærkbar (upgrade skal kunne betale sig) men ikke dominant; ROI i bånd med øvrige facilitets-spor |
| I5 | **Stort-talent-knaphed.** P(≥1 stort talent pr. hold pr. sæson) | Lav (følelsen "det store fund" skal være sjælden — kalibreres m. ejer på scorecardet) |
| I6 | **Årgangs-variation.** ±10 % uden kompounding over 12 sæsoner (#2493 C5) | Verificeret |

## 7. Slices (hver = egen PR + scorecard hvor markeret)

| Slice | Indhold | Gate |
|---|---|---|
| **S1** | Sim-harness + kalibreringsrapport (read-only; låser §2-tallene) | Scorecard I1-I6 → ejer-go |
| **S2** | `sundayIntakeTick` + drip + `generation_tag` + migrationer + #1799-fix | Backend-tests; første søndags-drip verificeret i prod |
| **S3** | Årgangsdag: transition-hook, finale-kuld, notifikation/recap-UI (EN+DA, mobil-first) | Klik-verify på preview m. seed-data; patch notes + help.json |
| **S4** | Verdens-influx-governor (frie agenter) | I1/I3 re-kørt; markeds-medianer overvåget efter go-live |
| **S5** | Facilitets-skalering (odds + volumen; tænd akademi-effekt-hook) | I4; koordinér m. facilitets-A2-scope |

UI-noter (S3): kandidat-kort genbruger eksisterende intake-UI; Årgangsdags-recap er også krønike-føde (#2490). Anti-AI-slop-æstetik per brand-reglerne.

## 8. Spillerfeedback-forankring (Discord-kanal 1522915781766283296, gennemgået 19/7)

Ejerens idé-kanal 4/7-18/7 krydstjekket for akademi/ungdom: søndags-modellen svarer direkte på 4/7-ønsket ("Kan der komme flere ryttere til intake? Kan der komme flere nye ryttere hver søndag?") og 13/7-prioriteringen ("brugerne vil meget gerne have forbedringer til akademierne nu"). Øvrige punkter fra kanalen er allerede shippet: #2179 (forlæng uden promotion), #2456 (frie ungdomsryttere fjernet fra akademiet — nu invariant i §5), #2644/#2660 (spejder-targeting frie/andre hold), #2659 (kun eksisterende ryttere + hurtig enkelt-scouting), #2627/#2648 (24h-auktion + provenu til mistende manager). Åbne, relaterede men separate spor: #2454 (potentiale 1-99), junior/U23-løb (addendum Fase 5/6), træningshastighed (#2262/#2650).

## 9. Relaterede issues

Bygger på: #2064 (dette design), #2627/#2648 (udløb/kompensation), #1308/#1309 (invarianter), #1543/#1162 (scout-usikkerhed). Forbereder: #2493 (årgangs-cyklus — generation_tag + navngivning), #2494 (scout-vindue), #2495 (filosofi-skoler farver kuld), #2492 (tre-tier). Koordinér: #2449 (S2-kalender, AKUT), #2376, #1137 (progression L0 — pension kører via eksisterende engine ved transition). Fixer: #1799.
