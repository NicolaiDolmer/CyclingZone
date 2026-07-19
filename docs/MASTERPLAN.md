# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> Ejer-godkendt 2026-07-11; **konsolideret 19/7** efter backlog-audit (45 verificerede closes + 5 done→todo; uge 30-rækkefølge ejer-låst 19/7 = deadline-først). **Regel: ét spor gøres FÆRDIGT før næste startes.** Status: 🟠 i gang · 🟢 kun verify · ⚪ ikke startet. Opdateres ved close-out; budget ≤1.500 tok. Visuel udgave: masterplan-artifact (re-synket 19/7).

## Stående spor (viger aldrig): stabilitet + fastholdelse
Sentry-fejl, løb der sidder fast, alle spillervendte bugs — hver uge uanset alt andet. **Åbne:** #2694 holdklassement (1-rytters-hold kan vinde, high) · #2699 OP akademi-overflow-talenter (high) · #2692 rider-ranking-perf ~8s (Sentry, high) · #2526 rytterprofil-links + #2581 spejder-fantomryttere (begge re-åbnet 19/7 — spillere melder stadig fejl) · #2589 sponsor-rate · #2263 rytter-stats (ejer-blokeret: screenshots). GT ITT-dominans: #2404 (+#2402/#2403/#2405/#2406). Triage-rest: #2260/#2257/#2261/#2254/#2259.

