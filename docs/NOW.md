# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (GDD, D-001–D-046; branch `codex/game-design-document`, docs-PR #5090 draft) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (revideret 10/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md (#5058: listen er korrupt).

## Aktiv styring

> **🎯 Next action (10/9 kl. 14:45):** Kør prompten `docs/drafts/next-session-prompt-2026-09-10-design-og-eksekvering.md` (ejer 10/9: kort design, derefter eksekvering til kunderne). **1) Merget 10/9 (ejer-go):** #5097 chunk-fejlens rod-årsag (14:43) og #5100 rytterkortets kald halveret (14:50); Deploy verify grøn. Post-verify 15:05: Sentry 0 events efter fix-release (2 gamle på 936714a); Railway 0×429 siden 12:04 UTC. Ingen patch note: intet spillervendt ændrer sig; #5089 forbliver åben. **#5099 mobil IKKE merget** (ejer: sticky-lapper er ikke standarden); ny mobil-tabelstandard = #5102 (design, næste session). **2) Docs:** #5071 (rebaset uden NOW.md, klar) · #5090 GDD (preflight grøn; META_DOCS_INDEX-linje + hard rule 30 #5058 før merge). **3) Design (kort):** personale-/løbsomdømme (`REPUTATION_RESEARCH.md` §4), popularitet → omdømme (D-042 forudsætning). **4) Derefter:** #4983 påmindelse før udtagelsesfrist (D-034) · #5073 pensionsvarsel rod-årsag · #4872 holder fixet? · bane 1 (#4845 → #4270, #4850-pakken). **Ejer-trin:** post fog of war-afstemningen (`docs/drafts/forum-poll-fog-of-war-2026-09-10.md` + PNG) · skema-reminder (luk ved 40 eller 15/9) · #4346 anmeld-handel (lovet 27/8) · flyt forumkategori ("senest 10/9") · nøgler (PostHog, GSC, Resend-webhook, EUR-testkøb, `AUTO_MERGE_PAT`, `SUPABASE_ACCESS_TOKEN`). S3 slutter søndag 27/9, S4 starter mandag 28/9.

> **⏳ Åbne ejer-valg:** #4270 S4-kalender (A/B) · #4860 sponsor S4 · #4616 EUR-nøgler · #4915 TTT · #4948 raceDay-hjælp · #4857 mandat-backfill · #5032 DM · #5073 pension rod-årsag · #4959 pulje 13 = 25 hold · assistent-flip `late_fill` (D-034, prod-skridt) · #2259 78 backup-tabeller (48 MB, flyt) · #5088 matview-grants · #2423 skew (rør ikke) · #5042 · #5044.

> **🔴 Åbne fund:** favorit-win-rate 62,6 % RØD (§7b). Feature-liveness rød på alle PR'er (#3069). **10/9-audits:** `docs/audits/2026-09-10-spillerstemmer-survey-roadmap-forum.md` (skema 27/242: ungdom+træning øverst; veto >20 % på delte programmer/AI-bud/indbakke-transfers; Pro aldrig fordel) + `2026-09-10-discord-stemmer-s3.md`. Issue-runder 10/9: #5091–#5096 · #5101–#5107 (GDD-beslutninger).

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), 12 betalende (MRR 436 kr). **S3:** 529 løb, 28/8 → 27/9, etaper hver hele time.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; eget GDD-kapitel, Q-037 parkeret til spillerafstemning).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b (refresh `buildV4AnchorBaseline.mjs` + `renderV4AnchorTable.mjs --write`, kun `--check` er read-only, #5001); hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846) live senest 28/9; kalenderpakker #4845 FØR S4-kalender.
- **GDD-regler (ejer 10/9):** ét område pr. kort · muligheder vises visuelt før kortet · "1 + tilføjelse" bevares ordret · forum-afstemning med billede når skemaet ikke dækker valget · genåbn aldrig låste beslutninger (fx #2798, 2/9).
- **Mekanik:** merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`, aldrig HH:57-HH:03; start køen først når checks har været rene i to aflæsninger; league-check mangler i ~10 min efter hvert push, køen stopper på "mangler"); migrationer applies af auto-migrate.yml, Claude tjekker runnet + post-verify før næste merge. Bølger: Workflow med faser byg → verificér (reviewer + fix) → go-kort; TIER WAVE, draft til `gh pr ready`, push <10 min + hvert 15. min, frossen worker = afløser i SAMME worktree. Workers kører aldrig hele e2e, spawner aldrig agenter, rører aldrig `docs/NOW.md` og kører preflight i FORGRUNDEN; go-kort bygges på `gh pr diff` + billeder orkestratoren selv har set. Tid: `Get-Date` (Git Bash `date` = UTC).

> **🤖 Working agent:** Fable workflow-session, startet 10/9 kl. 15:04 (prompt i `docs/drafts/`). Anden session: STOP + spørg.

_Historik i git-log, issue-tråde + docs/audits/._
