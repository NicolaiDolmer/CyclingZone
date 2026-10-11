# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (fra 11/10 sen aften):** (1) v4-bjergetaper pr. division 12/10 fra kl. 12 mod `balance-internals/motor-bench/bench-main-live.json`. (2) #6477 chunk merges efter ejerens GitHub-secret `POSTHOG_PERSONAL_API_KEY`. (3) Ejer-kort: faldets form (kerne 100 % / øvrige 70 % eller ens, #6499) FØR flaget `development_v2_aging_enabled` tændes før 25/10. (4) Ægte før/efter-billeder #6482 #6483 (Claude in Chrome ikke forbundet 11/10). (5) Design #6490 (træning ved 10× + "omgående træning", ejer 11/10) og #6489 (trup-skift-trigger), #6504 (frigivelse uden ejerskifte). (6) Tekniske standarder #6496: kort #6491 (job-kø) først. Man: betaling #4511 #4514 #4512.
>
> **11/10 aften (session `031242c6`):** Merget #6478 #6480 #6481 #6479 #6498 #6503 #6502 (+#6501 og patch 7.357 #6505 i kø). Udvikling 2.0 del 1 bygget bag slukket flag (D4 #6499 prøvekørt mod prod: plateau 29-30 = 0 fald, 31-33 manager 5,2 mod 11,8 i dag; D6 #6500). Aftenspidsens rodårsag: GIN-indeks 800 MB på `training_day_runs` (#6490, live-målt: 1 MB WAL pr. afregning, max 45 s, lukning 30 min). 7×5 er live for alle (docs rettet). Tekniske standarder vedtaget (#6496 #6491-#6497, TS håndhæves #5158). Discord-udkast i `docs/drafts/`; postmortem i `.claude/learnings/`.

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt. **140 er LÅST (ejer 15/9); spørg aldrig igen.** Måde B (5 pr. dato). §2c: S4 må laves om, indtil sæsonen er aktiv. **Junior må køre fra 16 (ejer 24/9). Juniorer må stå på U23 (YOUTH_RULES §2); trup-reglen er KUN en øvre grænse (#5794).**

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende; `ratingGolden.5321.json` KUN m. ejer-go.

> **🔴 Åbne fund:** #6490 aftenspids · #5692 matview · #6504 frigivelse. **📊 Triage:** `infisical run --env=dev --silent -- node scripts/sentry-issues.mjs --period=24h`.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/4 fra S4 (ejer 24/9: D3+D4 samles ved skiftet, script #5669). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder (`riderSeasonAge.js`, S3=2028). Akademi-nedrykning følger truppens aldersgrænse (#5547; #5145 lukket som overhalet 8/10). **Graduation Day ved 23** (live 15/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` ON (prod læst 1/10); v4 kører officielle etaper. Flip-rapport forældet (#5515). Kalender-gaten blokerende (#4123 + #5707); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus. Prod-måling 30/9: `training_tick_per_race_day`, `training_condition_per_date`, `race_day_development_enabled` og `race_day_engine_enabled` on. Dato-modellen aktiveret 29/9; B3 #5281 er IKKE bag flag.
- **Evner (live):** `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt (#5268) ejer-gated.
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396). Loft U23 12/junior 10 (#5626). Ungdomsdrift: 0 ved S3-skiftet (#5741, ejer 25/9), sats fra S4 åben. Spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms (#5215).
- **Kort-regler (ejer 15/9-26/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · **UI-PR = ÉT annoteret før/efter-billede** · spillervendt rettelse = problem + løsning FØR byg.
- **Mekanik:** parallelbyg via `wave.js` / `scripts/codex-wave.mjs`; ÉN merge-kø (`scripts/merge-queue.ps1 -Pr "a,b,c"`, aldrig kædede ventere); `mergeStateStatus` FØR vent på CI; commit kun bag guarden (#5094); migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; nye frontend-filer = .ts/.tsx; klassifikator-blokeret merge → ejeren kører selv.
> **🤖 Working agent:** Claude Code session 11/10 aften (startet 17:15): v4-tjek → merge-kø m. kort pr. PR → stabilitet → Udvikling 2.0 del 1/2 → træning. Ejeren er med.
