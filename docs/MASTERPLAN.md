# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 13/8** (#3662; spørg før omprioritering). 🔴 brand · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. ≤1.500 tok. [Visuel udgave](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3."* Alt viger for spor B undtagen det dato-bundne. **Målt:** ~547 åbne issues · 232 brugere, 1 abo. **S2-finale søn 23/8 kl. 19; cutover 19:30-22:30; S3 fra 25/8.**

## Uge-plan 22-25/8 (ejer-godkendt 21/8; v4-mål = LIVE fra S3 dag 1, spec-addendum 8c)

- **LØR 22/8 (rest i aften):** generalprøve (a)-(h) + restore-drill · ejer: mandat-apply m. nøgle + S3-kalender LÅSES.
- **SØN 23/8:** S2-finale → cutover 19:30-22:30 (drejebog; pre-flip-gate remeasureGate3459; mandat EFTER sæsonskifte) → akademi-flip. **Ny gate: #4120 FØR løn-genberegningen.**
- **MAN 24/8 (løbsfri):** kalibrering (scorecard + løbsfilm) → **ejer-gate på v4-flip** · /pro S3-launch · velkomstpost.
- **TIR 25/8:** S3 første løbsdag 11:00 — v4 hvis grønt, ellers v3 (låst fallback) · overvågning.

## A · Cutover 23/8 (dato-bundet, viger ikke)

