# Handoff fra merge-runden 3/9 til næste session

**Status ved skrivning (3/9 kl. 10:25):** 30 PR'er merget i dag, 8 åbne fra bølgen med workers i gang. Fuld liste: [`night-wave-2026-09-03.md`](../audits/night-wave-2026-09-03.md). Opdateres ved close-out.

## Hvad næste session skal (i rækkefølge)

1. **GitHub-audit** (ejer-ønske 3/9): kør `/github-housekeeping` med [`github-cleanup-candidates-2026-09-03.md`](../audits/github-cleanup-candidates-2026-09-03.md) som input (PR #4696): luk done-men-åbne issues, løste todo, dubletter; masterplan-drift-afsnittet ind i `MASTERPLAN.md` (ejer-godkendt rækkefølge, spørg før omprioritering). Lukning følger `GITHUB_WORKFLOW.md` (ejeren lukker per label-state-maskinen; AI lukker kun ved objektiv verifikation).
2. **S4-apply-kæden** (hård dato 27/9): når PR #4709 (regler/gates) og GT-katalog-PR'en (#4288-sporet) er merget: (a) `node backend/scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --race-days 28` uden `--apply` mod prod (read-only, worktree/main `backend/.env`), (b) scorecard skal være grønt på alle gates (eksakt kvote, monument-i-GT, mindste-overlap, rolling gulv/loft, GT-bånd, brosten/grus), (c) ejeren ser scorecardet og siger "kør", (d) `--apply` én gang (§2c), (e) post-verify: `seasons` har number 4 `upcoming`, 28 løbsdatoer, kvote 140/112/84/84, (f) årsmøde-tørkørslen (`proposeNextMandateDryRun.js`) finder S4.
3. **Rester fra bølgen** der ikke nåede merge i dag: se audit-tabellen "Resultat"-kolonnen; typisk kit-sider med e2e-rettelser, #4662 Pro-fordele (rebaset), #4673 (assistent bag flag), #4709.
4. **Ejer-only:** nøgleblokken #4616 (EUR-planer i Alunta, Railway-nøgler, Resend), derefter #4608 EUR-checkout merge; faktura #2 hos Alunta; #4388 S3-kompensation (A/B/C).
5. **Næste spor efter ejerens rækkefølge (pengeplan §3):** #4707 v4 jagt-kalibrering (ejer 3/9), #4209 GT-hviledage binder (efter #4191, ejer A), #4629 træningsprogrammer (wireframe-go), #4613 træningssiden (retning), #2223 indbakke (ejeren vælger variant A/B/C fra `docs/design/mockups/inbox-2223/`), #4263 (kræver `rider_value_history`), #3777 proposals-drift (natlig vagt rød; tre filer + schema_migrations-rækker med ejer-GO), #4711 shard-budget (manglende måling tolkes som 0).

## Læringer der skal ind i runbooken (docs-PR)

- Merge ALDRIG drafts i samme time som en bølge launches (ejer-merges 23:44 gjorde main rød for alle 32 PR'er; #4705 rettede fire vagter).
- Lane-pool-design virker (memory `project_night_wave_lane_pool_design`); lette spor 45-60 min timeout; dry-run-rapporter skal bruge apply'ets predikat.
- Session-død: alt overlevede fordi hvert spor pushede + oprettede PR selv; monitoren (bash `sleep`-loop) døde ved start; brug `gh pr checks --watch` i baggrunds-Bash som vækning.
- GitHub-runner-køen mætter ved 30+ PR'er × 3 shards: annullér mellemliggende main-kørsler (kun nyeste HEAD tæller) og opdatér frontend-PR'er først når shard-CI'en er inde.
