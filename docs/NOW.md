# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 (e2e-slot + design-gate/visuelt bevis/beslutningskort/testplan) skrevet ind i AGENTS.md 20/8 (#3661 lukket).

## Aktiv styring

> **🎯 Næste action: MERGE-TOGET ved ejer-go efter kl. 20** ([prompt](sessions/2026-08-20-aften-merge-tog-fortsaettelse-prompt.md) — ALT verificeret og staged). Orden er BINDENDE (patch note-numre): trin 7 PR #3798 (7.158, ejer-go er gaten) → #4013 (7.159, + index-SQL post-merge) → #4012 variant C (7.160) → #4021 pension (7.161) → #4018 finance (7.162, tjek CI-e2e først). Serielle patchNotes-konflikter pr. vogn er forventede — mekanisk løsning i prompten. Efter trin 7: migration → backfill-dry-run m. EJER-STOP → refit → indbakke → W7-fan-out. Merged 20/8 aften: #4019 (7.157) · #4020 · #4003. Ejer-go'er ER givet på #4012/#4021/#4018; kun trin 7 venter. Nye opfølgninger: #4023 #4024 #4025 (tekst-trim, ejer-princip: kort på fladen, manualer i Hjælp).

> **✅ Supabase-sessionen 20/8 LUKKET** (#4010 → PR #4013, patch note v7.159). Målt over 23 t: realtime var reelt dødt (7.727 `MalformedJWT`/døgn, 97 % af realtime-loggen — `sb_publishable_…` er ikke en JWT) · sponsor-sweep læste `race_results` 203.849×/døgn · `balanceDriftWatch` 376.260 buffere pr. side → **16.669 målt efter** · `getUser()` = ~515k DB-queries/døgn. Nye: **#4014** log-vagt · **#4015** request-budget · **#4016** session-lås · **#4017** mark-alle-læst. Advisor-accept-listen genverificeret mod prod (matviews: `anon` kan IKKE læse; `is_admin()` svarer altid `false` til anon) — skrevet ind i [4/8-auditten](audits/2026-08-04-supabase-hardening.md) så den ikke genrejses.

> **📅 Cutover SØNDAG AFTEN 19:30-22:30** (S2-finale kører til kl. 19; drejebog rev. 20/8): snapshot → race-day-flip → D1-komprimering → løn-genberegning (#3999-script, dry-run ×2,21 verificeret) → mandat-backfill. **Generalprøve mod staging LØRDAG** (målt tid + 22-tick + race_days_total=27-tjek) — **dispatch samtidig `restore-drill.yml` manuelt**, den kører ellers først 1/9. **PR #4013's tre perf-fixes bør ind FØR cutover** (auth-commit'en holdes tilbage til efter 25/8). **🚦 Trin 7-merge**: tester-runde kører (deadline hurtigst muligt); merge-kæden i [udrulnings-prompten](sessions/2026-08-19-udrulning-stor-opdatering-session-prompt.md) ved ejer-go.

> **👤 Ejer-klik:** post tester-opslag EN + 3 spillersvar + løn-Discord + weekendbesked (udkast i planlægningssessionen) · /pro: moms-tjek i Alunta + opret support@cyclingzone.org → derefter CHECKOUT_PAUSED-flip + testkøb (fredag: #2853 e-mail-loop-test) · race-day-besked + Sentry-alarm + #3486 VERCEL_TOKEN + `railway login` · #3961-slette-script (60 Discord-opslag).

> **📌 Opfølgninger:** W7 hjælpetekster LIGE efter trin 7-merge (trin 2/løbslære er allerede I trin 7-PR'en, verificeret 20/8) · W8: bundt 1 kørt 20/8, 53 needs-decision tilbage (bundt 2 = økonomi, efter cutover) · kalibrerings-session efter cutover: #3719/#3720/#3987/#3732/#2650 + D1-løn-sats på målt indtægt · #4001 akademi-værdi modner første søndag (ejer-dom; fremtid: 5 træningspas før auktion) · miljø-audit (ejer-ja 20/8) + #691 key-rotation uge 35 · #3952/#3982 visuals i design-sessionen.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdage.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Skalering:** #323.

> **🤖 Aktive sessioner: Ingen aktiv session.** (Race-planning-prototype-sessionen kan holde hoved-checkoutet på egen branch — arbejd i worktrees.)

_Historik i git-log, issue-tråde + docs/audits/._
