# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (24/9 kl. 19:20, session d lukket):** **Værdierne først, alt andet bagefter (ejer 24/9 aften): rækkefølge, ikke datoer.** (1) Admin-forhåndsvisning af værdier før/efter pr. model (#5686) FØR modellen er færdig · (2) den samlede model i #5497: type fylder mindre + elitepræmie i trin + marked fra start, indfasningsplan, managerholds ryttere med; gate = admin-siden → ejer "kør" (runbook #5443) · (3) mockups før byg: mobil-træning ét-tryk (#5685), potentiale-oplevelsen (#5683) · (4) post-verify outbox efter første FINAL-etape + digest dry_run i email_log · (6) "kør"-kort `race_finalize_resumable_enabled`, `youth_squad_pages` on · (7) småfejl-lane. Fuld kø: OneDrive `private-handoffs/2026-09-25-morgenrapport.md`.
>
> **Løfte-tavle 28/9 (løfte · nu):** tilmeldingskort · live · Discord-kort · live · /roadmap · live · S4-kalender 24 t · merget · U23/junior-sider · beta (#5666 #5688 merget, patch note 7.298), flag til alle afventer beta-svar · Mandatet · beta, #5679 merget, flip 28/9 · D4→D3 + 4 puljer · merget (#5669 #5651), køres 27/9 · comeback · merget (#5661) · ungdomsløb · alt merget (#5650 #5666 #5671) · træning fra løb · merget (#5640 #5654 #5670 #5663), flip 28/9 · 140 løbsdage · merget · ryttertype-visning · beta 24/9 (#5435).

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt. **140 er LÅST (ejer 15/9); spørg aldrig igen.** Måde B (jævnt, 5 pr. dato). §2c: S4 må laves om, indtil sæsonen er aktiv. `race_notify_outbox_enabled` ON siden 24/9 kl. 18:45 (ejer-kør), verificér efter første final-etape. **Junior må køre fra 16 (ejer 24/9).**

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende; `ratingGolden.5321.json` KUN m. ejer-go.

> **🔴 Åbne fund:** #5162 chunk (lige EFTER S4-sporene) · #5618/#5617 bestyrelses-beta · #5635 Discord-sweep. **CodeRabbit:** loft nået, lokal CR på risk:high. **📊 Triage:** `scripts/sentry-issues.mjs --period=7d` via infisical. **S3:** slutter 27/9.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/4 fra S4 (ejer 24/9: D3+D4 samles ved skiftet, script #5669). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder (`riderSeasonAge.js`, S3=2028). Akademi-nedrykning ≤ 21 IKKE live (#5145 parkeret). **Graduation Day ved 23** (live 15/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Kalender-gaten blokerende (#4123); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus, program 7×5 løbsdage. Alt bag `training_tick_per_race_day` + `race_day_development_enabled` (off); live 28/9. **B3 #5281 er IKKE bag flag**, merges på flip-dagen.
- **Evner (live):** `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt (#5268) ejer-gated.
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396); puljer og løb har `squad`. Loft U23 12/junior 10 (#5626). Alt live 28/9; spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms (#5215).
- **Kort-regler (ejer 15/9 + 17/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · UI-PR = skærmbillede samme tur · **spillervendt rettelse = problem + løsning i klart sprog FØR byg** · forklar hver PR i klart sprog i kortet (24/9).
- **Mekanik:** byg KUN via wave.js; merge én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); tjek `mergeStateStatus` FØR vent på CI (DIRTY = merge main ind); stablede PR'er retargetes til main FØR base merges (#5655→#5670); commit kun bag guarden (#5094); migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; nye frontend-filer = .ts/.tsx.

> **🤖 Working agent:** Claude Code DOLMERPC 25/9-a (fra 24/9 kl. 20): værdi-bølge kører (#5686→PR 5690, #5497→PR 5502, #5689→PR 5691).
