# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 (e2e-slot + design-gate/visuelt bevis/beslutningskort/testplan) skrevet ind i AGENTS.md 20/8 (#3661 lukket).

## Aktiv styring

> **🎯 Næste action: TRIN 7-MERGE efter kl. 20** (ejer tjekker i ro og orden; aften-sessionen kører kæden ved go). Merge-toget står klart i NUMMER-orden: trin 7 (PR #3798, 7.158) → #4013 (7.159) → #4012 etapetype variant C, ejer-valgt (7.160) → #4021 pension-banner, ejer-godkendt visuelt (7.161). Alle fire MERGEABLE + fuld e2e kørt på trin 7 (527 grønne). Efter trin 7-merge: migration → backfill-dry-run m. EJER-STOP → refit → indbakke → W7 hjælpetekst-fan-out (#3714 #3623 #3456 #3412). Merged i aften: #4019 spejder-modning (7.157, #3997 done, PR #4008 lukket) · #4020 mark-alle-læst (#4017 done). PR #4018 (finance): afventer fix-workerens push; uafhængig revision fandt KRITISK hul (sponsor-performance-puljen op til 150k mangler i afregningen + S2/S3-kolonner sammenligner forskellige størrelser) — skal rettes før merge, økonomien skal være perfekt.

> **✅ Supabase-sessionen 20/8 LUKKET** (#4010 → PR #4013, patch note v7.159). Målt over 23 t: realtime var reelt dødt (7.727 `MalformedJWT`/døgn, 97 % af realtime-loggen — `sb_publishable_…` er ikke en JWT) · sponsor-sweep læste `race_results` 203.849×/døgn · `balanceDriftWatch` 376.260 buffere pr. side → **16.669 målt efter** · `getUser()` = ~515k DB-queries/døgn. Nye: **#4014** log-vagt · **#4015** request-budget · **#4016** session-lås · **#4017** mark-alle-læst. Advisor-accept-listen genverificeret mod prod (matviews: `anon` kan IKKE læse; `is_admin()` svarer altid `false` til anon) — skrevet ind i [4/8-auditten](audits/2026-08-04-supabase-hardening.md) så den ikke genrejses.

> **📅 Cutover SØNDAG AFTEN 19:30-22:30** (S2-finale kører til kl. 19; drejebog rev. 20/8): snapshot → race-day-flip → D1-komprimering → løn-genberegning (#3999-script, dry-run ×2,21 verificeret) → mandat-backfill. **Generalprøve mod staging LØRDAG** (målt tid + 22-tick + race_days_total=27-tjek) — **dispatch samtidig `restore-drill.yml` manuelt**, den kører ellers først 1/9. **PR #4013's tre perf-fixes bør ind FØR cutover** (auth-commit'en holdes tilbage til efter 25/8). **🚦 Trin 7-merge**: tester-runde kører (deadline hurtigst muligt); merge-kæden i [udrulnings-prompten](sessions/2026-08-19-udrulning-stor-opdatering-session-prompt.md) ved ejer-go.

> **👤 Ejer-klik:** post tester-opslag EN + 3 spillersvar + løn-Discord + weekendbesked (udkast i planlægningssessionen) · /pro: moms-tjek i Alunta + opret support@cyclingzone.org → derefter CHECKOUT_PAUSED-flip + testkøb (fredag: #2853 e-mail-loop-test) · race-day-besked + Sentry-alarm + #3486 VERCEL_TOKEN + `railway login` · #3961-slette-script (60 Discord-opslag).

> **📌 Opfølgninger:** W7 hjælpetekster LIGE efter trin 7-merge (trin 2/løbslære er allerede I trin 7-PR'en, verificeret 20/8) · W8: bundt 1 kørt 20/8, 53 needs-decision tilbage (bundt 2 = økonomi, efter cutover) · kalibrerings-session efter cutover: #3719/#3720/#3987/#3732/#2650 + D1-løn-sats på målt indtægt · #4001 akademi-værdi modner første søndag (ejer-dom; fremtid: 5 træningspas før auktion) · miljø-audit (ejer-ja 20/8) + #691 key-rotation uge 35 · #3952/#3982 visuals i design-sessionen.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdage.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Skalering:** #323.

> **🤖 Aktive sessioner:** AFTEN-SESSIONEN (trin 7-finale + merge-tog) er AKTIV og står standby til ejer-go efter kl. 20 (Claude Code, hoved-checkout). Rør ikke merge-togets brancher eller feat/4011-finance-opgoerelse-afregning (fix-worker fra design-sessionen pusher stadig).

_Historik i git-log, issue-tråde + docs/audits/._
