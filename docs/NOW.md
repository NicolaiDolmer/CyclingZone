# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **⏰ Påmind ejeren:** fakturaer (Supabase, Railway inkl. pleasing-spontaneity, Vercel, Alunta 61,25 kr., Stripe, AI) · moms/revisor · slet Railway-var `RACE_DAY_ROLE_YIELD_PARAMS` · sikkerhed #691/#720/#748 · slet `backup_7401_20261101_riders`, `backup_7488_20261102_riders`, `backup_7508_20261102_notif_ids` (forfaldne) · slet `backup_5902_20261112_*` ~26/11 · slet `backup_8078/8080/8099_20261113_*` ~27/11.
>
> **🎯 Next action (tor 26/11 eftermiddag, PC1):** dagens plan står i MASTERPLAN "Tidsplan 26/11" og på roadmappet (opdateret 26/11). 1) merge-kø: #8792 → #8678 → #8763 → #8732/#8723/#8724 → Fable-dømte træning (#8779, #8771) → tekster #8787 → tændinger (rotation, ugeprioritet, akademisiden) med ejerens ja · 2) mail 1 #8766/#8767: ejer tjekker, test, send 17-18 · 3) laner: planlægning #8790/#8791, prognose #8788, ungdom #8794, S6-kalender + regelmatrix #5841, ruter #8259, #8592, #8180 · 4) prøveskifte #7325 (dump kræver ejerens ja) · 5) skift lør 28/11. Rækkeloft-audit 26/11: 5 læsninger rammer 1.000-loftet (#8180 m.fl.). Falsk lukket: #8045 genåbnet, #8793 rodårsag. **Merget 26/11 eftermiddag:** #8723 #8757 #8748 #8742 #8767 #8763 (kontraktloft) #8722 #8761.
>
> **🤖 Working agent:** PC1-Claude (session 26/11), wave a4bf151d.

> **🔴 Træningens realisme-regel (ejer 18/9, låst, #5267):** løbsdag = én dato · ét løb ELLER træning · etapeløb binder til sidste etape · lige mange løbsdage overalt. **140 er LÅST (ejer 15/9); spørg aldrig igen.** Måde B (5 pr. dato). §2c: S4 må laves om, indtil sæsonen er aktiv. **Junior må køre fra 16 (ejer 24/9). Juniorer må stå på U23 (YOUTH_RULES §2); trup-reglen er KUN en øvre grænse (#5794).**

> **🔴 Rating-reglen (17/9):** én rating overalt; synlige ratings falder aldrig uden ejerens vidende; `ratingGolden.5321.json` KUN m. ejer-go.

> **🔴 Åbne fund:** #7832 sent hold mister træningsdato (ingen efterbetaling, ejer 12/11) · #6490 aftenspids · #7139 ranglisten halter · #6504 frigivelse. **📊 Triage:** `infisical run --env=dev --silent -- node scripts/sentry-issues.mjs --period=24h`.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/4 fra S4 (ejer 24/9: D3+D4 samles ved skiftet, script #5669). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder (`riderSeasonAge.js`, S3=2028). Akademi-nedrykning følger truppens aldersgrænse (#5547; #5145 lukket som overhalet 8/10). **Graduation Day ved 23** (live 15/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` ON; v4 kører officielle etaper. Kalender-gaten blokerende (#4123 + #5707); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus. Prod-måling 30/9: `training_tick_per_race_day`, `training_condition_per_date`, `race_day_development_enabled` og `race_day_engine_enabled` on. Dato-modellen aktiveret 29/9; B3 #5281 er IKKE bag flag.
- **Evner (live):** `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt (#5268) ejer-gated.
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; senior-læserne bruger ÉT delt prædikat (#5396). Loft U23 12/junior 10 (#5626). Ungdomsdrift: 0 ved S3-skiftet (#5741, ejer 25/9), sats fra S4 åben.
- **Forside `/`:** anonym = marketing-sitet; ændring → `check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms (#5215).
- **Kort-regler (ejer 15/9-26/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · **UI-PR = ÉT annoteret før/efter-billede** · spillervendt rettelse = problem + løsning FØR byg.
- **Mekanik:** parallelbyg via `wave.js` / `scripts/codex-wave.mjs`; ÉN merge-kø (`scripts/merge-queue.ps1 -Pr "a,b,c"`, aldrig kædede ventere); `mergeStateStatus` FØR vent på CI; commit kun bag guarden (#5094); migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; nye frontend-filer = .ts/.tsx; klassifikator-blokeret merge → ejeren kører selv.
