# Dashboard-rework: Sportsforsiden — fast rygrad + spillerens board (hybrid)

> **Status:** Design ejer-godkendt 2026-08-07 (hybrid-split + mockup vist og godkendt = kontrakt). Implementering ikke påbegyndt — plads 3 i rework-køen (efter indbakke-triage og Mandatet, MASTERPLAN pkt. 7).
> **Forankring:** Epic [#3513](https://github.com/NicolaiDolmer/CyclingZone/issues/3513). Opfylder verdensklasse-planens pkt. 37 ("Dashboard som sportsforside") og [#62](https://github.com/NicolaiDolmer/CyclingZone/issues/62)-konvergensen (doktrinen: "Existing dashboard, notification, and next-action concepts should converge on this surface").
> **Audit-grundlag:** 6 parallelle research-spor 7/8 (frontend, backend + prod-SQL, GitHub, Discord, docs + Clarity, benchmark). Nøgletal refereret inline.

## Ejer-beslutninger (2026-08-07)

1. **Hybrid godkendt:** fast rygrad ("Since you were away" + "Your next move" — altid øverst, kan IKKE skjules) + alt andet som spillerens widget-board (reorder / resize / hide, server-persisteret). Ren retning A (tre faste zoner) blev rost men fravalgt til fordel for customizability; hybriden er den bindende syntese.
2. **Rygraden er bevidst slank** (2 kort, under én skærmhøjde) — FM26-læren: det vigtige må aldrig kunne konfigureres væk, men det må heller ikke fylde.

## Diagnose (kort)

- 20+ moduler i én søjle, 5.915px på mobil (58 % af trafikken); Clarity: 95 % scroll-dybde = spillerne gennemsøger hele siden; 351 quickbacks/3d; /notifications har flere pageviews end /dashboard (748 vs. 677/3d).
- **Talkonsistens-bugklassen** (6 spillere, maj-aug): #3506 (placering #2 vs. #16), #3507 (rangliste nul-overlap med målside), #3508 (rå vs. disponibel saldo). Rod-årsag: dashboardet genopfinder beregninger kildesiderne ejer (5 learnings-postmortems).
- Ingen error-state (#3510) · gold-ration-brud (#3509) · `/api/board/status` 20+ ukachede queries pr. load (#3511) · aldrig template-migreret (max-w-5xl, håndrullede empty-states).
- Benchmark: Hattrick (cadence-agnostisk forside) og OOTP (next-best-action-klarhed) er mønstrene; PCM-gap'et (resultater uden fortælling) er vores async-mulighed; FM26 er advarslen (big-bang-rewrite + dublerede tiles).

## Designet

### Rygraden (fast — spillet taler)

1. **"Since you were away":** redaktionelt digest siden `last_seen` — bedste eget resultat som headline, moments, rangændring, overbudt-mens-væk. Datakilde: FYI-laget fra indbakke-kontrakten + eksisterende moment-kort (MyLatestResult, Hero & Agony, Maiden Win foldes ind — de er i dag 3 separate kort). First-race-moment-kortet (#3310-spec) består urørt som special-case øverst.
2. **"Your next move":** top-3 fra **handlingskøen (action-tier) i indbakke-kontrakten — samme SSOT som badgen.** Erstatter dagens dublerede pending-logik (`useActionSummary`/`inboxPending.js`) og NextActionsCard/TeamSelectionCtaCard-dubletten. Én gold-knap via prioritetskæde (lukker #3509). Items er selv-løsende (kontraktens livscyklus).

### Spillerens board (alt andet)

- **Widget-registry med 3 størrelser** (1×1 stat-tile / 2×1 bred / 2×2 stor m. mini-tabel el. viz). Størrelse = informationstæthed (#2583). 4-kolonne grid desktop (#2445), 2 kolonner mobil.
- **Reorder + resize + hide + modul-bakke** — #2442's "telefon-widgets"-vision ordret. Redigeringstilstand via Tilpas-knappen (mockup viser chrome: håndtag, størrelsesskift, skjul, bakke).
- **Server-persisteret layout** (afløser localStorage `cz-dashboard-layout`; migration af eksisterende valg). Følger kontoen på tværs af enheder.
- **2×2-widgets er viz-vehiklen for pkt. 37** — sæsonkurve, stageprofil-graf, formkurve (komponenterne findes allerede, jf. game-plan-fund "0 SVG på højest-trafikerede side").
- Startsortiment: standings (m. dobbelttal "2nd of 6 managers · 16th overall"), next race, season-progress, recent results, board (Mandatet-slot), global rank, auctions, transfers, rider ranking, finance forecast, hero moments.

## Kontrakt-regler (arver indbakkens + strammer)

- **Ét tal, én ejer:** hver widget-værdi beregnes af kildesidens delte helper/endpoint/RPC — aldrig lokal genberegning (lukker #3506-#3508-klassen; forward-guard: paritetstest pr. widget mod kildesiden).
- **Links lander på handlingen** (indbakke-kontraktens deep-link-regel gælder også widgets — spillerklage-mønster #2, 4 spillere).
- Template-compliance (kanonisk EmptyState/ErrorState/skeleton, #3510) · én gold-knap · hairline/5px/tabular figures/stroke-ikoner · copy EN-first, DA-second.

## Grænseflader til parallelle spor (design-frys her)

- **Indbakken (producent af rygraden):** handlingskøen = SSOT for "Your next move" (dashboard viser top-3; badge og kø deler tal). FYI-digest-grupperne = kilde til "Since you were away". I cockpit-slutmålet (B) ER rygraden cockpittet — /notifications bliver fuld kø + arkiv.
- **Mandatet (producent af board-widget):** widgetten viser mandat-fremdrift + tillid m. kvitterings-genvej; confidence-forklaring **identisk** på dashboard og boardroom (Mandatets eget succeskriterium); boardroom-genvej fra widgetten. Widget-indholdet designes i Mandatet-sporet; #3511 (board-status-perf) løses naturligt af Mandatets nye endpoints.
- **First-session-retention (#3310):** landing-moment-kæden består urørt.

## Faser

- **Fase 0 (uafhængig — kan tages løbende, før køen når hertil):** bugs #3506-#3510 + template-migration + grid-tæthed på eksisterende moduler. Ingen afhængighed af indbakken.
- **Fase 1 (efter indbakke-slice 1-2):** rygrad på notifikations-kontrakten + widget-board (registry, 3 størrelser, server-persistens, migration fra localStorage).
- **Fase 2 (efter Mandatet):** fuld digest-motor ("Since you were away" m. rangændringer/auktioner), board-widget på Mandatets kontrakt, viz-widgets (pkt. 37).
- Hver slice: preflight + fuld e2e (alle 3 projekter) + preview m. seed-data + **ejer-go på UI før merge** (UI-reglen).

## Succeskriterier

- Scroll-dybde /dashboard 95 % → <70 % uden fald i gennemførte handlinger; quickbacks (351/3d) halveret.
- 0 talafvigelser dashboard vs. kildesider (paritetstests grønne).
- Andel af sessions der ser eget seneste resultat ≥60 % (deler #3310-målet).
- Doktrin-tro: ingen streaks/daglig-login-pres; forsiden fungerer til både 90 sek. og 15 min.

## Issue-konsolidering

Epic [#3513](https://github.com/NicolaiDolmer/CyclingZone/issues/3513). **Opsluges:** #2442, #2583, #2445 (dashboard-delen), #977-genbesøget, #3509, #3510. **Forudsætninger (løbende):** #3506, #3507, #3508. **Koordineres:** #3511 + #101 (Mandatet), #3310, #1569/#1140 (onboarding-kortet består i rygraden).
