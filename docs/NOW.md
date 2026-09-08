# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md.

## Aktiv styring

> **🎯 Next action (9/9):** prompt `docs/drafts/next-session-prompt-2026-09-09-mail-flip-survey-resultater.md`. Ejer-rækkefølge 8/9: spørgeskema-flowet helt optimalt FØR mail afsluttes. **1) Spørgeskema (#4943):** ÅBENT siden 8/9 14:15, 241 inviteret + Discord postet; admin-resultatside `/admin/surveys/2026-09-features` LIVE (#5043 merget 16:02; Deploy verify timede ud på GitHub-status, health 200, genkørt) · tal-status (SQL `docs/SURVEY_SYSTEM.md` §5) · følg Discord-tråden. **2) Mail (#4964/#2853, når ejeren siger til):** #5045 wordmark → testmail → #5038 mail-drift (go-kort, 2 migrationer, ejer-trin: Resend-webhook + secret, Postmaster/SNDS, DMARC) → flip welcome+day1 (runbook §2; før #5038 slet dry_run-rækken `welcome:b9e5fdb9…`). Første kandidats vindue lukker 10/9 12:14. **3) Målinger:** #4595 entry-chunk roterer stadig (Sentry debug-ID, kommentar 8/9) → ejer-valg rod-årsag før #5033 · NPS #4997 + roadmap-stemmer 9/9. **4) #4270 S4-kalender** A/B, grænse 27/9.

> **⏳ Åbne ejer-valg:** #4860 sponsor S4 · #4616 EUR-nøgler · #4915 TTT · #4948 raceDay-hjælp · #4857 mandat-backfill · #5032 DM-opfølgning · #2423 skew (rør ikke) · 16 ældre "policy uden grant"-fund (hygiejne, #5042) · `bg-cz-bg` udefineret 5 steder i admin (#5044).

> **🔴 Åbne fund:** favorit-win-rate 62,6 % RØD (§7b). League-size-audit + feature-liveness røde på alle PR'er (#4753, #3069). Vagter foreslået, ikke bygget: migrationer mod tom Postgres i CI · tone-lint. Postmortem 8/9: `.claude/learnings/2026-09-08-survey-grants-missing.md` (RLS-policy uden GRANT; "Live grant-tjek" kører aldrig på PR'er; ny lint `lint-sql-policy-grants.mjs` på hver PR).

> **✅ 8/9 eftermiddag (Fable):** merget #5035 admin-preview + v3 (12 spørgsmål, 20 idéer, fog of war) · #5036 mailskabelon · #5037 v7.265 · #5039 5 min · #5040 kort øverst · #5041 mellemrum · #5042 grants+lint · #5044 sticky-linje. Tre prod-hændelser lukket (grants gem 14:33, UPDATE-grant Send 14:56, mellemrum 15:05), 4 spillere backfyldt som gennemført. Mail: nøgler i prod (ny Resend-nøgle, kun sende-ret), dry_run verificeret, testmails leveret. Lærdomme: workers stopper når de venter på baggrunds-preflight; merge-kø kræver to rene check-aflæsninger. **8/9 aften:** v7.266 patch note (velkomst+dag-1-mail) draft-PR åben, Refs #2853 #4964.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), 12 betalende (MRR 436 kr). **S3:** 529 løb, 28/8 → 27/9, etaper hver hele time.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b (refresh `buildV4AnchorBaseline.mjs` + `renderV4AnchorTable.mjs --write`, kun `--check` er read-only, #5001); hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846) live senest 28/9; kalenderpakker #4845 FØR S4-kalender.
- **Mekanik:** merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`, aldrig HH:57-HH:03; start køen først når checks har været rene i to aflæsninger); migrationer applies af auto-migrate.yml, Claude tjekker runnet + post-verify før næste merge. Bølger: TIER WAVE, draft til `gh pr ready`, CodeRabbit CLI før ready, push <10 min + hvert 15. min, vagt `wave-lane-watch.ps1`, frossen worker = afløser i SAMME worktree. Workers kører aldrig hele e2e, spawner aldrig agenter og kører preflight i FORGRUNDEN; go-kort bygges på `gh pr diff` + billeder orkestratoren selv har set. Tid: `Get-Date` (Git Bash `date` = UTC).

> **🤖 Working agent:** Ingen aktiv session (Fable lukket 8/9 ca. 16:15; næste = spørgeskema-resultater + mail-flip, prompt i docs/drafts).

_Historik i git-log, issue-tråde + docs/audits/._
