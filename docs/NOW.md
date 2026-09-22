# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (22/9 kl. 18):** **Bølge kører (Claude):** SEO #5494 #5495 #5496 (#5493 venter på Ahrefs-nøgler). **Næste bølge, ejerens rækkefølge 22/9:** ryttertyper #5327 → ratings #5435 (model A, bag kontakt) → værdier #5497 (typefri + marked, R1-R6, erstatter 1b-1d; #3353 lukket, PR #5444 åben). **Ejerens hånd:** post spillersvar fra `drafts/2026-09-22-player-replies.md` · Android-test (#3643) · `training_score_visible` + udmelding · win-back #2760: tekst ok, kode mangler, så send-go · #4857-backfill-go efter dry-run. **Codex-kø:** `drafts/codex-session-2026-09-22-v3.md` opgave 2A-9. **PR-valg 22/9:** #5281 flip-dagen · #5461 kørselsdagen · #5476 afventer dig. **v4 live 28/9 (ejer).** **Derefter:** flip-dag 28/9 (#5281, #4849) · /roadmap #5387.

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt, overlap forbliver det almindelige. **Tallet er LÅST: 140 (ejer 15/9, TRAINING_RULES §13.3); spørg aldrig igen.** **Ejer 20/9: måde B (jævnt, 5 pr. dato); A + synkrone blokke fjernet i #5169. B4 #5264 merget 20/9 bag flag.** **§2c (ejer 19/9):** S4 må laves om, indtil sæsonen er aktiv. `race_notify_outbox_enabled` OFF, flip ejer-only.

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende. `ratingGolden.5321.json` opdateres KUN m. ejer-go.

> **🟡 Lofter + potentiale (ejer 18/9, byg intet):** lofterne ud, potentialet styrer farten (#5351); 6 huller efter 28/9. **#5268-point-flyt afventer.** **D-049-visning:** #5435, svar upostet #5436.

> **🔴 Åbne fund:** Webkit-flake #4925: rerun. **#5323 Quad9:** aflæs målingen (live fra 17/9) før DNS-kort. **📊 Triage:** `scripts/sentry-issues.mjs --period=7d` (via infisical dev). **S3:** 529 løb, 28/8 → 27/9.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). Mere fog of war (#5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning ≤ 21 er IKKE live (#5145 parkeret 14/9 til U23-sporet, branchen bevares; i dag ≤ 22). **Graduation Day ved 23** (live 15/9, side live 21/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Kalender-gaten blokerende (#4123); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus, program 7×5 løbsdage. #5205 + B4 #5264 + skader 5-25 (#5465) bag flag `training_tick_per_race_day` (off); live senest 28/9. **B3 #5281 er IKKE bag flag**, merges på flip-dagen.
- **Evner (live):** taktik/aggression uden alder for nye ryttere; `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9; motor: #5348 #5349 efter apply). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt (#5268) ejer-gated.
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396, kræver squad=senior OG is_academy=false til backfill er kørt; backfill ejer-gated). `U23_BIRTH_BAND` = variant A (#5401), generator A6 mangler; RPC'er har hård 8-cap (#5432). Alt live 28/9; spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `node scripts/check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms, ejerens tal ekskl. (#5215).
- **Kort-regler (ejer 15/9 + 17/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · UI-PR = skærmbillede samme tur · **spillervendt rettelse = problem + løsning i klart sprog FØR byg** (bidt 17/9).
- **Mekanik:** byg KUN via wave.js (Codex: samme indgang, #5468); merge én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); PR-loft 8; commit kun bag guarden (#5094); ny tabel bag flag → `FLAG_GATED_EMPTY_TABLES`; migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; skærmbilleder: vite i eget worktree + Playwright; nye frontend-filer = .ts/.tsx. Base-PR merget → PR lukkes; retarget først (#5478).

> **🤖 Working agent:** Ingen aktiv session. (PR der rører filen skal hedde `docs(now)…`/`docs(close-out)…`, #5093.)
