# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 2026-08-13** (#3662; spørg før omprioritering). Status: 🔴 brand/deadline · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. Budget ≤1.500 tok. Visuel udgave: [masterplan-artifact](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3."* Alt viger for spor B undtagen det dato-bundne.

**Målt:** ~535 åbne issues · 232 brugere, 1 abo · **S2-finale søn 23/8 kl. 19; cutover 19:30-22:30; S3 fra tir 25/8.**

## Uge-plan 21-25/8 (ejer-godkendt 21/8; v4-mål = LIVE fra S3 dag 1, spec-addendum 8c)

- **FRE 21/8:** ✅ F2 + #4063 + #4069 merged · ejer: S3-kalender LÅSES (lovet fre/lør) + Resend/moms/Discord-posts · **F3-NATBØLGE i nat** ([plan](superpowers/plans/2026-08-21-f3-natboelge-plan.md)).
- **LØR 22/8:** generalprøve mod staging (stopur, (a)-(h)) + restore-drill · ejer: mandat-apply mod staging m. egen nøgle · F3 review/merge · head-to-head-harness fuld + første kørsel.
- **SØN 23/8:** S2-finale → cutover 19:30-22:30 (drejebog; pre-flip-gate remeasureGate3459; mandat EFTER sæsonskifte) → akademi-flip · head-to-head natten over på S3-kalenderen.
- **MAN 24/8 (løbsfri):** kalibrering: scorecard + løbsfilm → **ejer-gate mandag aften på v4-flip** · /pro S3-launch-pakke · S3-velkomstpost.
- **TIR 25/8:** S3 første løbsdag 11:00 — v4 live hvis grønt, ellers v3 (fallback låst) · overvågningsberedskab.

## A · Cutover 23/8 (dato-bundet, viger ikke)

1. 🟠 **#3449 niveau-korrektion:** maskineri MERGED; gate RØD, apply ejer-gated tidligst 30/8. **#4000 k=100 MERGED 20/8 (#4007, flag off)** — flip ved cutover SAMMEN med c; rækkefølge c FØR #3353 bindende.
2. Supabase-perf-rest: `cherry-pick ac0d81200` uge 35 · **restore-drill dispatches manuelt LØRDAG** med generalprøven.
3. 🟠 **#3514 mandat** — 1a/1b merged inert (PR #3834); backfill 23/8 ejer-gated, gate GRØN. Rest: staging-apply med ejer-nøgle.
4. **Løn:** rest = søndagens genberegning af frosne kontrakter (drejebogen). #3393 PARKERET.
5. 🟠 **#3901:** D1-plan LÅST+BYGGET (PR #3930, dry-run godkendt). **Cutover = søndag AFTEN 19:30-22:30** · **generalprøve LØRDAG** · bufferdag 24/8 (#3467). Drejebog script-verificeret 20/8 (trin 5 → `mandateMigration3514.mjs`; backup-trin 5a tilføjet).
6. 🔵 Auto-accept-floor bliver stående (ejer 13/8); rammer kun inaktive hold nu (#3584), aktive 25/8.

## B · Rytter-pakken — "once and for all" (ALTOVERSKYGGENDE)

Samling #3664; design LÅST 13/8. Spec: [`rating-fundament-v3`](superpowers/specs/2026-08-13-rating-fundament-v3-design.md)

9. Trin 7-rest: **#4039 fast-follow** (dæmpet loft forbi peak + scout-verdikt på skrift + tester-verifikationer).

**#3668 → #3512 = ét spor lige efter cutover** (+ transparens-sessionen; #3512 bærer et offentligt løfte fra 10/8).

## B2 · Værdi og løn (ejer-ramme 14/8)

- Løn-rest: ⚪ #3755 28-dages-måling (gate for gebyret) · ⚪ #3756 gebyret · 🔴 #3732 pengepolitik · #4001 modner første søndag.
- **Kalibrerings-session EFTER cutover** (ejer 19/8): #3719+#3720 D3/D4 + upkeep · #3987 sponsor-skalering · løn-sats på MÅLT D1-indtægt · #3966 S4/S5-bånd m. v4-dagsbudget · gradvis aldersnedgang (ejer 21/8).

## C · Talent-kanalen (rest)

15. 🟠 **#3854 staff-rest** (per-scout kapacitet, routing, harness-rekalibrering FØR flag-flip).
17. **#3550:** rest = flag-flip i drejebogen søndag (#2022 ejes af #3514). Fremtid: #3970.
18. ⚪ **#3853** scout-kadence-måling (efterregulering af #3846).

## D · Penge og vækst — gate: spor B leveret (ikke en dato)

20. **#2853** e-mail-loop: testes FREDAG 21/8 (kræver Resend-nøgle + 3 tekster). Største fastholdelses-håndtag.
21. ⚪ **#4015 request-budget** — 65 brugere = 4.289 requests hver/døgn. Mål igen en uge efter #4013, sæt loft på det målte. Gate for "compute op fra Small?" FØR #2853/launch bringer flere ind.
22. **#3104 /pro-indgang LIVE** (køb pauset). Rest: moms-tjek i Alunta + support-postkasse → CHECKOUT_PAUSED-flip + ét testkøb → #2813 lukkes. S3-launch-pakke man 24/8.

## E · Løbende (aldrig hovedspor)

23. Gæld: done-men-åbne lukkes løbende (KS3-workflow) · #3513 opsluger #2442/#2583/#2445.
25. Ops-sidestrøm (uge 26.-30./8): **#4014** vagt på log-strømmen (advisors ser den IKKE) · **#4016** maskinlæsbart session-claim (prosa låser intet; 6. bid 20/8) · **#3486** `VERCEL_TOKEN` (2 min ejer-klik, låser #1784) · #2758 · #3487 · #691 service-key-rotation.

## F · Backlog-bølger (mål: 570 → ~200, #3154)

**Lukkemandat:** done/dubletter/opslugte lukkes frit; won't-do i bundter a 15-20.

- **Rest:** #2085 → #2853 · **W7 NU** (#3714 #3623 #3456 #3412) · **W8**: 53 needs-decision tilbage (bundt 2 = økonomi, efter cutover) · #4009 · #4025 tekst-trim (senere) · Discord-sweep 20/8: #4031-#4038 nye.
- Småbugs: #3896 · #3897 · #3898.

## E2 · Race-oplevelsen

**Rest:** #3914 PR B LIVE-broadcast · **#3855 v4: F1+F2 SKIBET** — næste = **F3-natbølge → head-to-head → flip-gate man 24/8** · taktik-ordrer v1 ejer-låst (T1-T4) · #3856 efter S3-bevis · #3864→v4-sporet · #3900+#3915 låst i KS3. Efter cutover-ugen: #4070 dashboard-redesign + #4071 manager-indstillinger.

## Parkeret — genbesøges når B og C er leveret

VK bølge 2-rest ([plan](superpowers/specs/2026-08-05-verdensklasse-game-plan.md)) · #2223 + #3513 · forum · små ønsker · vækst #2822/#1369/#1140/#2824/#2823 · **#2960** React 19 (uge 1 sept). **FROSSET:** #2217/#2218 · #1712 (≥300 brugere) · #1941 · #450 · live-taktik/replay.

## Stående (viger aldrig)

**Balance:** #2557 hold-dominans er det ENESTE åbne. **Doktrin:** styrke straffes ALDRIG, balance = struktur · 1 rytter = 1 løb/dag · simulér-før-ship.

## 2027-horisont (bevidst ikke i kø)

Verdenshistorik/klubmuseum · #1154 #934 #1113 #1099 #935 #2222 #26 #938 #1108 #1146 #50.
