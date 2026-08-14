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

**Designet er LÅST 13/8** — 8 ejer-beslutninger med målinger i [#3664-tråden](https://github.com/NicolaiDolmer/CyclingZone/issues/3664#issuecomment-5281975050). Læs den før #3666. **Tre landinger**, ikke én: kun landing 2 flytter rytterdata.

7. ✅ **#3665** evne-registry + split af vægt-tabellen i fire — merged 13/8 (`38f8ab8a`), nul synlige ændringer, R2/R3 bevist.
8. **LANDING 1 (før 23/8): #3666 + #2454 + #3667 i ét deploy.** De kan ikke skilles — potentiel rating *er* opskriften anvendt på lofterne. Stjernerne erstattes, labelen flyttes til hover, potentialet vises som interval. Halvbredderne er **målt og besluttet: `[9, 6, 4, 3]`** — gulvet i #3671 afgøres i samme omgang. *Løfte 9/8.*
9. **#3592 — skåret ned til caps-formningen alene.** `classifierWeights` er **frosset**: målt 13/8 klassificerer den nul ryttere (alle 8.731 har `archetype_draw`, 100 % match). Display-delen løses af #3666. *Løfte i patch note v7.95.*
10. **LANDING 2: [#3682](https://github.com/NicolaiDolmer/CyclingZone/issues/3682) positionerings-loftet.** Eneste del der ændrer eksisterende ryttere → prod-mutation, ejer-gated per spec §5, egen besked. Målt 13/8 (n=4.747): loft 22 → 48, potentiel rating **+2,83** i snit (sprinter +4,07). **Fire roller — tidskøreren taget ud** (kører alene mod uret), så positionering ryger også ud af `tt`'s visnings-opskrift. Skal implementeres som **gulv-løft**: 15 ryttere ville ellers miste loft.
11. **LANDING 3 (løbende): #3643 + #3649 — designet nu i [#3709](https://github.com/NicolaiDolmer/CyclingZone/issues/3709) (14 ejer-beslutninger 14/8, [spec](superpowers/specs/2026-08-14-3659-rytterudvikling-og-traening-design.md)).** Ejer-defineret succeskriterium: fremgangsbar, ugens point, opskriften synlig, **tempo som hastighed** — aldrig ankomsttid. **Åbent:** #3709's beslutning 9 valgte point pr. **sæson**; dette kriterium siger **uge**. Afklares i trin 1. Målt: den nye skala er *mindre* træningsfølsom (38,3 % mod 28,8 % uden bevægelse på en uge), så #3666 forværrer følelsen indtil denne lander.

**#3668 → #3512 = ét spor lige efter cutover** (ejer 13/8), med transparens-sessionen ([`prompt`](sessions/2026-08-13-transparens-session-prompt.md)). #3668 først — et baseline-refit uden rettet skala flytter bare problemet. Vej A og R1 ≤6 points står indtil da. #3512 bliver mere hastende efter #3666: starter-trupper (som nye managere får) rammer kun 36,3 % rigtigt, og det vil fremgå af tallene.

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
