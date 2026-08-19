# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. **Hard rule 24 (ny 18/8):** orkestratoren ejer e2e-slottet ved parallelle workers.

## Aktiv styring

> **🎯 Næste action: UDRULNINGS-SESSION** ([prompt](sessions/2026-08-19-udrulning-stor-opdatering-session-prompt.md)) — bundlet (trin 7 + hele #3721) er FÆRDIGBYGGET på PR #3798 (66e301d58), fuldt verificeret (backend 6.560 ✓ frontend 2.219 ✓ e2e 520 ✓) og live på tester-staging web-production-aea1d.up.railway.app (testere inviteret 19/8 ~18:30). Åbner med: tester-feedback + ejerens 2 udestående svar (visuelt go på pr-screens/3721-*, weekly rhythm-placering) → merge → kæden (migration → backfill-dry-run 4.247/2.134 → refit → indbakke-besked → Discord). #3393 merges FØRST 23/8 (løn-dom). Derefter: kalender → race-UI PR B → cutover sø 23/8.

> **✅ KS3 LUKKET 18/8** ([audit](audits/2026-08-18-kvalitetssession-3.md)): **D1-plan LÅST+BYGGET** (PR #3930 merged, dry-run godkendt — apply ejer-gated søndag m. frosset snapshot) · designs låst: #3899/#3900/#3924 · backlog net −32 (500 åbne). Merge-køen fra KS3 er landet og v7.144 skrevet (se session-linjen nedenfor).

> **💰 Værdi-sporet: LØN-SESSIONEN LEVERET 19/8** ([audit](audits/2026-08-19-loen-design-session.md)): niveau-korrektion = forhandlet kanal, gate-styret (RØD, maskineri bygget på #3449 inkl. #3733 trin 1) · A bekræftet på korrigeret 28-dages-præmis (60-løbsdages-fejlen fanget af ejer; dagsløns-divisor-bug fixet i #3393) · ungdomspakke #3972 (pull-intake, symbolsk intro) · forecast #3974 · præmie-D3/D4 + upkeep udskudt til efter cutover. Åbne: #3755 · #3756 · #3732.

> **📅 Cutover søndag 23/8** = race-day-flip + D1-komprimering + mandat-backfill (drejebog + værktøj + komprimering ALT merged/bevist). **👤 Ejer-klik: POST race-day-beskeden FØR søndag** ([cutover-beskeder](discord/2026-08-17-cutover-beskeder.md) besked 1) · Sentry-alarmregel · #3486 `VERCEL_TOKEN`.

> **📌 Opfølgninger:** #3661 er REELT ÅBEN (falsk done — de 4 design-proces-regler mangler i AGENTS.md; fanget af KS3's adversarielle verifikation) · #2884 anti-snipe mangler · sparkline-komponenten ligger klar til #3721-strukturdesignet (rytterprofil+træningsside designes SAMLET, ejer-krav 18/8) · #3592→trin 7 · W7 efter trin 7 · W8-bundter (54 needs-decision) · #3796/#3797 growth. Ops-gæld: 500 åbne.
> **🗄️ Supabase-hygiejne 19/8 KOMPLET:** #2677+#3035 eksekveret+verificeret i prod · ugentlige DB-vagter + restore-drill live · PITR fravalgt (#3977) · mandag: mål realtime-effekt (query i #3035).

> **🚨 Incident 18/8 LØST (#3934):** fixet+verificeret i prod; rest: raceRunner/regenerate på samme RPC (én writer). Detaljer i issuet.
> **🚨 Incident 18/8 aften LØST (#3961, PR #3962 auto-merger):** en efterladt lokal staging-backend (trin 7-scriptet, mod branch-klonen med kopieret `discord_settings`) re-simulerede snapshot-løb og postede 60 falske resultat-embeds til rigtige spillerkanaler 20:32–21:41. Proces dræbt, live-guard bygget (Discord kræver prod-DB), evidens+slette-script klar. **👤 Ejer-klik: kør slette-scriptet (60 opslag) + evt. kort spillerbesked.** Postmortem: `.claude/learnings/2026-08-18-staging-backend-poster-til-prod-discord.md`.
> **🤖 Aktive sessioner: Ingen aktiv session.** Merge-dag/bundle-sessionen LUKKET 19/8 aften: bundlet bygget+verificeret+deployet til tester-staging, lokale servere/worktrees ryddet (stack/3721-* merget og slettet). Dagens triage: #3979-#3985 oprettet, #3959 merged+#3953 lukket, evidens på #3924/#2442/#3854/#3961/#3746. Staging-klonen fik team_staff.slot + webhooks nullet + testkontoens manager_name. Kør IKKE radius-bølgen uden ejer-go.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold (komprimering). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag i puljen. **Pension:** måles på AFSLUTTET sæsons alder.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben (service-key-rotation). **Skalering:** #323 (paraply; 330-332 lukket).

_Historik i git-log, issue-tråde + docs/audits/._
