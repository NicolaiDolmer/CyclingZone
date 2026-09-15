# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-048) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (15/9 formiddag) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md · **Orkestrator-standard v2:** CLAUDE.md-afsnit + `.claude/workflows/wave.js` (#5142/#5220).

## Aktiv styring

> **🎯 Next action (15/9 kl. 09:3x):** "Ny session 16/9 starter med post-verify af #5258 (main grøn + migration #4846: schema_migrations-række, 2 indexe, `rider_ability_race_day_history`, flag off), derefter bølge 1 = træningens byggeplan efter ejer-beslutningerne 15/9 (`TRAINING_RULES.md` §13.3): #5169 → 140 løbsdage · B4 samlet sweep ≥ kl. 20 + knap uden bonus · skader i løbsdage · program pr. løbsdag (35 celler, mockup først) · #4620 U23 ind i Bane 1 (første kort: hvad viger?). Prompt: docs/drafts/session-prompt-2026-09-16.md." **Merget 15/9 (3):** #5205 træning-fundament bag flag (#4846) · #5214 anmeld handel (#4346, patch note 7.275) · #5258 CI-fix (migration `name[]`-cast + apiFetch i ReportTradeDialog; main var rød 09:04-09:3x). **Beslutninger 15/9 (8 kort, #4850):** løbsdag = tick · **140 løbsdage**, løb pr. division urørt · samlet sweep tidligst kl. 20 + frivillig knap uden bonus · **U23 (#4620) bygges med i S4-cutover** · skader i løbsdage · program pr. løbsdag (7×5) · formtræning (b) stod fast fra 14/9. **Audit 15/9:** 21 lukket (642 → 628), #3463 done-gated, #5145 todo, K-cache +7. **PR-gennemgang:** #4736 lukket (siden bygges i B6) · #3512 → egen designsession · #5235 overlap i skærmbilleder → fix-spor · #5240 splittes · #5211 CodeRabbit + registry. **Nye issues:** #5257 global handelsliste · #5259 beta-adgang (opt-in, høj prio). **Holdes:** #5236/#5237/#5238 (efter ejer-ja) · #5169 (rettes til 140 først).

> **🔴 Åbne fund:** main var rød 15/9 09:04-09:3x (fetch-wiring-ratchet mod forældet PR-base + migration-fejl); postmortem `.claude/learnings/2026-09-15-ratchet-stale-base-og-migration-name-array.md`, forward-guards foreslået (merge-kø kræver opdateret base; migrationer mod ægte Postgres i CI). CYCLINGZONE-56 måles på døgn uden bølge. Railway-MCP "Unauthorized" (ejeren kører `railway login`). GSC-nøgle ikke i Infisical. AGENTS.md over token-budget (Codex-only FAIL). MEMORY.md ~3.050 tok (over mål, under gate).

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md); tal i [`GROWTH_STACK.md`](GROWTH_STACK.md) §12. **S3:** 529 løb, 28/8 → 27/9; etaper kl. 11-19 dansk tid.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; Q-037 → #5107; skema 14/9: 68,6 % vil have mere skjult, 25,7 % ikke).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning kun ≤ 21 (#5145, PR #5197 lukket, branch bevaret).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b; hale-gate `v4TailSpread.js --gate`.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, **140 løbsdage/sæson** i alle divisioner, samlet sweep ≥ kl. 20 + knap uden bonus, skader i løbsdage, program 7×5. Fundament #5205 merget bag flag `training_tick_per_race_day` (off); live senest 28/9. Kalenderpakker #4845 (PR #5169 → 140) FØR #4270. U23-kalender #4620 i Bane 1.
- **Forside `/`:** anonym = marketing-sitet (proxy i `frontend/middleware.ts`, cookie `cz_session`), spiller = app. Enhver ændring af anonym `/` → kør `node scripts/check-cdn-cache-headers.mjs` lokalt før merge (#5251).
- **Priser (ejer 14/9):** spillere ser INKL. moms; ejerens tal (LTV/MRR/ARPU) EKSKL. moms (#5215).
- **Kort-regler (ejer 10/9 + 15/9):** ét område pr. kort · ÉT DELPUNKT pr. kort · ÉT samlet før/efter-billede før kortet · læs issuets seneste kommentarer FØR kortet · genåbn aldrig låste beslutninger.
- **Mekanik:** byg KUN via wave.js (4 laner, semafor 2, hook; frys = commit ≥45 min + tavshed, spor 120/180 min); merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`; stopper på pending checks og på rød Deploy verify: undersøg FØR næste merge; **branch bag main → `gh pr update-branch` + ny CI før merge**); migrationer applies af auto-migrate.yml, Claude post-verificerer STRAKS; CI tavs på PR = merge-konflikt; go-kort på `gh pr diff` + billede; workers rører aldrig `docs/NOW.md`; `gh --body` aldrig med backticks, brug `--body-file`. `Get-Date` FØR hver logning.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
