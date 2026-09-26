# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (26/9 kl. 23:15):** **NAT-SESSION**, prompt `private-handoffs/2026-09-27-nat-session-prompt.md`. I dag: værdikørslen KØRT (v6, løn 0, søndag 27/9 claimet, trin 1 = 4/10) · rating = bedste rolle on · U23/junior-sider on · Metro-L3 frosset+spærret · trin 6 kørt · parkering ved S4 = ja · patch 7.303 merget, 7.304 = #5811. Venter ejer-"merge": #5800 upkeep (flip før 12c) · #5801 programmer (beta) · #5803 GT (+ ingen GT dag 1) → S4-kalender "kør" → mandat-flip før "Afslut sæson". v4: 3 fejl rettes i nat, flip-beslutning søndag aften. Skiftet tidligst ca. 19:30 (S3 sidste etape 19:00). Løn-model: ugen efter skiftet.
>
> **Løfte-tavle 28/9 (løfte · nu):** tilmeldingskort, Discord-kort, comeback, ungdomsløb · live/merget · /roadmap-faner · #5387 A/B mangler · S4-kalender · 27/9 aften (12b) · U23/junior-sider · flip m. #5794 næste session · Mandatet · efter skiftet · D4→D3 + 4 puljer · 27/9 · træning fra løb · 28/9 (program pr. løbsdag #4629 IKKE bygget) · ryttertype-visning · søndag m. værdikørslen · upkeep-rework #4385 · ikke bygget.

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt. **140 er LÅST (ejer 15/9); spørg aldrig igen.** Måde B (5 pr. dato). §2c: S4 må laves om, indtil sæsonen er aktiv. **Junior må køre fra 16 (ejer 24/9). Juniorer må stå på U23 (YOUTH_RULES §2); trup-reglen er KUN en øvre grænse (#5794).**

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende; `ratingGolden.5321.json` KUN m. ejer-go.

> **🔴 Åbne fund:** #5162 chunk (EFTER S4) · #5633 (4/5 rettet) · #5692 matview timeouts · parkering ved S4 = åbent ejer-valg uden for #5506 (runbook l. 740). **📊 Triage:** `infisical run --env=dev --silent -- node scripts/sentry-issues.mjs --period=24h`. **Supabase 25/9:** 3 WARN dokumenteret. **S3:** slutter 27/9 kl. 15.

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

> **🤖 Working agent:** Ingen aktiv session (workflow-session 26/9 lukket 23:15; natsession starter på prompten).
