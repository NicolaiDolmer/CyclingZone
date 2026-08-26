# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 13/8** (#3662; spørg før omprioritering). 🔴 brand · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. ≤1.500 tok. [Visuel udgave](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3."* Alt viger for spor B undtagen det dato-bundne. **Målt:** 576 åbne issues · 232 brugere, 1 abo. **Hard regel 23/8:** ingen prod-mutation uden ejerens "GO" på netop det skridt.

## Frem til FREDAG 28/8 kl. 11 (ejer-godkendt 25/8) — alt andet viger

S3 er udskudt til fre 28/8 → søn 27/9 (#4218). Rækkefølgen er ejer-valgt:

1. 🟠 **#4236 er roden.** Kontiguitets-pakker bygget og grøn: 0 brud i alle fire divisioner, scorecard exit 0, 7167/7168. Rest: PR. **Løser også #4190.** Ejer 26/8: GT = 2 hviledage der OPTAGER løbsdagen · monument-eksklusivitet ophævet · stream+banded slettet.
2. 🔴 **#4272 shippes SAMMEN med #4236** — bånd for hvordan etaperne slutter (bjerg slutter nedad 59-70 %). Begge kræver regenerering, og den må kun køres ÉN gang. Enkeltstart 10 % i alle divisioner (m. #4220) · D1 brosten 3 % → 6 %.
3. **Holdudtagelsen:** #4200's anden halvdel (`raceRunner.js:812`). #4201 afgjort. **#4174 afgjort 26/8:** alle hold behandles ens, assistenten 1 t før — virkningsløs i D1 til #4236 er ude.
4. **Nye spillere kan lande:** #4183 + #4233 = ÉT bug (`aiTeamGenerator.js:403`). D4-A på 25 hold.
5. **Vagterne:** #4229 · #4215 · #4219 · #4123 · #4211. **#4103 afgjort:** med i #4236's regenerering.
6. **ÉN regenerering** (#4236 + #4272), dry-run-diff først. Derefter **tænd scheduler + entry-generator** — ejer-GO, sidst.

Ny gæld 26/8: **#4273** · **#4274**.

**Planning Center med (ejer 25/8):** P0 + UI-gælden + Z1-sæsonmatrixen. Design låst, se `superpowers/specs/2026-08-25-planning-center-z1-saesonmatrix-design.md`. Aksen låses først når #4236 er afgjort.

**UDSKUDT (ejer-godkendt):** v4-flip · #4203/#4209 · PC P1-P3-rest + #4070/#4071 · backlog-bølgerne.

**SSOT-disciplin (hard rule 30):** citér områdets SSOT i designet, opdatér den i samme PR. **24 regler bagud** — #4176 + #4254.

## B · Rytter-pakken (ALTOVERSKYGGENDE)

SSOT: `PROGRESSION_RULES.md`. Samling #3664; design LÅST 13/8.

6. **#3512** (arketype-prior, PR fra 17/8, rebase+verify) · **#4039** trin 7 fast-follow · **#4098** unge "done" langt fra rolleloftet (353 ryttere, ~65 pt gab) + **#4128** · **#3668 → #3512 = ét spor**.

## B2 · Værdi og løn (SSOT: `ECONOMY_RULES.md`)

- Løn-rest: ⚪ #3755 · ⚪ #3756 · 🔴 #3732 · #4001.
- **Kalibrerings-session mandag:** #3719 (+#4103 præmier pr. division) · #3720 · #3987 · løn-sats på MÅLT D1-indtægt · #3966 · gradvis aldersnedgang · #3442/#3656.

## C · Talent-kanalen (rest)

7. 🟠 **#3854 staff-rest** (per-scout kapacitet, routing, harness-rekalibrering FØR flag-flip). **#3550** flag-flip; fremtid #3970. ⚪ **#3853**.

## P · Planning Center + kalenderen (NYT spor 22/8)

SSOT: `PLANNING_CENTER_RULES.md`. Z1 v0 shippet (#4083); Z1-designet låst 25/8.

8. 🟠 **Ejer-direktiv-klyngen 21/8, rest:** **#4103** præmier pr. division m. #3719 · #4105 Toscana → S4 (#3864) · **#4109** Planlægning anti-AI-slop · #4143 kalender-glyffer. #4123-invarianterne mangler CI-gate.
8b. Kalenderen **genereret forfra 25/8** (#4218) → målinger fra 24/8 er forældede; #4236 står i punkt 5. **#4203/#4209 udskudt.**

9. **P0 + UI-gæld + Z1 er MED før fredag** (ejer 25/8). P0: #3990-rest · navne-dedup-guard · #3329 · #2791. UI-gæld: de fem fund i `PLANNING_CENTER_RULES.md` §7. Z1: bulk-endpoint + kladde + tre linser + #4245. **P2** taktik ind i centret (#3049 #2794 #1884 #2810 #2405) — monterer motorens kort, bygger det ikke. **P3** assistenten — gated på **#4201**, og #4246 (rolle vs ordre) skal afgøres FØR `TeamOrder` fryses.

## D · Penge og vækst — gate: spor B leveret (ikke en dato)

10. **#2853** e-mail-loop (Resend-nøgle + 3 tekster) — største fastholdelses-håndtag. ⚪ **#4015** genmål efter #4013.
11. **#3104 /pro LIVE** (køb pauset): **#4074 blokerer flip** + #4005 → flip + testkøb → #2813. **#4067** SEO-site.

## E · Løbende (aldrig hovedspor)

12. 🔴 **Spiller-kommunikation, fast ugerytme (#428)** — ejer-mandat 22/8, viger aldrig. MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t. Tråd-bank **#4117**, løfte-audit **#4111**.
13. Gæld: cutover-rest (besked 2 · Supabase-perf uge 35 m. #4010 · #3584) · done-men-åbne lukkes løbende · #3513 opsluger #2442/#2583/#2445. Ops: **#4016 halvt** (PR #4253 låser hovedmappen) · **#3486** · #2758 · #3487 · #691 · worktree-hygiejne (300+ døde).
14. 🔵 **Fair play (#3131):** prisloft valgt fra → #3138 ENESTE værn. Rest: retnings- + overbetalings-signal · flag-triage · #3438 · #3139.

15. ⚪ **Forum** (SSOT: `FORUM_RULES.md`) — L1 + dashboard + opbakning merged+live 25/8. Rest: #4252 · #4248 · #4255. Rolle mod Discord **15/9 (#4235)**.

## F · Backlog-bølger (#3154, 576 åbne — UDSKUDT til efter fredag)

Lukkemandat: done/dubletter/opslugte lukkes frit; won't-do i bundter a 15-20. **Rest:** W8: 53 needs-decision · #4119 · #3944/#3945.

## E2 · Race-oplevelsen (SSOT: `RACE_ENGINE_RULES.md`)

**#3855 v4: flippet er UDSKUDT** (ejer 25/8) — h2h-gaten rød (#4132), routes-gaten permanent rød (#4197). v3 er låst fallback; F6-flippet er ejer-only. **Rest:** #4246 rolle vs ordre FØR `TeamOrder` fryses · #3856 efter S3-bevis · #3864→S4. Efter fredag: #4070 + #4071.

## Parkeret (genbesøges efter B og C)

VK bølge 2-rest · #2223 + #3513 · vækst #2822/#1369/#1140/#2824/#2823 · #2960 React 19 (sept) · #4099/#4100. **FROSSET:** #2217/#2218 · #1712 · #1941 · #450 · live-taktik/replay.

## Stående (viger aldrig)

**Balance:** #2557 hold-dominans er ENESTE åbne. **Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse.

**2027-horisont** (ikke i kø): verdenshistorik/klubmuseum — issue-listen står i #1154.
