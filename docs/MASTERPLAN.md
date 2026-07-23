# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> Ejer-godkendt 2026-07-11; **omskrevet i 4 tidsspande 23/7** efter fuld backlog-audit af alle 413 åbne issues (75 agenter: inventar, dublet-jagt, adversariel lukke-verifikation, 4 prioriteringspaneler, 6 dybe audits). Ejer godkendte spand-inddelingen 23/7. **Regel: ét spor gøres FÆRDIGT før næste startes.** Status: 🔴 brand/deadline · 🟠 i gang · 🟢 kun verify · 🔵 ejer · ⚪ ikke startet. Budget ≤1.500 tok. Visuel udgave: [masterplan-artifact](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635) (re-synket 23/7).

**Målt i prod 23/7:** 161 brugere · 134 nye på 30 dage, hvoraf **98 (73 %) aldrig kommer igen** · 41 WAU, 8 DAU · **0 abonnementer** · S2 har 455 løb og **0 startlister**. Konsekvens for prioriteringen: anskaffelsen virker, fastholdelsen gør ikke. Første session + grund-til-at-vende-tilbage slår outreach.

## Stående spor (viger aldrig): stabilitet + fastholdelse
Sentry er stille (1 uløst/7 dage). Det der brænder er balance: #2731 maxRiderWinRate 0,67-0,75 vs mål 0,45 (rød siden 16/7) · #2557 hold-dominans · udbruds-andel 22-53 % vs bånd 1-7 % og sat `reportOnly` → alarmerer aldrig.

