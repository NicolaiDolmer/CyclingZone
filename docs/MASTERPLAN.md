# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 2026-08-13** i planlægningssessionen ([#3662](https://github.com/NicolaiDolmer/CyclingZone/issues/3662)) — 12 beslutninger, rækkefølgen er sagt ja til punkt for punkt. Erstatter 23/7-udgaven. Status: 🔴 brand/deadline · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. Budget ≤1.500 tok. Visuel udgave: [masterplan-artifact](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8, ordret:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3. Det er altoverskyggende vigtigt."* Alt andet viger for spor B — undtagen det der er bundet til en dato.

**Målt:** åbne issues **533** (18/8 efter natbølge XL: 9 PR merged + 28 hygiejne-lukninger + 27 done-lukninger 18/8 formiddag) · 217 brugere, 1 abonnement (14/8) · **S2 slutter søn 23/8 — 5 dage.**

## A · Cutover 23/8 (dato-bundet, viger ikke)

1. ⛔ **#3449 markedssweep — refit-gaten målt RØD 17/8** (bølge 2 spor 9, PR #3836 merged: #3750-filter + refit-værktøj + inert config). Refittet måler dårligere end kørende på alle mål (MAE 29.831 mod 20.572). **Nøglefund: kørende model × 0,422 slår alt** — niveau-korrektion (én konstant), ikke modelskifte, er den anbefalede vej; blend-sweepets omfordeling er bekræftet doktrin-brud. Beslutning + måling hører i **værdi/løn-design-sessionen**. #3449 forbliver draft.
3. 🟠 **#3514 mandat — GENOPLIVET af ejeren 17/8; fase 1a/1b MERGED inert** (PR #3834). Backfill 23/8 ejer-gated, gate GRØN; UI-flip har egen gate senere. Rest: staging-script-apply med ejer-nøgle.
4. 🔵 **#3393 løn — beslutning 4+5 TRUFFET 17/8** (ankerværdi + ét globalt A mod 35 % af genmålt indtægt). Ejer-valg: designes færdig SAMMEN før ombygning (design-session). Lønkurvens konkave form er fredet. Flipper ikke 23/8.
5. ✅ **#3459 race-day-flip** — komplet, flag `off` i prod, rollback-værktøj bevist, spillerbesked-udkast klar (post før søndag). **23/8 = race-day + mandat-backfill.**
6. 🔵 **Auto-accept-floor 15/8 bliver stående** (ejer 13/8, ingen handling). Fair-window (#3584) er i main, så 20/8 rammer kun inaktive hold; aktive først 25/8.

## B · Rytter-pakken — "once and for all" (ALTOVERSKYGGENDE, startet 13/8)

Ejer-ramme: *"Det er loft, potentiale, ryttertyperne, og følelsen af at træning ikke virker vi skal arbejde med."* Spec: [`2026-08-13-rating-fundament-v3-design.md`](superpowers/specs/2026-08-13-rating-fundament-v3-design.md). Samling: [#3664](https://github.com/NicolaiDolmer/CyclingZone/issues/3664).

**Designet er LÅST 13/8** — 8 ejer-beslutninger med målinger i [#3664-tråden](https://github.com/NicolaiDolmer/CyclingZone/issues/3664#issuecomment-5281975050). **Tre landinger**, ikke én: kun landing 2 flytter rytterdata.

8. 🟠 **#3671** gulvet fra landing 1 (mekanikken køber stadig intet for 149 hold) — resten af landing 1 + #3665 leveret 13/8.
9. **#3592 — kun caps-formningen.** `classifierWeights` er **frosset**: den klassificerer nul ryttere (alle 8.731 har `archetype_draw`, 100 % match). *Løfte i v7.95.*
10. ✅ **LANDING 2 LEVERET** (#3682 lukket 15/8, PR #3739 — verificeret 18/8 efter stale plan-entry). Rest: ejer-gated backfill for 1.840 team-løse frie agenter (hold-ryttere selv-healer via daglig træning) — **foldes ind i trin 7-udrulningen ons/tor**.
11. **LANDING 3 = [#3709](https://github.com/NicolaiDolmer/CyclingZone/issues/3709)**, 16 ejer-beslutninger, [spec](superpowers/specs/2026-08-14-3659-rytterudvikling-og-traening-design.md). Trin 1+3+4+5 merget 14/8 (patch note 7.129). **Rest: trin 2** gated af [#3762](https://github.com/NicolaiDolmer/CyclingZone/issues/3762) · **trin 7** BYGGET, PARKERET af ejeren 17/8 (PR #3798; overgangs-session FØR cutover, ejer-valgt 17/8) — presserende: 99-klippet lægger 1.840 evne-pladser på 99 hos 437 top-talenter.

**#3668 → #3512 = ét spor lige efter cutover** (ejer 13/8), med [transparens-sessionen](sessions/2026-08-13-transparens-session-prompt.md). #3668 først: et baseline-refit uden rettet skala flytter bare problemet. #3512 bærer desuden et åbent offentligt løfte fra 10/8 om nye holds startertrupper, og de rammer kun 36,3 % rigtigt.

## B2 · Værdi og løn — NY BLOK, ejer-ramme 14/8

Ejeren 14/8, ordret: *"Det er efter ratings, ryttertyper, potentiale og træning nok det vigtigste vi kan arbejde med."* Designet blev lavet og derefter adversarielt kritiseret samme dag. **To af fire beslutninger faldt.** Spec: [`vaerdi-og-loen-fundament`](superpowers/specs/2026-08-14-vaerdi-og-loen-fundament-design.md) + [`oekonomi-designkritik`](superpowers/specs/2026-08-14-oekonomi-designkritik.md) (syv beslutninger i §7).

- Beslutning 1-3 truffet 15/8, #2884 merget ([log](audits/2026-08-15-oekonomi-beslutninger-1-3.md)); beslutning 3: værdien følger markedet **pr. rytter efter hvor mange handler der findes**.
- ✅ **#3757 LUKKET (alle beslutninger 4+5+7 truffet)** — #3393 er nu kun gated af fælles design-session (bookes før søndag, sammen med #2840 dagsløn: ejer-valg 18/8 = nyt lønsystem fra ny sæson) · ⚪ [#3755](https://github.com/NicolaiDolmer/CyclingZone/issues/3755) 28-dages-måling (gate for gebyret) · ⚪ [#3756](https://github.com/NicolaiDolmer/CyclingZone/issues/3756) gebyret · 🔴 [#3750](https://github.com/NicolaiDolmer/CyclingZone/issues/3750) modellen trænes på en konstant.
- 🔴 **[#3732](https://github.com/NicolaiDolmer/CyclingZone/issues/3732) værdien er pengepolitik**, ikke en prisseddel. Netto rytterkøb er 53,3 % af alle pengedræn, lønnen 3,1 %. Hører sammen med #3360.
- 🔴 **[#3733](https://github.com/NicolaiDolmer/CyclingZone/issues/3733) søndags-kvitteringen** er nu en **hård afhængighed**: med evidensvægt pr. rytter flytter nogle ryttere sig om søndagen og andre ikke, og uden en forklaring på skærmen er det uforståeligt.

**Forudsætninger uden for blokken:** [#3719](https://github.com/NicolaiDolmer/CyclingZone/issues/3719) + [#3720](https://github.com/NicolaiDolmer/CyclingZone/issues/3720) måler at præmien pr. hold er 3,7-6,6× fra det upkeep-kalibreringen antog. Et fundament bygget på simuleret præmieindtjening kan ikke kalibreres mens præmien selv er ude af kontrol.

- ✅ **Fordelingen besluttet (ejer 14/8):** præmiepulje-indeks **D1 100 · D2 50 · D3 33 · D4 10**. D2 rammer allerede (52); **D3 mangler +18 %, D4 +30 %**.
- 🔵 **Én A/B tilbage, PARKERET til egen session** (ejer 14/8). Målet kan ikke nås med de nuværende knapper: game-day-kvoten og prestige-kaskaden (#2276) er låst, så endagsløbs-andelen er eneste håndtag — og 33 i D3 kræver ~0,85, altså mere end de 0,76 ejeren 7/8 kaldte "for mange" i #3327. **A) præmie-multiplikator pr. division** (egen skrue, point forbliver rå, ingen kalender-regenerering) vs **B) åbn klasse-whitelisten** (bryder kaskaden, kræver regenerering). Anbefaling: A. Prompt: [`2026-08-14-praemiefordeling-session-prompt.md`](sessions/2026-08-14-praemiefordeling-session-prompt.md). **A og #3720 er samme skrue set fra to sider** — vælges A, kalibreres upkeep mod de multiplicerede tal.

## C · Talent-kanalen — REST efter bølge 3 (kernen leveret 17/8)

15. 🟠 **#3489+#3658** staff: 2 slots pr. rolle merget (PR #3851, bag `FACILITIES_ENABLED`). Rest: **#3854** (per-scout kapacitet, per-rytter routing, facility-harness-rekalibrering FØR flag-flip).
17. 🔵 **#3550** signing fee MÅLT 17/8: roden er typedrevet markedsværdi-skævhed (puncheur-median 24.194 mod 2.898-8.200), ikke stjerneniveau; anbefaling B (afkobl fee fra markedsværdi) — beslutning i værdi/løn-design-sessionen.
18. ⚪ **#3853** scout-kadence-måling efter 1-dags-missionen (balance-efterregulering af #3846).

## D · Penge og vækst — betinget

Ejer 13/8: *"skal prioriteres snarligt, når der er lidt mere styr på store bugs der fylder hos spillerne."* **Gaten er spor B leveret** — ikke en følelse, ikke en dato.

20. **#2853** e-mail-loop (bygget, testet, slukket; kræver Resend-nøgle + 3 tekster). Audits' største enkelthåndtag for fastholdelse.
21. **#2813** go-live-gates → **#3104** /pro-indgang. *(#2736 fornyelses-webhook er LUKKET 11/8 — den kunde mister ikke Pro.)*

## E · Løbende (aldrig hovedspor)

23. Gæld: 23 done-men-åbne lukkes · #2223 og #3513 opsluger reelt deres løse issues på GitHub (#3496/#3491/#3493/#3439 hhv. #2442/#2583/#2445) · #3094 lukkes som duplikat af #2883.
24. **#3661** design-/kvalitetsprocessen → konkrete regler i `AGENTS.md`, ikke en hensigt.
25. Ops-sidestrøm: **#3486** `VERCEL_TOKEN` (2 min ejer-klik, låser #1784) · #2758 · #3487 · #691 service-key-rotation.

## F · Backlog-bølger (ejer-godkendt 15/8, plan-session — mål: 570 → ~200, [#3154](https://github.com/NicolaiDolmer/CyclingZone/issues/3154))

Natbølger/sidesessioner; hovedsporet taber ikke tempo. **Lukkemandat:** done/dubletter/opslugte lukkes frit; won't-do i bundter a 15-20 til ejeren. Visuel udgave af hele 30-punkts-planen: masterplan-artifacten.

- ✅ **W1-W6 + W9 LEVERET af natbølge XL 18/8** ([audit](audits/night-wave-2026-08-18.md) + formiddags-merges: 24 issues shipped, invariant + 4 migrationer applied, 800.000 kompenseret, 139 ungdomsryttere rekalibreret, 28+27 issues lukket). **Rest:** #3684 (pixel-maskering, fix klar i worktree) · #2836+#3582 (PR #3878/#3881 i merge-kø) · #2085 → derefter #2853 · **W7** venter på trin 7 (#3714 #3623 #3456 #3412) · **W8** beslutnings-bundter (54 needs-decision).
- **S3-kalender-finpuds: alle 4 restbeslutninger TRUFFET 17/8** (#3546): pakke i byg (PR #3862 draft), regenerering ejer-gated på scorecardet. FØR 23/8, kalender-session.
- Åbne pointere: #2022 ejes af #3514. (✅ #3396 + #3632 lukket.)

## E2 · Race-oplevelsen (ejer-startet 17/8 — bølge 2's teater-kerne åbnet før tid)

Session 17/8 (ejer + arkitekt): **#2410 event-log-spec ejer-besluttet** (JSONB-artefakt pr. etape, kontrakt-først, forward-only fra S3; prototype-gate BESTÅET + 6 renderer-forbedringer godkendt) — S1 (lager+generator+API bag flag) i byg. **Mockup-kontrakter godkendt:** #3858 Race Centre · #3859 etapeside før/under/efter + afspiller (begge blokeret af S1). **#3855 intra-etape-motor (v4)** = ejer-retningen; design-spor højt prioriteret EFTER cutover. #3856 backfill efter S3-bevis. Spec: [`2026-08-17-race-event-log-stage-timeline-design.md`](superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md).

## Parkeret — genbesøges når B og C er leveret

Verdensklasse **bølge 2's REST** (Peloton Post, klubhus/rivaler, palmarès, PWA, observatorium — plan: [`2026-08-05-verdensklasse-game-plan.md`](superpowers/specs/2026-08-05-verdensklasse-game-plan.md), bølge 1 er komplet; Race Centre-delen er åbnet, se E2) · rework-køen **#2223** indbakke og **#3513** dashboard · forum-forbedringer (reaktioner, ulæst-markering, svar-på-indlæg) · små ønsker (asking price på transferlisten, rytterstats ved hover) · vækst-sporet #2822/#1369/#1140/#2824/#2823 · **#2960** React 19 frosset til uge 1 sept.

**FROSSET:** #2217/#2218. **Parkeret siden før:** #1712 (≥300 brugere) · #1941 · #450 · live-taktik/replay (genåbnes som broadcast-teater i bølge 2).

## Stående (viger aldrig)

**Balance:** #2557 hold-dominans er det ENESTE åbne. #2731, #3015 og #3009 blev lukket 3/8 men stod her som "stående" i 12 dage — og fik 15/8 en session til at bygge på et forældet tal (rettet). #2731's 0,67-0,75 var et oppustet punktestimat; Wilson-lower-bound måler 0,359 og grønt (`docs/audits/2026-08-03-race-balance-2731.md`).
**Doktrin:** styrke straffes ALDRIG, balance = struktur · overlap intended, 1 rytter = 1 løb/dag · simulér-før-ship for alt balance-følsomt.

## 2027-horisont (bevidst ikke i kø)

Verdenshistorik/klubmuseum · #1154 · #934 · #1113 · #1099 · #935 · #2222 · #26 · #938 · #1108 · #1146 · #50.
