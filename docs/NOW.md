# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. **Hard rule 24 (ny 18/8):** orkestratoren ejer e2e-slottet ved parallelle workers.

## Aktiv styring

> **🎯 Næste action: MERGE-DAG 19/8** ([prompt](sessions/2026-08-19-merge-dag-session-prompt.md)) — ejer-test + merge-go på trin 7 (PR #3798, CI helt grøn), hele udrulningskæden i mål (migration → backfill m. dry-run-tal → besked), derefter PR-køen (#3959 · rebase #3393/#3449 · A/B #3512). Test-links, testkonto og alle kæde-trin står i prompten. Derefter LØN-SESSION ([prompt](sessions/2026-08-19-loen-design-session-prompt.md)) + ugen (kalender → race-UI PR B → cutover sø 23/8).

> **✅ KS3 LUKKET 18/8** ([audit](audits/2026-08-18-kvalitetssession-3.md)): **D1-plan LÅST+BYGGET** (PR #3930 merged, dry-run godkendt — apply ejer-gated søndag m. frosset snapshot) · designs låst: #3899/#3900/#3924 · backlog net −32 (500 åbne). Merge-køen fra KS3 er landet og v7.144 skrevet (se session-linjen nedenfor).

> **💰 Værdi-sporet:** beslutning 1-5+7 truffet; **nøglefund: kørende × 0,422 slår alt** → niveau-korrektion i løn-sessionen. Åbne: #3755 · #3756 · #3732 · #3733 (design låst). #3449 draft til løn-sessionen.

> **📅 Cutover søndag 23/8** = race-day-flip + D1-komprimering + mandat-backfill (drejebog + værktøj + komprimering ALT merged/bevist). **👤 Ejer-klik: POST race-day-beskeden FØR søndag** ([cutover-beskeder](discord/2026-08-17-cutover-beskeder.md) besked 1) · Sentry-alarmregel · #3486 `VERCEL_TOKEN`.

> **📌 Opfølgninger:** #3661 er REELT ÅBEN (falsk done — de 4 design-proces-regler mangler i AGENTS.md; fanget af KS3's adversarielle verifikation) · #2884 anti-snipe mangler · sparkline-komponenten ligger klar til #3721-strukturdesignet (rytterprofil+træningsside designes SAMLET, ejer-krav 18/8) · #3592→trin 7 · W7 efter trin 7 · W8-bundter (54 needs-decision) · #3796/#3797 growth. Ops-gæld: 500 åbne.

> **🚨 Incident 18/8 LØST (#3934, PR #3937 merged + migration applied):** #3420-constrainten gjorde sweepens rytter-swaps til 23P01-dødvande (~350 enheder/tick; Avesnois kørte m. 23 underfyldte hold). Fix: constraint DEFERRABLE + batch-RPC pr. hold + completion-trigger på binding_span. Verificeret i prod: 0 fejlede enheder. Opfølgning: raceRunner/regenerate på samme RPC (én writer). v7.143 patch note skrevet.
> **🚨 Incident 18/8 aften LØST (#3961, PR #3962 auto-merger):** en efterladt lokal staging-backend (trin 7-scriptet, mod branch-klonen med kopieret `discord_settings`) re-simulerede snapshot-løb og postede 60 falske resultat-embeds til rigtige spillerkanaler 20:32–21:41. Proces dræbt, live-guard bygget (Discord kræver prod-DB), evidens+slette-script klar. **👤 Ejer-klik: kør slette-scriptet (60 opslag) + evt. kort spillerbesked.** Postmortem: `.claude/learnings/2026-08-18-staging-backend-poster-til-prod-discord.md`.
> **🤖 Aktive sessioner: SPILLEROPLEVELSES-SESSIONEN kører (trin 7-overgang, venter ejer-test).** Ejerkrav 18/8 efter 17/8-målingen: spillerne skal SE at intet er taget. Bygget + CI-grønt på PR #3798: loft ved siden af prognosen (roleCeilRating i estimates, hero/scouting/tooltips) + engangspanel (/api/development/transition, backup-tabel = før-tal, dismiss-migration medfølger) + patch 7.145 + help + omskrevet besked. Fuld suite ✓, ægte-data-staging (branch staging-3746-trin7) gennemspillet m. testkonto trin7-tester@staging...invalid. Kører lokalt: :3001 + :5173 (branch-data) + :5205 (mock). Railway cz-staging-3746 klar; deploys = ejerens 2 `railway up` (chat). Promptens Blok 1+2+3 (resultat-øjeblik, #3721-struktur, scouting 2.0) IKKE påbegyndt. Svarudkast: `docs/discord/2026-08-18-svarudkast-uge33.md`. Kør IKKE radius-bølgen uden ejer-go.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold (komprimering). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag i puljen. **Pension:** måles på AFSLUTTET sæsons alder.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben (service-key-rotation). **Skalering:** #323 (paraply; 330-332 lukket).

_Historik i git-log, issue-tråde + docs/audits/._
