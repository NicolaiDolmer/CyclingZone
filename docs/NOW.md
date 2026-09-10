# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (GDD, D-001–D-031; branch `codex/game-design-document` → docs-PR for #5087) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (revideret 10/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md (#5058: listen er korrupt).

## Aktiv styring

> **🎯 Next action (10/9 kl. 13:15):** **1) Kvalitetsbølge** `wf_53ae5095` kører (5 baner: #4595 chunk-rod-årsag = egen `preventDefault()` · #5089 rytterkort 14 kald/rytter · #5060 mobil sticky navn · issue-runde (Codex-opfølgninger + 5 ufilede Discord-fund + #5073/#4872-check) · #5071 rebase uden NOW.md). Go-kort bygges på `gh pr diff` + billeder; intet merges uden ejerens ordrette "merge". **2) GDD-samtale** fortsætter i Claude Code (Codex overdrog efter Q-031; D-029–D-031 mentor valgt 10/9; ejer-regel: ét område pr. kort, fog of war = eget kapitel, muligheder vises visuelt). Næste kapitler efter spillerdata: holdudtagelse, akademi/U23, mobil. **3) Docs:** GDD-PR for #5087 åbnes efter preflight (NOW.md er ude af branchen) · masterplan-artifact opdateres · ejer-valg om venteliste-løft af trupper U23/junior (roadmap nr. 2, skema nr. 3). **Spillerdata:** `docs/audits/2026-09-10-*` (skema 27/242: ungdom+træning øverst, træning "fungerer dårligst" 17/36, veto >20 % på delte programmer/AI-bud/indbakke-transfers, Pro må aldrig give fordel). **Drift 10/9:** Sentry = 99,5 % chunk-fejl (rod-årsag fundet); Supabase-advisor 5 af 6 falske positiver, #5088 matview-grants ægte; 78 backup-tabeller 48 MB (#2259, ejer-go); 0 5xx på Railway. **Ejer-trin (uændret):** PostHog-nøgle · GSC-service-konto · Resend-webhook-secret · EUR-testkøb · `AUTO_MERGE_PAT` (#4812) · `SUPABASE_ACCESS_TOKEN` (#4269). S3 slutter søndag 27/9, S4 starter mandag 28/9.

> **⏳ Åbne ejer-valg:** #4270 S4-kalender (A/B, grænse 27/9) · #4860 sponsor S4 · #4616 EUR-nøgler · #4915 TTT · #4948 raceDay-hjælp · #4857 mandat-backfill · #5032 DM-opfølgning · #5073 pensionsvarsel rod-årsag · #4959 pulje 13 = 25 hold (ejer-gated reparation) · #2423 skew (rør ikke) · 16 "policy uden grant" (#5042) · `bg-cz-bg` (#5044) · hængende løfter til spillerne: #4346 anmeld-handel (27/8), flyt forumkategori ("senest 10/9").

> **🔴 Åbne fund:** favorit-win-rate 62,6 % RØD (§7b). Feature-liveness rød på alle PR'er (#3069). League-check rødt = ægte (pulje 13). Postmortem 8/9: `.claude/learnings/2026-09-08-survey-grants-missing.md`.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), 12 betalende (MRR 436 kr). **S3:** 529 løb, 28/8 → 27/9, etaper hver hele time.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; eget GDD-kapitel 10/9).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b (refresh `buildV4AnchorBaseline.mjs` + `renderV4AnchorTable.mjs --write`, kun `--check` er read-only, #5001); hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846) live senest 28/9; kalenderpakker #4845 FØR S4-kalender.
- **Mekanik:** merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`, aldrig HH:57-HH:03; start køen først når checks har været rene i to aflæsninger; league-check mangler i ~10 min efter hvert push, køen stopper på "mangler"); migrationer applies af auto-migrate.yml, Claude tjekker runnet + post-verify før næste merge. Bølger: TIER WAVE, draft til `gh pr ready`, CodeRabbit CLI før ready, push <10 min + hvert 15. min, vagt `wave-lane-watch.ps1`, frossen worker = afløser i SAMME worktree. Workers kører aldrig hele e2e, spawner aldrig agenter, rører aldrig `docs/NOW.md` og kører preflight i FORGRUNDEN; go-kort bygges på `gh pr diff` + billeder orkestratoren selv har set. Tid: `Get-Date` (Git Bash `date` = UTC).

> **🤖 Working agent:** Fable (Claude Code, desktop) · session 10/9 fra kl. 12:00 · main-checkout `C:\Dev\CyclingZone` (docs) + GDD-worktree `codex-game-design-document` (design) + bølge `wf_53ae5095` (5 worktrees under `C:\Dev\CyclingZone-worktrees\`). Anden session: STOP + spørg ejeren før pick-up (#559).

_Historik i git-log, issue-tråde + docs/audits/._
