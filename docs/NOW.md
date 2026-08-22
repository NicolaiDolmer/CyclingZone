# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (inkl. uge-plan 21-25/8) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action — TO ting før 19:30, begge ejer-kørsler:** (1) **KALENDER-APPLY**, se blokken nedenfor — vinduet lukker ved cutover. (2) **GENERALPRØVE (IKKE kørt endnu):** drejebog (a)-(h) mod staging `staging-3746-trin7` m. stopur + restore-drill; ejerens staging-nøgle kræves til (e) mandat-apply; (f) løn-genberegning omfatter akademi (verificeret). Output = søndagsplan m. målte tider. **Værdi-overgangen er PARKERET på gaten:** måling 22/8 RØD (0,225 > 0,15); cron måler ugentligt, realistisk 30/8+. Apply-population inkl. akademi, normalisering 1,1068. Ejeren bedømmer på `/admin/value-transition`.

> **📅 Cutover SØNDAG 19:30-22:30** (drejebog rev. 21/8): snapshot → race-day-flip → D1-komprimering → løn-genberegning → mandat-backfill → flag-flip #4007+#3449-c. Gate c: race_days_total = **28**. v4-gate MANDAG aften → evt. LIVE tir 25/8, v3-fallback ved rødt.

> **👤 Ejer-klik:** post besked 1 (race-day) + den OPRINDELIGE besked 2 (værdier, gate-styret, ingen dato — [cutover-beskeder](discord/2026-08-17-cutover-beskeder.md); 22/8-udkastet må IKKE postes) FØR søndag · S3-kalenderen LÅSES (lovet fre/lør!) · post #patch-notes-catchup + 13 community-tråde ([discord/2026-08-21-community-traade-en.md](discord/2026-08-21-community-traade-en.md)) · /pro: #4074 valuta-mismatch blokerer flip · JeppeK-navne (#4039) · #3486 VERCEL_TOKEN · `railway login` (MCP-token udløbet 22/8).

> **📌 Opfølgninger:** kalibrerings-session efter cutover: #3719/#3720/#3987/#3732/#2650 + #4059 (skarpe-dage-seed-skævhed, bekræftet 21/8) + D1-løn-sats + #3966-bånd · #3347-scorecard NO-GO for D2/D4 (katalog-bundet, interim) · W8 bundt 2 · #4001 · miljø-audit + #691 uge 35 · #3952/#3982 visuals · #4037 · `ceilingBandInversion.test.js` rød lokalt (CI grøn) · #4073 · team-orders-whitelist BLIVER indtil `tacticsOrdersAdapter.js` fetcher rigtigt · **#3448-anker** pushet som backup (`feat/3448-level-anchor`) — PR først EFTER værdi-overgangen · **worktree-hygiejne EFTER cutover** (klassificér ucommitted + ugentlig `cleanup:worktrees`; se MASTERPLAN Ops).

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 28 løbsdatoer (`race_days_total`=28 efter #4075-regen).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Skalering:** #323.
- **Spiller-kommunikation (ejer-mandat 22/8):** fast ugerytme MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar spillerne inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)). Tråd-bank klar: [#4117](https://github.com/NicolaiDolmer/CyclingZone/issues/4117). Viger aldrig for et feature-spor.

> **🧭 Planning Center: spec EJER-GODKENDT 21/8** — [superpowers/specs/2026-08-21-planning-center-fase2-design.md](superpowers/specs/2026-08-21-planning-center-fase2-design.md) (P0-P5; byg tidligst efter v4-gaten). **A6 AFGJORT 21/8: kalender-fanen består; Z1 v0 Season-visningen er shippet** (#4083). §3.4+§3.5 udført. Åbent: #3990-resten. Ny: #4076 (stående ordrer P3).
>
> **🔴 KALENDER-APPLY FØR 19:30 (ejer-kørsel):** [PR #4121](https://github.com/NicolaiDolmer/CyclingZone/pull/4121) — GT-dagsform (0 dage m. 5 GT-etaper, Giro 11→6 dage, D1 dage-uden-afgørelse 7→2) + monument-længder (Roubaix 155→255 km). 7024/7024 + preflight grønne. **Løbsudvalget er bit-identisk** — regenerering ruller IKKE kalenderen om. Merge → `git pull` → `regenSeason3Calendar.mjs` dry-run → ejer ser den → wipe+regen. `wipeSeason3Calendar.mjs` nægter at køre når sæsonen er `active`; efter 19:30 er det for sent. Claude er blokeret fra prod-scripts.

> **🤖 Ingen aktiv session.** Kalender-/værdi-session 22-23/8 lukket: masterplan + artifact opdateret, spor P oprettet · Discord-sweep → #4118/#4119 · **#4120 løn på frossen ryttertype (19,8x spænd) = ejer-valg A/B/C FØR søndagens løn-trin** · #4103-audit kørt (ITT D3 15,5 % mod D4 1,8 %; brosten D3 3x D1 — balance-valg til uge 35) · #4105 omfangs-rettet (ingen grus-arketype findes) · nye: #4122 forfattede løb, #4123 kalender-invarianter i CI.

_Historik i git-log, issue-tråde + docs/audits/._
