# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-048) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (14/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md · **Orkestrator-standard v2:** CLAUDE.md-afsnit + `.claude/workflows/wave.js` (#5142; forbedringer fra 14/9 i #5220).

## Aktiv styring

> **🎯 Next action (14/9 kl. 19:xx):** "Ny session 15/9 starter med spørgeskemaets fakta-ark (#5121) + måling af assistent-flippet (#5136). Prompt: docs/drafts/session-prompt-2026-09-15.md. Venter på ejer-tekster: #5211 + #5214. Bølge 1 15/9: #5230 CodeQL, #5241 trin 2, #2760 win-back, #4067 tre rettelser (PR #5239), #5242 apiFetch-wiring; derefter resterne #5124 (PR #5235) + #5177 (PR #5240, del i to)." **Merget 14/9 (11):** #5206 #5216 #5217 #5108 #5231 #5232 #5228 #5229 #5234 #5233 (+ #5221 docs). Assistent late_fill/12 t flippet 14:41 (364 pladser / 62 hold / 5 løb ved 15:35). **Beslutninger 14/9:** #5197 parkeret til U23/junior · #4235 lukket (forum = beslutninger, Discord = snak, måling 14/10 #5227) · #5121: #5205 frem, mobil ind, #5107 på hold · #4633: formtræning = (b) session med egen form-effekt · træningspas valgt: #5236 #5237 #5238 (efter #5205-design) · win-back #2760 + trin 2 #5241 i næste bølge. **Holdes:** #5205 træning (design først) · #5169 kalender · #4270.

> **🔴 Åbne fund:** CYCLINGZONE-56 26 events/24 t (flad), #5223/#5224 lav. AGENTS.md over token-budget (Codex-only FAIL, 108 linjer) = opfølger. MEMORY.md 3.050 tok (over mål 2.800, under gate).

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md); tal i [`GROWTH_STACK.md`](GROWTH_STACK.md) §12. **S3:** 529 løb, 28/8 → 27/9; etaper kl. 11-19 dansk tid.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; Q-037 → #5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning kun ≤ 21 (#5145, PR #5197).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b; hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846, PR #5205 bag flag) live senest 28/9; kalenderpakker #4845 (PR #5169, design) FØR #4270.
- **Priser (ejer 14/9):** spillere ser INKL. moms; ejerens tal (LTV/MRR/ARPU) EKSKL. moms (#5215).
- **GDD-regler (ejer 10/9):** ét område pr. kort · ÉT samlet før/efter-billede før kortet · genåbn aldrig låste beslutninger.
- **Mekanik:** byg KUN via wave.js (4 laner, semafor 2, hook; frys = commit ≥45 min + tavshed, spor 120/180 min); merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); migrationer applies af auto-migrate.yml, Claude post-verificerer; CI tavs på PR = merge-konflikt; go-kort på `gh pr diff` + billede; workers rører aldrig `docs/NOW.md`. Preview-screenshots: dev-server UDEN `VITE_PREVIEW_MOCK` når Playwright-routes skal styre data. `Get-Date` FØR hver logning.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
