# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 13/8** (#3662; spørg før omprioritering). 🔴 brand · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. ≤1.500 tok. [Visuel udgave](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3."* Alt viger for spor B undtagen det dato-bundne. **Målt:** ~540 åbne issues · 232 brugere, 1 abo. **S3 25/8-20/9 (27 dage, slutter altid søndag).** **Hard regel 23/8:** ingen prod-mutation uden ejerens "GO" på netop det skridt.

## Uge-plan 22-25/8 (ejer-godkendt 21/8; v4-mål = LIVE fra S3 dag 1, spec-addendum 8c)

- **GJORT 23-24/8:** cutover S2→S3 · kalender live · #4155 game_day PROD · #4154+#3818-sanktioner · #4163 løst+applied. Tal og detaljer: NOW.md + issue-tråde.
- **REST MAN 24/8 (løbsfri):** 🔴 **TÆND race-motoren** (`stage_scheduler_enabled=off` efter #4172) FØR 25/8 kl. 11 · **#4159 game_day-guard FØR næste kalender-generering** (fjerde vagt: assertér constraint-FORM, ikke eksistens) · kalibrering (scorecard + løbsfilm) → **ejer-gate på v4-flip** · #3720 upkeep/præmie-kurven (S4) · /pro S3-launch · velkomstpost.
- **TIR 25/8:** S3 første løbsdag 11:00 — v4 hvis grønt, ellers v3 (låst fallback) · overvågning.

## A · Cutover 23/8 — GENNEMFØRT

1. 🔵 Rest: ejer poster besked 2 · Supabase-perf uge 35 · auto-accept-floor står (#3584).

## B · Rytter-pakken — "once and for all" (ALTOVERSKYGGENDE)

Samling #3664; design LÅST 13/8. Spec: [`rating-fundament-v3`](superpowers/specs/2026-08-13-rating-fundament-v3-design.md)

6. **Mandag først: #3512** (arketype-prior, PR fra 17/8, rebase+verify) · Trin 7-rest: **#4039 fast-follow** · **#4098** unge ”done” langt fra rolleloftet (353 ryttere på 124 hold, ~65 pt gab) + **#4128** (16 fastlåste, plan klar).

**#3668 → #3512 = ét spor lige efter cutover** (+ transparens-sessionen; #3512 bærer et løfte fra 10/8).

## B2 · Værdi og løn (ejer-ramme 14/8)

- Løn-rest: 🔴 #4120 (A1) · ⚪ #3755 · ⚪ #3756 · 🔴 #3732 · #4001.
- **Kalibrerings-session mandag:** #3719 (+#4103 præmier pr. division) · #3720 · #3987 · løn-sats på MÅLT D1-indtægt · #3966 · gradvis aldersnedgang · #3442/#3656.

## C · Talent-kanalen (rest)

7. 🟠 **#3854 staff-rest** (per-scout kapacitet, routing, harness-rekalibrering FØR flag-flip). **#3550:** flag-flip i drejebogen søndag; fremtid #3970. ⚪ **#3853** scout-kadence-måling (#3846).

## P · Planning Center + kalenderen (NYT spor 22/8)

Spec ejer-godkendt 21/8: [planning-center-fase2](superpowers/specs/2026-08-21-planning-center-fase2-design.md) (P0-P5, byg efter v4-gaten). Z1 v0 shippet (#4083).

8. 🟠 **Ejer-direktiv-klyngen 21/8:** ✅ #4102 #4106 #4107 #4108 live 23/8 · #4103 rest = **præmier pr. division mandag m. #3719** (D4 11 % vs D1 108 % af sponsor) · #4105 Toscana → S4 (#3864) · **#4109** Planlægning anti-AI-slop · #4143 kalender-glyffer. Kalender-invarianter (#4123): søndagsslut + 471/27 i `verifySeason3Calendar.mjs`, mangler CI-gate.
8b. ✅ **Kalender-dimensionering LØST 24/8 (#4172).** Rod-årsag: `d4PoolCount=2` i `pyramidCompression` lagde ALLE 48 D4-hold i pulje A/B. Spredt til 8 puljer à 24, fyldt med 2.880 eksisterende frie ryttere (ingen nye skabt). S3-løb uden entries: 157 → 1. **Rest:** `d4PoolCount`-guard så S3→S4 ikke gentager det (tag med #4159) · **#4161** D1-sizing (29 ryttere på én dag) · det sidste tomme løb er et D3-overlap, egen fejlklasse.

9. **P0** kalender-integritet: #3990-rest (off-by-one, ejer-kald) · navne-dedup-guard · #3329 · #2791. **P1** sæsonmatrix + rytter-inspektør + UI-gæld (#3954 #3428 #3410 #2030 #3425 #3955 #3529 #3455 #3374). **P2** taktik ind i centret (#3049 #2794 #1884 #2810 #2405 + fjern `tacticsOrdersAdapter`-mock). **P3** assistenten (mål-løb-migration, #3087 #3088 #3957 #3939 #4076).

## D · Penge og vækst — gate: spor B leveret (ikke en dato)

10. **#2853** e-mail-loop (Resend-nøgle + 3 tekster) — største fastholdelses-håndtag. ⚪ **#4015 request-budget** — genmål efter #4013; gate for compute-sizing FØR launch.
11. **#3104 /pro LIVE** (køb pauset): **#4074 valuta-mismatch blokerer flip** + #4005 momstekst → flip + testkøb → #2813. **#4067** SEO-site.

## E · Løbende (aldrig hovedspor)

12. 🔴 **Spiller-kommunikation, fast ugerytme (#428)** — ejer-mandat 22/8, viger aldrig. MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t. Tråd-bank **#4117**, løfte-audit **#4111**.
13. Gæld: done-men-åbne lukkes løbende · #3513 opsluger #2442/#2583/#2445. Ops (uge 26.-30./8): **#4014** log-vagt · **#4016** session-claim · **#3486** `VERCEL_TOKEN` · #2758 · #3487 · #691 · **worktree-hygiejne**.
14. 🔵 **Fair play (#3131):** prisloft valgt fra efter #4154+#3818 → #3138 ENESTE værn. Rest: retnings- + overbetalings-signal · flag-triage · #3438 · #3139 regler. **Lagt i E, ikke omprioriteret.**

## F · Backlog-bølger (mål: 570 → ~200, #3154)

**Lukkemandat:** done/dubletter/opslugte lukkes frit; won't-do i bundter a 15-20.

- **Rest:** #2085 → #2853 · W7 (#3714 #3623 #3456 #3412) · W8: 53 needs-decision (bundt 2 = økonomi) · #4118 forum · #4119 solgt rytter · småbugs #3944 #3945.

## E2 · Race-oplevelsen

**Rest:** #3914 PR B LIVE-broadcast · **#3855 v4: h2h-gate RØD 23/8** (#4132: bjerg-spredning 4-5x, sprintere 45-61 %, nedkørsel) → **tirsdag v3; mandag = de tre afvigelser** · #3856 efter S3-bevis · #3864→S4 (+ Toscana-grus #4105). Efter cutover: #4070 + #4071.

## Parkeret (genbesøges efter B og C)

VK bølge 2-rest · #2223 + #3513 · vækst #2822/#1369/#1140/#2824/#2823 · #2960 React 19 (sept) · #4099/#4100. **FROSSET:** #2217/#2218 · #1712 · #1941 · #450 · live-taktik/replay.

## Stående (viger aldrig)

**Balance:** #2557 hold-dominans er ENESTE åbne. **Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb/dag · simulér-før-ship.

**2027-horisont** (ikke i kø): verdenshistorik/klubmuseum · #1154 #934 #1113 #1099 #935 #2222 #26 #938 #1108 #50.
