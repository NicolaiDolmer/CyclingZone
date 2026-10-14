# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **⏰ Påmind ejeren:** Alunta-faktura nr. 2 (61,25 kr., Sentry -62) afstemmes i Dinero, derefter Claude: Pro-afvigelse · CodeRabbit-loft nået (ejer) · `INDEXNOW_KEY` som GitHub-secret (#6558) · post Discord-tekst for 7.359 (docs/drafts/patch-7359) + app-opslag i forum.
>
> **🎯 Next action (startprompt `docs/sessions/2026-10-14-aften-s5-kalender.md`):** (1) Forum-afstemningerne (lukket kl. 20) → S5-start i #5833 → generatoren. (2) S5-profiler + kalender live senest lør 18/10 (#6369: #6360 #6362 #6364, #6570), første bølge med 6 laner. Datokort tor (#6601, forberedt i OneDrive `private-handoffs/2026-10-14-datokort-forberedelse-6601.md`). (3) Højdeprofil live (#6599/#6577); S5-tørkørsel tor. (4) Google Play-kort (#6584 spor 3) · push-tænding (VAPID, #6590). (5) #6490 aften 2 → DROP INDEX-kort. (6) Forretning frem mod 21/10: #6601 (privat del i OneDrive-context/private-handoffs).
>
> **14/10 pc1 merget + verificeret:** major-efterslæb #6604 (Sentry 11 events fra Railway+prod, @vercel/og 1.0 live, React 19-lint, ESLint 10 marketing) · -80 læselig (#6614) · 6 laner på NICOLAIPC (#6619) · preflight = CI-vagter (#6620). Åbent: #6616 pkt 2, #6617, #6618. **13-14/10:** app/PWA (#6585) · push bag slukket flag (#6591) · højdeprofil (#6599) + road book (#6577, med i S5) · Dagens etaper (#6576) · patch 7.359. Ingen nye løbende udgifter.
>
> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt. **140 er LÅST (ejer 15/9); spørg aldrig igen.** Måde B (5 pr. dato). §2c: S4 må laves om, indtil sæsonen er aktiv. **Junior må køre fra 16 (ejer 24/9). Juniorer må stå på U23 (YOUTH_RULES §2); trup-reglen er KUN en øvre grænse (#5794).**

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende; `ratingGolden.5321.json` KUN m. ejer-go.

> **🔴 Åbne fund:** #6490 aftenspids · #5692 matview · #6504 frigivelse. **📊 Triage:** `infisical run --env=dev --silent -- node scripts/sentry-issues.mjs --period=24h`.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/4 fra S4 (ejer 24/9: D3+D4 samles ved skiftet, script #5669). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder (`riderSeasonAge.js`, S3=2028). Akademi-nedrykning følger truppens aldersgrænse (#5547; #5145 lukket som overhalet 8/10). **Graduation Day ved 23** (live 15/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` ON (prod læst 1/10); v4 kører officielle etaper. Flip-rapport forældet (#5515). Kalender-gaten blokerende (#4123 + #5707); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus. Prod-måling 30/9: `training_tick_per_race_day`, `training_condition_per_date`, `race_day_development_enabled` og `race_day_engine_enabled` on. Dato-modellen aktiveret 29/9; B3 #5281 er IKKE bag flag.
- **Evner (live):** `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt (#5268) ejer-gated.
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396). Loft U23 12/junior 10 (#5626). Ungdomsdrift: 0 ved S3-skiftet (#5741, ejer 25/9), sats fra S4 åben. Spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms (#5215).
- **Kort-regler (ejer 15/9-26/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · **UI-PR = ÉT annoteret før/efter-billede** · spillervendt rettelse = problem + løsning FØR byg.
- **Mekanik:** parallelbyg via `wave.js` / `scripts/codex-wave.mjs`; ÉN merge-kø (`scripts/merge-queue.ps1 -Pr "a,b,c"`, aldrig kædede ventere); `mergeStateStatus` FØR vent på CI; commit kun bag guarden (#5094); migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; nye frontend-filer = .ts/.tsx; klassifikator-blokeret merge → ejeren kører selv.
> **🤖 Working agent:** Claude DOLMERPC 14/10 aften: S5-bølge (#6367, #6362), #6570, #6628, #6629. Codex → #6601.
