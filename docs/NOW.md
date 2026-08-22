# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (inkl. uge-plan 21-25/8) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action: GENERALPRØVE (egen session, ejer-beslutning 22/8 — IKKE kørt endnu):** drejebog (a)-(h) mod staging `staging-3746-trin7` m. stopur + restore-drill; ejerens staging-nøgle kræves til (e) mandat-apply; (f) løn-genberegning omfatter akademi (verificeret). Output = søndagsplan m. målte tider. **Værdi-overgangen er PARKERET på gaten:** officiel måling 22/8 RØD (spænd 0,225 > 0,15; nyeste vindue 0,775, median90 0,655, n90=80); cron måler søn 23/8 + ugentligt, realistisk 30/8+. Apply-population nu INKL. akademi (ejer 22/8), normalisering 1,1068. Ejeren bedømmer på `/admin/value-transition` (ejer-only, akademi på begge faner, 6.765 ryttere, tabel genbygget 22/8 18:30).

> **📅 Cutover SØNDAG AFTEN 19:30-22:30** (drejebog rev. 21/8): snapshot → race-day-flip (pre-flip-gate: remeasureGate3459) → D1-komprimering → løn-genberegning (dry-run ×2,21) → mandat-backfill → flag-flip #4007+#3449-c. **Generalprøve LØRDAG** + restore-drill + mandat-apply m. ejer-nøgle. Gate c: race_days_total = **28**. v4-gate MANDAG aften → evt. LIVE tir 25/8, v3-fallback ved rødt (addendum 8c).

> **👤 Ejer-klik:** post besked 1 (race-day) + den OPRINDELIGE besked 2 (værdier, gate-styret, ingen dato — [cutover-beskeder](discord/2026-08-17-cutover-beskeder.md); 22/8-udkastet må IKKE postes) FØR søndag · S3-kalenderen LÅSES (lovet fre/lør!) · post #patch-notes-catchup + 13 community-tråde ([discord/2026-08-21-community-traade-en.md](discord/2026-08-21-community-traade-en.md)) · /pro: #4074 valuta-mismatch blokerer flip · JeppeK-navne (#4039) · #3486 VERCEL_TOKEN · `railway login` (MCP-token udløbet 22/8).

> **📌 Opfølgninger:** kalibrerings-session efter cutover: #3719/#3720/#3987/#3732/#2650 + #4059 (skarpe-dage-seed-skævhed, bekræftet 21/8) + D1-løn-sats + #3966-bånd · #3347-scorecard NO-GO for D2/D4 (katalog-bundet, interim) · W8 bundt 2 · #4001 · miljø-audit + #691 uge 35 · #3952/#3982 visuals · #4037 · `ceilingBandInversion.test.js` rød lokalt (CI grøn) · #4073 (lav) · team-orders-whitelist BLIVER (verificeret 22/8: kortet er merged, men `tacticsOrdersAdapter.js` mocker stadig — fjern først når adapteren fetcher rigtigt) · **#3448-anker pushet som backup** (`feat/3448-level-anchor`) — PR først EFTER værdi-overgangen, rører samme kode; `a_floor_shift` står i config på main men læses ikke af nogen kode · **worktree-hygiejne EFTER cutover (ejer 22/8):** (1) `prune-merged-worktrees.ps1` skal klassificere ucommitted i skippede worktrees — affald (`pr-screens/*.png`, `*.log`, `*-out.*`, `preflight-*`) ryddes selv; kildekode (`backend/`,`frontend/src/`,`scripts/`,`docs/`,`*.test.*`) FEJLER højlydt m. push-kommando; ukendt → kildekode. (2) `cleanup:worktrees` som ugentlig scheduled task. Hører sammen. **Hvorfor:** 22/8 lå 730 linjer #3337-harness usikret i et skippet worktree, kun reddet manuelt (jf. #4112). Ryddet 22/8: 211→136 branches, 21→9 worktrees, 0 stale.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 28 løbsdatoer (`race_days_total`=28 efter #4075-regen).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Skalering:** #323.
- **Spiller-kommunikation (ejer-mandat 22/8):** fast ugerytme MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar spillerne inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)). Tråd-bank klar: [#4117](https://github.com/NicolaiDolmer/CyclingZone/issues/4117). Viger aldrig for et feature-spor.

> **🧭 Planning Center: spec EJER-GODKENDT 21/8** — [superpowers/specs/2026-08-21-planning-center-fase2-design.md](superpowers/specs/2026-08-21-planning-center-fase2-design.md) (P0-P5; byg tidligst efter v4-gaten). **A6 AFGJORT 21/8: kalender-fanen består; Z1 v0 Season-visningen er shippet** (#4083). §3.4+§3.5 udført. Åbent: #3990-resten. Ny: #4076 (stående ordrer P3).
>
> **🤖 Ingen aktiv session.** Planlægnings-/værdi-session 22/8 aften lukket: masterplan + artifact opdateret, spor P oprettet, Discord-sweep → #4118/#4119, **nyt #4120 (løn fryses på frossen ryttertype, 19,8x spænd) = ejer-valg A/B/C FØR søndagens løn-trin**.

_Historik i git-log, issue-tråde + docs/audits/._
