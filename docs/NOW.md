# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (inkl. uge-plan 21-25/8) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 I AFTEN (frisk session): F3-NATBØLGE-launch** — køreklar plan i [superpowers/plans/2026-08-21-f3-natboelge-plan.md](superpowers/plans/2026-08-21-f3-natboelge-plan.md) (11 workers, 2 chunks; preflight → ejer-go → launch i samme tur → launch-bevis). **Næste arbejds-session: LØBSKALENDEREN** efter spiller-feedback (ejer 21/8): dublet-navne-bug (to løb samme navn i træk) · GT-etapetype-variation lovet "denne update" · `/planning?tab=form&view=season` som forbillede · generatoren "ikke godt nok lært" · **løfte: kalender låst fre/lør**.

> **✅ 21/8-sessionen SHIPPET:** **F2 MERGED** (PR #4072: TS-kerne, W'/CP, M1-M4, tidslinje v2, fixtures, head-to-head-stub; #4030 done) · **#4063 træningsrater LIVE** (7.166; S4/S5-bånd → kalibrerings-session) · **#4069 MERGED** (7.167: pre-bid-varsel + sæsonskifte-guard (anker: upcoming-season −1 dag kl. 18; transfer_windows var død data) + FA-auktion min. 12t; #4004 done, kant → #4073) · taktik-ordrer v1 ejer-låst (T1-T4, spec) · cutover-drejebog: 3 huller lukket ved måling (22-tick 22:00-22:05 · season-transition SKRIVER board_profiles · caps-delta 0/2.961, gate-script `remeasureGate3459.mjs`) · svar-udkast 12 spillerspørgsmål: [discord/2026-08-21-svar-udkast-ubesvarede.md](discord/2026-08-21-svar-udkast-ubesvarede.md) · nye issues #4070/#4071 (dashboard/indstillinger, efter cutover-ugen).

> **📅 Cutover SØNDAG AFTEN 19:30-22:30** (drejebog rev. 21/8): snapshot → race-day-flip (pre-flip-gate: remeasureGate3459) → D1-komprimering → løn-genberegning (dry-run ×2,21) → mandat-backfill (EFTER sæsonskiftet) → flag-flip #4007+#3449-c. **Generalprøve LØRDAG** + restore-drill dispatch + mandat-apply m. ejer-nøgle. v4-gate MANDAG aften (head-to-head mod virkeligheds-ankre + film) → evt. LIVE tir 25/8, v3-fallback ved rødt (addendum 8c).

> **👤 Ejer-klik:** S3-kalender låses (løfte!) · post #patch-notes-catchup + trin7-roadbook · svar spillerne + **13 community-tråde klar m. postplan** ([discord/2026-08-21-community-traade-en.md](discord/2026-08-21-community-traade-en.md); taktik-tråden KUN hvis v4 flippes) · /pro: moms-tjek → CHECKOUT_PAUSED-flip + Resend (#2853), men **#4074 valuta-mismatch blokerer flippet** · JeppeK-navne (#4039) · #3486 VERCEL_TOKEN.

> **📌 Opfølgninger:** kalibrerings-session efter cutover: #3719/#3720/#3987/#3732/#2650 + D1-løn-sats + #3966-bånd + gradvis aldersnedgang · W8 bundt 2 · #4001 første søndag · miljø-audit + #691 uge 35 · #3952/#3982 visuals · #4037 luk hvis badget · `ceilingBandInversion.test.js` rød lokalt (CI grøn) · #4073 skip-feedback (lav).

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdage.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Skalering:** #323.

> **🤖 Ingen aktiv session** (21/8-dagsessionen lukket efter #4069-merge; parallel-klarering ophævet — normal claim-regel gælder igen).

_Historik i git-log, issue-tråde + docs/audits/._
