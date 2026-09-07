# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action (ejer-styret 7/9):** **Næste session = ejerens egne bestillinger.** Prompt: `docs/drafts/next-session-prompt-2026-09-08-ejer-bestillinger.md` (læs Discord #feedback-from-dolmer `1522915781766283296` for 1/9-8/9, verificér status pr. bestilling, ét rangeret kort). **Teknisk carry-over (workers parallelt):** 1) #4975 + #4988 (v4 felt-sammenhæng, holdspil B = ejer-valg 7/9) ligger på gammel #4971-sha → rebase på main + regenerér golden fixtures (nye `group_merged`-vagter) + CodeRabbit + merge én ad gangen + §7b-refresh. 2) Mål #4970 (chunk-fix live 7/9 ~14:20): CYCLINGZONE-56 events/dag 8/9 vs 7/9, forventet -60-70 %; skriv på #4595. 3) Ejer-kort: #4589 reparation af 19 akademi-ryttere (dry-run i `database/manual/`). 4) #4993 M10/solo-id (sonnet). 5) CLI-review (`coderabbit review --base main --committed`) ind som fast trin i `scripts/make-wave-brief.mjs` før `gh pr ready`.

> **⏳ Åbne ejer-valg (ét ad gangen):** #4589 reparation · #4915 TTT-punkter · #4948 raceDay-hjælpetekst (`help.json` → `sections.raceDay`) · #4964 launch-kohorte · #2423 skew (ejer: rør ikke) · #4872 værdi-frys (#3345) → hører til V4-refit #3353, genåbn ikke som bug. Discord: coming-soon-plakater + replay + spørgeskema (ejer poster selv).

> **🔴 Åbne fund (§7b refreshet 7/9 efter #4971):** bjerg-top-10 **209 s GRØN** · højbjerg-hale grøn · felt-sammenhæng flad 31 % rød (fix i #4975, venter rebase) · favorit-win-rate 57 % rød (egen akse) · nedkørsel 0,43 grøn. CLAUDE.md 1737/1750 tok (#4364) · #4811 · #4453 · #4537 · #4530 · #4531 · #4109.

> **✅ 7/9 dagbølge (Fable, ejer ved maskinen):** 17 PR'er merget (#4966 #4967 #4968 #4969 #4970 #4971 #4972 #4973 #4974 #4976 #4977 #4978 #4986 #4990 #4991 #4995 (=#4989, auto-lukket ved base-slet) + patch note #4994). Efterfølgende: #5002 #5003 + patch note v7.262. Done: #4947 #4949 #4950 #4595 #4213 #4872 #4877 #4954 #4921 #4963 #4828 #4987 #4589 #4951 #4917 #4979 #4980 #4992. Nye: #4979-#4985 #4987 #4992 #4993. Audit: `docs/audits/day-wave-2026-09-07.md`. **CodeRabbit:** PR'er som draft til sidst (#4991), CLI installeret + logget ind, cap 20 USD, promo-kredit til 14/9.

> **📊 Triage:** Sentry via `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. Clarity er ikke kilde til "hvor mange" (traffic_events brød 1/9, #4963 annoteret). #4952 Firefox-mobil · #4953 dead clicks /training (→ #3643/#4613/#4982).

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). 12 betalende (MRR 436 kr). #4616 EUR-nøgler → ejer-klik. #4514 kunden beholder Pro.

> **✅ S3 kører:** 529 løb, 28/8 → søn 27/9. Etaper hver hele time; scheduler hvert 5. min.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (GT-hviledage bundet, #4209). **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF (række findes nu, #4951); v3 kører S3 færdig. Flip-scope = v3-paritet + #2789/#2944/#2582 + intention (§9, nu 14 beslutninger). Ankre = §7b (population 2026-09-07, refresh `buildV4AnchorBaseline.mjs` + `renderV4AnchorTable.mjs --write`); hale-gate `v4TailSpread.js --gate`.
- **Træning:** nyt system (løbsdag som tick, #4850/#4846) live senest S4-start 28/9; kalenderpakker #4845 FØR S4-kalender. Dags-støj bruger `seededUnitMixed` (#4987).
- **Mekanik:** merges én ad gangen (`scripts/merge-queue.ps1`; aldrig HH:57-HH:03); `database/*.sql` applies af auto-migrate.yml, Claude laver post-verify. Bølger: TIER WAVE, PR som draft til `gh pr ready`, CLI-review før ready, push <10 min + hvert 15. min, vagt `scripts/wave-lane-watch.ps1`, briefs `scripts/make-wave-brief.mjs`, frossen worker = recovery i SAMME worktree.

> **🤖 Working agent:** Ingen aktiv session (dagbølge 7/9 lukket ca. 16:45; næste = ejer-bestillinger, prompt i docs/drafts).

_Historik i git-log, issue-tråde + docs/audits/._
