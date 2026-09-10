# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (GDD, D-001–D-048; branch `codex/game-design-document`, docs-PR #5090 ready) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (revideret 10/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md (repareret 10/9, #5110).

## Aktiv styring

> **🎯 Next action (10/9 kl. 16:15):** Workflow-session kører. **Merget i dag (ejer-go):** #5097, #5100 (14:43/14:50; post-verify grøn, chunk-fejl bærer nu URL, #4595 kommenteret) · #5071 (15:53) · #5110 (16:04, hard rule 26+30 repareret, #5058 lukket). **Prod-skridt (ejer-go 15:41):** omdømme-backfill 28.886 hændelser/2.960 ryttere + flag `rider_reputation_enabled` = `shadow` kl. 15:45; post-verify 16:07: etapen gav 10 nye hændelser, ingen flade læser (#1099; 7-dages audit ved hver session). **Beslutninger i dag:** D-047 mobiltabeller (tre faste kolonner + "Fuld tabel" to-lags, #5102; PR #5099 lukket) · D-048 løbsomdømme = låst klasse + prestige-tillæg · #5073: ejer valgte A (genopret varslet + gem det som kolonne) · assistent-flip `late_fill` FØRST når #4983 er live. **Byggebaner i gang (draft, go-kort med billeder før merge):** #5108 (#4983 påmindelse, review) · #5111 (#5102 DataTable-standard, byg) · #5109 (#5073 reparation, byg). **Venter på go-kort:** #5090 GDD (CI efter handoff-synk 16:16). **Ejer-trin:** post fog of war-afstemningen (`docs/drafts/forum-poll-fog-of-war-2026-09-10.md` + PNG) · skema-reminder (luk ved 40 eller 15/9) · #4346 anmeld-handel (lovet 27/8) · flyt forumkategori · nøgler (PostHog, GSC, Resend-webhook, EUR-testkøb, `AUTO_MERGE_PAT`, `SUPABASE_ACCESS_TOKEN`). S3 slutter søndag 27/9, S4 starter mandag 28/9. **Visuel identitet (ejer 10/9, epic #5113, 3D-first):** ejer kører selv Claude Design-prompten (`docs/drafts/claude-design-prompt-visual-identity-2026-09-10.md`); næste Claude-skridt = spec + plan når artboards er godkendt, første byg = #5115 livery.

> **⏳ Åbne ejer-valg:** #4270 S4-kalender (A/B) · #4860 sponsor S4 · #4616 EUR-nøgler · #4915 TTT · #4948 raceDay-hjælp · #4857 mandat-backfill · #5032 DM · #4959 pulje 13 = 25 hold (nådefrist udløber 14/9 20:48, så bliver league-check rødt igen) · #2259 78 backup-tabeller · #5088 matview-grants · #2423 skew (rør ikke) · #5042 · #5044.

> **🔴 Åbne fund:** favorit-win-rate 62,6 % RØD (§7b). Feature-liveness rød på alle PR'er (#3069). 4.878 aktive ryttere har `reputation = NULL` (ingen hændelser); PR 3 skal skrive seed-gulvet før flag `on` (#1099). **10/9-audits:** `docs/audits/2026-09-10-*`. Issue-runder 10/9: #5091–#5096 · #5101–#5107.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), 12 betalende (MRR 436 kr). **S3:** 529 løb, 28/8 → 27/9, etaper hver hele time.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; Q-037 parkeret til spillerafstemning #5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028); varslet er et LØFTE og gemmes som kolonne (ejer 10/9, #5073). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b (refresh `buildV4AnchorBaseline.mjs` + `renderV4AnchorTable.mjs --write`, kun `--check` er read-only, #5001); hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846) live senest 28/9; kalenderpakker #4845 FØR S4-kalender.
- **GDD-regler (ejer 10/9):** ét område pr. kort · ÉT samlet før/efter-billede med markeringer før kortet · "1 + tilføjelse" bevares ordret · forum-afstemning med billede når skemaet ikke dækker valget · genåbn aldrig låste beslutninger.
- **Mekanik:** merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`, køen venter selv uden for HH:57-HH:03; checks rene i to aflæsninger først); migrationer applies af auto-migrate.yml, Claude post-verificerer. Bølger: Workflow byg → reviewer → ret → go-kort på `gh pr diff` + billeder; TIER WAVE; workers rører aldrig `docs/NOW.md`, preflight i forgrunden. Tid: `Get-Date` FØR hver logning (estimater var 10 min forkerte 10/9).

> **🤖 Working agent:** Fable workflow-session, startet 10/9 kl. 15:04 (prompt i `docs/drafts/`). Anden session: STOP + spørg.

_Historik i git-log, issue-tråde + docs/audits/._
