# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Næste session: LØBSKALENDEREN forbedres efter spiller-feedback** (ejer 21/8). Input klar fra Discord-sweep: dublet-navne-bug (to løb samme navn i træk, ejers egen test 20/8) · GT-etapetype-variation lovet spillerne "denne update" (bjerg/flad/TT ikke i træk) · `/planning?tab=form&view=season` som forbillede for sæsonvisning · generatoren "ikke godt nok lært" (ejers ord 20/8) · **løfte til spillerne: kalender låst fre/lør**. Status 21/8-sessionen: F2 KOMPLET (PR #4072 auto-merge) · #4063 træningsrater LIVE (7.166) · #4004 omarbejdes (pre-bid-varsel + sæsonskifte-guard + FA-auktion min. 12t) · taktik-ordrer v1 ejer-låst (T1-T4) · uge-plan 21-25/8 i MASTERPLAN · svar-udkast til 12 spillerspørgsmål klar (docs/discord/2026-08-21-svar-udkast-ubesvarede.md) · F3-NATBØLGE forberedes i aften (launch = ejer-go).

> **✅ 20/8 MERGE-TOGET KØRT — alt live og prod-verificeret.** 12 merges: #3798 (7.158, inkl. rolle-label fra tester-feedback) → #4013 (7.159, index+autovacuum applied) → #4012 (7.160) → #4021 (7.161) → #4018 (7.162, bundle-budget 892→897 genmålt) + #4007 (k=100 bag flag, flip ved cutover m. #3449-c) + #4028 (v4 F1, segments/weather-migration applied) + #4029 (7.164, #3149 done) + 4 dependabot. Trin 7-kæden komplet: dismiss-migration, backfill 8.980/8.980 (backup: `rider_caps_3746_backup_20260816`, rollback-SQL i scriptets output), refit committet, indbakke 211/211, engangspanel set af ejer, Sentry 0 nye fejl. Labels flippet på #3746-kæden + #4010/#3985/#2748/#4011/#4000/#3149. Discord-sweep 20/8: 8 nye issues (#4031-#4038) + 6 opdaterede. audit-vagten lærte race_stage_claims (flygtig tabel).

> **📅 Cutover SØNDAG AFTEN 19:30-22:30** (drejebog rev. 20/8): snapshot → race-day-flip → D1-komprimering → løn-genberegning (#3999, dry-run ×2,21) → mandat-backfill → **flag-flip #4007+#3449-c (bindende rækkefølge, #3353)**. Generalprøve mod staging LØRDAG + dispatch `restore-drill.yml` manuelt. Rest: #3512 (rød backend-test) · #3393 (vurdér mod ny lønmodel før genoplivning).

> **👤 Ejer-klik:** post #patch-notes-catchup ([klar, v7.148-7.164](discord/2026-08-20-patch-notes-catchup-7148-7163.md)) + trin 7-roadbook-opslag (2026-08-16-trin7-potentiale-fart.md) · svar testerne (udkast i sessionen; JeppeK's rytternavne låser #4039-verifikationerne op) · /pro: moms-tjek + support@ → CHECKOUT_PAUSED-flip (fredag: #2853) · #3486 VERCEL_TOKEN + `railway login` · #3961-slette-script.

> **🚴 Race engine v4 (#3855):** F1 SKIBET 20/8 (#4028 merged, migration applied). Næste byg: **#4030 F2** (TS-kerne + W'-energimodel + gruppe-model).

> **📌 Opfølgninger:** kalibrerings-session efter cutover: #3719/#3720/#3987/#3732/#2650 + D1-løn-sats · W8 bundt 2 (økonomi) efter cutover · #4001 akademi-værdi første søndag · miljø-audit + #691 key-rotation uge 35 · #3952/#3982 visuals · race-planning-prototype live (feedback → #1146) · #4037 delvist dækket af 7.160 — luk hvis spilleren mente badget · NB: `ceilingBandInversion.test.js` rød lokalt også på main (CI grøn) — kalibrerings-sessionen.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdage.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Skalering:** #323.

> **🤖 Aktiv session: Fable i hoved-checkout (21/8, ejer online)** — ejer-beslutninger (#4004/#4001/#4005-p3) → F2-designsession (#4030) → cutover-forberedelse. Andre sessioner: STOP + spørg ejer.

_Historik i git-log, issue-tråde + docs/audits/._
