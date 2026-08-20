# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 2026-08-13** (#3662; spørg før omprioritering). Status: 🔴 brand/deadline · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. Budget ≤1.500 tok. Visuel udgave: [masterplan-artifact](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3."* Alt viger for spor B undtagen det dato-bundne.

**Målt:** **527** åbne issues (20/8) · 217 brugere, 1 abo · **S2 slutter søn 23/8.**

## A · Cutover 23/8 (dato-bundet, viger ikke)

1. 🟠 **#3449 niveau-korrektion — besluttet 19/8** (forhandlet kanal, én konstant, gate-styret efter cutover; gate seeder RØD, maskineri + #3733 trin 1 BYGGET på PR'en). Merges sidst i løn-pakken (#3992 → #3993 → #3972/#3974 → #3449); apply ejer-gated, tidligst 30/8.
3. 🟠 **#3514 mandat** — fase 1a/1b merged inert (PR #3834); backfill 23/8 ejer-gated, gate GRØN. Rest: staging-script-apply med ejer-nøgle.
4. 🟠 **Løn — OMLAGT 20/8 (#3989, PR #3992):** løn = `current_production_value` × **én global sats 0,35**. Ingen divisions-skalering, markedsværdi er IKKE et løngrundlag. **#3393 PARKERET** — målt mod prod genindfører markedsværdi-grundlaget inversionen på evne-aksen (19-årigt talent dyrere end en bedre 27-årig). Dagsløns-divisor-fixet reddet ud i #3991 (merged). Afventer ejer-go; genberegning flipper 23/8 i drejebogen.
5. 🟠 **#3901:** pakke leveret; **D1-plan LÅST+BYGGET** (top 24 → D1, PR #3930, dry-run godkendt). **23/8 = race-day-flip + komprimering + mandat-backfill** (apply ejer-gated). Bufferdag 24/8 besluttet (#3467).
6. 🔵 Auto-accept-floor bliver stående (ejer 13/8); 20/8 rammer kun inaktive hold (#3584), aktive 25/8.

## B · Rytter-pakken — "once and for all" (ALTOVERSKYGGENDE)

Samling #3664; design LÅST 13/8. Spec: [`rating-fundament-v3`](superpowers/specs/2026-08-13-rating-fundament-v3-design.md).

9. **#3592 caps-formning → foldes ind i trin 7** (ejer-besluttet 18/8; analyse i `docs/audits/2026-08-18-3592-caps-formning/`). `classifierWeights` frosset.
10. **Landing 2-rest:** ejer-gated backfill for 1.840 team-løse frie agenter — foldes ind i trin 7-udrulningen ons/tor.
11. **Landing 3 = #3709.** Rest: **trin 2** (gated af #3762) · **trin 7** BYGGET, parkeret til ons/tor (PR #3798; 99-klippet presser 437 top-talenter).

**#3668 → #3512 = ét spor lige efter cutover** (+ transparens-sessionen; #3512 bærer et offentligt løfte fra 10/8).

## B2 · Værdi og løn (ejer-ramme 14/8)

- **Løn-pakken bygget** ([audit](audits/2026-08-19-loen-design-session.md) + #3989): #3992 → #3993 → #3972 → #3974 → #3449, rækkefølgen er bindende. Rest: ⚪ #3755 28-dages-måling (gate for gebyret) · ⚪ #3756 gebyret · 🔴 #3732 pengepolitik.
- **#3719+#3720: D3/D4-løft + upkeep-rekalibrering udskudt til kalibrerings-session EFTER cutover** (ejer 19/8) på ægte S3-tal. Samme session tager **#3987 sponsor-skalering efter division/ranking** (jeppek 19/8 — indtægtssiden skalerer ikke med den divisions- og trupværdi-skalerede udgiftsside) og en evt. hævning af løn-satsen på MÅLT D1-indtægt (D1 har aldrig haft menneskehold, så 0,35 hviler på et ekstrapoleret estimat).

## C · Talent-kanalen (rest)

15. 🟠 **#3854 staff-rest** (per-scout kapacitet, routing, harness-rekalibrering FØR flag-flip; 2 slots/rolle merged bag flag).
17. 🟠 **#3550 signing fee** — løst ved ungdomspakken (PR #3972); flippes i drejebogen efter #3992. Fremtid: #3970.
18. ⚪ **#3853** scout-kadence-måling (balance-efterregulering af #3846).

## D · Penge og vækst — gate: spor B leveret (ikke en dato)

20. **#2853** e-mail-loop (bygget, slukket; kræver Resend-nøgle + 3 tekster). Største fastholdelses-håndtag.
21. **#2813** go-live-gates → **#3104** /pro-indgang.

## E · Løbende (aldrig hovedspor)

23. Gæld: done-men-åbne lukkes løbende (KS3-backlog-workflow bærer resten) · #3513 opsluger #2442/#2583/#2445.
25. Ops-sidestrøm: **#3486** `VERCEL_TOKEN` (2 min ejer-klik, låser #1784) · #2758 · #3487 · #691 service-key-rotation.

## F · Backlog-bølger (mål: 570 → ~200, #3154)

**Lukkemandat:** done/dubletter/opslugte lukkes frit; won't-do i bundter a 15-20 til ejeren.

- W1-W6+W9 leveret ([audit](audits/night-wave-2026-08-18.md)). **Rest:** #2085 → #2853 · **W7** efter trin 7 (#3714 #3623 #3456 #3412) · **W8** beslutnings-bundter (54 needs-decision) · KS3-workflow leveret 18/8: net −32 (adversariel verifikation fangede 2 falske done; 20 wontdo ejer-dømt).
- Småbugs 17/8: #3896 skadet rytter kunne udtages · #3897 Discord-pulje-id · #3898 evne-sortering.
- DM-kuldet: #3913+#3916 i merge-kø, #3912 merget, #3917-analyse leveret (fodrer #3855).
- S3-kalender-finpuds (#3546): PR #3862 draft, regenerering ejer-gated — kalender-session FØR 23/8.
- #2022 ejes af #3514.

## E2 · Race-oplevelsen

**Rest:** #3914 PR A MERGED 19/8 (PR #3969); rest = PR B LIVE-broadcast + regression #3985 (etapetypen forsvandt fra etape-fanerne efter sammenfoldningen) · **#3855 motor v4** = ejer-retningen EFTER cutover (#3917 fodrer den) · #3856 backfill efter S3-bevis · #3864 klassiker-uge (S4). **#3900 sæson-overblik + #3915 dagens etaper designes SAMLET i KS3.** Spec: [`race-event-log-stage-timeline`](superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md).

## Parkeret — genbesøges når B og C er leveret

VK bølge 2-rest ([plan](superpowers/specs/2026-08-05-verdensklasse-game-plan.md)) · #2223 indbakke + #3513 dashboard · forum-forbedringer · små ønsker · vækst #2822/#1369/#1140/#2824/#2823 · **#2960** React 19 (uge 1 sept). **FROSSET:** #2217/#2218 · #1712 (≥300 brugere) · #1941 · #450 · live-taktik/replay (→ broadcast-teater).

## Stående (viger aldrig)

**Balance:** #2557 hold-dominans er det ENESTE åbne. **Doktrin:** styrke straffes ALDRIG, balance = struktur · overlap intended, 1 rytter = 1 løb/dag · simulér-før-ship.

## 2027-horisont (bevidst ikke i kø)

Verdenshistorik/klubmuseum · #1154 · #934 · #1113 · #1099 · #935 · #2222 · #26 · #938 · #1108 · #1146 · #50.
