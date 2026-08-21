# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (inkl. uge-plan 21-25/8) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 I AFTEN: F3-NATBØLGE-launch** — køreklar plan i [superpowers/plans/2026-08-21-f3-natboelge-plan.md](superpowers/plans/2026-08-21-f3-natboelge-plan.md) (11 workers, 2 chunks; preflight → ejer-go → launch i samme tur → launch-bevis). **Ejer-klik derefter: S3-kalenderen LÅSES (løftet fre/lør — kalenderen er nu klar til det).**

> **✅ 21/8 KALENDER-SESSIONEN SHIPPET (#4075 lukket):** S3-kalenderen wiped + regenereret fra RENT katalog (rod-årsag: seed 20/8 uden --prune → 158 katalogrækker, dublet-GT'er, NULL-arketyper). Live nu: 471 løb; D1 = 33 løb, præcis 3 GT'er (Giro 18/Tour 17/Vuelta 17), 0 dubletter, monument = normal EKSKLUSIV løbsdag (100000-sentinel FJERNET, spec §3.4/B2 udført: kode+SQL+data), GT-etapevariation maks 2 ens i træk (før 5-7), 4 lange ProSeries forkortet til bånd [3,5] (ejer-godkendt), alle 4 tiers kvote 100 %/0 tomme dage. PR #4077+#4078 (`race_pool.retired_at`)+#4079 (brostens-reservationer) merged; 2 RPC'er redeployet. **⚠ `race_days_total` = 28 (før 27)** — drejebog opdateret, #3990 kommenteret. Snapshots: `docs/snapshots/4075/` + `3546/wipe-snapshot-…-21.json`. Patch note 7.168 (PR #4080). Postmortem: `.claude/learnings/2026-08-21-seed-uden-prune-forgiftede-kalenderen.md`.

> **📅 Cutover SØNDAG AFTEN 19:30-22:30** (drejebog rev. 21/8): snapshot → race-day-flip (pre-flip-gate: remeasureGate3459) → D1-komprimering → løn-genberegning (dry-run ×2,21) → mandat-backfill → flag-flip #4007+#3449-c. **Generalprøve LØRDAG** + restore-drill + mandat-apply m. ejer-nøgle. Gate c: race_days_total = **28** nu. v4-gate MANDAG aften → evt. LIVE tir 25/8, v3-fallback ved rødt (addendum 8c).

> **👤 Ejer-klik:** S3-kalender låses (løfte!) · post #patch-notes-catchup + trin7-roadbook · svar spillerne + **13 community-tråde klar m. postplan** ([discord/2026-08-21-community-traade-en.md](discord/2026-08-21-community-traade-en.md); taktik-tråden KUN hvis v4 flippes) · /pro: moms-tjek → CHECKOUT_PAUSED-flip + Resend (#2853), men **#4074 valuta-mismatch blokerer flippet** · JeppeK-navne (#4039) · #3486 VERCEL_TOKEN.

> **📌 Opfølgninger:** kalibrerings-session efter cutover: #3719/#3720/#3987/#3732/#2650 + D1-løn-sats + #3966-bånd + gradvis aldersnedgang · **#3347-realisme-scorecard melder NO-GO for D2/D4-trækkene (katalog-bundet, kendt interim-gap — til kalibrerings-sessionen)** · W8 bundt 2 · #4001 første søndag · miljø-audit + #691 uge 35 · #3952/#3982 visuals · #4037 luk hvis badget · `ceilingBandInversion.test.js` rød lokalt (CI grøn) · #4073 skip-feedback (lav).

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 28 løbsdatoer (`race_days_total`=28 efter #4075-regen).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Skalering:** #323.

> **🧭 Planning Center: spec EJER-GODKENDT 21/8** — [superpowers/specs/2026-08-21-planning-center-fase2-design.md](superpowers/specs/2026-08-21-planning-center-fase2-design.md) (P0-P5; byg tidligst efter v4-gaten). §3.4 (monument-B2) + §3.5 (dubletter) er UDFØRT af kalender-sessionen. Åbent: A6 kalenderfanen + #3990-resten (begreber+copy; off-by-one de facto løst data-side, se issue-kommentar 21/8). Ny: #4076 (stående ordrer P3).
>
> **🤖 Ingen aktiv session** (kalender-sessionen lukket 21/8 aften).

_Historik i git-log, issue-tråde + docs/audits/._
