# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (inkl. uge-plan 21-25/8) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action: VÆRDI-OVERGANGEN (ejer-direktiv 21/8: kør 21-22/8, FØR søndag)** — GO-pakke klar: PR #4096 (manuel gate-måling + c=nyeste vindue + sum-neutral dæmpning ×1,230 + c-override-dry-run) afventer ejer-review/merge. Dry-runs 21/8 (#3750-kommentar): c=0,894 → −10,6 % (anbefalet) vs. c=0,666 → −33,4 %. Rækkefølge: besked postes ([udkast](discord/2026-08-22-vaerdi-overgangs-besked.md)) → snapshot → manuel måling → c-apply m. ejer-go → dæmpnings-flip-deploy → fuld backfill → **GENKØR løn-dry-run** (dæmpning ændrer CPV → #3989-løn) → patch note. DEREFTER: F3-integration (wiring-noter i PR-bodies #4084-#4092, h2h #4094).

> **✅ 21/8 AFTEN-SESSION (alt landet samme aften):** Z1 v0 Season-visning shippet (#4083, patch note 7.169, ejer-visuelt godkendt) · F3-natbølgen 11/11 spor leveret og merged (#4084-#4092 engine-moduler INERTE til wiring, #4091 orders-API, #4094 h2h-scorecard) · #4095 U23-sæsonsalder-fix (#4058 lukket før S3) · #4081 help-orphans + #4082 eslint merged · undersøgelser: #4059 bekræftet bug (seed-skævhed, til kalibrerings-session), #3981 afklaret (Discord-digest, ikke mail; drift af afsendelsestidspunkt). 3 agent-dødsfald genoprettet u. tab — postmortem: `.claude/learnings/2026-08-21-natboelge-agent-doedsfald.md`.

> **📅 Cutover SØNDAG AFTEN 19:30-22:30** (drejebog rev. 21/8): snapshot → race-day-flip (pre-flip-gate: remeasureGate3459) → D1-komprimering → løn-genberegning (dry-run ×2,21) → mandat-backfill → flag-flip #4007+#3449-c. **Generalprøve LØRDAG** + restore-drill + mandat-apply m. ejer-nøgle. Gate c: race_days_total = **28**. v4-gate MANDAG aften → evt. LIVE tir 25/8, v3-fallback ved rødt (addendum 8c).

> **👤 Ejer-klik:** S3-kalenderen LÅSES (løftet fre/lør!) · **#4093 taktik-kort UI: visuelt go (draft)** · migration-apply-permission (se Next action) · post #patch-notes-catchup + 13 community-tråde ([discord/2026-08-21-community-traade-en.md](discord/2026-08-21-community-traade-en.md)) · /pro: #4074 valuta-mismatch blokerer flip · JeppeK-navne (#4039) · #3486 VERCEL_TOKEN.

> **📌 Opfølgninger:** kalibrerings-session efter cutover: #3719/#3720/#3987/#3732/#2650 + #4059 (skarpe-dage-seed-skævhed, bekræftet 21/8) + D1-løn-sats + #3966-bånd · #3347-scorecard NO-GO for D2/D4 (katalog-bundet, interim) · W8 bundt 2 · #4001 · miljø-audit + #691 uge 35 · #3952/#3982 visuals · #4037 · `ceilingBandInversion.test.js` rød lokalt (CI grøn) · #4073 (lav) · fjern team-orders-whitelist i audit-feature-liveness når #4093 merges · **PR #4112** (maybeSingle i requireAuth, backend-only, CI grøn) afventer review · **#3448-anker pushet som backup** (`feat/3448-level-anchor`) — PR først EFTER værdi-overgangen, rører samme kode; `a_floor_shift` står i config på main men læses ikke af nogen kode · wire `cleanup:worktrees` op som scheduled task (findes som prompt, kører ikke → 77 worktrees hobet op, 48 ryddet 22/8).

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 28 løbsdatoer (`race_days_total`=28 efter #4075-regen).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Skalering:** #323.

> **🧭 Planning Center: spec EJER-GODKENDT 21/8** — [superpowers/specs/2026-08-21-planning-center-fase2-design.md](superpowers/specs/2026-08-21-planning-center-fase2-design.md) (P0-P5; byg tidligst efter v4-gaten). **A6 AFGJORT 21/8: kalender-fanen består; Z1 v0 Season-visningen er shippet** (#4083). §3.4+§3.5 udført. Åbent: #3990-resten. Ny: #4076 (stående ordrer P3).
>
> **🤖 Working agent: Ingen aktiv session.**

_Historik i git-log, issue-tråde + docs/audits/._
