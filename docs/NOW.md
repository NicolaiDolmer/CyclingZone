# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action: CUTOVER S2→S3 SØNDAG 23/8 19:30.** Køreplan m. MÅLTE tider + 5 kritiske rettelser: [audits/2026-08-23-generalproeve-cutover.md](audits/2026-08-23-generalproeve-cutover.md) (PR #4136). Rækkefølge: 19:05 D1-dry-run (11 min) → 19:30 #4129-nøgle → snapshot/backup → pre-flip-gate (sæsonnr. **2**) → race-day-flip → `season_end_skip_division_movement='on'` → Afslut sæson (8 min, ALDRIG blind genkørsel) → D1-komprimering apply → window-wrap (rettet SQL) → Udfør sæsonskifte (14 min) → flag 'off' → **generateSeasonEntries --execute** (mangler i drejebogen!) → løn-genberegning → mandat-backfill → achievements → slutkontrol. Ejer-go pr. skridt. Lange scripts: aldrig 2-min-terminal.

> **🗓 Kalender "helt på plads" FØR cutover (ejer-krav 23/8):** ✅ #4131 søndagsslut APPLIED 15:05 (471 løb, 27 dage, sidste løbsdag søn 20/9, GT-vagter GO; PR #4133 rettes grøn + merges) · 🟠 #3371 omrokering af S3's korte etapeløb (script `reorderShortStageRaces3371.mjs`, dry-run → ejer-go → apply) · 🟠 #4103 komposition ens i alle divisioner: **ITT 10 %, brosten 5 %, højbjerg 12 %** (ejer 16:05, script `recomposeSeason3Stages4103.mjs`; køres FØR #3371) · 🟠 #4103-4 point vs. præmier måles (rapport ~17:00, beslutning inden cutover) · 🟠 #4106 udbruds-tekst (UI-PR i dag). **Ikke valgt i dag:** #4105 Toscana-grus (mandag/#3864).

> **💰 Værdier (ejer: "rettes inden 18", men kalender FØRST):** gate GRØN 13:59 (bånd 0,30, c = **0,811**, −18,9 %, 6.771 ryttere, dry-run OK). Apply = `marketValueLevelCorrectionApply.js --confirm-apply` → merge PR #4135 (dæmpnings-flip + patch note 7.174) → løn i aften på rettede værdier (#4120 valg D). Spillerbesked: [discord/2026-08-23-vaerdi-opdatering-besked.md](discord/2026-08-23-vaerdi-opdatering-besked.md) (ejer har postet 0,76-udgaven, skal rettes til 0,81). Nattens røde måling gemt i `backup_gate_log_3449_20260823`.

> **🏁 v4-gaten: RØD** (h2h-scorecard PR #4132: bjerg-spredning 4-5x, sprintere 45-61 %, nedkørsel forkert retning) → **tirsdag kører v3**; mandag = de tre afvigelser. Ruteprofiler A + mini-A bygget (PR #4137, preview mandag, design låst på #4107/#4108).

> **👤 Ejer-klik:** ret Discord-tallet til 0,81 · svar: skader nulstilles IKKE (kun træthed→0, form decay 25 %), egomadsens forslag er allerede sådan, cybersimon fixet i #4044, D1-upkeep-tal (#4125) · #3486 VERCEL_TOKEN · `railway login`.

> **📌 Mandag 24/8 (løbsfri):** v4-afvigelser · #4107/#4108 preview+merge · #4098/#4128 rytter-pakken (353 unge "done" under loft) · #4105 · kalibrering (#3719/#3720/#3987/#3732/#4059) · MAN-ugenote (#428) · /pro (#4074) · forecast-verify · staging-branch `staging-cutover` slettes (#3839) · worktree-hygiejne · auto-mode-classifier blokerer prod-scripts + self-permission (permission-regler: scratchpad add-perms.mjs, ejer kører).

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, **27 løbsdatoer 25/8-20/9** (sæsoner slutter altid søndag, ejer 23/8).
- **Staging:** `scripts/refresh-staging.ps1` (lean prod-kopi til Supabase-branch, credentials via CLI) + `scripts/with-staging.ps1`; generalprøve FØR enhver destruktiv prod-op.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation (ejer-mandat 22/8):** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117; løfte-audit #4111 kørt 23/8 (brudt: "100 % nyt værdisystem 23/8", v4 "snart").

> **🤖 Working agent: Claude Code (Fable) hovedsession 23/8, aktiv siden 12:00** — orkestrerer cutover + kalender-workers. Ny session: STOP og spørg ejeren før pick-up.

_Historik i git-log, issue-tråde + docs/audits/._
