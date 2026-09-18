# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (19/9):** ejer-kort ét ad gangen, billede som FIL: `drafts/next-session-prompt-2026-09-19.md`. (1) **#5397 træningssiden på mobil** og (2) **#5400 én besked pr. løb + roligt dashboard** venter på ordet "merge" · (3) **kalenderformen** (#5267, prøvepakning kræver ja) · (4) slettelisten (`audits/2026-09-18-branch-opgoerelse.md`, #4924) · (5) skærmbilleder til #5383 · (6) potentiale-session efter 28/9. **Aften 18/9:** `audits/night-wave-2026-09-18-aften.md`, 7 PR'er merget (alt internt). **Hos ejeren:** listen nederst i prompten. **Åbne PR'er (rør ikke):** #5281 #5264 #5169 #3512 · Dependabot #5379 (grøn) #5356 (rød).

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato i cykelåret · ét løb ELLER træning · etapeløb binder til sidste etape, hviledag = hvile · lige mange løbsdage i alle divisioner, overlap skal forblive det almindelige. Model C afvist. **B4 #5264 rettes FØR merge; #5169 merges ikke som den er.** `race_notify_outbox_enabled` OFF, flip ejer-only.

> **🔴 Rating-reglen (hændelse 17/9, lukket):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende; nye evner tæller først når de har værdier. Golden-guard `ratingGolden.5321.json` opdateres KUN m. ejer-go.

> **🟡 Lofter + potentiale (ejer-retning 18/9, byg intet):** lofterne ud, potentialet styrer farten (#5351). Det meste ER aftalt; 6 huller tages ét ad gangen efter 28/9. Find aftalerne FØR du spørger. **#5268-point-flyt afventer.**

> **🔴 Åbne fund:** Webkit-flaken #4925: rerun, ikke fix. **#5323 Quad9:** måling live fra 17/9 kl. 13; aflæs 19/9 før DNS-kort. Advisors: 3 kendte WARN. **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **S3:** 529 løb, 28/8 → 27/9.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (#5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning kun ≤ 21 (#5145). **Graduation Day ved 23** (live 15/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Kalender-gaten blokerende (#4123); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus, program 7×N løbsdage (N uafgjort, UI bærer 1-5). #5205 + B4 #5264 bag flag `training_tick_per_race_day` (off); live senest 28/9. **B3 #5281 er IKKE bag flag**, merges på flip-dagen.
- **Evner (live):** taktik/aggression uden alder for nye ryttere; `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9; motor: #5348 #5349 efter apply). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt = `backend/scripts/dry-run-5268-mental-abilities.js`, ejer-gated. Fødsel uden PCM = default (#5278).
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396, kræver squad=senior OG is_academy=false til backfill er kørt; backfill ejer-gated). `U23_BIRTH_BAND` = variant A (#5401), generator A6 mangler. Alt live 28/9; spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `node scripts/check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms, ejerens tal ekskl. (#5215).
- **Kort-regler (ejer 15/9 + 17/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · UI-PR = skærmbillede samme tur · **spillervendt rettelse = problem + løsning i klart sprog FØR byg** (bidt 17/9).
- **Mekanik:** byg KUN via wave.js; merge én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); commit-guarden skriver markør, pre-commit afviser commit uden (#5094); ny tabel bag flag → `FLAG_GATED_EMPTY_TABLES`; migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; skærmbilleder tages med vite i eget worktree + Playwright; nye frontend-filer = .ts/.tsx.

> **🤖 Working agent:** Ingen aktiv session. (PR der rører filen skal hedde `docs(now)…`/`docs(close-out)…`, #5093.) Historik: git-log + issues + docs/audits/.

