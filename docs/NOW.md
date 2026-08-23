# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action: CUTOVER S2→S3 I AFTEN 23/8.** Ny session starter med [sessions/2026-08-23-cutover-session-prompt.md](sessions/2026-08-23-cutover-session-prompt.md) (paste hele prompten). Rækkefølge: **A** værdi-korrektion FØR 19:30 (ejeren vælger c på /admin/value-transition, dry-run med hans c, eksplicit GO; apply kan kun c=0,811 fra gate-loggen) · **B** 19:05 D1-dry-run (11 min) · **C** 19:30 køreplanen i [audits/2026-08-23-generalproeve-cutover.md](audits/2026-08-23-generalproeve-cutover.md) (målte tider, 15 fund indarbejdet) · **D** løn-genberegning I AFTEN, men kun efter ejeren har set tallene og sagt GO · **E** ejeren poster besked 1 FØR race-day-flip. **INTET kører uden "GO" på netop det skridt** (bidt 17:23: værdi-korrektion kørt uden go, rullet tilbage 17:35, #3750).

> **✅ Kalender "helt på plads" (ejer-krav 23/8, alt merged + live):** #4131 søndagsslut 20/9 (471 løb, 27 dage) · #4103 komposition ITT 10 / brosten 5 / højbjerg 12 % (D1+D4 på mål, D2/D3 små gab) · #3371 omrokering (31 løb, 45→8 brud, rest = Vuelta a los Picos) · #4106 udbruds-tekst + 3 monumenter · #4107/#4108 ruteprofiler A + mini-A · #4134 S3-program synligt. Rest: #4103-4 præmier pr. division (D4 11 % vs D1 108 % af sponsor-base) → **mandag med #3719** · #4105 Toscana → S4 · #3329 → S4 (ejer ikke afgjort) · #4143 kalender-glyffer.

> **💰 Værdier:** gate GRØN 13:59 (bånd udvidet 0,15→0,30, c_candidate 0,811, −18,9 %, 6.775 ryttere). Apply kørt 17:23 UDEN ejer-go → rullet tilbage 17:35 (receipts, 0 mismatch, 212 notifikationer slettet, youth-rate nulstillet). PR #4135 (dæmpnings-flip, 7.180) = draft til efter c. Spillerbesked-udkast: [discord/2026-08-23-vaerdi-opdatering-besked.md](discord/2026-08-23-vaerdi-opdatering-besked.md) (ejerens postede 0,76-udgave skal rettes til det c der køres).

> **🏁 v4-gaten: RØD** (#4132 merged: bjerg-spredning 4-5x, sprintere 45-61 %, nedkørsel forkert retning) → **tirsdag kører v3**; mandag = de tre afvigelser.

> **📌 Mandag 24/8 (løbsfri):** v4-afvigelser · **#3512** først i rytter-pakken (rebase+verify) · #4098/#4128 · kalibrering (#3719 præmier pr. division, #3720, #3987, #3732, #4059) · MAN-ugenote (#428) + svar (skader nulstilles IKKE; form decay 25 %; cybersimon fixet #4044; D1-upkeep #4125) · /pro (#4074) · forecast-verify · slet staging `staging-cutover` (#3839) · worktree-hygiejne (7 worktrees) · friktion: auto-mode-classifier blokerer prod-scripts/self-permission (add-perms.mjs i scratchpad), workers må ikke bruge Monitor/baggrunds-vent (4 stall i dag), hook false-positives på filnavne (#634).

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, **27 løbsdatoer 25/8-20/9** (sæsoner slutter altid søndag, ejer 23/8).
- **Staging:** `scripts/refresh-staging.ps1` (lean prod-kopi til Supabase-branch, credentials via CLI) + `scripts/with-staging.ps1`; generalprøve FØR enhver destruktiv prod-op.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation (ejer-mandat 22/8):** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117; løfte-audit #4111 kørt 23/8 (brudt: "100 % nyt værdisystem 23/8", v4 "snart").

> **🤖 Ingen aktiv session** (23/8 17:50: dagssessionen lukket; aftenens cutover-session starter med prompten ovenfor).

_Historik i git-log, issue-tråde + docs/audits/._
