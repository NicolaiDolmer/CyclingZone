# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md.

## Aktiv styring

> **🎯 Next action (8/9 eftermiddag):** prompt `docs/drafts/next-session-prompt-2026-09-08-eftermiddag-noegler-spoergeskema.md`. **1) Mail-nøgler:** ejeren lægger RESEND_API_KEY + EMAIL_UNSUB_SECRET i Infisical prod → Railway (mangler begge; kun SAT/MANGLER tjekkes via scratch-fil, aldrig værdier). Så `email_log` (runbook §3) → copy-kort → "kør" = welcome + day1 fra dry_run til on. **2) Spørgeskema (#4943):** ejer tester som admin på /survey/2026-09-features (draft) → "kør" = status open + `sendSurveyInvite.mjs --dry-run` → `--apply` + Discord-udkast + patch note v7.265. **3) Målinger:** #4595 events pr. deploy efter #5021 (baseline 3,30/2,60; lag 3 = #5033) · NPS #4997 + roadmap-stemmer 9/9 · Results D2/D3/D4 stille (#4999). **4) #4270 S4-kalender** blokeret af #4845; ejer vælger A (byg #4845, apply 14-18/9) / B (apply nu); udskudt 7/9 og 8/9; grænse 27/9.

> **⏳ Åbne ejer-valg:** #4860 sponsor S4-tilbud (før 27/9) · #4616 EUR-nøgler · #4915 TTT · #4948 raceDay-hjælp · #4857 mandat-backfill · #5032 DM-opfølgning (CASCADE ved kontosletning) · #2423 skew (rør ikke). Discord: patch-notes catch-up v7.256-7.264. Forum "The future of:" academy + race engine i `docs/drafts/forum-future-of-*.md`. Ejeren poster selv.

> **🔴 Åbne fund:** favorit-win-rate 62,6 % RØD (§7b). #4595 chunk: 37 events/18 spillere pr. 6 t før #5021; måles 24 t. League-size-audit rød på ALLE PR'er siden 5/9 (D4-F 25 hold, #4753) + feature-liveness drift (#3069, gammel migration). Vagter foreslået, ikke bygget: migrationer mod tom Postgres i CI · tone-lint (forbudte termer + æøå) · worker-skabelon (ingen fuld e2e, ingen egne agenter, afslut synkront). Postmortems `.claude/learnings/2026-09-07-*`.

> **✅ 7/9 aften → 8/9 formiddag (Fable, 25 workers):** hele forum- og beskedpakken merget: #5009 webhooks · #5010 Founder · #5006+#5024 spørgeskema-infra · #5008 forum-stat · #5023 Discord-navn · #5025 kohorte-rapport · #5029 mobil-faner · #5027 v7.263 · #5028 lazy-retry-vagt · #5020 Roadmap-kategori · #5018 @-tag · #5026 kategori-abonnement · #5022 billeder · #5019 DM · #5021 chunk-fix · #5034 v7.264 + Hjælp Forum/Beskeder. Alle migrationer post-verificeret. Done: #4999 #5007 #5000 #5012 #5014 #4818 #5011 #5013 #4819 #3200. Dag-1-mail dry_run tændt 07:52. Lærdomme: seed-aritet (hotfix + lint), Founder-Supporter-tekst, efterladt under-agent, PR'er i samme filer skal merges i rækkefølge.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. Clarity ikke kilde til antal (#4963). #4952 #4953 #4982. Sentry-ops #5015-#5017. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), 12 betalende (MRR 436 kr). **S3:** 529 løb, 28/8 → 27/9, etaper hver hele time.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b (refresh `buildV4AnchorBaseline.mjs` + `renderV4AnchorTable.mjs --write`, kun `--check` er read-only, #5001); hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846) live senest 28/9; kalenderpakker #4845 FØR S4-kalender.
- **Mekanik:** merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`, aldrig HH:57-HH:03); migrationer applies af auto-migrate.yml, Claude tjekker runnet + post-verify før næste merge; PR'er i samme filer merges i rækkefølge med fletning imellem. Bølger: TIER WAVE, draft til `gh pr ready`, CodeRabbit CLI før ready (`%LOCALAPPDATA%\Programs\coderabbit\coderabbit.exe`, kan selv committe), push <10 min + hvert 15. min, vagt `wave-lane-watch.ps1`, frossen worker = afløser i SAMME worktree. Workers kører aldrig hele e2e og spawner aldrig agenter; go-kort bygges på `gh pr diff` + billeder orkestratoren selv har set. Tid: `Get-Date` (Git Bash `date` = UTC).

> **🤖 Working agent:** Ingen aktiv session (Fable lukket 8/9 ca. 11:00; næste = mail-nøgler + spørgeskema-åbning + målinger, prompt i docs/drafts).

_Historik i git-log, issue-tråde + docs/audits/._
