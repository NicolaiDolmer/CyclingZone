# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> Ejer-godkendt 2026-07-11; **omskrevet i 4 tidsspande 23/7** efter fuld backlog-audit af alle 413 åbne issues (75 agenter: inventar, dublet-jagt, adversariel lukke-verifikation, 4 prioriteringspaneler, 6 dybe audits). Ejer godkendte spand-inddelingen 23/7. **Regel: ét spor gøres FÆRDIGT før næste startes.** Status: 🔴 brand/deadline · 🟠 i gang · 🟢 kun verify · 🔵 ejer · ⚪ ikke startet. Budget ≤1.500 tok. Visuel udgave: [masterplan-artifact](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635) (re-synket 23/7).

**Målt i prod 23/7:** 161 brugere · 134 nye på 30 dage, hvoraf **98 (73 %) aldrig kommer igen** · 41 WAU, 8 DAU · **0 abonnementer** · S2 har 455 løb og **0 startlister**. Konsekvens for prioriteringen: anskaffelsen virker, fastholdelsen gør ikke. Første session + grund-til-at-vende-tilbage slår outreach.

> **Rettelse 23/7 (2. audit-runde):** tre fund fra første runde holdt IKKE ved genverifikation og er fjernet herfra — (a) "D4 har 13 løbsløse dage" var falsk (alle 8 D4-puljer har præcis 2 løb hver af de 28 dage; forveksling af `league_division_id=4` med tier 4), (b) "auktionsmarkedet tomt 21 % af tiden" var en engangsepisode 16.-18/7, ingen tomme timer siden, gns. 37 aktive auktioner/time, og "918 utilgængelige free agents" var forkert, (c) "36,7 t til første notifikation" var et gennemsnit trukket af outliers — medianen er **22 minutter**. Det reelle restsignal er at **18 af 134 nye brugere aldrig får en notifikation overhovedet**.

## Stående spor (viger aldrig): stabilitet + fastholdelse
Sentry er stille (1 uløst/7 dage). Det der brænder er balance: #2731 maxRiderWinRate 0,67-0,75 vs mål 0,45 (rød siden 16/7) · #2557 hold-dominans · udbruds-andel 22-53 % vs bånd 1-7 % og sat `reportOnly` → alarmerer aldrig.

## 1 · FØR SÆSONSKIFTE (23-27/7)

