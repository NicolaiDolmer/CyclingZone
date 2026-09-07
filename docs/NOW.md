# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action (ejer-styret):** **#4960 MÅLT + lukket 7/9 — svar i issue-tråden.** -37 % findes ikke i spillerbasen: serverside 65→55, DAU fladt 32-49 hele 1/8-6/9. **H1 bekræftet** (launch-kohorte 28,6 %, etablerede 86,8 %, signups 20→6) · **H2 afvist som churn-driver** · **H3 dominerer:** klientside-måleren knækkede 1/9 ~16:45 (React 19 #4547). Opfølgere: **#4963** metrik-brud · **#4964** launch-kohorte (ejer-valg). **Rækkefølge låst af ejer 7/9: #4960 ✅ → #4595 → #4914.** #4595 = chunk-fejlen (CYCLINGZONE-56), IKKE retention-kritisk. #4914 kalibrering derefter — prompt: `docs/drafts/next-session-prompt-2026-09-08-v4-kalibrering.md` (Fable high; opus-lane på motoren; sonnet på #4947 #4949 #4950 #4951). **Regel 6/9: tre baner**, fuld rækkefølge i [MASTERPLAN.md](MASTERPLAN.md). **Bane 1:** #4914 → #4915 TTT (ejer-valg) → flip (ejer) → S4-kalender #4270 (ikke før #4845) → træning #4850 → mandat #4857→#4859 → cutover #4592/#4619/#4860/#4376. **Bane 2:** #4616 nøgleblok (ejer ~30 min) → Pro i euro + mail-loop dry_run. **Bane 3:** #4917 løbsside-opfølgere · #4948 raceDay-hjælp flag · #4951 flag-rækker · #4495 akademi-valg. **Ejer-go der venter:** #4857 · #4859 · #4845 · #4404 `AUTO_MERGE_PAT` · #4924 orphan-worktrees.

> **⏳ Åbne ejer-valg (ét ad gangen):** 1) holdspils-niveau (M16 gab 3,0 mod v3 19,4): leveres som A/B-tal fra #4914-lanen · 2) hjælpetekst "Race day and tactics" (#4948, usynlig til flip; `help.json` → `sections.raceDay`) · 3) #4915 TTT-punkter · 4) #2423 skew protection (ejer: rør ikke) · Discord: coming-soon-plakater + replay (ejer poster selv). **Låst 7/9:** hale-bånd bjerg/højbjerg 6-12 %, fladt 0-2 % (§9 nr. 13).

> **🔴 Åbne fund (målt mod 7/9-populationen, §7b):** bjerg-top-10 **132 s rød** (180-240) · højbjerg-hale **5,2 % rød** (6-12 %) · felt-sammenhæng 31 % rød · favorit-win-rate 57 % rød · nedkørsels-ratio s2 0,52 over loft (middel 0,39 grøn) · sprinter 96 % GRØN. CLAUDE.md 1737/1750 tok (#4364) · #4828/#4829 D4-pulje F 25/24 · #4811 · #4453 · #4537 · #4530 · #4531 · #4109.

> **✅ 7/9 (Fable, 14 workers):** 10 PR'er merget (hale-gate #4945, populations-snapshot #4946 m.fl.). Audit: `docs/audits/night-wave-2026-09-07.md`. Læring: `.claude/learnings/2026-09-07-v4-absolute-constants-vs-relative-scale.md`. Ingen patch note: v4 flag-OFF.

> **📊 Triage 7/9 (Sentry+Clarity):** #4960 målt (se Next action) · #4595 CYCLINGZONE-56 (874 ev/50 brugere) — ægte fejl, men IKKE retention-kritisk · #4954 consent-regression (cookie-banner dødt) · #4952 Firefox-mobil JS-fejl · #4953 dead clicks /training. **Clarity er ikke kilde til "hvor mange" — brug `player_events`/`growth_metric_snapshots`.** Sentry læses via `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d` (MCP'en er stadig uautoriseret).

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). 12 betalende (MRR 436 kr). #4616 EUR-nøgler → ejer-klik. #4514 kunden beholder Pro.

> **✅ S3 kører:** 529 løb, 28/8 → søn 27/9. Etaper hver hele time; scheduler hvert 5. min.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (GT-hviledage bundet, #4209). **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Flip-scope = v3-paritet + #2789/#2944/#2582 + intention (§9). Bygget ≠ koblet ind. Ankre = §7b (population 2026-09-07 + proxy-etaper + 3 seeds, refresh `buildV4AnchorBaseline.mjs` + `renderV4AnchorTable.mjs --write`); hale-gate `v4TailSpread.js --gate`.
- **Træning:** nyt system (løbsdag som tick, #4850) live senest S4-start 28/9; kalenderpakker #4845 FØR S4-kalender.
- **Mekanik:** merges én ad gangen (`scripts/merge-queue.ps1`; aldrig HH:57-HH:03); `database/*.sql` applies af auto-migrate.yml, Claude laver post-verify. Bølger: TIER WAVE, maks 3 byg-workers, push <10 min + hvert 15. min, vagt `scripts/wave-lane-watch.ps1`, briefs `scripts/make-wave-brief.mjs`, frossen worker = recovery i SAMME worktree, commit det der ligger først.

> **🤖 Working agent:** Fable, dagbølge 7/9 fra 11:00 (ejer ved maskinen). 15 spor kørt, 13 PR'er (#4966-#4978) + UI-lane #4979/#4980 + recovery #4872. Merge-kø kører (`merge-queue-1.log` i sessionens scratchpad). Rør ikke worktrees under `CyclingZone-worktrees/`.

_Historik i git-log, issue-tråde + docs/audits/._
