# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT:** [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md). **Rækkefølge-SSOT:** [docs/MASTERPLAN.md](MASTERPLAN.md). **Vision (ejer 10/7):** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, udførende subagenter på sonnet i worktrees; PR der afventer aftalt justering = draft.

## Aktiv styring

> **🎯 Next action (NY SESSION efter 17/7-bølgen):** (1) **Ejer-tests i prod:** Global Rank (side + widget; pile/rookie-noter i [#2453-kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/2453)) · bulk-priser på /transfers (kræv ryttere til salg) · /planner fuld bredde · /training. (2) **S2-generering:** admin → Sæson → opret sæson 2 → "Generér kalender" (dry-run-preview FØRST). (3) **#2568 del 2:** design-oplæg til ejeren (løbs-forståelighed i planner) — flip-blocker for peak_planner on. (4) **#2557:** verificér variant C-effekt i drift-vagtens admin-tabel efter første nat-kørsel (+ tjek Sentry cron-monitor); share4+-undersøgelse = #2574. (5) #2463 ejer-rest: `TEST_ACCOUNT_PASSWORD` i backend/.env. (6) Discord-announce (stor: 17/7-featurepakken!) + markedsføring (#1341).
>
> **✅ 17/7 GENNEMFØRT (natbølge + dagbølge, én session):** **29 PR'er merged** (#2545-#2567 nat+dag, #2573 planner-bredde, #2575 rekalibrering C, 4 dependabot) · **7 migrationer applied** (onboarding-dismiss, race-days-backfill 524/60→18/28, 2 notifikations-typer, U23-bånd, Global Rank-pakken, drift-tabel) · **24 issues → done** · patch notes v7.09+v7.11 · Global Rank LIVE (design ejer-låst) · S2-synlighed live · drift-vagt live · rekalibrering C live (favWin 38,1% i bånd; #2557 åben til live-verify) · deploy-verify-falsk-alarm fixet (#2559). Fuld facit: [bølge-artifact](audits/night-wave-2026-07-17.md).
>
> **🌙 Session 16/7 sen aften:** Discord-sweep → 13 issues #2518-#2530; analyser #2528 (status quo S1→S2) + #2521 (3 kilder). MERGED+LIVE: #2531 Discord-EN · #2532 scout-køb · #2533 planner-dato-UX · #2534 · #2538 watchdog-fix · #2537 baseline-tilfredshed (v7.07) · #2539 dato-chips · #2458 ejer-go: mission 14→2 dage (v7.08) + 38 opgaver omdateret. Railway-MCP + Infisical kræver re-login.

> **🌊 Dagbølge 16/7 (7 Fable-spor, 08:57-09:55):** 5 PR'er + #2472-verifikation + masterplan **konsolideret 16/7** (ejer-go; analyse + 5 indarbejdede anbefalinger på [#2468](https://github.com/NicolaiDolmer/CyclingZone/issues/2468) — sæsongrænse-pakken er nu NU-kø pkt 2). **#1847 KORRIGERET:** 70% af "13.262 orphans" er by-design (team-rækker); ægte = **4.100 (1,7%), 100% AI-churn, alle display-sikre** — oprydnings-DELETE bevidst droppet (ville skade palmarès), i stedet navne-snapshot + DELETE-guard i #2481.

> **🩹 [#2407](https://github.com/NicolaiDolmer/CyclingZone/issues/2407):** #2481 merged + orphan-guard applied 16/7; 5 overskudshold markeret (3/1/1) — sweepen trimmer til 24/24/24, **verificér 17/7**. Backup: `backup_2407_20260715_pending_removal`.

> **💰 Værdimodel v4 (#2428) — SHADOW LIVE (elite-præmie-retning, ejer 14/7).** Admin→Økonomi→"Rytter-værdi v4". Mega-stjerner v4 35-82M, ukøbelige; 6/7 gates grønne. Audit: [audits/2026-07-13-valuation-v4-shadow-scorecard.md](audits/2026-07-13-valuation-v4-shadow-scorecard.md).
> **💸 Løn-decoupling slice A (shadow) → PR [#2433](https://github.com/NicolaiDolmer/CyclingZone/pull/2433) (ejer review + merge).** Per-division `SALARY_RATE_PROD`; alle gates grønne, ingen økonomi-ændring. Audit: [audits/2026-07-14-salary-decoupling-scorecard.md](audits/2026-07-14-salary-decoupling-scorecard.md).
> **🎯 NÆSTE (#2428, ejer-gated):** (1) Slice B cutover (predictBaseValue→v4 + lønmodel + migration bundlet, ejer merger; rør ALDRIG GENERATED/prize_earnings_bonus før da). (2) Udvikl-og-sælg A/B/C (ROI 172%).

> **v3-track: KOMPLET LIVE 16/7 (S1-S6).** S6 why-rapport merged + migration applied. Rest: `peak_planner_enabled` står på 'beta' — ejer tester (#2501/#2506-forbedringerne er inde) og flipper til 'on' når klar.

> **🎓 Træning/ungdom-addendum 16/7 — ejer-beslutninger LÅST:** [spec](superpowers/specs/2026-07-16-traening-ungdom-verdensklasse-addendum-design.md) + issues [#2484](https://github.com/NicolaiDolmer/CyclingZone/issues/2484)-[#2495](https://github.com/NicolaiDolmer/CyclingZone/issues/2495). Tre-tier klubstruktur = målbilledet (epic [#2492](https://github.com/NicolaiDolmer/CyclingZone/issues/2492), superseder #958). **Fase 0-sidestrøm klar (uge 30-31):** #2484 udviklings-moment · #2485 akademi-regnskab · #2486 spec-forlig · #2456-kodeoprydning (✅ PR #2483 fra bølgen).

> **Ejer-klikliste (åben):** PR [#2584](https://github.com/NicolaiDolmer/CyclingZone/pull/2584) micro-animationer (#2577) — review+merge (UI-smag; OBS: origin-branch `feat/2577-micro-animations` har en løs Discord-sweep-commit fra anden session, urørt) · flip `peak_planner_enabled` beta→on (#2426) · #2461 Discord-svar-udkast (7 stk.) · Sentry alert 559456 regression-condition (#2389-kommentar pkt 7) · Alunta+CZ Pro testkøb (#1903) · flip-bølge-verify (#2357) · /training-verify · Supabase OTP-expiry+leaked-pw (#2258/#929) · TdF-dag (#2080) · #2276 rest-verify · #2288 dashboard-verify · #2100 loft-projektion · #2206 rangliste · #2081 slice 1 (PR #2225) · #2076/#2085/#1784. _(Discord-announce + CYCLINGZONE-2G/24 klaret 16/7.)_

> **Åbne pick-ups:** Klub-UX Slice 2 [#2311](https://github.com/NicolaiDolmer/CyclingZone/issues/2311) · v3-flip-forudsætninger #2376 · Palmarès-rest (#1997: roster-tidslinje, mulig S3) · #1996 del 2 (claude:blocked) · #2436 (lav) · perf/CI-rest [#2511](https://github.com/NicolaiDolmer/CyclingZone/issues/2511). **Kendt bug:** test-konti wipes (#2245, high). Mobil = 54,9% af app-besøg.

> **🩺 Sentry/Railway-triage 17/7:** Sentry rent — CYCLINGZONE-33 (board-500, fix #2517) + 34 (watchdog-fantomkolonne, fix #2538) resolvet: begge sidste events ligger FØR fixene gik live, ~14 t/24 crons rene siden. CYCLINGZONE-32 = #2436 (lav, kendt). **Nyt fund i Railway-loggen (ingen Sentry-capture):** [#2569](https://github.com/NicolaiDolmer/CyclingZone/issues/2569) — bestyrelses-DM'er på Discord er ALDRIG leveret siden 4/7 (#2157); `notifyBoardUpdateDM` tog kun `teamId`, cron kalder med `userId` → tavst drop hvert 30. min. Fix + regressionstest i PR (v7.10). In-app-notifikationer var upåvirkede. Railway-MCP-token udløb undervejs → re-login for friske logs.

> **🌙 16/7 aften ([#2463](https://github.com/NicolaiDolmer/CyclingZone/issues/2463) generalprøve):** 🔴 Rod-årsag fundet: auto-accept-uret målte race_days_completed (SUM etaper, alle divisioner — 524 af "60") mod dag-tærskler ⇒ 218 auto-accepts, 0 T-1-varsler nogensinde, 0 manuelle signeringer nogensinde; sæsonskiftet ville tvangs-acceptere alle 1yr-fornyelser på timer. **Fixet + merged:** #2514 (kalenderdags-ur pr. plan, 5 dage + T-3/T-1) · #2513 (Playwright-spec der signerer + wizard-escape ved proposal-fejl) · #2515 patch notes v7.03 (auto-merge). Følgebug udskilt: #2512 (renegotiation-lås permanent aktiv). Fund-detaljer: [issue-kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/2463#issuecomment-4994998978).
>
> **🤖 Working agent:** Ingen aktiv session. #2461 Discord-svar-udkast venter stadig ejer-review.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: #1152 afventer godkendelse. Rytterprofil-rest: hero/rating #2006 + højde/vægt+compare #2266.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 16/7 (dagbølge-close-out); Discord-sweep 15/7-detaljer, #2437-forløbet og watchdog-triagen ligger i git-log, issue-tråde + bølge-artifacts._
