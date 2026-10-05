# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (5/10 eftermiddag): næste Claude-session: [`2026-10-05-naeste-session-claude.md`](superpowers/plans/2026-10-05-naeste-session-claude.md) (løbsmotoren først) · Codex ved siden af: [`2026-10-05-naeste-session-codex.md`](superpowers/plans/2026-10-05-naeste-session-codex.md).** Først: aftentjek #6129 (20 ryttere trænet?) + #6153 (ingen rangliste-500) + staging-kopi → rens → syntetiske logins. Morgenblok: **Udvikling 2.0 D1-D7 (#6110, byg fra 6/10)** · løbsmotor: samlet billede af diagnoserne 5/10 → designsamtaler ét punkt ad gangen (#6187 #5978 #6201 #6185 #6199+#6200 #3460 #2557 #6137); **#6156 bygges først derefter** · #6053 med ejeren · Train now-flip · #5864 + #6130 go.
>
> **5/10 (planlægningssession #6148):** #6129 anvendt · #6153 + #6179 merget · merge-kø #6195 #6197 #6180 #6183 · roadmap = MASTERPLAN (rækkefølge, 8 løfter, 16 GDD-punkter, 2027-liste) · motor-diagnoser på issues · udgifter: staging-branch er eneste nye faste post · deps: intet brændende, major-plan 1/12.

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt. **140 er LÅST (ejer 15/9); spørg aldrig igen.** Måde B (5 pr. dato). §2c: S4 må laves om, indtil sæsonen er aktiv. **Junior må køre fra 16 (ejer 24/9). Juniorer må stå på U23 (YOUTH_RULES §2); trup-reglen er KUN en øvre grænse (#5794).**

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende; `ratingGolden.5321.json` KUN m. ejer-go.

> **🔴 Åbne fund:** #5162 chunk (EFTER S4) · #5633 (4/5 rettet) · #5692 matview timeouts · parkering ved S4 = JA (ejer 26/9). **📊 Triage:** `infisical run --env=dev --silent -- node scripts/sentry-issues.mjs --period=24h`. **Supabase 25/9:** 3 WARN dokumenteret.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/4 fra S4 (ejer 24/9: D3+D4 samles ved skiftet, script #5669). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder (`riderSeasonAge.js`, S3=2028). Akademi-nedrykning ≤ 21 IKKE live (#5145 parkeret). **Graduation Day ved 23** (live 15/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` ON (prod læst 1/10); v4 kører officielle etaper. Flip-rapport forældet (#5515). Kalender-gaten blokerende (#4123 + #5707); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus. Prod-måling 30/9: `training_tick_per_race_day`, `training_condition_per_date`, `race_day_development_enabled` og `race_day_engine_enabled` on. Dato-modellen aktiveret 29/9; B3 #5281 er IKKE bag flag.
- **Evner (live):** `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt (#5268) ejer-gated.
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396). Loft U23 12/junior 10 (#5626). Ungdomsdrift: 0 ved S3-skiftet (#5741, ejer 25/9), sats fra S4 åben. Spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms (#5215).
- **Kort-regler (ejer 15/9-26/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · **UI-PR = ÉT annoteret før/efter-billede** · spillervendt rettelse = problem + løsning FØR byg.
- **Mekanik:** parallelbyg via `wave.js` / `scripts/codex-wave.mjs`; ÉN merge-kø (`scripts/merge-queue.ps1 -Pr "a,b,c"`, aldrig kædede ventere); `mergeStateStatus` FØR vent på CI; commit kun bag guarden (#5094); migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; nye frontend-filer = .ts/.tsx; klassifikator-blokeret merge → ejeren kører selv.
> **🤖 Working agent:** Claude (Fable), hoved-checkout, 5/10 eftermiddag: løbsmotor-design med ejeren (#6157: #6187 → #5978/#6201 → #6185 → #6199/#6200 → #3460 → #2557 → #6137), byg via wave; staging-fingeraftryk (#5904). Merge-kø 5/10 verificeret (#6183 + #6211 i prod).
