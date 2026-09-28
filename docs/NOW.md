# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (27/9 kl. 23):** **S4 ER AKTIV** (skifte 22:36-22:46, alt verificeret). Løbsdag 1 = man. 28/9 19:30: 25 senior + 10 U23 + 10 junior løb; AI-hold udtaget af den timelige generator (41.716 AI-entries, 22:54), managers udtager selv (nød-udtagelse efter aftalt regel). **Mandag formiddag:** (1) træningsflip `training_tick_per_race_day` + `race_day_development_enabled` + merge #5281 SAMME dag (ejer-go) · (2) PR'er for kode der allerede er KØRT i prod fra branch: `fix/5830-calendar-type-gap` (R16+R17, D2 endagsløb 12/7/1/1→8/7/3/3) og `feat/4620-youth-groups-12-12-mix` (`--managers-per-group=12 --mix-junior`) · (3) patch note for skiftet (S4, D3+D4 samlet, ungdomsløb, parkering) · (4) #5828 omdømme + #5820 Boardroom-mål før løbsdag 1 · (5) genkør `retireD4PoolsS4.js --apply --owner-go` når 2 AI-hold med transferbud i D4 E/G er frie. Uge 1: #5826 v4-kalibrering, v4 tænd/vent, #5834, #5835 (AI-genbrug S5). Frosset hold The Wheelbarrels parkeret manuelt (ejer 27/9). **Season day** = de 140 dage; race day = dag med løb.
>
> **✅ #5843 (28/9 kl. 12:04):** U23/junior-løb kan nu ses (U23/Junior team → Calendar) og udtages (løbssiden, Hold-fanen); trup-regel: løb bruger kun egen trups ryttere, trup-flyt rydder gamle entries. PR #5869 merget (`7bea260`). **Åbent:** ejer-test af gem i prod · ejer-gated oprydning af 22 forkert-trup-race_entries (SQL i PR #5869) · Discord-besked til managers.
>
> **Løfter før S4 der mangler (målt 27/9 aften):** træning fra løb (flip mandag) · v4 (ejer) · race sharpener #5238 · sekundær type #3813 · sæsonmatrix mobil #5124 · point-flyt #5268 · omdømme synligt #4956. ✅ ungdomsløb live i S4.

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt. **140 er LÅST (ejer 15/9); spørg aldrig igen.** Måde B (5 pr. dato). §2c: S4 må laves om, indtil sæsonen er aktiv. **Junior må køre fra 16 (ejer 24/9). Juniorer må stå på U23 (YOUTH_RULES §2); trup-reglen er KUN en øvre grænse (#5794).**

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende; `ratingGolden.5321.json` KUN m. ejer-go.

> **🔴 Åbne fund:** #5162 chunk (EFTER S4) · #5633 (4/5 rettet) · #5692 matview timeouts · parkering ved S4 = JA (ejer 26/9). **📊 Triage:** `infisical run --env=dev --silent -- node scripts/sentry-issues.mjs --period=24h`. **Supabase 25/9:** 3 WARN dokumenteret. **S3:** sidste etape 27/9 kl. 19 (D1) / 18 (D2-D4); skiftet ca. 19:30.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/4 fra S4 (ejer 24/9: D3+D4 samles ved skiftet, script #5669). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder (`riderSeasonAge.js`, S3=2028). Akademi-nedrykning ≤ 21 IKKE live (#5145 parkeret). **Graduation Day ved 23** (live 15/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Flip-klar-rapport forældet → genkør `v4FlipReadiness.mjs` efter S4's første løbsdage. Kalender-gaten blokerende (#4123 + #5707); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus. Alt bag `training_tick_per_race_day` + `race_day_development_enabled` (off); live 28/9. **B3 #5281 er IKKE bag flag**, merges på flip-dagen.
- **Evner (live):** `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt (#5268) ejer-gated.
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396). Loft U23 12/junior 10 (#5626). Ungdomsdrift: 0 ved S3-skiftet (#5741, ejer 25/9), sats fra S4 åben. Spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms (#5215).
- **Kort-regler (ejer 15/9-26/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · **UI-PR = ÉT annoteret før/efter-billede** · spillervendt rettelse = problem + løsning FØR byg.
- **Mekanik:** byg KUN via wave.js; ÉN merge-kø (`scripts/merge-queue.ps1 -Pr "a,b,c"`, aldrig kædede ventere); `mergeStateStatus` FØR vent på CI; commit kun bag guarden (#5094); migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; nye frontend-filer = .ts/.tsx; klassifikator-blokeret merge → ejeren kører selv.

> **🤖 Working agent:** Ingen aktiv session (sæsonskifte-session 27/9 lukket ca. kl. 23).
