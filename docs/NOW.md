# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Næste action (21/8): F2-designsession** (TS-kerne + W'-energi + gruppemodel; input klar: #3965 udbruds-bonus 0,42 vs punch-vægt 0,44 · #3966 træningsrate -70..-92% kumulativt siden 14/8). Natbølgen HELT lukket: alle 14 PR'er + patch note 7.165 merged, 17 issues done ([audit](audits/night-wave-2026-08-21.md)). Fredags-klik: Resend-nøgle+tekster (#2853) · moms-tjek→CHECKOUT_PAUSED-flip (#4060 live) · Discord-posts · JeppeK-navne (#4039). Beslutninger til ejer: #4004, #4001, #4005-p3. Ejer retter S3-kalenderen (#3547).

> **✅ 20/8 MERGE-TOGET KØRT — alt live og prod-verificeret.** 12 merges: #3798 (7.158, inkl. rolle-label fra tester-feedback) → #4013 (7.159, index+autovacuum applied) → #4012 (7.160) → #4021 (7.161) → #4018 (7.162, bundle-budget 892→897 genmålt) + #4007 (k=100 bag flag, flip ved cutover m. #3449-c) + #4028 (v4 F1, segments/weather-migration applied) + #4029 (7.164, #3149 done) + 4 dependabot. Trin 7-kæden komplet: dismiss-migration, backfill 8.980/8.980 (backup: `rider_caps_3746_backup_20260816`, rollback-SQL i scriptets output), refit committet, indbakke 211/211, engangspanel set af ejer, Sentry 0 nye fejl. Labels flippet på #3746-kæden + #4010/#3985/#2748/#4011/#4000/#3149. Discord-sweep 20/8: 8 nye issues (#4031-#4038) + 6 opdaterede. audit-vagten lærte race_stage_claims (flygtig tabel).

> **📅 Cutover SØNDAG AFTEN 19:30-22:30** (drejebog rev. 20/8): snapshot → race-day-flip → D1-komprimering → løn-genberegning (#3999, dry-run ×2,21) → mandat-backfill → **flag-flip #4007+#3449-c (bindende rækkefølge, #3353)**. Generalprøve mod staging LØRDAG + dispatch `restore-drill.yml` manuelt. Rest: #3512 (rød backend-test) · #3393 (vurdér mod ny lønmodel før genoplivning).

> **👤 Ejer-klik:** post #patch-notes-catchup ([klar, v7.148-7.164](discord/2026-08-20-patch-notes-catchup-7148-7163.md)) + trin 7-roadbook-opslag (2026-08-16-trin7-potentiale-fart.md) · svar testerne (udkast i sessionen; JeppeK's rytternavne låser #4039-verifikationerne op) · /pro: moms-tjek + support@ → CHECKOUT_PAUSED-flip (fredag: #2853) · #3486 VERCEL_TOKEN + `railway login` · #3961-slette-script.

> **🚴 Race engine v4 (#3855):** F1 SKIBET 20/8 (#4028 merged, migration applied). Næste byg: **#4030 F2** (TS-kerne + W'-energimodel + gruppe-model).

> **📌 Opfølgninger:** kalibrerings-session efter cutover: #3719/#3720/#3987/#3732/#2650 + D1-løn-sats · W8 bundt 2 (økonomi) efter cutover · #4001 akademi-værdi første søndag · miljø-audit + #691 key-rotation uge 35 · #3952/#3982 visuals · race-planning-prototype live (feedback → #1146) · #4037 delvist dækket af 7.160 — luk hvis spilleren mente badget · NB: `ceilingBandInversion.test.js` rød lokalt også på main (CI grøn) — kalibrerings-sessionen.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdage.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Skalering:** #323.

> **🤖 Aktive sessioner: NATBØLGE 21/8 KØRER** (Fable-orkestrator i hoved-checkout på main; 3 workflow-chunks, ~21 sonnet-workers i worktrees). Andre sessioner: STOP + spørg ejer.

_Historik i git-log, issue-tråde + docs/audits/._