1. 🔴 **#4120 løn-rangordenen** (NY 22/8): genberegningen fryser kontrakter på den FROSNE `valuation_type` → 19,8x lønspænd ved samme evne+alder; puncheur-offset x9,11 fittet på n=19. **Ejer-valg FØR søndag:** kør / dæmp m. #4000 / udskyd til efter c.
2. 🟠 **#3449 niveau-korrektion:** gate RØD (0,225 > 0,15), apply ejer-gated tidligst 30/8. **#4000 merged, flag off** — flippes SAMMEN med c; c FØR #3353 bindende.
3. 🟠 **#3514 mandat** — merged inert; backfill 23/8 ejer-gated, gate GRØN. Rest: staging-apply m. ejer-nøgle.
4. 🟠 **#3901:** D1-plan bygget, dry-run godkendt. Bufferdag 24/8 (#3467).
5. Supabase-perf-rest: `cherry-pick ac0d81200` uge 35. 🔵 Auto-accept-floor står (ejer 13/8); rammer aktive hold fra 25/8 (#3584).

## B · Rytter-pakken — "once and for all" (ALTOVERSKYGGENDE)

Samling #3664; design LÅST 13/8. Spec: [`rating-fundament-v3`](superpowers/specs/2026-08-13-rating-fundament-v3-design.md)

6. Trin 7-rest: **#4039 fast-follow** (dæmpet loft + scout-verdikt på skrift + tester-verifikationer) · **#4098** unge 'done' langt fra rolleloftet (4. gentagelse).

**#3668 → #3512 = ét spor lige efter cutover** (+ transparens-sessionen; #3512 bærer et løfte fra 10/8).

## B2 · Værdi og løn (ejer-ramme 14/8)

- Løn-rest: 🔴 #4120 (se A1) · ⚪ #3755 28-dages-måling (gate for gebyret) · ⚪ #3756 gebyret · 🔴 #3732 pengepolitik · #4001 modner første søndag.
- **Kalibrerings-session EFTER cutover** (ejer 19/8): #3719+#3720 · #3987 · løn-sats på MÅLT D1-indtægt · #3966 S4/S5-bånd · gradvis aldersnedgang (ejer 21/8) · #3442/#3656.

## C · Talent-kanalen (rest)

7. 🟠 **#3854 staff-rest** (per-scout kapacitet, routing, harness-rekalibrering FØR flag-flip). **#3550:** flag-flip i drejebogen søndag; fremtid #3970. ⚪ **#3853** scout-kadence-måling (#3846).

## P · Planning Center + kalenderen (NYT spor 22/8)

Spec ejer-godkendt 21/8: [planning-center-fase2](superpowers/specs/2026-08-21-planning-center-fase2-design.md) (P0-P5, byg efter v4-gaten). Z1 v0 shippet (#4083).

8. 🔴 **Ejer-direktiv-klyngen 21/8 har intet hjem i P0-P5** (oprettet 22/8, EFTER spec'en): **#4102** program synligt · **#4103** kalender-audit · **#4104** monument-længde · **#4105** Toscana-grus · **#4106** udbruds-tekst · **#4107** ruteprofiler · **#4108** miniaturer · **#4109** Planlægning anti-AI-slop. Indplaceres FØR P0.
9. **P0** kalender-integritet: #3990-rest (off-by-one, ejer-kald) · navne-dedup-guard · #3329 · #2791. **P1** sæsonmatrix + rytter-inspektør + UI-gæld (#3954 #3428 #3410 #2030 #3425 #3955 #3529 #3455 #3374). **P2** taktik ind i centret (#3049 #2794 #1884 #2810 #2405 + fjern `tacticsOrdersAdapter`-mock). **P3** assistenten (mål-løb-migration, #3087 #3088 #3957 #3939 #4076).

## D · Penge og vækst — gate: spor B leveret (ikke en dato)

10. **#2853** e-mail-loop (Resend-nøgle + 3 tekster) — største fastholdelses-håndtag. ⚪ **#4015 request-budget** — genmål efter #4013; gate for compute-sizing FØR launch.
11. **#3104 /pro LIVE** (køb pauset): **#4074 valuta-mismatch blokerer flip** + #4005 momstekst → flip + testkøb → #2813. **#4067** SEO-site.

## E · Løbende (aldrig hovedspor)

12. 🔴 **Spiller-kommunikation, fast ugerytme (#428)** — ejer-mandat 22/8, viger aldrig. MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t. Tråd-bank **#4117**, løfte-audit **#4111**.
13. Gæld: done-men-åbne lukkes løbende · #3513 opsluger #2442/#2583/#2445. Ops (uge 26.-30./8): **#4014** log-vagt · **#4016** session-claim · **#3486** `VERCEL_TOKEN` · #2758 · #3487 · #691 · **worktree-hygiejne**.

## F · Backlog-bølger (mål: 570 → ~200, #3154)

**Lukkemandat:** done/dubletter/opslugte lukkes frit; won't-do i bundter a 15-20.

- **Rest:** #2085 → #2853 · **W7 NU** (#3714 #3623 #3456 #3412) · **W8**: 53 needs-decision (bundt 2 = økonomi, efter cutover) · #4009 · sweep 22/8: **#4118** forum-sortering, **#4119** solgt rytter væk fra truppen · småbugs #3896 #3897 #3898 #3944 #3945.

## E2 · Race-oplevelsen

**Rest:** #3914 PR B LIVE-broadcast · **#3855 v4: F1-F3 SKIBET** — næste = **head-to-head → flip-gate man 24/8** · #3856 efter S3-bevis · #3864→S4 · #3900+#3915 (hører til #4102). Efter cutover: #4070 + #4071.

## Parkeret (genbesøges efter B og C)

VK bølge 2-rest ([plan](superpowers/specs/2026-08-05-verdensklasse-game-plan.md)) · #2223 + #3513 · vækst #2822/#1369/#1140/#2824/#2823 · **#2960** React 19 (sept) · #4099/#4100. **FROSSET:** #2217/#2218 · #1712 (≥300 brugere) · #1941 · #450 · live-taktik/replay.

## Stående (viger aldrig)

**Balance:** #2557 hold-dominans er ENESTE åbne. **Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb/dag · simulér-før-ship.

**2027-horisont** (ikke i kø): verdenshistorik/klubmuseum · #1154 #934 #1113 #1099 #935 #2222 #26 #938 #1108 #1146 #50.
