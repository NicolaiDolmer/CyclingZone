# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (3/10 aften): fast rytme fra nu, se [`OPERATING_PLAN.md`](OPERATING_PLAN.md)** (ejer-godkendt 3/10: morgen 08.30 + aften 20.15 i Claude Code, Codex bygger Stabilitet/Betaling/Fabrikken og rører aldrig NOW/MASTERPLAN). **(1)** Brand: #6095 gem af etapetaktik (ikke startet) og #5860 dobbeltbooking (sat op 3/10); Codex har #6115-kodefix. #6061 forebyggelse live 3/10 (PR #6119, `2abc92efd`, migration post-verificeret); historisk kompensation afventer ejer-go i #6129. **(2)** Søn 4/10: Udvikling 2.0 D1-D4 (#6110, spillersignaler på issuet) + kort #5912/#5897. **(3)** Man 5/10: mandagsstyring m. Discord-fund #6122-#6126, træningspakken (#6053 parkeret til da, #6123, #6060, #5915, #5485), flip-listen beta → alle, lovet #5965.
>
> **✅ 3/10:** #6117 liga-vagt + #6107 flag-batching merget og live; #6115 data repareret (5 forældreløse tilbud trukket tilbage, 2 AI-hold nedlagt). Lukket: #6114/#6108/#6043 + Sentry v11 #6040/#6037 (privatliv → #6121); død Deadline Day-cron → #6120. Audit: 7 lukket, 4 → done, 3 → todo (`.claude/audits/audit-2026-10-03.md`).

> **📌 #6110 Udvikling 2.0:** design-kort søn 4/10-man 5/10, byg uge 41.

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt. **140 er LÅST (ejer 15/9); spørg aldrig igen.** Måde B (5 pr. dato). §2c: S4 må laves om, indtil sæsonen er aktiv. **Junior må køre fra 16 (ejer 24/9). Juniorer må stå på U23 (YOUTH_RULES §2); trup-reglen er KUN en øvre grænse (#5794).**

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende; `ratingGolden.5321.json` KUN m. ejer-go.

> **🔴 Åbne fund:** #5162 chunk (EFTER S4) · #5633 (4/5 rettet) · #5692 matview timeouts · parkering ved S4 = JA (ejer 26/9). **📊 Triage:** `infisical run --env=dev --silent -- node scripts/sentry-issues.mjs --period=24h`. **Supabase 25/9:** 3 WARN dokumenteret.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/4 fra S4 (ejer 24/9: D3+D4 samles ved skiftet, script #5669). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder (`riderSeasonAge.js`, S3=2028). Akademi-nedrykning ≤ 21 IKKE live (#5145 parkeret). **Graduation Day ved 23** (live 15/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` ON (prod læst 1/10); v4 kører officielle etaper. Flip-klar-rapport forældet → genkør `v4FlipReadiness.mjs` efter S4's første løbsdage. Kalender-gaten blokerende (#4123 + #5707); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus. Prod-måling 30/9: `training_tick_per_race_day`, `training_condition_per_date`, `race_day_development_enabled` og `race_day_engine_enabled` on. Dato-modellen aktiveret 29/9; B3 #5281 er IKKE bag flag.
- **Evner (live):** `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt (#5268) ejer-gated.
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396). Loft U23 12/junior 10 (#5626). Ungdomsdrift: 0 ved S3-skiftet (#5741, ejer 25/9), sats fra S4 åben. Spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms (#5215).
- **Kort-regler (ejer 15/9-26/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · **UI-PR = ÉT annoteret før/efter-billede** · spillervendt rettelse = problem + løsning FØR byg.
- **Mekanik:** parallelbyg via `wave.js` / `scripts/codex-wave.mjs`; ÉN merge-kø (`scripts/merge-queue.ps1 -Pr "a,b,c"`, aldrig kædede ventere); `mergeStateStatus` FØR vent på CI; commit kun bag guarden (#5094); migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; nye frontend-filer = .ts/.tsx; klassifikator-blokeret merge → ejeren kører selv.
> **🤖 Working agent:** Claude Code: github-housekeeping fuld-backlog-audit (3/10 aften, read-only indtil ejer-go). Codex arbejder på #6115 (claim på issuet).
