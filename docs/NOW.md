# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action (ejer-styret):** **Regel 6/9: tre baner** (deadline S4 · forretning viger aldrig · færdiggør før nyt), fuld rækkefølge i [MASTERPLAN.md](MASTERPLAN.md). **Bane 1 nu:** v4 før flip: natbølgen 7/9 lukkede #4885 #4886 #4905 #4934 #4911 #4910. Rest før flip: **#4936 snapshot re-eksport FØRST** (trin 1 målt: prod p50 7-12, snapshot p50 1) → #4914 kalibreringspakke (holdspil-gab ejer-go · M12 · bjerg-anker-spænd 165-242 s · hale-bånd) → #4915 TTT (ejer-valg) → flip (ejer) → S4-kalender #4270 (ikke før #4845) → træning #4850 → mandat #4857→#4859 → cutover #4592/#4619/#4860/#4376. **Bane 2:** #4616 nøgleblok (ejer ~30 min) → Pro i euro + mail-loop dry_run. **Bane 3:** #4929/#4928 register MERGET (dormant-state + registervagt) · ops #4918/#4920/#4919 (PR #4940) · #4917 løbsside-opfølgere · #4495 akademi-valg. **Ejer-go der venter:** #4857 · #4859 · #4845 · #4404 `AUTO_MERGE_PAT` · #4924 orphan-worktrees. Deploy-verify rød = chunk-fejl-raten (#2423), ikke koden.

> **⏳ Åbne ejer-valg (ét ad gangen):** **1) bjerg-anker-spænd** (#4914: bjerg-top-10 242/165/228 s mod 180-240, middel inde, spænd ikke; kalibreres med holdspil-gabet efter #4936). Hale-bånd LÅST 7/9: bjerg 6-12 %, fladt 0-2 % · 2) hjælpetekst "Race day and tactics" (usynlig til flip; `help.json` → `sections.raceDay`) · 3) holdspils-kalibrering (v4 gab 3,0 mod v3 19,4) · 4) #4915 TTT-punkter · 5) #2423 skew protection (ejer: rør ikke) · Discord: coming-soon-plakater + replay (ejer poster selv).

> **🔴 Åbne fund:** #4936 populations-snapshot skævt · nedkørsels-/summit-ratio s2 = 0,50 præcis på loftet (#4914) · CLAUDE.md 1737/1750 tok (trim næste docs-session) · #4828/#4829 D4-pulje F 25/24 · #4811 · #4453 · #4537 · #4530 · #4531 · #4109.

> **✅ 7/9 nat (Fable, 11 workers, 0 frys):** 8 PR'er merget: #4931 rng-streams segment-nøglede som default (breakaway-hypotesen falsk; climbSelection + descent var ramt) · #4933 nedkørsels-styrt gulv · #4935 **halen: fart-modellen var absolut, W' aldrig i tærsklen; p90 bjerg 2,7 → 9,1 %, OTL fyrer** · #4939 nedkørsels-styrt gennem M10 (koster tid/skade) · #4937 RACE_ENGINE_RULES målt tilstand + **ankertabel §7b pinnet + genereret** (refresh: `buildV4AnchorBaseline.mjs` + `renderV4AnchorTable.mjs --write`) · #4932 hjælpetekster (hardkodet skjult, intet frontend-flag) · #4938 register. Audit: `docs/audits/night-wave-2026-09-07.md`. Læring: `.claude/learnings/2026-09-07-v4-absolute-constants-vs-relative-scale.md`. Ingen patch note: v4 er flag-OFF, intet spillervendt ændret.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). 12 betalende (MRR 436 kr). #4616 EUR-nøgler → ejer-klik. #4514 kunden beholder Pro.

> **✅ S3 kører:** 529 løb, 28/8 → søn 27/9. Etaper hver hele time; scheduler hvert 5. min.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (GT-hviledage bundet, #4209). **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Flip-scope = v3-paritet + #2789/#2944/#2582 + intention (§9). Bygget ≠ koblet ind: to kolonner i kataloget. Ankre = §7b (pinnet population + etaper + 3 seeds); baseline pr. main i `backend/scripts/out/baseline/`.
- **Træning:** nyt system (løbsdag som tick, #4850) live senest S4-start 28/9; kalenderpakker #4845 FØR S4-kalender.
- **Mekanik:** PR'er merges én ad gangen (`scripts/merge-queue.ps1` efter #4940; aldrig HH:57-HH:03); `database/*.sql` applies af auto-migrate.yml, Claude laver post-verify. Bølger: TIER WAVE, maks 3 byg-workers, push <10 min + hvert 15. min, vagt `scripts/wave-lane-watch.ps1`, briefs fra `scripts/make-wave-brief.mjs`.

> **🤖 Working agent:** Fable · Claude Code · DolmerPC · 7/9 formiddag → hale-bånd låst (bjerg 6-12 %, fladt 0-2 %); workers: #4885 hale-gate + #4936 snapshot-re-eksport. Rør ikke harness-baselines i main-checkoutet.

_Historik i git-log, issue-tråde + docs/audits/._
