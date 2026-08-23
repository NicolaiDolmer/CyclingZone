# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (inkl. uge-plan 21-25/8) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action: GENERALPRØVE — ejer-aftale 23/8: køres i morgen tidlig, ikke i nat.** drejebog (a)-(h) mod staging `staging-3746-trin7` m. stopur + restore-drill; ejerens staging-nøgle kræves til (e) mandat-apply; (f) løn-genberegning omfatter akademi (verificeret). Output = søndagsplan m. målte tider. **Værdi-overgangen er PARKERET på gaten:** måling 22/8 RØD (0,225 > 0,15); cron måler ugentligt, realistisk 30/8+. Apply-population inkl. akademi, normalisering 1,1068. Ejeren bedømmer på `/admin/value-transition`.

> **📅 Cutover SØNDAG 19:30-22:30** (drejebog rev. 21/8): snapshot → race-day-flip → D1-komprimering → løn-genberegning → mandat-backfill → flag-flip #4007+#3449-c. Gate c: race_days_total = **28**. v4-gate MANDAG aften → evt. LIVE tir 25/8, v3-fallback ved rødt.

> **👤 Ejer-klik:** post besked 1 (race-day) + den OPRINDELIGE besked 2 (værdier, gate-styret, ingen dato — [cutover-beskeder](discord/2026-08-17-cutover-beskeder.md); 22/8-udkastet må IKKE postes) FØR søndag · S3-kalenderen LÅSES (lovet fre/lør!) · post #patch-notes-catchup + 13 community-tråde ([discord/2026-08-21-community-traade-en.md](discord/2026-08-21-community-traade-en.md)) · /pro: #4074 valuta-mismatch blokerer flip · JeppeK-navne (#4039) · #3486 VERCEL_TOKEN · `railway login` (MCP-token udløbet 22/8).

> **📌 Opfølgninger:** kalibrerings-session efter cutover: #3719/#3720/#3987/#3732/#2650 + #4059 (skarpe-dage-seed-skævhed, bekræftet 21/8) + D1-løn-sats + #3966-bånd · #3347-scorecard NO-GO for D2/D4 (katalog-bundet, interim) · W8 bundt 2 · #4001 · miljø-audit + #691 uge 35 · #3952/#3982 visuals · #4037 · `ceilingBandInversion.test.js` rød lokalt (CI grøn) · #4073 · team-orders-whitelist BLIVER indtil `tacticsOrdersAdapter.js` fetcher rigtigt · **#3448-anker** pushet som backup (`feat/3448-level-anchor`) — PR først EFTER værdi-overgangen · **worktree-hygiejne EFTER cutover** (klassificér ucommitted + ugentlig `cleanup:worktrees`; se MASTERPLAN Ops) · **#4128** traeningsberegning (plan klar i issuet).

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 28 løbsdatoer (`race_days_total`=28 efter #4075-regen).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Skalering:** #323.
- **Spiller-kommunikation (ejer-mandat 22/8):** fast ugerytme MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar spillerne inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)). Tråd-bank klar: [#4117](https://github.com/NicolaiDolmer/CyclingZone/issues/4117). Viger aldrig for et feature-spor.

> **🧭 Planning Center: spec EJER-GODKENDT 21/8** — [superpowers/specs/2026-08-21-planning-center-fase2-design.md](superpowers/specs/2026-08-21-planning-center-fase2-design.md) (P0-P5; byg tidligst efter v4-gaten). **A6 AFGJORT 21/8: kalender-fanen består; Z1 v0 Season-visningen er shippet** (#4083). §3.4+§3.5 udført. Åbent: #3990-resten. Ny: #4076 (stående ordrer P3).
>
> **✅ KALENDER-APPLY GENNEMFØRT 23/8 kl. 00:32** via workflow `season3-calendar-apply.yml` (dispatch, ejer-gated). Verificeret mod prod: 471 løb, 28 dage 25/8-21/9, maks 4 GT-etaper/dag, Giro 6 dage, monumenter 255-290 km, ingen delt GT-dag. Snapshot af den gamle kalender ligger som artifact (90 dage).

> **🤖 Ingen aktiv session.** Discord-triage + loft-analyse 23/8 lukket: sweep → #4124 (sæsonskifte-tidslinje), #4125 (divisions-upkeep) · **#4098 verificeret i data: 353 unge ryttere på 124 af 362 hold står "done" ~65 pt under eget maks-loft** (climbing værst; loft-19 = aldersnedskrivning fra 27 år, ikke evne-specifikt) · nyt #4128 (evne fastlåst under loft, 16 uforklarede) **planlagt men IKKE udført**: akkumulerer dagsudbyttet? start `dailyTrainingEngine.js` + `riderProgression.js:89`; `ability_progress` er kandidat-akkumulator · **ejer-klik venter:** thelamba-svaret i `docs/discord/2026-08-23-gt-dagsform-svar-thelamba.md`.

_Historik i git-log, issue-tråde + docs/audits/._
