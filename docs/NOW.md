# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (24/9 kl. 10):** **Ny session:** OneDrive `private-handoffs/session-prompt-2026-09-24-c.md` (v2, ejer-godkendt) + KØ i `2026-09-24-morgenrapport-nat.md`: beslutninger der blokerer byggeri FØRST (#4592 comeback: Global Rank/D4→D3/pro rata · træning fra løb · ungdomsløb) → bølge → merge-blok (S4-kalender "kør" først). **Løfte-tavle 24/9:** live = tilmeldingskort (#5605), Discord-kort (#5604; backfill "kør"), /roadmap-tekster (#5558; SQL "kør") · beta = U23/junior (on med #5568), Mandatet (28/9) · go-klar = #5596 #5598 #5603 #5608 #5615 · ikke bygget = hent tilbage, ungdomsløb, træning fra løb, ugeplan 7×5.

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt, overlap forbliver det almindelige. **Tallet er LÅST: 140 (ejer 15/9, TRAINING_RULES §13.3); spørg aldrig igen.** **Ejer 20/9: måde B (jævnt, 5 pr. dato); A + synkrone blokke fjernet i #5169. B4 #5264 merget 20/9 bag flag.** **§2c (ejer 19/9):** S4 må laves om, indtil sæsonen er aktiv. `race_notify_outbox_enabled` OFF, flip ejer-only.

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende. `ratingGolden.5321.json` opdateres KUN m. ejer-go.

> **🟡 Lofter (ejer 18/9, byg intet):** potentialet styrer farten (#5351); #5268 afventer; svar #5436 upostet.

> **🔴 Åbne fund:** **#5589 + #5601 dashboard-vinder (brand, PR #5598)** · #5602 bølge-motor-opfølgning · #5618/#5617 bestyrelses-beta · mobil hurtig-hvile. **#5162 chunk (ejer 24/9):** verdensklasse-A lige EFTER S4-sporene. **CodeRabbit:** loft nået, lokal CR på risk:high. **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **S3:** slutter 27/9.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/4 fra S4 (ejer 24/9: D3+D4 samles ved skiftet, #4592). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning ≤ 21 er IKKE live (#5145 parkeret 14/9 til U23-sporet, branchen bevares; i dag ≤ 22). **Graduation Day ved 23** (live 15/9, side live 21/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Kalender-gaten blokerende (#4123); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus, program 7×5 løbsdage. #5205 + B4 #5264 + skader 5-25 (#5465) bag flag `training_tick_per_race_day` (off); live senest 28/9. **B3 #5281 er IKKE bag flag**, merges på flip-dagen.
- **Evner (live):** taktik/aggression uden alder for nye ryttere; `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9; motor: #5348 #5349 efter apply). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt (#5268) ejer-gated.
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396); puljer og løb har `squad` (A2 #5525, alt senior). `U23_BIRTH_BAND` = variant A (#5401), generator A6 dry-run (#5548); squad-backfill kørt 23/9; RPC'erne tæller pr. trup U23 12/junior 10 (#5547). Alt live 28/9; spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `node scripts/check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms, ejeren ekskl. (#5215).
- **Kort-regler (ejer 15/9 + 17/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · UI-PR = skærmbillede samme tur · **spillervendt rettelse = problem + løsning i klart sprog FØR byg** (bidt 17/9).
- **Mekanik:** byg KUN via wave.js (Codex: samme indgang, #5468); merge én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); intet PR-loft (#5510); commit kun bag guarden (#5094); ny tabel bag flag → `FLAG_GATED_EMPTY_TABLES`; migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; skærmbilleder: vite i eget worktree + Playwright; nye frontend-filer = .ts/.tsx. Base-PR merget → PR lukkes; retarget først (#5478).

> **🤖 Working agent:** Ingen aktiv session (24/9-b lukket; cloud-session bygger #5561 #5617 #5620 + specs på cloud/-grene).
