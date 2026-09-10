# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (GDD, D-001–D-048, merget 10/9; indgang `design/gdd/CLAUDE_HANDOFF.md`) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (revideret 10/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md (repareret 10/9).

## Aktiv styring

> **🎯 Next action (10/9 kl. 19:30):** Kør prompten `docs/drafts/next-session-prompt-2026-09-10-aften.md` (ejer: "tale om dette i aften og afslutte det"). **Åbent til samtalen:** PR #5108 (#4983 påmindelse før udtagelsesfrist) er klar (CI grøn på nær kendt audit) men MERGES IKKE før flip af `assistant_selection_mode` → `late_fill` er afgjort: 108 managere har helt tomme trupper inden for 24 t og ville se "Holdet stiller ikke op" falsk, så længe assistenten først fylder ved etape 1. **Merget 10/9 (ejer-go):** #5097, #5100, #5071, #5110 (hard rule 26+30), #5090 (GDD), #5109 (pensionsvarsel gemt som kolonne; reparation KØRT 19:2x, 7.261 rækker, 58 ryttere fik svaret fra før 7/9 tilbage, #5073 lukket), #5111 (D-047 mobiltabeller live 19:07, ejeren har IKKE set preview, "ser til det når det er live"). Patch note 7.269. **Prod-flag:** `rider_reputation_enabled` = shadow siden 15:45 (backfill 28.886 hændelser; 7-dages audit ved hver session, #1099). **Beslutninger:** D-047 mobiltabeller, D-048 løbsomdømme = låst klasse + prestige-tillæg, #5073 valg A. **Ejer-trin:** post Discord-udkastet om pensionsvarslet (`docs/drafts/discord-5073-retirement-notice-2026-09-10.md`) · fog of war-afstemning (#5107) · spørgeskema: 28 gennemført/9 begyndt/218 ikke svaret, ingen lukkedato (forslag: 14/9 + indbakke-skub, udkast kommer) · #4346 anmeld-handel · flyt forumkategori · nøgler (PostHog, GSC, Resend-webhook, EUR-testkøb, `AUTO_MERGE_PAT`, `SUPABASE_ACCESS_TOKEN`). S3 slutter søndag 27/9, S4 starter mandag 28/9. **Visuel identitet (ejer 10/9, epic #5113, 3D-first):** ejer kører selv Claude Design-prompten (`docs/drafts/claude-design-prompt-visual-identity-2026-09-10.md`); næste Claude-skridt = spec + plan når artboards er godkendt, første byg = #5115 livery.

> **⏳ Åbne ejer-valg:** late_fill-flip (D-034, i aften) · #4270 S4-kalender (A/B) · #4860 sponsor S4 · #4616 EUR-nøgler · #4915 TTT · #4948 raceDay-hjælp · #4857 mandat-backfill · #5032 DM · #4959 pulje 13 = 25 hold (nådefrist udløber 14/9 20:48) · #2259 78 backup-tabeller · #5088 matview-grants · #2423 skew (rør ikke) · #5042 · #5044.

> **🔴 Åbne fund:** favorit-win-rate 62,6 % RØD (§7b). Feature-liveness rød på alle PR'er (#3069). 4.878 aktive ryttere har `reputation = NULL`; PR 3 skal skrive seed-gulvet før flag `on` (#1099). Docs-oprydning + Hjælp-afsnit om mobiltabeller + admin_log-constraint: #5112. Mobiltabel-standarden dækker ikke Auktioner, Transferlisten, Daglig træning, sæsonmatricen (egne tabeller, eget issue mangler).

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), 12 betalende (MRR 436 kr). **S3:** 529 løb, 28/8 → 27/9, etaper hver hele time.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; Q-037 parkeret til spillerafstemning #5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028); varslet er et LØFTE gemt på rytteren (`retirement_notice_*`, 10/9). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b (refresh `buildV4AnchorBaseline.mjs` + `renderV4AnchorTable.mjs --write`, kun `--check` er read-only, #5001); hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846) live senest 28/9; kalenderpakker #4845 FØR S4-kalender.
- **GDD-regler (ejer 10/9):** ét område pr. kort · ÉT samlet før/efter-billede med markeringer før kortet · "1 + tilføjelse" bevares ordret · genåbn aldrig låste beslutninger.
- **Mekanik:** merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`, venter selv uden for HH:57-HH:03); migrationer applies af auto-migrate.yml, Claude post-verificerer. CI tavs på en PR = merge-konflikt (`mergeStateStatus` DIRTY); merge main ind i åbne baner efter hvert docs-merge. Bølger: Workflow byg → reviewer → ret → go-kort på `gh pr diff` + billeder; små opfølgninger som Agent i SAMME worktree; workers rører aldrig `docs/NOW.md`. Tid: `Get-Date` FØR hver logning.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
