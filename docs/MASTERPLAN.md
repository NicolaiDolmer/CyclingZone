# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 13/8** (#3662; spørg før omprioritering). 🔴 brand · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. ≤1.500 tok. [Visuel udgave](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3."* Alt viger for spor B undtagen det dato-bundne. **Målt:** 576 åbne issues · 232 brugere, 1 abo. **Hard regel 23/8:** ingen prod-mutation uden ejerens "GO" på netop det skridt.

## SÆSONSTART fre 28/8 kl. 11 — holdudtagelse + planlægning (ejer-godkendt 27/8)

Fredags-blokken **leveret**: #4284 · #4285 · #4286 · #4291 merged 27/8; kalender + motorer live (NOW.md). Rapport: `docs/audits/2026-08-28-natsession-rapport.md`.

20 spillerrettede issues 24.-27/8, tre fjerdedele samme tema. Master-session, fuld kontekst + verificerede rod-årsager i prompten: [`superpowers/plans/2026-08-28-saesonstart-planlaegning-master-session-prompt.md`](superpowers/plans/2026-08-28-saesonstart-planlaegning-master-session-prompt.md).

1. **A · Holdudtagelsen (FØR kl. 11):** #4295 (klienten blokerer stadig delvis trup — strengere end serveren; kobler til #4174) · #4299 (entry uden `binding_span` + dag-rækker, begge værn blinde) · #4201 ("pull, ikke push" er ALLEREDE i koden — ratificér i SSOT + gør synlig, byg intet nyt).
2. **D · Formplanen (FØR kl. 11):** #4294 (låst "no peak" + fremstår peaket; ejer lovede fuld reset 26/8) · #4212 · #4293 · #4271.
3. **B · Overlap-læsbarhed:** #4296 (kortet viser kun startdagen) · #4259 · #4245 (`raceDays` tæller etaper) · #4165.
4. **C · Z1-sæsonmatrixen (#1146):** aksen er FRI (#4236 lukket, 0 løbsdage over flere datoer) → kolonner = 31 datoer. Bulk-endpoint · kladde + Gem plan · låsepanel · tre linser · `?view=`.

Ny gæld, **ikke** i sessionen: #4288 (GT-båndet kræver 21 etaper, S3 kører 17-18) · [#4278](https://github.com/NicolaiDolmer/CyclingZone/issues/4278) (D4 opad 41,9 % mod bånd 25-32 % — ejer-valg) · #4282/#4146 (vagt-fejl, 0 reelle brud) · #4292 · #4123 + #4215-rest.

**UDSKUDT (ejer-godkendt):** v4-flip · #4203/#4209 · PC P2-P3 + #4070/#4071 · backlog-bølgerne · #4270 · #4264/#4262/#4263/#4177/#4297 · #4265-#4269.

**SSOT-disciplin (hard rule 30):** citér områdets SSOT, opdatér den i samme PR. **24 regler bagud** — #4176 + #4254.

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
9. **P0 + UI-gæld + Z1 kører i sæsonstart-sessionen** (ejer 25/8; spor B+C ovenfor). P0: #3990-rest · navne-dedup-guard · #3329 · #2791. UI-gæld: de fem fund i `PLANNING_CENTER_RULES.md` §7. Z1: bulk-endpoint + kladde + tre linser + #4245. **P2** taktik ind i centret (#3049 #2794 #1884 #2810 #2405) — monterer motorens kort, bygger det ikke. **P3** assistenten — gated på **#4201**, og #4246 (rolle vs ordre) skal afgøres FØR `TeamOrder` fryses.

## D · Penge og vækst — gate: spor B leveret (ikke en dato)

10. **#2853** e-mail-loop (Resend-nøgle + 3 tekster) — største fastholdelses-håndtag. ⚪ **#4015** genmål efter #4013.
11. **#3104 /pro LIVE** (køb pauset): **#4074 blokerer flip** + #4005 → flip + testkøb → #2813. **#4067** SEO-site.

## E · Løbende (aldrig hovedspor)

12. 🔴 **Spiller-kommunikation, fast ugerytme (#428)** — ejer-mandat 22/8, viger aldrig. MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t. Tråd-bank **#4117**, løfte-audit **#4111**.
13. Gæld: cutover-rest (besked 2 · Supabase-perf uge 35 m. #4010 · #3584) · done-men-åbne lukkes løbende · #3513 opsluger #2442/#2583/#2445. Ops: **#4016 halvt** (PR #4253 låser hovedmappen) · **#3486** · #2758 · #3487 · #691 · worktree-hygiejne (300+ døde).
14. 🔵 **Fair play (#3131):** prisloft valgt fra → #3138 ENESTE værn. Rest: retnings- + overbetalings-signal · flag-triage · #3438 · #3139.

15. ⚪ **Forum** (SSOT: `FORUM_RULES.md`) — rest: #4252 · #4248 · #4255. Rolle mod Discord **15/9 (#4235)**.

## F · Backlog-bølger (#3154, 576 åbne — UDSKUDT til efter fredag)

Lukkemandat: done/dubletter/opslugte lukkes frit; won't-do i bundter a 15-20. **Rest:** W8: 53 needs-decision · #4119 · #3944/#3945.

## E2 · Race-oplevelsen (SSOT: `RACE_ENGINE_RULES.md`)

**#3855 v4: flippet er UDSKUDT** (ejer 25/8) — h2h-gaten rød (#4132), routes-gaten permanent rød (#4197). v3 er låst fallback; F6-flippet er ejer-only. **Rest:** #4246 rolle vs ordre FØR `TeamOrder` fryses · #3856 efter S3-bevis · #3864→S4. Efter fredag: #4070 + #4071.

## Parkeret (genbesøges efter B og C)

VK bølge 2-rest · #2223 + #3513 · vækst #2822/#1369/#1140/#2824/#2823 · #2960 React 19 (sept) · #4099/#4100. **FROSSET:** #2217/#2218 · #1712 · #1941 · #450 · live-taktik/replay.

## Stående (viger aldrig)

**Balance:** #2557 hold-dominans er ENESTE åbne. **Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse.

**2027-horisont** (ikke i kø): verdenshistorik/klubmuseum — issue-listen står i #1154.
