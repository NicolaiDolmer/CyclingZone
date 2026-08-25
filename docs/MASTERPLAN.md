# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 13/8** (#3662; spørg før omprioritering). 🔴 brand · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. ≤1.500 tok. [Visuel udgave](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3."* Alt viger for spor B undtagen det dato-bundne. **Målt:** 576 åbne issues · 232 brugere, 1 abo. **Hard regel 23/8:** ingen prod-mutation uden ejerens "GO" på netop det skridt.

## Frem til FREDAG 28/8 kl. 11 (ejer-godkendt 25/8) — alt andet viger

S3 er udskudt til fre 28/8 → søn 27/9 (#4218). Rækkefølgen er ejer-valgt:

1. **Holdudtagelsen — symptomerne LUKKET** (#4222). Rest: #4200's anden halvdel — delvise trupper toppes ikke op, mens fladen lover det modsatte (`raceRunner.js:812`). **#4201 AFGJORT:** sen udfyldning, tomme trupper, 1 t før løb, sweep 60→15 min.
2. **Nye spillere kan lande:** #4183 + #4233 er **ÉT bug** — `aiTeamGenerator.js:403`, trimmen vælger i id-orden og kaster på transfer_offers-FK. D4-A står på 25 hold.
3. **#4174** — ét ejer-svar: hvor højt fyldes inaktive trupper. Genmålt: kun D1 rammer stadig 29.
4. **Vagterne:** #4229 · #4215 · #4219 · #4123. Ingen brænder fredag; alle gør os blinde bagefter. **#4123 er forudsætning** for at røre kalenderen — diff-værktøjet er dødt på en hardkodet dato.
5. **#4236 er roden, verificeret:** én løbsdag spænder op til **9 kalenderdage** (D1 ld 15 = 5/9→13/9); D1 25/89, D3 21/47. Felter kan ikke fyldes lovligt → brænder fast i resultater. #4211: 5 af 6 brud er fejl i scriptet selv.
5b. 🆕 **Stage-mix brudt i alle 4 divisioner** (#4103): højbjerg 5,6–16,1 % mod 12 ±2; regenereringen overskrev #4140. **Ejer-svar mangler.**
6. **Tænd scheduler + entry-generator** — står `off`; ejer-GO, sidste skridt.

**Planning Center med (ejer 25/8):** P0 + UI-gælden + Z1-sæsonmatrixen. Design låst, se `superpowers/specs/2026-08-25-planning-center-z1-saesonmatrix-design.md`. Aksen låses først når #4236 er afgjort.

**UDSKUDT (ejer-godkendt):** v4-flip · #4203/#4209 · PC P1-P3-rest + #4070/#4071 · backlog-bølgerne.

**SSOT-disciplin (hard rule 30, ejer 25/8):** intet design uden at citere sit områdes SSOT; SSOT'en opdateres i samme PR. Nye 25/8: `FORUM_RULES.md` · `DASHBOARD_RULES.md`. 🆕 **24 regler er allerede bagud** — 12 i kalenderen (#4176) + 12 udenfor (**#4254**). Kostede en fejl 25/8: GT'ernes 17-18 etaper læst som regression, fordi SSOT'en siger 21.

## B · Rytter-pakken (ALTOVERSKYGGENDE)

SSOT: `PROGRESSION_RULES.md`. Samling #3664; design LÅST 13/8.

6. **#3512** (arketype-prior, PR fra 17/8, rebase+verify) · **#4039** trin 7 fast-follow · **#4098** unge "done" langt fra rolleloftet (353 ryttere, ~65 pt gab) + **#4128** · **#3668 → #3512 = ét spor**.

## B2 · Værdi og løn (SSOT: `ECONOMY_RULES.md`)

- Løn-rest: 🔴 #4120 (A1) · ⚪ #3755 · ⚪ #3756 · 🔴 #3732 · #4001.
- **Kalibrerings-session mandag:** #3719 (+#4103 præmier pr. division) · #3720 · #3987 · løn-sats på MÅLT D1-indtægt · #3966 · gradvis aldersnedgang · #3442/#3656.

## C · Talent-kanalen (rest)

7. 🟠 **#3854 staff-rest** (per-scout kapacitet, routing, harness-rekalibrering FØR flag-flip). **#3550** flag-flip; fremtid #3970. ⚪ **#3853**.

## P · Planning Center + kalenderen (NYT spor 22/8)

SSOT: `PLANNING_CENTER_RULES.md`. Z1 v0 shippet (#4083); Z1-designet låst 25/8.

8. 🟠 **Ejer-direktiv-klyngen 21/8, rest:** **#4103** præmier pr. division m. #3719 · #4105 Toscana → S4 (#3864) · **#4109** Planlægning anti-AI-slop · #4143 kalender-glyffer. #4123-invarianterne mangler CI-gate.
8b. Kalenderen **genereret forfra 25/8** (#4218) → målinger fra 24/8 er forældede; #4236 står i punkt 5. **#4203/#4209 udskudt.** #4190 omskrevet til navngivning + invariant.

9. **P0 + UI-gæld + Z1 er MED før fredag** (ejer 25/8). P0: #3990-rest · navne-dedup-guard · #3329 · #2791. UI-gæld: #3954 + de fem fund i `PLANNING_CENTER_RULES.md` §7. Z1: bulk-endpoint + kladde + tre linser + #4245. **P2** taktik ind i centret (#3049 #2794 #1884 #2810 #2405) — monterer motorens kort, bygger det ikke. **P3** assistenten — gated på **#4201**, og #4246 (rolle vs ordre) skal afgøres FØR `TeamOrder` fryses.

## D · Penge og vækst — gate: spor B leveret (ikke en dato)

10. **#2853** e-mail-loop (Resend-nøgle + 3 tekster) — største fastholdelses-håndtag. ⚪ **#4015** genmål efter #4013.
11. **#3104 /pro LIVE** (køb pauset): **#4074 blokerer flip** + #4005 → flip + testkøb → #2813. **#4067** SEO-site.

## E · Løbende (aldrig hovedspor)

12. 🔴 **Spiller-kommunikation, fast ugerytme (#428)** — ejer-mandat 22/8, viger aldrig. MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t. Tråd-bank **#4117**, løfte-audit **#4111**.
13. Gæld: cutover-rest (ejer poster besked 2 · Supabase-perf uge 35, #4010 cherry-pick · #3584) · done-men-åbne lukkes løbende · #3513 opsluger #2442/#2583/#2445. Ops (uge 26.-30./8): **#4014** · **#4016 halvt leveret** (PR #4253 låser hovedmappen til main) · **#3486** · #2758 · #3487 · #691 · worktree-hygiejne (300+ døde mapper, 22 aktive).
14. 🔵 **Fair play (#3131):** prisloft valgt fra → #3138 ENESTE værn. Rest: retnings- + overbetalings-signal · flag-triage · #3438 · #3139.

15. ⚪ **Forum** (SSOT: `FORUM_RULES.md`) — **#4249** + **#4250** åbne; rollen mod Discord afgøres **15/9 (#4235)**.

## F · Backlog-bølger (#3154, 576 åbne — UDSKUDT til efter fredag)

Lukkemandat: done/dubletter/opslugte lukkes frit; won't-do i bundter a 15-20. **Rest:** W7 (#3714 #3623 #3456 #3412) · W8: 53 needs-decision · #4119 · #3944/#3945.

## E2 · Race-oplevelsen (SSOT: `RACE_ENGINE_RULES.md`)

**#3855 v4: flippet er UDSKUDT** (ejer 25/8) — h2h-gaten rød (#4132), routes-gaten permanent rød (#4197). v3 er låst fallback; F6-flippet er ejer-only. **Rest:** #4246 rolle vs ordre FØR `TeamOrder` fryses · #3914 PR B LIVE-broadcast · #3856 efter S3-bevis · #3864→S4. Efter fredag: #4070 + #4071.

## Parkeret (genbesøges efter B og C)

VK bølge 2-rest · #2223 + #3513 · vækst #2822/#1369/#1140/#2824/#2823 · #2960 React 19 (sept) · #4099/#4100. **FROSSET:** #2217/#2218 · #1712 · #1941 · #450 · live-taktik/replay.

## Stående (viger aldrig)

**Balance:** #2557 hold-dominans er ENESTE åbne. **Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse.

**2027-horisont** (ikke i kø): verdenshistorik/klubmuseum · #1154 #934 #1113 #1099 #935 #2222 #26 #938 #1108 #50.
