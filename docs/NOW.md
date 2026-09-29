# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (29/9, efter release):** 1) **#5908** tjek samlet board-skrivning ved første afsluttede løb (Railway `board=` ~1 kald, var 880). 2) **#5897** + **#5912** reparation af 217 bestyrelser + 1.759 tabte træningsdage (dry-run → ejer-go). 3) Resten af **#5893** (hændelsesplan) bygges af Codex; handoff-køen i **#5888** (#5885 help/patch, #5734, #5886, #5887). **28/9-hændelse:** ungdomsløb sprunget over → 2 DB-udfald (19:53, 20:12) fra board-storm → træning først 21:38. Rettet: #5890 #5891 #5892 #5896 #5909 #5880.
>
> **✅ Leveret 28/9:** auktioner (#5870) · bestyrelsesunderskrift (#5868) · U23/junior-udtagelse + trup-regel (#5869) · træning fra løb (#5281) · v4 (#5826, #5875) · ungdomsgave (#5874, kørt) · auktionsryttere retur (#5847) · visionsmål (#5877) · ungdomshjælp (#5786) · patch 7.306-7.311. Omdømme (#5828) ikke tændt før gulvet er rettet. **Mangler:** race sharpener #5238 · sekundær type #3813 · sæsonmatrix mobil #5124 · point-flyt #5268 · omdømme #4956. **29/9:** Sikkerheds-PR #5925; CI/deploy grøn, Vercel `READY`, tre alarmer `fixed`. #5889 merget (7.317); #5705/#5934 merget (CI/READY).

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt. **140 er LÅST (ejer 15/9); spørg aldrig igen.** Måde B (5 pr. dato). §2c: S4 må laves om, indtil sæsonen er aktiv. **Junior må køre fra 16 (ejer 24/9). Juniorer må stå på U23 (YOUTH_RULES §2); trup-reglen er KUN en øvre grænse (#5794).**

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende; `ratingGolden.5321.json` KUN m. ejer-go.

> **🔴 Åbne fund:** #5162 chunk (EFTER S4) · #5633 (4/5 rettet) · #5692 matview timeouts · parkering ved S4 = JA (ejer 26/9). **📊 Triage:** `infisical run --env=dev --silent -- node scripts/sentry-issues.mjs --period=24h`. **Supabase 25/9:** 3 WARN dokumenteret. **S3:** sidste etape 27/9 kl. 19 (D1) / 18 (D2-D4); skiftet ca. 19:30.

> **✅ 29/9:** #5922 watchdog og #5913 ungdomspuljer live; audit 35 puljer/0 afvigelser. #5923 Codex-arbejdsform indført; pilot 0/5 målt.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/4 fra S4 (ejer 24/9: D3+D4 samles ved skiftet, script #5669). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder (`riderSeasonAge.js`, S3=2028). Akademi-nedrykning ≤ 21 IKKE live (#5145 parkeret). **Graduation Day ved 23** (live 15/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Flip-klar-rapport forældet → genkør `v4FlipReadiness.mjs` efter S4's første løbsdage. Kalender-gaten blokerende (#4123 + #5707); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus. Alt bag `training_tick_per_race_day` + `race_day_development_enabled` (off); live 28/9. **B3 #5281 er IKKE bag flag**, merges på flip-dagen.
- **Evner (live):** `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt (#5268) ejer-gated.
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396). Loft U23 12/junior 10 (#5626). Ungdomsdrift: 0 ved S3-skiftet (#5741, ejer 25/9), sats fra S4 åben. Spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms (#5215).
- **Kort-regler (ejer 15/9-26/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · **UI-PR = ÉT annoteret før/efter-billede** · spillervendt rettelse = problem + løsning FØR byg.
- **Mekanik:** parallelbyg via `wave.js` / `scripts/codex-wave.mjs`; ÉN merge-kø (`scripts/merge-queue.ps1 -Pr "a,b,c"`, aldrig kædede ventere); `mergeStateStatus` FØR vent på CI; commit kun bag guarden (#5094); migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; nye frontend-filer = .ts/.tsx; klassifikator-blokeret merge → ejeren kører selv.
> **🤖 Working agent:** Ingen aktiv session (29/9: #5922/#5913/#5923; handoff på issues).
