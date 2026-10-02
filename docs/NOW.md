# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (2/10 morgen, Giroen etape 1 kl. 11.00):** ejer-kort fra natsessionen, én ad gangen: 1) **#6051+#6056** motor (flad-rest + AI-spurtere, begge beregningsfejl → gælder næste ikke-kørte etape; merge #6056 først, delte filer). 2) **#6046** brosten: balance (bag slukket orders_gc_v1) eller beregningsfejl. 3) **CYCLINGZONE-44** 8 dobbeltbookede rytter-par S4, kan nås før afvikling: kør `audit-4700-double-booked-riders.js` FØR kl. 11. 4) **Train now-flip** (prod: 30/44 ryttere med ticks hos ét beta-hold). 5) PR'er: #6045, #6053, #6054, #6052 (0,5 KB over bundle-loft), #6031 (sænker loftet tæt), #6044. 6) Start bølgen for orders_gc_v1-flader (sporfil i natsessionen; klassifikatoren afviste start). Efter 11: mål korrelationen på Giro-etape 1.
>
> **🔑 Ejer kl. 15 (#6066):** opret `AUTO_MERGE_PAT` som Actions- OG Dependabot-secret; Claude verificerer, genkører #6057, merger PR #6071.
>
> **✅ Nat 2/10:** merget #6032 (#5957, live 00.50, deploy verify grøn), #6033 (#5955 bremse, slukket), #6048 (#6046 brosten, slukket), Dependabot #6041/#6042/#6038/#6039. Replay af 208 S4-etaper: flad stadig under S3, tydeligt bedre med #6051+#6056 (tal privat i balance-internals/night-2-10/).

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
> **🤖 Working agent:** Ingen aktiv session (natsession 2/10 afsluttet ca. 07.30; morgenkort venter på ejeren i natsessionen).
