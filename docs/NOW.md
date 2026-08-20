# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 (e2e-slot + design-gate/visuelt bevis/beslutningskort/testplan) skrevet ind i AGENTS.md 20/8 (#3661 lukket).

## Aktiv styring

> **🎯 Næste action: TRIN 7-FINALE + MERGE-TOG i aften** ([prompt](sessions/2026-08-20-aften-trin7-finale-merge-session-prompt.md)) - preview-verify, merge-kæde ved ejer-go, #4011-merge, #4012-variant, #3997-mekanik, pension-minimum (#2748). Design-sessionen 20/8 leverede: design-go A+C (#4011) + #3924 kompakt, fold-disciplin, kulance udbetalt, drejebog-fix, 7.152. Tidligere prompt: [design-wireframes](sessions/2026-08-20-design-wireframes-session-prompt.md) — starter med Discord-feedback sidste 24 t, derefter 3-4 emner i dybden af ejer-valgt pulje (#3350 forklaringer · #3924 trænings-følelse · #3513 sportsforside · #3900+#3915 race-flader · #3982 · #3967 · /pro-indhold). Spiller-validering på ENGELSK, ejeren poster selv.

> **✅ Supabase-sessionen 20/8 LUKKET** (#4010 → PR #4013, patch note v7.154). Målt over 23 t: realtime var reelt dødt (7.727 `MalformedJWT`/døgn, 97 % af realtime-loggen — `sb_publishable_…` er ikke en JWT) · sponsor-sweep læste `race_results` 203.849×/døgn · `balanceDriftWatch` 376.260 buffere pr. side → **16.669 målt efter** · `getUser()` = ~515k DB-queries/døgn. Nye: **#4014** log-vagt · **#4015** request-budget · **#4016** session-lås · **#4017** mark-alle-læst. Advisor-accept-listen genverificeret mod prod (matviews: `anon` kan IKKE læse; `is_admin()` svarer altid `false` til anon) — skrevet ind i [4/8-auditten](audits/2026-08-04-supabase-hardening.md) så den ikke genrejses.

> **📅 Cutover SØNDAG AFTEN 19:30-22:30** (S2-finale kører til kl. 19; drejebog rev. 20/8): snapshot → race-day-flip → D1-komprimering → løn-genberegning (#3999-script, dry-run ×2,21 verificeret) → mandat-backfill. **Generalprøve mod staging LØRDAG** (målt tid + 22-tick + race_days_total=27-tjek) — **dispatch samtidig `restore-drill.yml` manuelt**, den kører ellers først 1/9. **PR #4013's tre perf-fixes bør ind FØR cutover** (auth-commit'en holdes tilbage til efter 25/8). **🚦 Trin 7-merge**: tester-runde kører (deadline hurtigst muligt); merge-kæden i [udrulnings-prompten](sessions/2026-08-19-udrulning-stor-opdatering-session-prompt.md) ved ejer-go. PR #4012 (etapetype-badge, #3985) baerer 7.155 i aftenens merge-tog.

> **👤 Ejer-klik:** post tester-opslag EN + 3 spillersvar + løn-Discord + weekendbesked (udkast i planlægningssessionen) · /pro: moms-tjek i Alunta + opret support@cyclingzone.org → derefter CHECKOUT_PAUSED-flip + testkøb (fredag: #2853 e-mail-loop-test) · race-day-besked + Sentry-alarm + #3486 VERCEL_TOKEN + `railway login` · #3961-slette-script (60 Discord-opslag).

> **📌 Opfølgninger:** W7 hjælpetekster LIGE efter trin 7-merge (trin 2/løbslære er allerede I trin 7-PR'en, verificeret 20/8) · W8: bundt 1 kørt 20/8, 53 needs-decision tilbage (bundt 2 = økonomi, efter cutover) · kalibrerings-session efter cutover: #3719/#3720/#3987/#3732/#2650 + D1-løn-sats på målt indtægt · #4001 akademi-værdi modner første søndag (ejer-dom; fremtid: 5 træningspas før auktion) · miljø-audit (ejer-ja 20/8) + #691 key-rotation uge 35 · #3952/#3982 visuals i design-sessionen.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdage.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Skalering:** #323.

> **🤖 Aktive sessioner:** AFTEN-SESSIONEN (trin 7-finale + merge-tog) er AKTIV fra 20/8 aften (Claude Code, hoved-checkout). Overtager #4018-fix-runden og #3997-mekanik-PR'en når workers pusher. Design-sessionens baggrunds-workers kører stadig i worktrees - rør ikke deres brancher.

_Historik i git-log, issue-tråde + docs/audits/._
