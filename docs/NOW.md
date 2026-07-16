# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT:** [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md). **Rækkefølge-SSOT:** [docs/MASTERPLAN.md](MASTERPLAN.md). **Vision (ejer 10/7):** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, udførende subagenter på sonnet i worktrees; PR der afventer aftalt justering = draft.

## Aktiv styring

> **🎯 Next action (session 17/7, ejer-aftalt):** (1) Discord-announce — ejer HAR godkendt tekst-udkastet 16/7 og poster selv/godkender endeligt i morgen; SPØRG om den. (2) **Markedsføring** — ejer vil se på det igen (jf. AI_CHANNEL_ROUTING + #1341). (3) Verificér AI-trim 24/24/24 (5 hold markeret 16/7, sweepen sletter) + #2472-normalisering efter næste trænings-tick (351 ryttere gulv-normaliseres). Derefter: [#2463](https://github.com/NicolaiDolmer/CyclingZone/issues/2463) board-generalprøve → #2361 → #2449.
>
> **✅ 16/7 GENNEMFØRT (hele dagen):** 18 PR'er merged inkl. #2472 loft+taper (ejer-valg efter scorecard) og patch notes **v7.02 LIVE** · 3 migrationer applied · race v3 S1-S6 komplet live · 16 issues lukket · CI hærdet: 14 required checks (+perf-gate m. skip-stub, +check-verification, +getuser-guard, +silent-mutation-guard; no-op review fjernet) · #2511-rest: perf-gate på main-pushes + i18n-namespace-split.

> **🌊 Dagbølge 16/7 (7 Fable-spor, 08:57-09:55):** 5 PR'er + #2472-verifikation + masterplan **konsolideret 16/7** (ejer-go; analyse + 5 indarbejdede anbefalinger på [#2468](https://github.com/NicolaiDolmer/CyclingZone/issues/2468) — sæsongrænse-pakken er nu NU-kø pkt 2). **#1847 KORRIGERET:** 70% af "13.262 orphans" er by-design (team-rækker); ægte = **4.100 (1,7%), 100% AI-churn, alle display-sikre** — oprydnings-DELETE bevidst droppet (ville skade palmarès), i stedet navne-snapshot + DELETE-guard i #2481.

> **🩹 [#2407](https://github.com/NicolaiDolmer/CyclingZone/issues/2407):** #2481 merged + orphan-guard applied 16/7; 5 overskudshold markeret (3/1/1) — sweepen trimmer til 24/24/24, **verificér 17/7**. Backup: `backup_2407_20260715_pending_removal`.

> **💰 Værdimodel v4 (#2428) — SHADOW LIVE (elite-præmie-retning, ejer 14/7).** Admin→Økonomi→"Rytter-værdi v4". Mega-stjerner v4 35-82M, ukøbelige; 6/7 gates grønne. Audit: [audits/2026-07-13-valuation-v4-shadow-scorecard.md](audits/2026-07-13-valuation-v4-shadow-scorecard.md).
> **💸 Løn-decoupling slice A (shadow) → PR [#2433](https://github.com/NicolaiDolmer/CyclingZone/pull/2433) (ejer review + merge).** Per-division `SALARY_RATE_PROD`; alle gates grønne, ingen økonomi-ændring. Audit: [audits/2026-07-14-salary-decoupling-scorecard.md](audits/2026-07-14-salary-decoupling-scorecard.md).
> **🎯 NÆSTE (#2428, ejer-gated):** (1) Slice B cutover (predictBaseValue→v4 + lønmodel + migration bundlet, ejer merger; rør ALDRIG GENERATED/prize_earnings_bonus før da). (2) Udvikl-og-sælg A/B/C (ROI 172%).

> **v3-track: KOMPLET LIVE 16/7 (S1-S6).** S6 why-rapport merged + migration applied. Rest: `peak_planner_enabled` står på 'beta' — ejer tester (#2501/#2506-forbedringerne er inde) og flipper til 'on' når klar.

> **🎓 Træning/ungdom-addendum 16/7 — ejer-beslutninger LÅST:** [spec](superpowers/specs/2026-07-16-traening-ungdom-verdensklasse-addendum-design.md) + issues [#2484](https://github.com/NicolaiDolmer/CyclingZone/issues/2484)-[#2495](https://github.com/NicolaiDolmer/CyclingZone/issues/2495). Tre-tier klubstruktur = målbilledet (epic [#2492](https://github.com/NicolaiDolmer/CyclingZone/issues/2492), superseder #958). **Fase 0-sidestrøm klar (uge 30-31):** #2484 udviklings-moment · #2485 akademi-regnskab · #2486 spec-forlig · #2456-kodeoprydning (✅ PR #2483 fra bølgen).

> **Ejer-klikliste (åben):** flip `peak_planner_enabled` beta→on (#2426) · #2461 Discord-svar-udkast (7 stk.) · Sentry alert 559456 regression-condition (#2389-kommentar pkt 7) · Alunta+CZ Pro testkøb (#1903) · flip-bølge-verify (#2357) · /training-verify · Supabase OTP-expiry+leaked-pw (#2258/#929) · TdF-dag (#2080) · #2276 rest-verify · #2288 dashboard-verify · #2100 loft-projektion · #2206 rangliste · #2081 slice 1 (PR #2225) · #2076/#2085/#1784. _(Discord-announce + CYCLINGZONE-2G/24 klaret 16/7.)_

> **Åbne pick-ups:** Klub-UX Slice 2 [#2311](https://github.com/NicolaiDolmer/CyclingZone/issues/2311) · v3-flip-forudsætninger #2376 · Palmarès-rest (#1997: roster-tidslinje, mulig S3) · #1996 del 2 (claude:blocked) · #2436 (lav) · perf/CI-rest [#2511](https://github.com/NicolaiDolmer/CyclingZone/issues/2511). **Kendt bug:** test-konti wipes (#2245, high). Mobil = 54,9% af app-besøg.

> **🤖 Working agent:** Claude Code (Fable) — aktiv 16/7 aften på [#2463](https://github.com/NicolaiDolmer/CyclingZone/issues/2463) board-generalprøve (ejer-go: autonome opgaver). #2461 Discord-svar-udkast venter stadig ejer-review.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: #1152 afventer godkendelse. Rytterprofil-rest: hero/rating #2006 + højde/vægt+compare #2266.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 16/7 (dagbølge-close-out); Discord-sweep 15/7-detaljer, #2437-forløbet og watchdog-triagen ligger i git-log, issue-tråde + bølge-artifacts._
