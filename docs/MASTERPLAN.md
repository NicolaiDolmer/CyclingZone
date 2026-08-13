# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 2026-08-13** i planlægningssessionen ([#3662](https://github.com/NicolaiDolmer/CyclingZone/issues/3662)) — 12 beslutninger, rækkefølgen er sagt ja til punkt for punkt. Erstatter 23/7-udgaven. Status: 🔴 brand/deadline · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. Budget ≤1.500 tok. Visuel udgave: [masterplan-artifact](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8, ordret:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3. Det er altoverskyggende vigtigt."* Alt andet viger for spor B — undtagen det der er bundet til en dato.

**Målt:** åbne issues **546** · done-pukkel **23** (begge talt 13/8, ikke 524/19) · 199 brugere, 1 abonnement (målt 6/8, ikke genmålt) · **S2 slutter søn 23/8 — 10 dage.**

## A · Cutover 23/8 (dato-bundet, viger ikke)

1. 🔴 **#3449 markedssweep — merge + kør 14.-15/8.** Ejer-løfte 11/8 holdes ordret ("værdier og lønninger mellem i dag og fredag"). Har egen kill-switch.
2. 🔴 **#3645 rollback-drejebog + backup-tabeller.** Ejer-valg 13/8: **backup + genberegnings-script for BÅDE løn og mandat**, ikke kun en skreven plan. De to er de eneste komponenter uden flag.
3. 🔴 **#3514 mandat fase 1a/1b** — datamodel + migration. **Hård frist: merget og dry-run-godkendt 19/8, ellers ryger den ud af 23/8 automatisk** (ejer 13/8). Intet bygget pr. 13/8.
4. 🔴 **#3393 løn** — re-kalibreres mod post-sweep-fordelingen (dens oprindelige forudsætning). Draft indtil ejeren godkender kurve/eksponent/sats.
5. ✅ **#3459 race-day-flip** — komplet i main, `race_day_engine_enabled` verificeret `off` i prod. Kun selve flippet mangler.
6. 🔵 **Auto-accept-floor 15/8 bliver stående** (ejer 13/8, ingen handling). Fair-window (#3584) er i main, så 20/8 rammer kun inaktive hold; aktive først 25/8.

## B · Rytter-pakken — "once and for all" (ALTOVERSKYGGENDE, startet 13/8)

Ejer-ramme: *"Det er loft, potentiale, ryttertyperne, og følelsen af at træning ikke virker vi skal arbejde med."* Spec: [`2026-08-13-rating-fundament-v3-design.md`](superpowers/specs/2026-08-13-rating-fundament-v3-design.md). Samling: [#3664](https://github.com/NicolaiDolmer/CyclingZone/issues/3664).

7. **#3665** evne-registry + split af vægt-tabellen i fire — nul synlige ændringer, bevist af R2/R3.
8. **#3666** skalaen: vægtet snit + de 8 opskrifter + ALLE visningsflader i én PR (ingen mellemtilstand med to skalaer).
9. **#2454** potentiale 1-6 → 1-99: stjernerne erstattes i UI af **potentiel rating** (ejer 13/8). `potentiale`-feltet bliver rent internt — motor, værdi og akademi rører sig ikke. *Løfte 9/8.*
10. **#3592** de fire matematisk uadskillelige typepar. *Løfte i live patch note v7.95.*
11. **capsShaping**: det der tæller i ratingen skal også vokse i lofterne (spec §6 punkt 2 → #3564-sporet).
12. **#3643 træningsfladen + #3639/#3649 loft-beskeden.** Succeskriterium er ikke konsistente tal, men at **træning føles som om den virker**.
13. **#3667** samlet kommunikation: patch notes + `help.json` (en+da), én besked om ét system.

**Udskudt igen 13/8:** #3668 rod-fix af evne-skalaen (taktik median 38 vs. bjerg 5). Ejeren: *"lige netop den med at ændre i de faktisk viste stats kan vente en smule."* Konsekvens: vej A står ved magt, R1-gaten forbliver ≤6 points spredning, og de 8 opskrifter i spec §3 gælder som skrevet.

## C · Talent-kanalen ind i klubben (ejer-valgt 13/8)

14. **#3657** scoutingmissioner uden targeting — *"they feel useless the way they are now"* (4 spillere 12-13/8) + ejer-direktiv samme dag.
15. **#3652** rapport på øvrige fundne ryttere + kortere scout-tur · **#3548** nedtælling.
16. **#3489** flere spejdere og trænere samtidigt, hver med sit speciale.
17. **#3658** staff-kandidater.
18. **#3550** akademi signing fee 760k-1M for 2-stjernede. *Løfte 10/8 ("on the list").*
19. **#3650** akademiryttere på transferlisten. *Ejer-lovet 11/8.*

## D · Penge og vækst — betinget

Ejer 13/8: *"skal prioriteres snarligt, når der er lidt mere styr på store bugs der fylder hos spillerne."* **Gaten er spor B leveret** — ikke en følelse, ikke en dato.

20. **#2853** e-mail-loop (bygget, testet, slukket; kræver Resend-nøgle + 3 tekster). Audits' største enkelthåndtag for fastholdelse.
21. **#2813** go-live-gates → **#3104** /pro-indgang. *(#2736 fornyelses-webhook er LUKKET 11/8 — den kunde mister ikke Pro.)*

## E · Løbende (aldrig hovedspor)

22. Bug-blok: **#3620** kontraktår forsvinder ved akademi-forfremmelse (regression af lukkede #2881, åben siden 24/7) · **#3541** skadedage vist forskelligt tre steder · **#3669** forhandlet byttetilbud kan ikke afvises.
23. Gæld: 23 done-men-åbne lukkes · #2223 og #3513 opsluger reelt deres løse issues på GitHub (#3496/#3491/#3493/#3439 hhv. #2442/#2583/#2445) · #3094 lukkes som duplikat af #2883.
24. **#3661** design-/kvalitetsprocessen → konkrete regler i `AGENTS.md`, ikke en hensigt.
25. Ops-sidestrøm: **#3486** `VERCEL_TOKEN` (2 min ejer-klik, låser #1784) · #2758 · #3487 · #691 service-key-rotation.

## Parkeret — genbesøges når B og C er leveret

Verdensklasse **bølge 2** (Race Centre, Peloton Post, klubhus/rivaler, palmarès, PWA, observatorium — plan: [`2026-08-05-verdensklasse-game-plan.md`](superpowers/specs/2026-08-05-verdensklasse-game-plan.md), bølge 1 er komplet) · rework-køen **#2223** indbakke og **#3513** dashboard · forum-forbedringer (reaktioner, ulæst-markering, svar-på-indlæg) · små ønsker (asking price på transferlisten, rytterstats ved hover) · vækst-sporet #2822/#1369/#1140/#2824/#2823 · **#2960** React 19 frosset til uge 1 sept.

**FROSSET:** #2217/#2218. **Parkeret siden før:** #1712 (≥300 brugere) · #1941 · #450 · live-taktik/replay (genåbnes som broadcast-teater i bølge 2).

## Stående (viger aldrig)

**Balance:** #2731 maxRiderWinRate 0,67-0,75 vs. mål 0,45 · #2557 hold-dominans · #3015 AI-ryttere restituerer aldrig · #3009 scorecards exiter grønt trods FAIL.
**Doktrin:** styrke straffes ALDRIG, balance = struktur · overlap intended, 1 rytter = 1 løb/dag · simulér-før-ship for alt balance-følsomt.

## 2027-horisont (bevidst ikke i kø)

Verdenshistorik/klubmuseum · #1154 · #934 · #1113 · #1099 · #935 · #2222 · #26 · #938 · #1108 · #1146 · #50.