## 1 · NU — uge 30 (19-26/7, deadline-anker: Årgangsdagen 26/7)
1. ✅ **Backlog-audit 19/7:** 45 closes (+#2654 afvist) + 5 done→todo (#2449/#2521/#2522/#2526/#2581). Rytme fremover: done-flip straks efter merge + ugentlig billig script-sweep + natbølger til småopgaver (ingen dyre agent-fanouts).
2. 🟠 **Sæsongrænse-kæden (hovedspor):** #2676 security-fix (anon rollover-revoke, lille) → [#2449](https://github.com/NicolaiDolmer/CyclingZone/issues/2449) **S2-kalender — IKKE genereret, deadline 26/7** (kræver #2276-verify; #2518-planner-skift bundlet) → #2361 sæsonritual-generalprøve (⚠️ må ikke annullere aktive scout-missioner) → #2064 S1 sim-harness → **S3 Årgangsdagen klar til 26/7**. #2463 board-generalprøve: dev-shipped, rest = #2521 (5 låste hold, re-åbnet).
3. ⚪ **Balance-brande (midt på ugen):** #2699 + #2694 fixes · #2650 fatigue-mætning (ejer-beslutning + simulér-før-ship) · #2645B peak-kurve (ejer-go) · #2639 D4-trim (ejer 👍/👎).
4. ⚪ **Quick-win-natbølge (ejer-GO 19/7, revideret scope):** #2401+#2208 auktions-besked-oprydning · #2183 auktioner på egen holdside · #228 auktionsside-mini-rework (ejer-spec 19/7: flag ved navn, badge-kolonne, autobud-knap vandret) · #2695 træner-speciale · #2657-rest (backfill dublet-navne + kombinatorik) · #2674 · #2673 · #2668 · #2590. **Ejer-afvist 19/7:** #2654-udløb (lukket), #450-minimumspris (backlog); #1941 grace parkeret.
5. **Sidestrøm:** AI-audit #2679/#2681/#2682 (token-besparelser, betaler sig selv) · #2675 udløbs-auktioner-verify (aften 19/7) · #2647 invariant-vagt · Supabase-rest #2677/#2678/#2259.
6. 🟢 **Ejer-klik (valgt 19/7):** CZ Pro Alunta+testkøb ([#1903](https://github.com/NicolaiDolmer/CyclingZone/issues/1903) — derefter åbner Claude salget; har ventet siden 5/7!) · #2639 👍/👎 · #2680 connectors · 10-min klik-verify-runde (liste på #2588).

## 2 · Uge 31-33
7. ⚪ **UI-bølge 1:** [#2443](https://github.com/NicolaiDolmer/CyclingZone/issues/2443) menu/IA-inventar (ejer godkender struktur FØRST) → [#1602](https://github.com/NicolaiDolmer/CyclingZone/issues/1602) mobil-P0'er (54,9%-fladen; +#2603) → [#2465](https://github.com/NicolaiDolmer/CyclingZone/issues/2465) feedback-kontrakt → #2467. **Discord-connect (fastholdelse):** [#2161](https://github.com/NicolaiDolmer/CyclingZone/issues/2161) OAuth-login + DM uden developer-mode + #2441 kanal-synlighed.
8. ⚪ **Perf-slice** [#2444](https://github.com/NicolaiDolmer/CyclingZone/issues/2444) del 1: dashboard + liga-overblik (+#2692 hvis ikke taget i uge 30); del 2 → ops-sidestrøm. Gater #2442.
9. 🟠 **Værdi-kæden efter v4-cutover (LIVE 18/7):** #2667 slice 4 selvkørende re-fit · #2669 harness-migrering · #1281 market_premium (slice 3) · beslutninger #2452 gebyr-design + #2670 ROI/250%-loft + #2176 når v4-adfærd kan måles.
10. ⚪ **Narrativ S2 recap v2** [#2356](https://github.com/NicolaiDolmer/CyclingZone/issues/2356) (genbruges af #2361-recap) + palmarès-rest #1997 (roster-tidslinje).
11. 🟢 **Træning/ungdom Fase 0-sidestrøm:** [#2484](https://github.com/NicolaiDolmer/CyclingZone/issues/2484) udviklings-moment · [#2485](https://github.com/NicolaiDolmer/CyclingZone/issues/2485) akademi-regnskab · akademi-bugs #1799/#2257 · #2262/#2494/#2495-forberedelse.

## 3 · Aug-sep
12. ⚪ **Træning/ungdom fase 1-3** (SSOT: [addendum 16/7](superpowers/specs/2026-07-16-traening-ungdom-verdensklasse-addendum-design.md); sim+scorecard-gates): motor [#1922](https://github.com/NicolaiDolmer/CyclingZone/issues/1922)/#2262/#1974 → beslutningslag #2487/#2488 + krønike-start #2490 + #2454 potentiale 1-99 + #2438-kontrakt + #2458 → sæsonkort #2489. #2064-serien fortsætter (12 intakes/sæson + facilitets-skalering).
13. ⚪ **UI-bølge 2:** #2445 responsive · #2447 planlægger-konsistens · #2448 ruteprofiler (mockup-gate) · #2442 dashboard-tilpasning (EFTER #2444+#2439) · #2583 widget-tæthed · [#2604](https://github.com/NicolaiDolmer/CyclingZone/issues/2604) planlægnings-UX (PCM-ref) · #2605-klassen kalender-ikoner (#2527-bundle).
14. ⚪ **Felt-integritet:** [#2457](https://github.com/NicolaiDolmer/CyclingZone/issues/2457) AI-kvalitet pr. division (efter #2407/#2377; sim-gate).
15. ⚪ **Motor-audit + engine-dybde:** #2410 tidslinje · #2416 udbrud v2 · #2417 τ-exit · #2412 TTT · #2413 bonussek. · #2476 sidevind · #2478 adaptiv AI-taktik · #2479 W'/CP-spike · #2525 massespurt-tærskel · #2582 tidsgrænse/broom wagon (needs-decision) · #1176 year-form/startliste.

## 4 · Efterår (okt-dec) — ét ad gangen
16. Træning/ungdom fase 4-6: #2491 Graduation Day → **tre-tier epic [#2492](https://github.com/NicolaiDolmer/CyclingZone/issues/2492)** + #2493 årgange + #2494 derby + #2495 filosofi + pension · 17. Verdensrangliste-motor [#2477](https://github.com/NicolaiDolmer/CyclingZone/issues/2477) (Global rank #2453 LIVE 17/7) · 18. Marked-QoL: #2451-rest/#1905/#2400 · 19. Personale: #2398 lille slice; #2450 personale-oversigt (ejer-uddybet 17/7) · 20. AI-markedsaktør v1 · 21. Kontrakt-liv #1150/#1310 (kandidat til frem-rykning, ejer-go) · 22. Pro Analyst + årsplan + private ligaer · 23. Resultat-hub #959 + narrativ S3 · 24. Dashboard/holdside #2178 (+#2601-rest) · 25. Board-FORENKLING #955 · 26. Admin-oprydning #2462 · 27. Brand #481 (+#671-rest/#2666-baseline) + SEO #1301 · 28. Skalering #323/#1375.

## Ops/community-sidestrøm (subagent, aldrig hovedspor)
[#2460](https://github.com/NicolaiDolmer/CyclingZone/issues/2460) setup-forhindringer · #2440 cron-alarm-klynger · #2409 Railway-MCP · #2423 Vercel-hærdning · #2444 del 2 · #2461 Discord-svar-rutine (7 udkast venter ejer) · #2480 ML-kalibrering (lav) · #2572 Working-agent-claim (high) · #2511 bundle-drift · AI-audit-rest #2683-#2688.

**FROSSET (beslutning 7):** staff/empire-dybde #2217/#2218. **Parkeret:** #1712 (≥300 managere) · #1941 grace (ejer 19/7) · #450 minimumspris (ejer 19/7) · live-taktik/alliancer/replay (research).

## 5 · 2027-HORISONT (vision — bevidst ikke i kø)
Verdenshistorik fuld + klubmuseum (narrativ S3-S4) · rytterpersonlighed light #1154 · landshold+mesterskaber #934 · fans pr. land #1113 · omdømme #1099 · venner #935 · merchandise #2222 · transfer war room #26 · søgning #938 · nationalitet #1108 · formplanlægning #1146 · admin-rework #50.
