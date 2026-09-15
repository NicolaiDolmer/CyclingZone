# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-048) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (ejer-godkendt bølge-rækkefølge 15/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md · **Orkestrator-standard v2:** CLAUDE.md-afsnit + `.claude/workflows/wave.js` (#5142/#5220).

## Aktiv styring

> **🎯 Next action (15/9 kl. 15:4x):** Prompt: `docs/drafts/session-prompt-2026-09-16.md`. Først post-verify merges 15/9 (#5261 score bag flag `training_score_visible` = **beta** · #5265 tre hårde sessioner · #5211 Discord-velkomst · #5277 patch note 7.276). Derefter to parkerede beslutninger ét kort ad gangen, forklaret med et konkret hold: **sponsor** (#4860, PR #5263 klar) og **løbsdage 112/140** (#5267, PR #5169 klar); **B4** (#4847, PR #5264 klar) i træningssession 16/9. Så bølge 3 (rytter-fundament: #5268 evne-migration · #5269 fødsel uden PCM · #4619 trup-datamodel) → bølge 4 (kalender m. trupper; #5262 katalog merges SAMMEN med pakkeren). **Merget 15/9 (8):** #5205 · #5214 · #5258 · #5261 · #5265 · #5211 · #5277 · #5276 (e2e-flake #5242 rettet; #5235 har fået main ind). **Parkeret (ejer):** #5263 · #5169 · #5264 · #5235 (mobil: egen designsession, D-047 revurderes, #5124) · #5262 · #5260 (docs). **Specs 15/9:** Holdarbejde/Lederskab (9 kort) · U23/junior (6 + 2 kort) · #3668 = E (egne evner, ingen PCM, ingen rytter mister masse). **Udkast (ejeren poster selv):** `docs/drafts/roadbook-plan-2026-09-15.md` · `patch-notes-audit-2026-09-15.md` (Discord-post). Nye issues 15/9: #5266-#5275.

> **🔴 Åbne fund:** Kendt webkit-flake `landing-hydration.spec` (#4925) faldt igen 15/9, grøn ved rerun. Beta-testere: 0 i prod, så score i beta = kun admin indtil ejeren udpeger holdnavne. CYCLINGZONE-56 chunk-fejl fortsat. Railway-MCP "Unauthorized". AGENTS.md + FEATURE_STATUS.md over token-budget.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md); tal i [`GROWTH_STACK.md`](GROWTH_STACK.md) §12. **S3:** 529 løb, 28/8 → 27/9; etaper kl. 11-19 dansk tid.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; #5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning kun ≤ 21 (#5145).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, samlet sweep ≥ kl. 20 + knap uden bonus, skader i løbsdage, program 7×5. #5205 + B4 #5264 (parkeret) bag flag `training_tick_per_race_day` (off); live senest 28/9. Løbsdage pr. sæson 140 vs 112 afgøres i #5267.
- **Evner (ejer 15/9):** taktik/aggression = egne evner uden alder/PCM; ingen rytter mister masse; ÉN migration (#5268) FØR U23-ryttere fødes (#5269). Holdarbejde/Lederskab: spec `2026-09-15-holdarbejde-og-lederskab-evner-design.md`.
- **Trupper (ejer 15/9):** U23 + junior alt live 28/9; spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`; Graduation Day ugen før skiftet.
- **Forside `/`:** anonym = marketing-sitet; ændring → `node scripts/check-cdn-cache-headers.mjs` før merge (#5251). **Priser:** spillere inkl. moms; ejerens tal ekskl. (#5215).
- **Kort-regler (ejer 15/9):** ét delpunkt pr. kort · konkret eksempel med prod-tal · læs issuets seneste kommentarer FØR kortet · genåbn aldrig låste beslutninger · udskyd aldrig selv.
- **Mekanik:** byg KUN via wave.js; merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`, kun påkrævede checks; `gh pr update-branch` først); ny tabel bag flag → `FLAG_GATED_EMPTY_TABLES` i samme PR; migrationer applies af auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; `gh --body-file`, aldrig backticks.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
