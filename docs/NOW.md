# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-048) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (11/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md · **Orkestrator-standard v2:** CLAUDE.md-afsnit + `.claude/workflows/wave.js` (#5142).

## Aktiv styring

> **🎯 Next action (13/9 kl. 19:50):** **#5176 trin 2** (revoke-SQL fra `database/proposals/` til auto-migrate-mappen i egen PR, efter verifikation af ældre klienters overgang; post-verify grants + advisor, mål 7→3 WARN; frist 18/9). **#5182 designsession** (board-flaskehals = rod-årsag til #3624; oplæg i `docs/drafts/5182-board-flaskehals-designsession.md`; to beslutninger: A grøn? pr. løb eller pr. løbsdag?). Så **#4270/#4845** (PR #5169 klar; ejer valgte 13/9 at tage overlap-gulv vs. §1d **14/9**) · **#5136** afstemning 13 stemmer (A 12 t: 7, D frist: 4, E aldrig: 2) → flip + #5108 (2 CodeRabbit-major rettes først) · **#5157** #4736 + #3512 afgøres 14/9 (ejer 13/9; anbefaling: luk, branches bevares). Epic #5162 close-out: patch note 7.271 samlet + help-FAQ + 24 t-måling. **Merget 13/9:** #5173 (#5159 spor 1, cf374c9b; #5139 lukket) · #5183 (#5176 trin 1, 22fc2ea7) · **#5185 hotfix** (d70e23fc: seasons.id er ikke RFC-UUID, z.uuid() gav 400 på alle sæson-kald i ~45 min; postmortem i learnings; opfølgning #5186 klienten sluger 4xx stille) · #5175 (#5155 script + ugentlig dry-run, 83fc0504; lukkesession for 18 done-gatede udestår). Bølge 3-kø: #5178 → #5177 → #5151 → #5158 → #4846. **Venter på ejer:** #5182 session · #4270 senest 14/9 · #5136 · AUTO_MERGE_PAT (#4812) · #5107 · nøgler · faktura 61,25 kr · PNG'er (#5113). S3 slutter 27/9, S4 starter 28/9.

> **🔴 Åbne fund:** Supabase 7 WARN (#5176, frist 18/9; trin 1 merget 13/9, revoke udestår) · **#5182 board-trinnet = 72-93 % af race-finalization (6.360 sekv. DB-kald) → rod-årsag til #3624 forsinkede løb; tick med 5 etaper tog 36 min** · CYCLINGZONE-56 målt 13/9: 4 ev./24t (25 den 12/9, 143 den 11/9); mål igen 24 t efter #5173-deploy · favorit-win-rate 62,6 % RØD · 4.881 aktive ryttere `reputation = NULL` (#1099, shadow) · wave.js stopper levende spor på 60 min (#5178) · ca. 680 uregistrerede worktree-mapper (#4924). Backlog 626 åbne.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), 12 betalende (MRR 436 kr). **S3:** 529 løb, 28/8 → 27/9; etaper kl. 11-19 dansk tid.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; Q-037 → #5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b; hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846) live senest 28/9; kalenderpakker #4845 FØR #4270.
- **GDD-regler (ejer 10/9):** ét område pr. kort · ÉT samlet før/efter-billede før kortet · genåbn aldrig låste beslutninger.
- **Mekanik:** byg KUN via wave.js (4 laner, semafor 2, hook); merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); migrationer applies af auto-migrate.yml, Claude post-verificerer; CI tavs på PR = merge-konflikt; go-kort på `gh pr diff` + billede; workers rører aldrig `docs/NOW.md`. `Get-Date` FØR hver logning.

> **🤖 Working agent:** Claude Code (Fable) 13/9 fra 20:45 — bølge wf_f9f3797b: #5176 trin 2 · #5186 · #5108-klargøring.

_Historik i git-log, issue-tråde + docs/audits/._
