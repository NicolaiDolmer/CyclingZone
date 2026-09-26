# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (26/9 kl. 07:00, session f nat):** **1) Morgenblok:** 24 PR'er venter på dit "merge" (tabel: `private-handoffs/2026-09-26-session-f-rapport.md`): #5766 (U23/JR + hint) → flip `youth_squad_pages` · #5772 → #5786 (deler help.json) · resten. Valg: #5765 (B) · #5780 (A) · #5764 · mandat-svar. **2) Lørdag 27/9 (#5506 + #4859):** S4-række (12b) → `proposeNextMandateDryRun.js` → "kør" → `board_mandate_model_enabled` beta→on → post-verify → Discord-opslag (`docs/drafts/*-mandate-flip.md`, sæsonpause PR #5767). `academy_drift_enabled` off FØR 12c (#5741). **3) Mandag:** #5281 (grøn) + træningsflips.
>
> **Løfte-tavle 28/9 (løfte · nu):** tilmeldingskort · live · Discord-kort · live · /roadmap · live (faner = #5387-rest) · S4-kalender · skrives 27/9 aften (12b) · U23/junior-sider · beta, flyt-dialog #5750 merget (7.301), flag lørdag når ejeren har set siderne · Mandatet · **flip lørdag** (ejer-valg A 25/9): #5751 rettet + resynket, byggesten #5752-#5755 merget; tillid mættet = #5757 (S4) · D4→D3 + 4 puljer · køres 27/9 · comeback · merget · ungdomsløb · merget · træning fra løb · flip 28/9 (#5281 samme dag) · 140 løbsdage · låst · ryttertype-visning · beta.

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt. **140 er LÅST (ejer 15/9); spørg aldrig igen.** Måde B (jævnt, 5 pr. dato). §2c: S4 må laves om, indtil sæsonen er aktiv. `race_notify_outbox_enabled` ON siden 24/9. **Junior må køre fra 16 (ejer 24/9). Juniorer må stå på U23 (YOUTH_RULES §2, ejer 2/9).**

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende; `ratingGolden.5321.json` KUN m. ejer-go.

> **🔴 Åbne fund:** #5162 chunk (lige EFTER S4) · #5633 bestyrelses-beta (5 fund, blokerer #4859) · #5692 matview 34 timeouts/døgn. **📊 Triage:** `infisical run --env=dev --silent -- node scripts/sentry-issues.mjs --period=24h`. **Supabase 25/9:** 3 WARN dokumenteret, 125 INFO. **S3:** slutter 27/9.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/4 fra S4 (ejer 24/9: D3+D4 samles ved skiftet, script #5669). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder (`riderSeasonAge.js`, S3=2028). Akademi-nedrykning ≤ 21 IKKE live (#5145 parkeret). **Graduation Day ved 23** (live 15/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Kalender-gaten blokerende (#4123 + #5707 lige mange løbsdage); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus, program 7×5 løbsdage. Alt bag `training_tick_per_race_day` + `race_day_development_enabled` (off); live 28/9. **B3 #5281 er IKKE bag flag**, merges på flip-dagen.
- **Evner (live):** `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt (#5268) ejer-gated.
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396). Loft U23 12/junior 10 (#5626). Ungdomsdrift: 0 ved S3-skiftet (#5741, ejer 25/9), sats fra S4 åben. Spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms (#5215).
- **Kort-regler (ejer 15/9 + 17/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · UI-PR = skærmbillede samme tur · **spillervendt rettelse = problem + løsning i klart sprog FØR byg** · forklar hver PR i klart sprog i kortet (24/9).
- **Mekanik:** byg KUN via wave.js; merge én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); `mergeStateStatus` FØR vent på CI (DIRTY = merge main ind); samme bølge + samme fil → simulér merge + tsc FØR kø (25/9); commit kun bag guarden (#5094); migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; nye frontend-filer = .ts/.tsx.

> **🤖 Working agent:** Ingen aktiv session (session f lukket 26/9 kl. 07:00; rapport `private-handoffs/2026-09-26-session-f-rapport.md`).
