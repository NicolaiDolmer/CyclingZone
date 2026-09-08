# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md.

## Aktiv styring

> **🎯 Next action (8/9 morgen):** prompt `docs/drafts/next-session-prompt-2026-09-08-morgen-merges-kalender.md`. **1) Merge-kort i rækkefølge** (diffs læst + billeder set natten til 8/9; ejer siger "merge" pr. PR): #5029 mobil-faner under nav (prod-bug) · #5027 patch note v7.263 · #5028 lazy-retry-vagt · #5020 Roadmap-kategori · #5018 @-tag · #5026 kategori-abonnement · #5022 billeder · #5021 chunk-fix (ejer: VENT). Efter hver migration: tjek auto-migrate-run + post-verify FØR næste. **2) Dag-1-mail dry-run** (#4964, `docs/EMAIL_LOOP_GO_LIVE_RUNBOOK.md`: 24 t dry_run → copy-go → on). **3) #4270 S4-kalender** blokeret af #4845; ejer vælger A (byg #4845, apply 14-18/9) / B (apply nu, løbsdags-træning fra S5). Grænse 27/9. **4) Spørgeskema** ligger som draft i prod (11 spørgsmål); ejer tester som admin på /survey/2026-09-features → "kør" = status open + `sendSurveyInvite.mjs --dry-run` → `--apply` + Discord-post + patch note.

> **⏳ Åbne ejer-valg:** #4860 sponsor S4-tilbud (A/B før 27/9) · #4616 EUR-nøgler · #4915 TTT · #4948 raceDay-hjælp · #4857 mandat-backfill · #2423 skew (rør ikke). Discord: patch-notes catch-up v7.256-7.263. Forum "The future of:" academy + race engine i `docs/drafts/forum-future-of-*.md`. Ejeren poster selv.

> **🔴 Åbne fund:** favorit-win-rate 62,6 % RØD (§7b). #4595 chunk 282 events/39 spillere pr. 48 t, fix i #5021. League-size-audit rød på ALLE PR'er siden 5/9: D4-F 25 hold (#4753). **#3200 DM: PR #5019 READY, CI 44 grøn, 14 billeder i scratchpad `3200/`**; merge-kort efter de 8 andre (player-facing copy skal ses). Vagter foreslået, ikke bygget (ejer: intet nyt 7/9): migrationer mod tom Postgres i CI · tone-lint (forbudte termer + æøå) · worker-skabelon. Postmortems `.claude/learnings/2026-09-07-*`.

> **✅ 7/9 aften → 8/9 nat (Fable, 20 workers):** merget #5009 webhooks kun gruppekanaler · #5010 Founder-mærke + tekst "Founder" · #5006+#5024 spørgeskema (seed 4 kolonner/3 værdier → hotfix + `lint-sql-insert-arity`) · #5008 forum-visninger/seneste svar/indlægstal · #5023 Discord-navn · #5025 kohorte-rapport. Beslutninger: 11 spørgsmål (#4943) · #4818 kun ejer opretter, alle svarer · #4819 upload 2 MB/3 pr. indlæg · DM 1:1 + blokér/anmeld/log + skriv-til-modparten · trofæ "Founding Manager" bliver. Done: #4999 #5007 #5000 #5012. NPS/roadmap-stemmer genmåles 9/9.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. Clarity ikke kilde til antal (#4963). #4952 #4953 #4982. Sentry-ops #5015-#5017. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), 12 betalende (MRR 436 kr). **S3:** 529 løb, 28/8 → 27/9, etaper hver hele time.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b (refresh `buildV4AnchorBaseline.mjs` + `renderV4AnchorTable.mjs --write`, kun `--check` er read-only, #5001); hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846) live senest 28/9; kalenderpakker #4845 FØR S4-kalender.
- **Mekanik:** merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`, aldrig HH:57-HH:03); migrationer applies af auto-migrate.yml, Claude tjekker runnet + post-verify før næste merge. Bølger: TIER WAVE, draft til `gh pr ready`, CodeRabbit CLI før ready (`%LOCALAPPDATA%\Programs\coderabbit\coderabbit.exe`, kan selv committe), push <10 min + hvert 15. min, vagt `wave-lane-watch.ps1`, frossen worker = afløser i SAMME worktree. Workers kører aldrig hele e2e; go-kort bygges på `gh pr diff` + billeder orkestratoren selv har set. Tid: `Get-Date` (Git Bash `date` = UTC).

> **🤖 Working agent:** Ingen aktiv session (Fable lukket 8/9 ca. 02:00; næste = morgen-merges + dag-1-mail + kalender).

_Historik i git-log, issue-tråde + docs/audits/._
