# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (GDD, D-001–D-048, merget 10/9; indgang `design/gdd/CLAUDE_HANDOFF.md`) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (revideret 10/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md (repareret 10/9).

## Aktiv styring

> **🎯 Next action (10/9 kl. 20:10):** Kør prompten `docs/drafts/next-session-prompt-2026-09-10-aften.md`. **Åbent til samtalen:** PR #5108 (#4983 påmindelse før udtagelsesfrist) er klar (CI grøn på nær kendt audit) men MERGES IKKE før flip af `assistant_selection_mode` → `late_fill` er afgjort: 108 managere har helt tomme trupper inden for 24 t og ville se "Holdet stiller ikke op" falsk, så længe assistenten først fylder ved etape 1. **Merget 10/9 (ejer-go):** 7 PR'er, patch note 7.269 (detaljer i git-log); pensionsvarsel-reparation kørt (7.261 rækker), D-047 mobiltabeller live. **Prod-flag:** `rider_reputation_enabled` = shadow siden 15:45 (backfill 28.886 hændelser; 7-dages audit ved hver session, #1099). **Beslutninger:** D-047 mobiltabeller, D-048 løbsomdømme = låst klasse + prestige-tillæg, #5073 valg A. **Nye issues 10/9:** #5121 · #5122/#5123 · #5124 (audit `docs/audits/2026-09-10-mobil-stemmer.md`). **Ejer-trin:** post forumindlæg + Discord-udkast (begge i `docs/drafts/`, 10/9) · fog of war-afstemning (#5107) · #4346 anmeld-handel · flyt forumkategori · nøgler (PostHog, GSC, Resend-webhook, EUR-testkøb, `AUTO_MERGE_PAT`, `SUPABASE_ACCESS_TOKEN`). S3 slutter søndag 27/9, S4 starter mandag 28/9. **Visuel identitet (epic #5113, 3D-first):** ejer kører selv Claude Design-prompten (`docs/drafts/claude-design-prompt-visual-identity-2026-09-10.md`); derefter spec + plan, første byg #5115.

> **🌅 Triage 11/9:** PR #5132 klar til go (Sentry-alarmer viste `[Object]`; CodeRabbit-fund rettet). #5133 nyt: 1 akademirytter fik aldrig sit graduerings-valg, står stille til 28/9 — reparation ejer-gated. **Til dig:** ubetalt faktura 61,25 kr ~33 dage over forfald (gaten holder). Chunk-fejl #4595 oppe på 52 spillere/1356 events (fix = #5033).

> **⏳ Åbne ejer-valg:** late_fill-flip (D-034, næste session) · #4270 S4-kalender (A/B) · #4860 sponsor S4 · #4616 EUR-nøgler · #4915 TTT · #4948 raceDay-hjælp · #4857 mandat-backfill · #5032 DM · #4959 pulje 13 = 25 hold (nådefrist udløber 14/9 20:48) · #2259 78 backup-tabeller · #5088 matview-grants · #2423 · #5042 · #5044.

> **🔴 Åbne fund:** favorit-win-rate 62,6 % RØD (§7b). Feature-liveness rød på alle PR'er (#3069). 4.878 aktive ryttere har `reputation = NULL`; PR 3 skal skrive seed-gulvet før flag `on` (#1099). Docs-oprydning + Hjælp-afsnit om mobiltabeller + admin_log-constraint: #5112. Handles vs. anonymisering i audits: ejeren vælger én konvention.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), 12 betalende (MRR 436 kr). **S3:** 529 løb, 28/8 → 27/9, etaper hver hele time.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; Q-037 parkeret til spillerafstemning #5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028); varslet er et LØFTE gemt på rytteren (`retirement_notice_*`, 10/9). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b (`buildV4AnchorBaseline.mjs` + `renderV4AnchorTable.mjs --write`, #5001); hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846) live senest 28/9; kalenderpakker #4845 FØR S4-kalender.
- **GDD-regler (ejer 10/9):** ét område pr. kort · ÉT samlet før/efter-billede med markeringer før kortet · "1 + tilføjelse" bevares ordret · genåbn aldrig låste beslutninger.
- **Mekanik:** merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`, venter selv uden for HH:57-HH:03); migrationer applies af auto-migrate.yml, Claude post-verificerer. CI tavs på en PR = merge-konflikt (`mergeStateStatus` DIRTY); merge main ind i åbne baner efter hvert docs-merge. Bølger: Workflow byg → reviewer → ret → go-kort på `gh pr diff` + billeder; små opfølgninger som Agent i SAMME worktree; workers rører aldrig `docs/NOW.md`. Tid: `Get-Date` FØR hver logning.

> **🤖 Working agent:** Claude Code (Fable) siden 11/9 08:50: merge-kø, late_fill-kort, #5121, brand-bølge, dependency-majors, #4845.

_Historik i git-log, issue-tråde + docs/audits/._
