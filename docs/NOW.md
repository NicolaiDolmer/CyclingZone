# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (S4-kalender synlig for managers SENEST man 21/9, ejer 19/9, #5405):** (1) ejer-kort: kalenderens røde punkter m. prod-tal (`balance-internals/2026-09-19-s4-kalender-kvalitet/`) · (2) S4-række (`upcoming`) + `--apply` KUN m. ejer-go pr. kørsel (CALENDAR_RULES §2d) · (3) afstemning A/B om træningsdage: `audits/2026-09-19-kort/afstemning-*`, ejeren poster selv · (4) #5410 tekst-vagt: ejer-billede før merge, derefter kontrast (7 farvepar) · (5) **1-99-skalaen: udmelding senest 21/9** · (6) slet 853 tomme mapper (#4924). **Merget 19/9:** #5397 (flag `training_mobile_table` = beta) #5400 #5406-#5409; 25 branches → tags `archive/2026-09-19/*`. **Åbne PR'er:** #5410 #5281 #5264 #5169 #3512 · Dependabot #5379, #5356 (rød).

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt, overlap forbliver det almindelige. **Tallet er LÅST: 140 (ejer 15/9, TRAINING_RULES §13.3); spørg aldrig igen (bidt 19/9).** Synkrone etapeløbs-blokke er umulige i D1/D3/D4 (målt 19/9). **Åbent (afstemning):** ekstra træningsdage i hullerne (A) eller jævnt 5 pr. dato (B); begge grønne på #5169, se #5267. **B4 #5264 rettes FØR merge; #5169 merges ikke som den er.** **§2c (ejer 19/9):** S4 må laves om, indtil sæsonen er aktiv. `race_notify_outbox_enabled` OFF, flip ejer-only.

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende. `ratingGolden.5321.json` opdateres KUN m. ejer-go.

> **🟡 Lofter + potentiale (ejer 18/9, byg intet):** lofterne ud, potentialet styrer farten (#5351); 6 huller efter 28/9. **#5268-point-flyt afventer.**

> **🔴 Åbne fund:** Webkit-flaken #4925: rerun, ikke fix. **#5323 Quad9:** aflæs målingen (live fra 17/9) før DNS-kort. Advisors: 3 kendte WARN. **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **S3:** 529 løb, 28/8 → 27/9.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). Mere fog of war (#5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning ≤ 21 er IKKE live (#5145 parkeret 14/9 til U23-sporet, branchen bevares; i dag ≤ 22). **Graduation Day ved 23** (live 15/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Kalender-gaten blokerende (#4123); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus, program 7×5 løbsdage. #5205 + B4 #5264 bag flag `training_tick_per_race_day` (off); live senest 28/9. **B3 #5281 er IKKE bag flag**, merges på flip-dagen.
- **Evner (live):** taktik/aggression uden alder for nye ryttere; `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9; motor: #5348 #5349 efter apply). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt (#5268) ejer-gated. 
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396, kræver squad=senior OG is_academy=false til backfill er kørt; backfill ejer-gated). `U23_BIRTH_BAND` = variant A (#5401), generator A6 mangler. Alt live 28/9; spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `node scripts/check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms, ejerens tal ekskl. (#5215).
- **Kort-regler (ejer 15/9 + 17/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · UI-PR = skærmbillede samme tur · **spillervendt rettelse = problem + løsning i klart sprog FØR byg** (bidt 17/9).
- **Mekanik:** byg KUN via wave.js; merge én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); commit kun bag guarden (#5094); ny tabel bag flag → `FLAG_GATED_EMPTY_TABLES`; migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; skærmbilleder: vite i eget worktree + Playwright; nye frontend-filer = .ts/.tsx.

> **🤖 Working agent:** Ingen aktiv session. (PR der rører filen skal hedde `docs(now)…`/`docs(close-out)…`, #5093.) Historik: git-log + issues + docs/audits/.

