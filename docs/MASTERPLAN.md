# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 13/8** (#3662; spørg før omprioritering). 🔴 brand · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. ≤1.500 tok. [Visuel udgave](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3."* Gjaldt FØR S3 startede — **afløst i S3-vinduet af rammen nedenfor** (ejer 28/8); genoptages efter 27/9. **Målt 28/8:** 616 åbne issues · 232 brugere, 1 abo. **Hard regel 23/8:** ingen prod-mutation uden ejerens "GO" på netop det skridt.

## S3 KØRER 28/8 → 27/9 — rammen (ejer-beslutning 28/8)

**Ejeren valgte: "Gør den kørende sæson god."** Fortrinsret: fejl der rammer spillere nu · #428-rytmen (viger aldrig) · en motor der kører rent.

**Grundreglerne (spor B, B2, C) er udskudt til efter 27/9.** Lander de midt i en sæson, planlægger spillerne efter ét regelsæt og måles efter et andet. Mandatet 13/8 gjaldt FØR start; S3 kører med den bestand den har. **Undtagelse:** en grundregel må rettes hvis den er en ren FEJL der rammer spillere nu (#4098) — ikke hvis den er en forbedring.

## Kø i S3-vinduet (ejer-godkendt 27/8, trimmet 28/8)

0. **FØRST (ejer 28/8): #2758** Discord-triage → issues (dagligt) + **#4269** daglig Supabase-kontrol. Køen herunder skal fyldes af det spillerne møder og det basen melder — ikke af AI-vurdering. Begge er ejer-direktiver (20/7 og 25/8).
1. **#4317** ContextBand-aksen (4 forkerte tal, kilder i issuet) · **#4259** byg FORFRA, se refutations-kommentaren · **#4355** juni-fyldkuldets taktik-læk.
2. **#4098** unge markeret færdige 65 pt under loftet — ejeren spørges igen senest 31/8.
3. **Spor C, Z1 (#1146):** `needs-contract`, kontrakten først. **Z1-aksen er ikke fri:** op til 5 løbsdage deler dato i D1, så 31 dato- og 86 løbsdags-kolonner er to akser. Klikbar akse = åbent ejer-valg.
4. **#4176** kalender-SSOT — ejer-frist senest 4/9 OG før S4-kalenderen. Med #4254 (24 regler bagud, hard rule 30).

**Ejer-beslutninger 27-28/8 (genåbn dem ikke):** løbsdage **1-baseret** · afmeldt hold stiller **ikke** op · "løbsdag" = bindings-enheden, sponsor betaler pr. etape · **minimum 6, fladt** (42 starter) · **to regenereringer er forbudt**.

Ny gæld: #4288 · **#4278** (D4 opad 41,9 % mod bånd 25-32 %) · #4282/#4146 · #4292 · #4123 + #4215-rest · **#4370** (React #421 på forsiden).
**UDSKUDT:** v4-flip · #4203/#4209 · PC P2-P3 + #4070/#4071 · backlog-bølger · #4270 · #4264/#4262/#4263/#4177/#4297 · #4265-#4269.

## Grundreglerne — UDSKUDT til efter 27/9 (ejer 28/8)

- **B · Rytter-pakken** (`PROGRESSION_RULES.md`, låst 13/8, samling #3664): #3512 · #4039 · #4098 + #4128 · #3668.
- **B2 · Værdi og løn** (`ECONOMY_RULES.md`): #3755 · #3756 · #3732 · #4001 · #3719 (+#4103) · #3720 · #3987 · #3966 · #3442/#3656.
- **C · Talent-kanalen:** #3854 (harness-rekalibrering FØR flag-flip) · #3550 flag-flip · #3853 · #3970.

## P · Planning Center + kalenderen (NYT spor 22/8)

SSOT: `PLANNING_CENTER_RULES.md`. Z1 v0 shippet (#4083); Z1-designet låst 25/8.

8. 🟠 **Ejer-direktiv-klyngen 21/8, rest:** **#4103** præmier pr. division m. #3719 · #4105 Toscana → S4 (#3864) · **#4109** Planlægning anti-AI-slop · #4143 kalender-glyffer. #4123-invarianterne mangler CI-gate.
9. **P0 + UI-gæld + Z1 kører i sæsonstart-sessionen** (ejer 25/8; spor B+C ovenfor). P0: #3990-rest · navne-dedup-guard · #3329 · #2791. UI-gæld: de fem fund i `PLANNING_CENTER_RULES.md` §7. Z1: bulk-endpoint + kladde + tre linser + #4245. **P2** taktik ind i centret (#3049 #2794 #1884 #2810 #2405) — monterer motorens kort, bygger det ikke. **P3** assistenten — gated på **#4201**, og #4246 (rolle vs ordre) skal afgøres FØR `TeamOrder` fryses.

## D · Penge og vækst — gate: spor B leveret (ikke en dato)

10. **#2853** e-mail-loop (Resend-nøgle + 3 tekster) — største fastholdelses-håndtag. ⚪ **#4015** genmål efter #4013.
11. **#3104 /pro LIVE** (køb pauset): **#4074 blokerer flip** + #4005 → flip + testkøb → #2813. **#4067** SEO-site.

## E · Løbende (aldrig hovedspor)

12. 🔴 **Spiller-kommunikation, fast ugerytme (#428)** — ejer-mandat 22/8, viger aldrig. MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t. Tråd-bank **#4117**, løfte-audit **#4111**.
13. Gæld: cutover-rest (besked 2 · Supabase-perf uge 35 m. #4010 · #3584) · done-men-åbne lukkes løbende · #3513 opsluger #2442/#2583/#2445. Ops: **#4016 halvt** (PR #4253 låser hovedmappen) · **#3486** · #2758 · #3487 · #691 · worktree-hygiejne (300+ døde).
14. 🔵 **Fair play (#3131):** prisloft valgt fra → #3138 ENESTE værn. Rest: retnings- + overbetalings-signal · flag-triage · #3438 · #3139.

15. ⚪ **Forum** (SSOT: `FORUM_RULES.md`) — rest: #4252 · #4248 · #4255. Rolle mod Discord **15/9 (#4235)**.

16. ⚪ **Typelaget (efter fredag):** PR **#4334** + kæden #4326-#4333 (kontekst i #4325).

## F · Backlog-bølger (#3154, 576 åbne — UDSKUDT til efter fredag)

Lukkemandat: done/dubletter/opslugte lukkes frit; won't-do i bundter a 15-20. **Rest:** W8: 53 needs-decision · #4119 · #3944/#3945.

## E2 · Race-oplevelsen (SSOT: `RACE_ENGINE_RULES.md`)

**#3855 v4: flippet er UDSKUDT** (ejer 25/8) — h2h-gaten rød (#4132), routes-gaten permanent rød (#4197). v3 er låst fallback; F6-flippet er ejer-only. **Rest:** #4246 rolle vs ordre FØR `TeamOrder` fryses · #3856 efter S3-bevis · #3864→S4. Efter fredag: #4070 + #4071.

## Parkeret (genbesøges efter B og C)

VK bølge 2-rest · #2223 + #3513 · vækst #2822/#1369/#1140/#2824/#2823 · #2960 React 19 (sept) · #4099/#4100. **FROSSET:** #2217/#2218 · #1712 · #1941 · #450 · live-taktik/replay.

## Stående (viger aldrig)

**Balance:** #2557 hold-dominans er ENESTE åbne. **Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse.

**2027-horisont** (ikke i kø): verdenshistorik/klubmuseum — issue-listen står i #1154.