## 1 · FØR SÆSONSKIFTE (23-27/7)
1. 🔴 **Brande fra audit 23/7:** [#2804](https://github.com/NicolaiDolmer/CyclingZone/issues/2804) `Number(null)===0` i raceSimulator → distanceFactor gav 0,85 på alle 1.060 S1-profiler; udholdenhed inverteret på 196 etaper (PR [#2807](https://github.com/NicolaiDolmer/CyclingZone/pull/2807)) · [#2802](https://github.com/NicolaiDolmer/CyclingZone/issues/2802) RLS: spiller kan sætte `users.role='admin'` · [#2803](https://github.com/NicolaiDolmer/CyclingZone/issues/2803) RLS: køber kan selv sætte `seller_confirmed` (+ `swap_offers` uden værdikontrol).
2. 🔴 **Startlister i RIGTIG rækkefølge** [#2742](https://github.com/NicolaiDolmer/CyclingZone/issues/2742) + [#2805](https://github.com/NicolaiDolmer/CyclingZone/issues/2805): **#2742's foreslåede rækkefølge er forkert** — generatoren matcher hold mod løb på division, så entries før op/nedrykning placerer 24 hold forkert. Rigtig: alle S1-løb afviklet → "Afslut sæson" → generér entries → transition #2361. #2805: `/admin/seasons/:id/end` har ingen spærre mod uafviklede løb (98 løb kan droppes irreversibelt). + #2743 dobbelt-sæson-guard.
3. 🟠 **Cutover-generalprøve + drejebog** [#2361](https://github.com/NicolaiDolmer/CyclingZone/issues/2361): aldrig kørt i prod; vinduet 26/7 17:00 → 27/7 09:00 UTC er ~16 t og helt manuelt. Ejer ser 8 oprykkere + 16 nedrykkere FØR kørsel.
4. 🟠 **Økonomi-integritet:** #2746 løn-backfill (1.329/2.556 ryttere NULL) · #2589 sponsor-rate (65 aftaler med halveret divisor aktiverer 27/7) · #2764 præmie-timeout.
5. 🟠 **Sæsonlukning som oplevelse:** #2745 `season_ended`-notifikation (fuldt bygget i frontend, oprettes ALDRIG fra backend) · #2763 "Sæson 0" i 3 spillervendte vælgere · #2164 oprykningsbesked hardkodet dansk.
6. 🟠 **Pension+regen første gang nogensinde:** #2748 varsel + squad-guard (38 ryttere i 36-39 på menneskehold) + #2747.
7. 🔵 **Ejer-klik:** #1903 Alunta-plan + testkøb (0 abonnementer, ventet siden 5/7) · e-mail-loop-flip (3 tekster + 2 Railway-keys + kvoter; `email_loop_enabled` findes ikke i `app_config`) · #2639 D4-trim (blokerer `audit`-check på ALLE PR'er).
8. ⚪ **#2755 bjerg-klassikere til D3** (0 af 140 tier-3-endagsløb) — rutedata låses ved første etape. **Skær denne først** hvis tiden knibes.

## 2 · NÆSTE UGE (28/7-3/8) — luk hullet i bunden af spanden
9. ⚪ **Pro kan faktisk købes og beholdes:** [#2806](https://github.com/NicolaiDolmer/CyclingZone/issues/2806) `/pro` linket 0 steder + `isPro()` gater intet i backend · #2736 fornyelse lytter på `invoice.paid` som ikke findes hos Alunta · ToS/opsigelse/fortrydelsesret mangler · mindst 2 ægte perks (#27 gemte filtre, synligt Founder-badge).
10. ⚪ **Første session:** auktionsmarkedet tomt **21 % af tiden** (blokke på 8-10 t) mens 918 free agents er urørlige → drip-listing m. gulv på 8 · D4 har 13 løbsløse dage i S2, 3 i træk 28.-30/7, og ALLE nye managere lander der · #2718/#2719/#2254 klikbarhed (kontrakt-knap klikket 15x uden svar).
11. ⚪ **#2752 sæson-recap/årbog** (data findes, kun fladen mangler) · **#2042 riv login-væggen ned** (/races 3.304, /riders 2.606, /auctions 1.110 sessioner — alle bag ProtectedRoute; største målte lækage).
12. ⚪ **Balance:** #2731 + #2557 + udbruds-alarm ud af `reportOnly` · #2650 fatigue-mætning · #2789/#2757 motor-huller (virker fremad → efter cutover).
13. ⚪ **#2760/#2761** win-back + Discord-invite · **#2226** fair-play-detektor (funnel-sag fundet manuelt 22/7; 42 nye brugere/14 dage) · **#2270** natlig gennemkørsel af en løbsdag.

## 3 · AUGUST — vækst oven på et tæt spand
14. ⚪ Onboarding: #1569 + #2045 + velkomstbesked (første grund til at komme igen lander i snit **36,7 t** efter signup; kun 19 % ser nogensinde et løbsresultat).
15. ⚪ #2161/#2441 Discord-login · #1173 referral + #2236 outreach-bølge 2 + #2759 ads (Hattrick-kanalen verificeret varm).
16. ⚪ #62/#91/#2180 daglig rytme (Today/inbox, live-ticker, "mangler holdudtagelse").
17. ⚪ #2443/#1602/#2445 menu + mobil-P0'er (mobil = 54,9 %) · #2009/#2448 hover-kort + etapeprofil-graf (**flyttet fra uge 30**).
18. ⚪ #2698/#2262/#1974/#2699 progression · #2084/#1299/#1301 mail-sekvens + SEO.

## 4 · EFTER AUGUST
19. Træning/ungdom fase 1-6: [#2492](https://github.com/NicolaiDolmer/CyclingZone/issues/2492) tre-tier + #2487/#2488/#2491/#2493-#2495 · 20. Kontrakt-liv #1150/#1310 (807 ryttere udløber efter S2 → klar før skiftet EFTER dette) · 21. Motor-dybde #2476 sidevind/#2410 tidslinje/#2416 udbrud v2/#2412 TTT · 22. Værdi-kæden #2667/#2669/#1281/#2452/#2670 (v4 live 18/7 — vent til ~15/8) · 23. Verdensrangliste #2477 · 24. Skalering #323/#1375 (genbesøg ved ~300 brugere) · 25. Økonomi-ombygning #1441 · 26. Socialt lag #2209/#935 · 27. Brand #481/#671 + SEO #1301 · 28. Board-forenkling #955 · 29. Admin #2462.

## Ops/community-sidestrøm (subagent, aldrig hovedspor)
#2758 faste rutiner · #2460 setup-forhindringer · #2440 cron-alarmer · #2409/#2423 Railway+Vercel · #2511 bundle-drift · #2572 working-agent-claim · AI-audit #2689 (#2679-#2688) — **kør som ÉN samlet session i en rolig uge**.

**FROSSET:** staff/empire-dybde #2217/#2218. **Parkeret:** #1712 (≥300 managere) · #1941 grace (ejer 19/7: design, ikke bug) · #450 minimumspris · live-taktik/alliancer/replay (research).

## 5 · 2027-HORISONT (vision — bevidst ikke i kø)
Verdenshistorik + klubmuseum · rytterpersonlighed #1154 · landshold+mesterskaber #934 · fans pr. land #1113 · omdømme #1099 · venner #935 · merchandise #2222 · transfer war room #26 · søgning #938 · nationalitet #1108 · formplanlægning #1146 · admin-rework #50.
