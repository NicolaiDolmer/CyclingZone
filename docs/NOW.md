# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-048) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (ejer-godkendt bølge-rækkefølge 15/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md · **Orkestrator-standard v2:** CLAUDE.md-afsnit + `.claude/workflows/wave.js` (#5142/#5220).

## Aktiv styring

> **🎯 Next action (16/9):** Prompt: `docs/drafts/session-prompt-2026-09-16-runde2.md` (detaljer + merge-tabel dér). **Merge-kø:** #5297 → #5287 → #5281 → #5240, én ad gangen, `update-branch` mellem hver. #5297 (#5288 fighter-loftet, ejer-valg A: `aggression` ud af loft-tabellen) = 49 pass/0 fail, webkit-rerun kørte ved close-out. Ingen migration; caps genberegnes ved næste træningstick, så spillerne ser først fixet da. **#5287: ret 7.277 FØR merge** (den siger lofterne for taktik OG angrebslyst er sænket — usandt efter #5297). #5281 helt grøn men ejer-parkeret. **Derefter (ejer 15/9):** 1) sponsor #4860 (PR #5263, kort vist) · 2) løbsdage #5267 (kort afvist "rigtigt dårligt"; start forfra med ejerens ord) · 3) træningssession B4 #5264 + B3 #5281 · 4) apply-go-kort: point-flyt #5268 (EFTER #5297 er deployet) + trup-backfill #4619. **Derefter bølge 4** (kalender m. trupper; #5262 katalog merges SAMMEN med pakkeren; #5283 gate — ejer-krav: synlig generator-test FØR U23-generering). **Parkeret (ejer):** #5263 · #5169 · #5264 · #5281 · #5235 · #5262 · #5240 · #3512.

> **🔴 Åbne fund:** **Webkit-flaken #4925 er bredere end titlen** — mobile-webkit fejler på skiftende specs på tværs af urelaterede PR'er (evidens i #4925, målt 15+16/9). Rerun, ikke fix. Deploy verify tom-JSON-flake → #5286. CYCLINGZONE-5Z dobbelt sprint-kaptajn gentog sig (#5223). `zod` mangler lokalt → 3 route-tests fejler, kør `npm run sync-deps`. Beta-testere: 0 i prod. AGENTS.md/FEATURE_STATUS/MASTERPLAN over token-budget. **Discord-sweep 16/9:** 8 nye issues, #5296 (welcome-mail sender 0, to døgn) er high og urørt. **Parallel session:** #5285 (bølge #5284) har 3 ægte CI-fejl; tjek `wave-active.json` FØR spawn.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md); tal i [`GROWTH_STACK.md`](GROWTH_STACK.md) §12. **S3:** 529 løb, 28/8 → 27/9; etaper kl. 11-19 dansk tid.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; #5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning kun ≤ 21 (#5145). **Graduation Day ved 23** (live 15/9, #5279).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, samlet sweep ≥ kl. 20 + knap uden bonus, program 7×5. #5205 + B4 #5264 + B3 #5281 (begge parkeret) bag flag `training_tick_per_race_day` (off); live senest 28/9. **Løbsdage-fakta (#5267, 15/9):** D1 havde 86 løbsdage i S3, "140" = etaper (5 slots = klokkeslæt × 28); 112/140-valget er IKKE afgjort.
- **Evner (15/9, live):** taktik/aggression uden alder for nye ryttere; `teamwork`/`leadership` findes som data (motor bag flag senere); lofter 55/70. Point-flyt til eksisterende = `backend/scripts/dry-run-5268-mental-abilities.js`, ejer-gated. Fødsel uden PCM = default (#5278).
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` (loft U23 12 / junior 10) live; backfill = `backend/scripts/backfill-4619-riders-squad.js`, ejer-gated (valg A: automatisk efter alder). U23 + junior alt live 28/9; spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `node scripts/check-cdn-cache-headers.mjs` før merge (#5251). **Priser:** spillere inkl. moms; ejerens tal ekskl. (#5215).
- **Kort-regler (ejer 15/9):** ét delpunkt pr. kort · konkret eksempel med prod-tal · læs issuets seneste kommentarer FØR kortet · genåbn aldrig låste beslutninger · udskyd aldrig selv · UI-PR = skærmbillede i samme tur.
- **Mekanik:** byg KUN via wave.js; merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`, kun påkrævede checks; `gh pr update-branch` først, konflikt → worker fletter main ind); ny tabel bag flag → `FLAG_GATED_EMPTY_TABLES` i samme PR; migrationer applies af auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; `gh --body-file`, aldrig backticks.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
