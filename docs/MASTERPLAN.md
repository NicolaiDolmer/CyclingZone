# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 2026-08-13** (#3662; spørg før omprioritering). Status: 🔴 brand/deadline · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. Budget ≤1.500 tok. Visuel udgave: [masterplan-artifact](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3."* Alt viger for spor B undtagen det dato-bundne.

**Målt:** **525** åbne issues (20/8 efterm.) · 217 brugere, 1 abo · **S2-finale søn 23/8 kl. 19; cutover 19:30-22:30; S3-løb fra tir 25/8.** Næste session: [design-wireframes](sessions/2026-08-20-design-wireframes-session-prompt.md) (emner ejer-valgt 20/8).

## A · Cutover 23/8 (dato-bundet, viger ikke)

1. 🟠 **#3449 niveau-korrektion:** maskineri MERGED; gate RØD, apply ejer-gated tidligst 30/8. **#4000 type-dæmpning k=100 EJER-GODKENDT 20/8**, flippes SAMMEN med c (puncheur 7,9x→1,7x; rækkefølge c FØR #3353 bindende).
3. 🟠 **#3514 mandat** — fase 1a/1b merged inert (PR #3834); backfill 23/8 ejer-gated, gate GRØN. Rest: staging-script-apply med ejer-nøgle.
4. ✅ **Løn LEVERET 20/8:** hele pakken merged og prod-verificeret (#3992+#3993 20/8; #3972/#3974/#3449-maskineri 19/8; genberegnings-script #3999 dry-run matcher ×2,21). #3393 PARKERET. Rest = søndagens genberegning af frosne kontrakter i drejebogen.
5. 🟠 **#3901:** D1-plan LÅST+BYGGET (PR #3930, dry-run godkendt). **Cutover = søndag AFTEN 19:30-22:30** (S2-finale kører til 19:00; drejebog rev. 20/8) · **generalprøve mod staging LØRDAG** (ejer-godkendt) · bufferdag 24/8 (#3467).
6. 🔵 Auto-accept-floor bliver stående (ejer 13/8); 20/8 rammer kun inaktive hold (#3584), aktive 25/8.

## B · Rytter-pakken — "once and for all" (ALTOVERSKYGGENDE)

Samling #3664; design LÅST 13/8. Spec: [`rating-fundament-v3`](superpowers/specs/2026-08-13-rating-fundament-v3-design.md).

9. **#3592 caps-formning → foldes ind i trin 7** (ejer-besluttet 18/8; analyse i `docs/audits/2026-08-18-3592-caps-formning/`). `classifierWeights` frosset.
10. **Landing 2-rest:** ejer-gated backfill for 1.840 team-løse frie agenter — foldes ind i trin 7-udrulningen ons/tor.
11. **Landing 3 = #3709.** **Trin 2 (løbslære) er ALLEREDE i trin 7-PR'en** (verificeret 20/8: fokus + tredje række på færdighedsdagen). **Trin 7** BYGGET + Week plan-fane tilføjet 20/8; tester-runde kører, merge ved ejer-go efter feedback.

**#3668 → #3512 = ét spor lige efter cutover** (+ transparens-sessionen; #3512 bærer et offentligt løfte fra 10/8).

## B2 · Værdi og løn (ejer-ramme 14/8)

- **Løn-pakken FULDT MERGED 20/8** ([audit](audits/2026-08-19-loen-design-session.md) + #3989). Rest: ⚪ #3755 28-dages-måling (gate for gebyret) · ⚪ #3756 gebyret · 🔴 #3732 pengepolitik · #4001 akademi-intake-værdi modner første søndag (ejer-dom 20/8; fremtid: 5 træningspas før auktion).
- **#3719+#3720: D3/D4-løft + upkeep-rekalibrering udskudt til kalibrerings-session EFTER cutover** (ejer 19/8) på ægte S3-tal. Samme session tager **#3987 sponsor-skalering efter division/ranking** (jeppek 19/8 — indtægtssiden skalerer ikke med den divisions- og trupværdi-skalerede udgiftsside) og en evt. hævning af løn-satsen på MÅLT D1-indtægt (D1 har aldrig haft menneskehold, så 0,35 hviler på et ekstrapoleret estimat).

## C · Talent-kanalen (rest)

15. 🟠 **#3854 staff-rest** (per-scout kapacitet, routing, harness-rekalibrering FØR flag-flip; 2 slots/rolle merged bag flag).
17. ✅ **#3550 signing fee** — leveret (PR #3972 merged 19/8); flag flippes i drejebogen søndag. Fremtid: #3970.
18. ⚪ **#3853** scout-kadence-måling (balance-efterregulering af #3846).

## D · Penge og vækst — gate: spor B leveret (ikke en dato)

20. **#2853** e-mail-loop: testes FREDAG 21/8 (ejer 20/8; kræver Resend-nøgle + 3 tekster). Største fastholdelses-håndtag.
21. **#3104 /pro-indgang LIVE 20/8** (PR #3998, v7.151; køb pauset). Rest: ejerens moms-tjek i Alunta + support-postkasse → CHECKOUT_PAUSED-flip + ét testkøb → #2813 lukkes. S3-launch-pakke til mandag 24/8 (ejer-ja 20/8).

## E · Løbende (aldrig hovedspor)

23. Gæld: done-men-åbne lukkes løbende (KS3-backlog-workflow bærer resten) · #3513 opsluger #2442/#2583/#2445.
25. Ops-sidestrøm: **#3486** `VERCEL_TOKEN` (2 min ejer-klik, låser #1784) · #2758 · #3487 · #691 service-key-rotation.

## F · Backlog-bølger (mål: 570 → ~200, #3154)

**Lukkemandat:** done/dubletter/opslugte lukkes frit; won't-do i bundter a 15-20 til ejeren.

- **Rest:** #2085 → #2853 · **W7** efter trin 7 (#3714 #3623 #3456 #3412) · **W8**: bundt 1 kørt 20/8, 53 needs-decision tilbage (bundt 2 = økonomi, efter cutover).
- Småbugs: #3896 · #3897 · #3898 · #3917-analyse leveret (fodrer #3855).
- ✅ Kalenderen LANDET 20/8 (#3546 lukket: wipe+regen i prod, første løb tir 25/8, race_days_total=27).
- #2022 ejes af #3514.

## E2 · Race-oplevelsen

**Rest:** #3914 PR A MERGED 19/8 (PR #3969); rest = PR B LIVE-broadcast + regression #3985 (etapetypen forsvandt fra etape-fanerne efter sammenfoldningen) · **#3855 motor v4** = ejer-retningen EFTER cutover (#3917 fodrer den) · #3856 backfill efter S3-bevis · #3864 klassiker-uge (S4). **#3900+#3915: designs låst i KS3; valideres i design-sessionen.**

## Parkeret — genbesøges når B og C er leveret

VK bølge 2-rest ([plan](superpowers/specs/2026-08-05-verdensklasse-game-plan.md)) · #2223 indbakke + #3513 dashboard · forum-forbedringer · små ønsker · vækst #2822/#1369/#1140/#2824/#2823 · **#2960** React 19 (uge 1 sept). **FROSSET:** #2217/#2218 · #1712 (≥300 brugere) · #1941 · #450 · live-taktik/replay (→ broadcast-teater).

## Stående (viger aldrig)

**Balance:** #2557 hold-dominans er det ENESTE åbne. **Doktrin:** styrke straffes ALDRIG, balance = struktur · overlap intended, 1 rytter = 1 løb/dag · simulér-før-ship.

## 2027-horisont (bevidst ikke i kø)

Verdenshistorik/klubmuseum · #1154 · #934 · #1113 · #1099 · #935 · #2222 · #26 · #938 · #1108 · #1146 · #50.
