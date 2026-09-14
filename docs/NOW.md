# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-048) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (14/9 aften) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md · **Orkestrator-standard v2:** CLAUDE.md-afsnit + `.claude/workflows/wave.js` (#5142/#5220).

## Aktiv styring

> **🎯 Next action (14/9 kl. 23:xx):** "Ny session 15/9 starter med træningsdesignet (#5205: før/efter-mockup + fakta-ark, ejeren udskød svaret 14/9 aften) som første kort, derefter #4633 A/B, skadesvarighed, ugeplan-rytme. Prompt: docs/drafts/session-prompt-2026-09-16.md. Venter på ejer-tekster: #5211 + #5214 (begge grøn CI). Bølge 2: #5246 · #5124 (PR #5235) · #5177 del i to (PR #5240) · #5242 PR 2 · #5249 (TTFB-måling først)." **Merget 14/9 aften (6):** #5245 CodeQL (#5230) · #5239 forside → marketing (#4067, bro; opfølgere #5249 statisk + #5250 ægte session-cookie) · #5244 "Kør ugens træning" (#5241) · #5247 win-back (#2760, flag false, 92 i segmentet; ejer-prosa + go 21-24/9) · #5252 + #5254 Deploy verify-fix (#5251, rød 21:1x-00:0x pga. #5239: to scripts hentede / anonymt; delt helper scripts/lib/fetchAppShell.mjs; flake-opfølger #5253) · #5248 apiFetch PR 1 (#5242, 57 kaldsteder; PR 2 = 214). **Beslutninger 14/9 aften:** spørgeskema lukket (34/246, fakta-ark på #5121, ejeren skriver forum-opslag) · assistent late_fill 12 t BEHOLDT (598 entries/104 managere/10 løb i første sweep, 1 selvrettelse, 0 klager; opfølger #5246) · #4067-mekanik = bro, slutmål #5249/#5250 · bud-fejlboks ved 429 beholdt bevidst. **Holdes:** #5205 træning (design-svar 15/9) · #5169 kalender · #4270 · #5236/#5237/#5238 (efter design-ja).

> **🔴 Åbne fund:** Deploy verify grøn igen 15/9 00:0x (583f58439). CYCLINGZONE-56 flad (0-3/t; mål døgn uden bølge fra 15/9 00:00), #5223/#5224 0 nye events. Railway-MCP "Unauthorized" (ejeren kører `railway login`). GSC-nøgle ikke i Infisical (trin 12 sprunget over). AGENTS.md over token-budget (Codex-only FAIL). MEMORY.md 3.050 tok (over mål 2.800, under gate).

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md); tal i [`GROWTH_STACK.md`](GROWTH_STACK.md) §12. **S3:** 529 løb, 28/8 → 27/9; etaper kl. 11-19 dansk tid.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; Q-037 → #5107; skema 14/9: 68,6 % vil have mere skjult, 25,7 % ikke).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning kun ≤ 21 (#5145, PR #5197).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b; hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846, PR #5205 bag flag `training_tick_per_race_day`, frontend urørt) live senest 28/9; kalenderpakker #4845 (PR #5169, design) FØR #4270.
- **Forside `/`:** anonym = marketing-sitet (proxy i `frontend/middleware.ts`, cookie `cz_session`), spiller = app. Enhver ændring af anonym `/` → kør `node scripts/check-cdn-cache-headers.mjs` lokalt før merge (#5251).
- **Priser (ejer 14/9):** spillere ser INKL. moms; ejerens tal (LTV/MRR/ARPU) EKSKL. moms (#5215).
- **GDD-regler (ejer 10/9):** ét område pr. kort · ÉT samlet før/efter-billede før kortet · genåbn aldrig låste beslutninger.
- **Mekanik:** byg KUN via wave.js (4 laner, semafor 2, hook; frys = commit ≥45 min + tavshed, spor 120/180 min); merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`; stopper på pending checks og på rød Deploy verify: undersøg FØR næste merge); migrationer applies af auto-migrate.yml, Claude post-verificerer; CI tavs på PR = merge-konflikt; go-kort på `gh pr diff` + billede; workers rører aldrig `docs/NOW.md`; `gh --body` aldrig med backticks, brug `--body-file`. `Get-Date` FØR hver logning.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
