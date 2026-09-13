# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-048) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (11/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md · **Orkestrator-standard v2:** CLAUDE.md-afsnit + `.claude/workflows/wave.js` (#5142; frys på branch-aktivitet siden #5194).

## Aktiv styring

> **🎯 Next action (14/9 kl. 00:15):** **Ejer-go på to UI-PR'er fra aftenbølgen:** #5197 (#5145 akademi-gate 21: knap deaktiveret ved 22 + migration, reviewet) og #5195 (#5184 tom sæsonopsamling får "Se kalenderen"), skærmbilleder i PR-body → sig "merge". · **#4270/#4845 kalender-valg 14/9** (PR #5169 klar) · **#5157** afgør #4736 + #3512 14/9 · **#5182 designsession** (oplæg i `docs/drafts/5182-board-flaskehals-designsession.md`) · **#5136** afstemning 13 stemmer (A 12 t: 7) → flip + merge #5108 · **#5176 rest:** 3 definer-WARN (frist 18/9) + B-policy · #5155 lukkesession (18 done-gatede) · #5177 spor 2 (/roadmap LCP+CLS) ikke startet. **Merget aftenbølge 13/9 (wf_7bcd3cab, 10 spor, 0 fejl, 1 timeout på færdigt spor):** #5190 (#5146 autofyld rytter-gren) · #5192 (#5143 -OwnNodeModules) · #5191 (#5181 værdi-alder i hjælpen) · #5189 (#5177 spor 1, CLS forside 0,29→0,05) · #5193 (#5112 docs + admin_log-migration verificeret) · #5196 (#5144 4xx-status, prod-verificeret 400) · #5198 (#5177 spor 3, entry 236→55 KB gzip) · #5194 (#5178 wave.js frys på branch-aktivitet). Patch note 7.271 samlet (inkl. #5173 reload-koordination). **Venter på ejer:** #5197 · #5195 · #5182 session · #4270 · #5136 · AUTO_MERGE_PAT (#4812) · #5107 · nøgler · faktura 61,25 kr · PNG'er (#5113). S3 slutter 27/9, S4 starter 28/9.

> **🔴 Åbne fund:** Supabase **3 WARN** (#5176: 3 definer-funktioner, frist 18/9) · **#5182 board-trinnet = 72-93 % af race-finalization** → rod-årsag til #3624 · CYCLINGZONE-56 måles igen 24 t efter #5173 · webkit-flake #4925 ramte 2 PR'er 13/9 (landing-hydration + seo-public-routes, React #418) · favorit-win-rate 62,6 % RØD · 4.881 aktive ryttere `reputation = NULL` (#1099) · ca. 680 uregistrerede worktree-mapper (#4924). Backlog ~620 åbne.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), 12 betalende (MRR 436 kr). **S3:** 529 løb, 28/8 → 27/9; etaper kl. 11-19 dansk tid.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; Q-037 → #5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning kun ≤ 21 (#5145).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b; hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846) live senest 28/9; kalenderpakker #4845 FØR #4270.
- **GDD-regler (ejer 10/9):** ét område pr. kort · ÉT samlet før/efter-billede før kortet · genåbn aldrig låste beslutninger.
- **Mekanik:** byg KUN via wave.js (4 laner, semafor 2, hook; frys = commit ≥45 min + tavshed, spor 120/180 min); merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); migrationer applies af auto-migrate.yml, Claude post-verificerer; CI tavs på PR = merge-konflikt; go-kort på `gh pr diff` + billede; workers rører aldrig `docs/NOW.md`. `Get-Date` FØR hver logning.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
