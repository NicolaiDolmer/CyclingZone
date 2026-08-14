# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 2026-08-13** i planlægningssessionen ([#3662](https://github.com/NicolaiDolmer/CyclingZone/issues/3662)) — 12 beslutninger, rækkefølgen er sagt ja til punkt for punkt. Erstatter 23/7-udgaven. Status: 🔴 brand/deadline · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. Budget ≤1.500 tok. Visuel udgave: [masterplan-artifact](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8, ordret:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3. Det er altoverskyggende vigtigt."* Alt andet viger for spor B — undtagen det der er bundet til en dato.

**Målt:** åbne issues **546**, done-pukkel **23** (13/8) · 217 brugere, 1 abonnement (14/8) · **S2 slutter søn 23/8 — 9 dage.**

## A · Cutover 23/8 (dato-bundet, viger ikke)

1. ⛔ **#3449 markedssweep — SKAL IKKE MERGES** (målt 14/8, [audit](audits/2026-08-14-oplaas-vaerdier-og-loefter.md)). Sweepet er **søndags-gated**, så ejer-løftet "mellem i dag og fredag" var strukturelt umuligt uanset modelkvalitet. Dertil: modellen måler dårligere end den der kører, metrikken er cirkulær (65,4 % af auktioner lukker på modellens eget anker), og artefaktet er fittet på en typefordeling hvor divergensen nu er 74,8 %. **Anbefaling: rebase, behold koden, slet artefaktet, hold draft, refit efter typebeslutningen.** Spillerbesked med ny plan er ejer-handling.
2. 🔴 **#3645 rollback-drejebog + backup-tabeller.** Ejer-valg 13/8: **backup + genberegnings-script for BÅDE løn og mandat**, ikke kun en skreven plan. Intet skrevet pr. 14/8.
3. 🔵 **#3514 mandat fase 1a/1b — ANBEFALES DROPPET fra cutoveren** per sin egen regel: hård frist 19/8, og intet er bygget pr. 14/8. Ejer-beslutning mangler. Efter cutover får den plads til at blive god i stedet for presset.
4. 🔴 **#3393 løn** — **blokeret af [#3730](https://github.com/NicolaiDolmer/CyclingZone/issues/3730)** (D4's indtægt: lønnen ville tage 55,4 % af nye holds indtægt). Lønkurvens konkave form er målt god og skal ikke laves om — den fjerner 8/9 af alders-inversionen. Afventer desuden beslutning 4+5 i [designkritikkens §7](superpowers/specs/2026-08-14-oekonomi-designkritik.md).
5. ✅ **#3459 race-day-flip** — komplet i main, `race_day_engine_enabled` verificeret `off` i prod. Kun selve flippet mangler.
6. 🔵 **Auto-accept-floor 15/8 bliver stående** (ejer 13/8, ingen handling). Fair-window (#3584) er i main, så 20/8 rammer kun inaktive hold; aktive først 25/8.

## B · Rytter-pakken — "once and for all" (ALTOVERSKYGGENDE, startet 13/8)

Ejer-ramme: *"Det er loft, potentiale, ryttertyperne, og følelsen af at træning ikke virker vi skal arbejde med."* Spec: [`2026-08-13-rating-fundament-v3-design.md`](superpowers/specs/2026-08-13-rating-fundament-v3-design.md). Samling: [#3664](https://github.com/NicolaiDolmer/CyclingZone/issues/3664).

**Designet er LÅST 13/8** — 8 ejer-beslutninger med målinger i [#3664-tråden](https://github.com/NicolaiDolmer/CyclingZone/issues/3664#issuecomment-5281975050). **Tre landinger**, ikke én: kun landing 2 flytter rytterdata.

7. ✅ **#3665** evne-registry + split af vægt-tabellen — merged 13/8, nul synlige ændringer.
8. ✅ **LANDING 1 leveret 13/8:** #3666 + #2454 + #3667. Halvbredder `[9, 6, 4, 3]`. Restpunkt: gulvet i **#3671** (mekanikken køber stadig intet for 149 hold).
9. **#3592 — kun caps-formningen.** `classifierWeights` er **frosset**: den klassificerer nul ryttere (alle 8.731 har `archetype_draw`, 100 % match). *Løfte i v7.95.*
10. **LANDING 2: [#3682](https://github.com/NicolaiDolmer/CyclingZone/issues/3682) positionerings-loftet.** Eneste del der ændrer eksisterende ryttere: prod-mutation, ejer-gated, egen spillerbesked. Målt (n=4.747): loft 22 → 48, potentiel rating **+2,83** i snit. **Fire roller**, tidskøreren taget ud. Skal være **gulv-løft** — 15 ryttere ville ellers miste loft.
11. **LANDING 3 = [#3709](https://github.com/NicolaiDolmer/CyclingZone/issues/3709)**, 16 ejer-beslutninger, [spec](superpowers/specs/2026-08-14-3659-rytterudvikling-og-traening-design.md). ✅ **Trin 1 merget 14/8** (PR #3717): kvittering pr. evne, lukkede #3649+#3651+#3706. Taget udgår af trin 1 og arves af trin 3 (`ability_caps` forlader aldrig serveren, #1162); enheden er **sæson**. **Trin 2 er gated af [#3721](https://github.com/NicolaiDolmer/CyclingZone/issues/3721)** — træningssidens struktur er aldrig designet, kun dens indhold, og trin 2+4 lægger mere på samme flade.

**#3668 → #3512 = ét spor lige efter cutover** (ejer 13/8), med [transparens-sessionen](sessions/2026-08-13-transparens-session-prompt.md). #3668 først: et baseline-refit uden rettet skala flytter bare problemet. #3512 bærer desuden et åbent offentligt løfte fra 10/8 om nye holds startertrupper, og de rammer kun 36,3 % rigtigt.

## B2 · Værdi og løn — NY BLOK, ejer-ramme 14/8

Ejeren 14/8, ordret: *"Det er efter ratings, ryttertyper, potentiale og træning nok det vigtigste vi kan arbejde med."* Designet blev lavet og derefter adversarielt kritiseret samme dag. **To af fire beslutninger faldt.** Spec: [`vaerdi-og-loen-fundament`](superpowers/specs/2026-08-14-vaerdi-og-loen-fundament-design.md) + [`oekonomi-designkritik`](superpowers/specs/2026-08-14-oekonomi-designkritik.md) (syv beslutninger i §7).

- 🔴 **[#3729](https://github.com/NicolaiDolmer/CyclingZone/issues/3729) markedets mundkurv.** `auctionRules.js:110` gør modellens værdi til et loft på egne ryttere og et gulv på bankens. **23 konkurrenceprissatte spiller-til-spiller-handler i hele spillets historie.** Alt andet i værdi-sporet hviler på den: uden den kan markedet aldrig sige at noget er mere værd end modellen tror.
- 🔴 **[#3732](https://github.com/NicolaiDolmer/CyclingZone/issues/3732) værdien er pengepolitik**, ikke en prisseddel. Netto rytterkøb er 53,3 % af alle pengedræn, lønnen 3,1 %. Et søndags-sweep flytter pengemængden. Hører sammen med #3360.
- 🔴 **[#3730](https://github.com/NicolaiDolmer/CyclingZone/issues/3730) D4's indtægt** — blokerende for #3393.
- ⚪ **[#3733](https://github.com/NicolaiDolmer/CyclingZone/issues/3733) søndags-kvitteringen.** Efter #3729, ellers vil den sige "markedet sagde intet i denne uge" hver søndag.

**Forudsætninger uden for blokken:** [#3719](https://github.com/NicolaiDolmer/CyclingZone/issues/3719) + [#3720](https://github.com/NicolaiDolmer/CyclingZone/issues/3720) måler at præmien pr. hold er 3,7-6,6× fra det upkeep-kalibreringen antog. Et fundament bygget på simuleret præmieindtjening kan ikke kalibreres mens præmien selv er ude af kontrol.

- ✅ **Fordelingen besluttet (ejer 14/8):** præmiepulje-indeks **D1 100 · D2 50 · D3 33 · D4 10**. D2 rammer allerede (52); **D3 mangler +18 %, D4 +30 %**.
- 🔵 **Én A/B tilbage, PARKERET til egen session** (ejer 14/8). Målet kan ikke nås med de nuværende knapper: game-day-kvoten og prestige-kaskaden (#2276) er låst, så endagsløbs-andelen er eneste håndtag — og 33 i D3 kræver ~0,85, altså mere end de 0,76 ejeren 7/8 kaldte "for mange" i #3327. **A) præmie-multiplikator pr. division** (egen skrue, point forbliver rå, ingen kalender-regenerering) vs **B) åbn klasse-whitelisten** (bryder kaskaden, kræver regenerering). Anbefaling: A. Prompt: [`2026-08-14-praemiefordeling-session-prompt.md`](sessions/2026-08-14-praemiefordeling-session-prompt.md). **A og #3720 er samme skrue set fra to sider** — vælges A, kalibreres upkeep mod de multiplicerede tal.

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

**Balance:** #2557 hold-dominans er det ENESTE åbne. #2731, #3015 og #3009 blev lukket 3/8 men stod her som "stående" i 12 dage — og fik 15/8 en session til at bygge på et forældet tal (rettet). #2731's 0,67-0,75 var et oppustet punktestimat; Wilson-lower-bound måler 0,359 og grønt (`docs/audits/2026-08-03-race-balance-2731.md`).
**Doktrin:** styrke straffes ALDRIG, balance = struktur · overlap intended, 1 rytter = 1 løb/dag · simulér-før-ship for alt balance-følsomt.

## 2027-horisont (bevidst ikke i kø)

Verdenshistorik/klubmuseum · #1154 · #934 · #1113 · #1099 · #935 · #2222 · #26 · #938 · #1108 · #1146 · #50.
