# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. **Hard rule 24 (ny 18/8):** orkestratoren ejer e2e-slottet ved parallelle workers.

## Aktiv styring

> **🎯 Næste action: UDRULNINGS-SESSION** ([prompt](sessions/2026-08-19-udrulning-stor-opdatering-session-prompt.md)) — bundlet (trin 7 + hele #3721) er FÆRDIGBYGGET på PR #3798 (66e301d58), fuldt verificeret (backend 6.560 ✓ frontend 2.219 ✓ e2e 520 ✓) og live på tester-staging web-production-aea1d.up.railway.app (testere inviteret 19/8 ~18:30). Åbner med: tester-feedback + ejerens 2 udestående svar (visuelt go på pr-screens/3721-*, weekly rhythm-placering) → merge → kæden (migration → backfill-dry-run 4.247/2.134 → refit → indbakke-besked → Discord). Løn-dommen faldt 20/8: #3393 er parkeret, PR #3992 (#3989) tager dens plads i drejebogen. Derefter: kalender → race-UI PR B → cutover sø 23/8.

> **💰 Værdi-sporet: LØN-SESSIONEN LEVERET 19/8** ([audit](audits/2026-08-19-loen-design-session.md)): niveau-korrektion = forhandlet kanal, gate-styret (RØD, maskineri bygget på #3449 inkl. #3733 trin 1) · A bekræftet på korrigeret 28-dages-præmis (60-løbsdages-fejlen fanget af ejer; dagsløns-divisor-bug fixet i #3393) · ungdomspakke #3972 (pull-intake, symbolsk intro) · forecast #3974 · præmie-D3/D4 + upkeep udskudt til efter cutover. Åbne: #3755 · #3756 · #3732.

> **📅 Cutover søndag 23/8** = race-day-flip + D1-komprimering + mandat-backfill (drejebog + værktøj + komprimering ALT merged/bevist). **👤 Ejer-klik: POST race-day-beskeden FØR søndag** ([cutover-beskeder](discord/2026-08-17-cutover-beskeder.md) besked 1) · Sentry-alarmregel · #3486 `VERCEL_TOKEN`.

> **📌 Opfølgninger:** #3661 er REELT ÅBEN (falsk done — de 4 design-proces-regler mangler i AGENTS.md; fanget af KS3's adversarielle verifikation) · #2884 anti-snipe mangler · sparkline-komponenten ligger klar til #3721-strukturdesignet (rytterprofil+træningsside designes SAMLET, ejer-krav 18/8) · #3592→trin 7 · W7 efter trin 7 · W8-bundter (54 needs-decision) · #3796/#3797 growth. Ops-gæld: 500 åbne.

> **🤖 Aktive sessioner: Ingen aktiv session.** Løn-sessionen 20/8 LUKKET. Ejer-dom: løn = `current_production_value` × **én global sats 0,35**, ingen divisions-skalering, markedsværdi er IKKE et løngrundlag → **#3393 PARKERET** (målt: den genindfører inversionen på evne-aksen). Leveret: [#3989](https://github.com/NicolaiDolmer/CyclingZone/issues/3989) design+måling · PR [#3991](https://github.com/NicolaiDolmer/CyclingZone/pull/3991) `race_days_total` MERGED · PR [#3992](https://github.com/NicolaiDolmer/CyclingZone/pull/3992) løn + PR [#3993](https://github.com/NicolaiDolmer/CyclingZone/pull/3993) upkeep-linje (begge draft, afventer **ejer-go på det visuelle**). Prod-verificeret: medianholdets S3-prognose falder fra 110.231 (×19,4) til 11.984 (×2,2). Nye issues: #3994 (gul risiko-tekst siger "underskud" ved positiv netto). **👤 Ejer-klik: known-issue-række i `ops_notices` + Discord-besked (udkast i sessionen).** Perf-gaten var rød på main selv (2,8 KB over) — budget hævet 880→885.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold (komprimering). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag i puljen. **Pension:** måles på AFSLUTTET sæsons alder.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben (service-key-rotation). **Skalering:** #323 (paraply; 330-332 lukket).

_Historik i git-log, issue-tråde + docs/audits/._