> **Session-kø med klar-til-brug prompts: [#2825](https://github.com/NicolaiDolmer/CyclingZone/issues/2825).** S1-S7 er uafhængige og kan køre parallelt i worktrees; **S8 (cutover, Fable) kører alene.**

1. ✅ **Brande slukket 23/7:** [#2804](https://github.com/NicolaiDolmer/CyclingZone/issues/2804) `Number(null)===0` → distanceFactor 0,85 på alle 1.060 S1-profiler, udholdenhed inverteret på 196 etaper (PR #2807 merged 06:35 UTC, 2 t 25 min før den etape den ville have ramt) · [#2818](https://github.com/NicolaiDolmer/CyclingZone/issues/2818) endagsløb lovede point der aldrig uddeles (PR #2821) · [#2639](https://github.com/NicolaiDolmer/CyclingZone/issues/2639) løst uden sletning — fejlen lå i audit-checket (PR #2808).
2. 🔴 **S1 · RLS-lockdown:** [#2802](https://github.com/NicolaiDolmer/CyclingZone/issues/2802) spiller kan sætte `users.role='admin'` · [#2803](https://github.com/NicolaiDolmer/CyclingZone/issues/2803) køber sætter selv `seller_confirmed` (+ `swap_offers` uden værdikontrol) · [#2814](https://github.com/NicolaiDolmer/CyclingZone/issues/2814) forfalskede bud. Frontenden skriver ikke til nogen af tabellerne — ren angrebsflade. 2 t.
3. 🔴 **S8 · Startlister + cutover-generalprøve** [#2742](https://github.com/NicolaiDolmer/CyclingZone/issues/2742) + [#2805](https://github.com/NicolaiDolmer/CyclingZone/issues/2805) + [#2361](https://github.com/NicolaiDolmer/CyclingZone/issues/2361): **#2742's rækkefølge er FORKERT** — generatoren matcher på division, så entries før op/nedrykning placerer 24 hold forkert. Rigtig: alle S1-løb afviklet → "Afslut sæson" → generér entries → transition. #2805: ingen spærre mod uafviklede løb (98 løb kan droppes irreversibelt). Skiftet er aldrig kørt i prod; vinduet er ~16 t og helt manuelt. + #2743. **Ejer godkender navngivne op-/nedrykkere FØR kørsel.**
4. 🟠 **S3 · Økonomi-integritet:** #2746 løn-backfill (1.329/2.556 ryttere NULL) · #2589 sponsor-rate genberegnes ved AKTIVERING (65 aftaler med halveret divisor) · #2764 præmie-timeout.
5. 🟠 **S2 · Sæsonlukning som oplevelse:** #2745 `season_ended` (bygget i frontend, oprettes ALDRIG fra backend) · #2763 "Sæson 0" i 3 vælgere · #2164 oprykningsbesked hardkodet dansk.
6. 🟠 **S5 · Pension + kontraktudløb, første gang nogensinde:** [#2700](https://github.com/NicolaiDolmer/CyclingZone/issues/2700)/#2748 varsel + squad-spærre · #2744 frigiv de 196 (ejer-valg B 23/7) · #2747. Spærren skal regne på BEGGE mekanikker samlet: værst tænkeligt falder 13 menneskehold under 12-normen, men ingen under 8-minimum.
7. 🟠 **S4 · #2755 bjergklassikere til D2+D3** (0 af 158 endagsløb i D2/D3, mod 8 i D4) — ejer-valg A 23/7. Rutedata låses ved første etape 27/7 09:00 UTC.
8. 🟠 **S6 · [#2161](https://github.com/NicolaiDolmer/CyclingZone/issues/2161) Discord-login** — opprioriteret 23/7: blokerer nu per-pulje-synlighed (#1815), ikke bare login. Adgang skal gentildeles ved skiftet, ikke kun ved tilmelding.
9. 🔵 **S7 · Ejer-klik:** #1903 Alunta-plan + testkøb (0 abonnementer, ventet siden 5/7) + #2806 skriv `/pro` om til ren støtte og link den · e-mail-loop-flip (3 tekster + 2 Railway-keys + kvoter).

## 2 · NÆSTE UGE (28/7-3/8) — luk hullet i bunden af spanden
10. ⚪ **Pro trin 2 — identitet + komfort** (ejer-valg 23/7, 1-2 uger efter trin 1): synligt Founder-mærke andre kan se · #27 gemte scoutingfiltre · #26 ønskeliste/sammenligning. Plus [#2813](https://github.com/NicolaiDolmer/CyclingZone/issues/2813) handelsbetingelser + opsigelsessti + fortrydelsesret · #2736 fornyelse (lytter på `invoice.paid`, som ikke findes hos Alunta) · [#2816](https://github.com/NicolaiDolmer/CyclingZone/issues/2816) dobbeltkøb · [#2817](https://github.com/NicolaiDolmer/CyclingZone/issues/2817) webhook logger ikke fejl · [#2820](https://github.com/NicolaiDolmer/CyclingZone/issues/2820) `/founder-supporter` modsiger `/pro`.
11. ⚪ **Første session:** #2718/#2719/#2254 klikbarhed (kontrakt-knap klikket 15x uden svar) · **18 af 134 nye brugere får ALDRIG en notifikation** · [#2819](https://github.com/NicolaiDolmer/CyclingZone/issues/2819) guiden mangler på 2 af 4 trin · [#2826](https://github.com/NicolaiDolmer/CyclingZone/issues/2826) 7 udfyldte hele tilmeldingen og faldt på mail-bekræftelsen.
12. ⚪ **#2752 sæson-recap/årbog** (data findes, kun fladen mangler) · [#2441](https://github.com/NicolaiDolmer/CyclingZone/issues/2441) + #1815 per-pulje-synlighed på Discord (bygger på #2161).
13. ⚪ **Balance:** #2731 målbillede først (vores bånd modsiger hinanden) · #2557 · udbruds-alarm ud af `reportOnly` · #2650 fatigue-mætning · #2789/#2757 motor-huller · [#2812](https://github.com/NicolaiDolmer/CyclingZone/issues/2812) generator_version=4 stemples uden rutefelter · [#2811](https://github.com/NicolaiDolmer/CyclingZone/issues/2811) bevis Sub-2's passage-persistens.
14. ⚪ **#2760/#2761** win-back + Discord-invite · **#2226** fair-play-detektor + [#2815](https://github.com/NicolaiDolmer/CyclingZone/issues/2815) lån minutter efter kontooprettelse · **#2270** natlig gennemkørsel af en løbsdag.
15. ⚪ **Oprydning:** [#2827](https://github.com/NicolaiDolmer/CyclingZone/issues/2827) fire konkurrerende plan-docs → én · #2259 drop 23 backup-tabeller (ejer-valg A, efter cutover) · [#2828](https://github.com/NicolaiDolmer/CyclingZone/issues/2828) fjern død uge-rapport-automatik · #1595 slet PCM-import-pipelinen.

## 3 · AUGUST — vækst oven på et tæt spand
16. ⚪ **Fable-sporet** (arkitektur, ikke kode — tages ved lejlighed): [#2822](https://github.com/NicolaiDolmer/CyclingZone/issues/2822) verdensklasse-benchmark · [#1369](https://github.com/NicolaiDolmer/CyclingZone/issues/1369) retention-arkitektur · [#1140](https://github.com/NicolaiDolmer/CyclingZone/issues/1140) de første 20 minutter · [#2824](https://github.com/NicolaiDolmer/CyclingZone/issues/2824) synlighed udefra (login-væg + sprogstier + SEO som ét) · [#2823](https://github.com/NicolaiDolmer/CyclingZone/issues/2823) fleet-playbook.
17. ⚪ Onboarding-implementering: #1569 + #2045 (kun 19 % ser nogensinde et løbsresultat). Velkomstmailen ER bygget (#2725) — venter kun på `email_loop_enabled`.
18. ⚪ #1173 referral (7 dage / 1 md ved betaling, ejer 23/7) + #2236 outreach + #2759 ads. **Markedsføring skal være løbende, ikke begivenhedsbundet** (ejer 23/7) → #680/#2080 omskrives.
19. ⚪ #62/#91/#2180 daglig rytme (Today/inbox, live-ticker, "mangler holdudtagelse").
20. ⚪ #2443/#1602/#2445 menu + mobil-P0'er (mobil = 54,9 %) · #2009/#2448 hover-kort + etapeprofil-graf · [#2810](https://github.com/NicolaiDolmer/CyclingZone/issues/2810).
21. ⚪ #2698/#2262/#1974 progression · **#2699 akademi-nerf** (ejer 23/7: C nu — ret generatoren fremad; A senere — sænk potentiale på de 90) · #2084/#1299/#1301 mail-sekvens + SEO.
22. ⚪ **#2042 login-væggen** — ejer-udskudt 23/7 til session 27/7 eller senere. Hører sammen med #2824 og #2046.

## 4 · EFTER AUGUST
23. Træning/ungdom fase 1-6: [#2492](https://github.com/NicolaiDolmer/CyclingZone/issues/2492) tre-tier + #2487/#2488/#2491/#2493-#2495 · 24. Kontrakt-liv #1150/#1310 (**807 ryttere udløber efter S2, heraf 681 på menneskehold** → skal stå klar før skiftet EFTER dette) · 25. Motor-dybde #2476 sidevind/#2410 tidslinje/#2416 udbrud v2/#2412 TTT · [#2818](https://github.com/NicolaiDolmer/CyclingZone/issues/2818)-opfølgning: endagsløb har ingen klassementer (korrekt cykelsport — kun visningen var forkert) · 26. Værdi-kæden #2667/#2669/#1281/#2452/#2670 (v4 live 18/7 — vent til ~15/8) · 27. Verdensrangliste #2477 · 28. Skalering #323/#1375 (genbesøg ved ~300 brugere) · 29. Økonomi-ombygning #1441 · 30. Socialt lag #2209/#935 · 31. Brand #481/#671 + SEO #1301 · 32. Board-forenkling #955 · 33. Admin #2462.

## Ops/community-sidestrøm (subagent, aldrig hovedspor)
#2758 faste rutiner · #2460 setup-forhindringer · #2440 cron-alarmer · #2409/#2423 Railway+Vercel · #2511 bundle-drift · #2572 working-agent-claim · AI-audit #2689 (#2679-#2688) — **kør som ÉN samlet session i en rolig uge**.

**FROSSET:** staff/empire-dybde #2217/#2218. **Parkeret:** #1712 (≥300 managere) · #1941 grace (ejer 19/7: design, ikke bug) · #450 minimumspris · live-taktik/alliancer/replay (research).

## 5 · 2027-HORISONT (vision — bevidst ikke i kø)
Verdenshistorik + klubmuseum · rytterpersonlighed #1154 · landshold+mesterskaber #934 · fans pr. land #1113 · omdømme #1099 · venner #935 · merchandise #2222 · transfer war room #26 · søgning #938 · nationalitet #1108 · formplanlægning #1146 · admin-rework #50.
