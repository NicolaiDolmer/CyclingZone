# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **⏰ Påmind ejeren:** Alunta-faktura 61,25 kr. · CodeRabbit-loft (1 review/time) · `INDEXNOW_KEY` (#6558) · VAPID-nøgler til push (#6590) · **spillerkommunikation:** gennemgå roadbook, svarliste (44 + 4 nye udkast 15/10) og Discord 7.356-7.361 + færdiggør patch-PR #6661 via `docs/sessions/2026-10-15-kommunikation-gennemgang.md` (#6319); known issues opdateret i prod 15/10. · **forsiden #6665:** ejeren læser selv; spørg ikke.
>
> **🎯 Next action:** (1) Akademi før søn 18/10 kl. 00: ejer vælger #6673 (2.0) eller #6662, derefter flag-flip på ordret go (#6155). (2) #6677 merge formiddag. (3) Ejer-go: #6692 ikoner (billede sendt) · #6694 roadmap auto-beta (migration) · patch note #6661 ny ordlyd · idébanken E på https://claude.ai/artifact/WZUTZr9bRMgvo43KAYC5n6 · #6643 animation · #6691 hjælpetekst. (4) #6490 genmål 16/10 aften. (5) Codex-løkke på #6657 #6671 #6680: merge ved ren gate.
>
> **15/10:** pc1 merget #6637 #6639 #6640 #6646 #6652 #6659 #6663 #6669 #6670 #6672 #6675 #6689 #6658 · DOLMERPC merget #6664 #6676 #6678 #6682 #6685 #6688 · flag: `stage_page_v2`=beta, `training_bulk_day`=beta, `first_race_card`=on · aften: aftenspidsen max 50 s → 1,1 s (#6490) · triage 23 + 12 undersøgelser på issues · roadmap A-C i prod (backup `backup_*_20261015`).
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
> **🤖 Working agent:** pc1 (NicolaiPC) samlet session 15/10 aften, driver merge-køen; ingen bølge kører.
