# Omdømme-system: rytter, klub, nation, manager — design (2026-09-04)

> **Status:** DESIGN, ejer-godkendt afsnit for afsnit 4/9 2026 (aften-session, Fable som arkitekt).
> Refs #1099 (rytter-omdømme, epic), #1112 (manager), #844 (nation, SSOT `docs/slices/844-countries-system.md`),
> #2261 (high profile-mærkning), #2723 (renown usynligt), #1113/#2222 (fans/merch, senere), #3448 (markedsvægt),
> #1663/`2026-06-21-renown-sponsor-fase2-design.md` (klub-renown proxy v1).
> Doktrin: `2026-06-08-living-world-product-doctrine-design.md` (omdømme = optjent standing, manager-omdømme kosmetisk),
> `2026-06-21-economy-coherence-design.md` §omdømme↔økonomi. Simulér-før-ship gælder (§9).

## 1. Problemet

`riders.popularity` sættes én gang ved generering (`fictionalRiderGenerator.js:597`, tier-tabel L141-144:
superstar 70-100, star 45-85, solid 10-50, domestique 0-18) og ændres aldrig. Ingen kodesti skriver den efter
resultater (verificeret 4/9). Konsekvenser målt i prod 4/9: 7.503 ryttere, median 3, 95 %-fraktil 48, 102 ryttere ≥ 75.
Bestyrelsens Star Signing-mål (`boardIdentity.calculateRiderStarScore` = popularity·0,70 + UCI·0,30 mod tærskel 68)
kan opfyldes af en 3½-4-stjerners rytter der tilfældigvis blev seedet kendt (#2261). Klub-renown til sponsor er en
bevidst proxy (division + sidste sæsons placering, `renownEngine.js`). `countries.reputation` er seedet 31/5 og læses
ingen steder. Spillerne kan ikke se omdømme uden for bestyrelseslokalet (#2723).

## 2. Ejer-låste beslutninger (4/9 2026)

| # | Beslutning |
|---|---|
| Formål | Omdømme skal mærkes i: bestyrelsen, markedsværdi + lønkrav, nation (landshold/nationsstyrke), fans/merch/sponsor-løft. Fundament nu; forbrugere i rækkefølge (§7). |
| Henfald | Falmer, men aldrig under karriere-gulvet. Ét synligt tal. |
| Nation v1 | Rytter-resultater løfter nationen nu (lande-planens fase 3a + 3b: dæmpet, gulv/loft). Landshold + nationalt mesterskab venter på løbsmotoren. |
| Fundament | Tilgang A: hændelsesbog. 0-100, karriere-gulv (loft 60) + form der halveres pr. sæson. Point-tabel (§4) er kalibreringsudgangspunkt, ikke facit. |
| Afledte | Nation dæmpet + synlig. Klub synlig, sponsor-multiplier uændret i S3. Manager: kun karrierehistorik, ingen effekt (doktrin 8/6). |
| Forbrugere | Bestyrelsen: high profile = omdømme ≥ 70, UCI-blanding droppes. Marked/løn via #3448-kadence, først efter 27/9. Ordbånd + hvorfor-liste overalt. |
| Udrulning | Flag off → shadow → on. 5 PR'er (§8). Ingen prod-skrivning uden ejer-go pr. trin. |

Fravalgt: B (formel i materialiseret visning, intet gulv, uforklarlig), C (direkte +/- uden historik).

## 3. Rytterens tal

```
reputation = clamp(floor + form, 0, 100)
floor      = clamp(seedFloor + Σ floorCredits, 0, FLOOR_CAP=60)      // falder aldrig
form       = Σ formPoints(event) · 0,5^(sæsoner siden event)           // halveres ved hvert sæsonskifte
seedFloor  = min(popularity, FLOOR_CAP) · SEED_FLOOR_WEIGHT (default 1,0; harness må sænke til 0,5, se §9)
```

Ordbånd (samme overalt, en/da): Unknown/Ukendt 0-19 · Known/Kendt 20-44 · Profile/Profil 45-69 ·
Star/Stjerne 70-89 · Legend/Legende 90+.

`popularity` bevares som "ry ved ankomst" (seed) og bruges kun som `seedFloor`-input. Ingen kode læser den som
omdømme når flaget er `on`.

## 4. Hændelser og point (kalibreringsudgangspunkt)

Løbsklasse-vægt `W_CLASS`: TourFrance 1,0 · GiroVuelta 0,8 · Monuments 0,8 · OtherWorldTourA 0,6 · B 0,5 · C 0,4 ·
ProSeries 0,25 · Class1 0,15 · Class2 0,10.

| Hændelse (kilde: `race_results.result_type` + `rank`) | Form-basispoint | Karriere-gulv-kredit |
|---|---|---|
| Sejr endagsløb (`stage`, rank 1, race_type single) | 20 · W | Monument +15 · WT-A/B/C +6 · ProSeries +1 |
| Samlet sejr etapeløb (`gc`, rank 1, sidste etape) | 25 · W | Tour +20 · Giro/Vuelta +15 · WT-A/B/C +6 · ProSeries +1 |
| Etapesejr (`stage`, rank 1, race_type stage_race) | 8 · W | GT +4 · WT +1 |
| Trøje vundet (`points`/`mountain`/`young`, rank 1, sidste etape) | 10 · W | GT +4 |
| Podium (rank 2-3) i ovenstående | 40 % af sejrens formpoint | 0 |
| Top 10 (rank 4-10) i ovenstående | 10 % af sejrens formpoint | 0 |
| Dag i førertrøje (`leader`, rank 1, ikke sidste etape) | 2 · W | 0 |

Class1/Class2 giver ingen gulv-kredit. `team`/`team_day`-resultater tæller ikke (hold-omdømme afledes i §6).
Alle vægte bor i én konstantfil (`backend/lib/reputationConstants.js`) og kalibreres i harnessen (§9).

**Afvigelser fra tabellen, fundet i PR 1 (#4780, 4-5/9) og accepteret:**
- Endagsløb har i prod ingen `stage`-rækker; resultatet ligger som `result_type='gc'` (83.504 rækker). Motoren læser
  endagssejr/podium/top-10 fra `gc` når `race_type='single'`.
- Trøjer får hver sin `event_kind` (`jersey_points_win`, `jersey_mountain_win`, `jersey_young_win`), så tre trøjer til
  samme rytter på sidste etape ikke kolliderer på `dedupe_key`.
- Hook'en bor i `backend/lib/reputationHook.js` (kaldes fra `raceRunner.js`), så "flag off = ingen DB-adgang" kan testes.
- Hård clamp til 100 klemte 29 ryttere på præcis 100 i første kalibrering. Erstattes af et blødt loft
  (`reputation = 100 · tanh(raw / SOFT_CAP)`, raw = floor + form); endelige konstanter står i
  `docs/audits/reputation-calibration-2026-09-05.md` (kørsel 2) og i konstantfilen.
- Datadækning: 55,6 % af S1's og 37,3 % af S2's resultatrækker har `rider_id = NULL` (ryttere slettet siden). Det er
  ryttere der ikke findes mere, så nulevende rytteres tal påvirkes ikke; S3 har fuld dækning.

## 5. Datamodel

- Ny tabel `rider_reputation_events`: `id, rider_id, team_id, race_id, stage_number, season_id, event_kind,
  race_class, form_points numeric, floor_credit numeric, occurred_at, dedupe_key UNIQUE, created_at`.
  `dedupe_key = rider:<rider_id>:race:<race_id>:stage:<n>:<event_kind>`. Egen tabel, ikke `rider_career_events`:
  den er en milepæls-krønike (#3398/#2490) og må ikke fyldes med 20k+ point-rækker.
- `riders`: `reputation numeric`, `reputation_floor numeric`, `reputation_form numeric`, `reputation_updated_at`.
- `teams`: `reputation numeric`, `reputation_updated_at` (§6).
- `countries.reputation` genbruges (findes), `reputation_seed` er ankeret.
- Migration idempotent (`database/2026-09-xx-reputation-system.sql`), applies af auto-migrate.yml ved merge; post-verify.

## 6. Afledte tal

- **Nation** (`countries.reputation`, søndags-sweep sammen med `marketValueSundaySweep`):
  `target = 0,7·seed + 0,3·mean(top-10 rytter-omdømme for nationen)`; bevægelse mod target maks 3 point pr. sæson
  (fordelt pr. uge), clamp `[seed−15, seed+15]`. Kun synlig i v1 (landeside, flag-tooltip) + input til
  generatorens talent-loft i #844 fase 2 senere. Ingen rich-get-richer: gulv/loft + lille vægt.
- **Klub** (`teams.reputation`, samme sweep): `0,7·mean(top-8 rytter-omdømme i truppen) + 0,3·resultsScore·100`
  (resultsScore fra `renownEngine.computeResultsScore`). Kun synlig i S3. Sponsor-multiplieren læser proxy'en indtil
  én sæson med det nye tal er set; skift = egen PR med økonomi-simulering (`economyCalibrationSweep.js`).
- **Manager:** intet tal, ingen effekt. Karrierehistorik (mesterskaber, sejre, stjerner haft i truppen) vises i
  klub-museet/profil fra eksisterende `season_honours` + `rider_career_events`. Doktrin 8/6, #1112/#1109.

## 7. Forbrugere (første version)

1. **Bestyrelsen:** `calculateRiderStarScore` returnerer `reputation` når flaget er `on`; tærskel 70
   (`STAR_RIDER_SCORE_THRESHOLD` 68 → 70, UCI-led fjernes). Forced-listing-beskyttelsen (`boardConsequences.js:359`,
   popularity ≥ 70) læser samme tal. Bestyrelsens rytter-tal = rytterens tal overalt. Lukker #2261, #3983-restgæld.
2. **Marked og løn:** `marketValueModel` feature `popularity` fødes med `reputation`; kræver refit (fit-script) og
   scorecard i #3448's kadence med ejer-go pr. trin. Lønkravet følger via Fase 3-krogen
   (`2026-07-05-economy-fase3-empire-design.md` L85). **Først efter 27/9** (grundregler udskudt, ejer 28/8 + 4/9).
3. **Synlighed:** tal + ordbånd på rytterkort, profil-hero, marked, auktion, holdside; "hvorfor"-liste med de seneste
   hændelser (form-point, halveringer) på profilen. Klub-tal på klubsiden, nation på landeside. Lukker #2723.
4. **Fans/merch/sponsor-løft:** egen spec senere (#1113/#2222), læser klub-omdømmet.

## 8. Flag og udrulning

Flag `rider_reputation_enabled` i `app_config` via `featureStage.js` (mønster: `raceFinalizeResumableFlag.js`):
`off` (default) → `shadow` (beregnes ved løbsafslutning + natligt, ingen forbruger læser) → `on`.

PR-rækkefølge (hver PR med dry-run/audit, ingen prod-skrivning uden ejer-go):
1. Motor + hændelsesbog + konstantfil + migration + backfill-script (afspilning af alle sæsoner fra `race_results`,
   `--dry-run`/`--apply --owner-go`) + kalibrerings-harness (rapport i `docs/audits/reputation-calibration-<dato>.md`).
   Hook: samme sted som `careerFirsts` kaldes i `raceRunner.js` (simulateRace + simulateStageByIndex), idempotent.
2. Shadow-drift i prod (flag `shadow`) mindst 7 dage + natlig audit (fordeling, top 50, største afvigelser fra seed).
3. Synlighed + bestyrelses-forbruger bag flaget `on` (frontend T3-profil, marked, auktion; help.json en/da).
4. Nation + klub afledt i søndags-sweepet + landeside/klubside.
5. Marked/løn (efter 27/9, #3448-kadence).

Rollback: flag `off` → alle forbrugere læser som i dag (`popularity`/UCI-blanding). Tabellen kan blive stående.

## 9. Test og kalibrering

- Enhedstests (`node --test`): point-tabel pr. klasse/resultat, gulv-kap, halvering over sæsonskifte, ordbånd,
  dedupe ved gen-afslutning, seedFloor.
- Afspilnings-harness (`backend/scripts/reputation-calibration.js`, read-only): kører alle sæsoner, rapporterer
  fordeling (p50/p75/p95, andel ≥ 70/≥ 90), top 50 med hændelses-forklaring, og sammenligning mod seed.
  **Mål:** median lav (≤ 10), 1-2 % ≥ 70, ≤ 0,3 % ≥ 90, og de 20 mest vindende ryttere i S1-S3 skal alle være ≥ 70.
  Rammer seed-gulvet for mange Stjerner uden resultater → `SEED_FLOOR_WEIGHT` sænkes (0,5) før PR 1 merges.
- e2e: profil viser tal + ordbånd + hvorfor-liste (mobile + desktop projekter).
- Dry-run-scripts efter mønster fra `backend/scripts/retire-stuck-ai-teams.js`.

## 10. Ikke i scope

Landshold og nationalt mesterskab (kræver løbsmotor, #844 fase 4). Fans/merch-økonomi (#1113/#2222). Sponsor-skift
til rytter-baseret klub-omdømme (egen PR efter én sæson). Manager-omdømme som tal eller effekt (doktrin). Løbs-prestige
som præmie-driver (PUBLIC_ROADMAP, separat).
