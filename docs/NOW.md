# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT:** [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md). **Rækkefølge-SSOT:** [docs/MASTERPLAN.md](MASTERPLAN.md). **Vision (ejer 10/7):** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, udførende subagenter på sonnet i worktrees; PR der afventer aftalt justering = draft.

## Aktiv styring

> **🎯 Next action:** (1) **#2612 (#2599) — merge + kør `race_entry_clears`-migration** (sidste bølge-PR; de 9 andre LIVE). (2) **Bølge-beslutninger (issues oprettet):** #2621 sæson-0-DB-række · #2622 sweep-scope (8.841-entry-autofill) · #2623 backfill 17 usøgbare scout-ryttere · #2589 sponsor-slice · #2624 board-harness-verify. (3) **Ejer-tests i prod:** /training · Global Rank · bulk-priser /transfers. (4) **S2-generering:** admin → Sæson → "Generér kalender" (dry-run FØRST). (5) Discord-announce 17/7-pakken.
> _(✅ #2580/PR #2587 LUKKET+LIVE v7.14 17/7: A valgt = copy-fejl, intet datatab; prod-verificeret af Claude.)_
>
> **🌊 18/7 Værdi-bølge (10 issues, subagent-fan-out + adversarisk verify) — 9 MERGED + LIVE (prod READY):** #2598 test-fakes · #2571 DM-aggregat (+ #2618 guard-bug-følgefix) · #2596 board-footguns · #2579 solgt rytter · #2581 scout-fantomryttere (⚠️ 17 hist. usøgbare — backfill?) · #2605 kalender-brosten-ikon · #2600 Sæson 0 (⚠️ ÆGTE data-tilstand: seasons.number=0 bogførings-række — behold/slet?) · #2597 værdi-trend-pile. **Ejer-rest:** #2612 (#2599 auto-udtagelse+ryd-alt — migration, ejer merger+applier; sweep fylder stadig hele sæsonen 8.841 entries, indsnævring = produktbeslutning). **Afvist:** #2589 sponsor-rate (virker ikke for 36% af hold — issuet åbent m. metode). **Nye:** #2616 strategi-dup · #2617 squad-enforcement-guard.
>
> **✅ 17/7:** 29 PR'er merged + 7 migrationer + 24 issues→done (Global Rank LIVE, S2-synlighed, drift-vagt, rekalibrering C — #2557 åben til live-verify). **Ejer-flag:** #2449 (S2-kalender ikke genereret) + #2521 (5 hold board-låst 50). Facit: [natbølge](audits/night-wave-2026-07-17.md) · [audit](../.claude/audits/audit-2026-07-17.md).

> **🌊 Dagbølge 16/7 (7 Fable-spor, 08:57-09:55):** 5 PR'er + #2472-verifikation + masterplan **konsolideret 16/7** (ejer-go; analyse + 5 indarbejdede anbefalinger på [#2468](https://github.com/NicolaiDolmer/CyclingZone/issues/2468) — sæsongrænse-pakken er nu NU-kø pkt 2). **#1847 KORRIGERET:** 70% af "13.262 orphans" er by-design (team-rækker); ægte = **4.100 (1,7%), 100% AI-churn, alle display-sikre** — oprydnings-DELETE bevidst droppet (ville skade palmarès), i stedet navne-snapshot + DELETE-guard i #2481.

> **🩹 [#2407](https://github.com/NicolaiDolmer/CyclingZone/issues/2407):** #2481 merged + orphan-guard applied 16/7; 5 overskudshold markeret (3/1/1) — sweepen trimmer til 24/24/24, **verificér 17/7**. Backup: `backup_2407_20260715_pending_removal`.

> **💰 Værdimodel v4 (#2428) — SHADOW LIVE (elite-præmie-retning, ejer 14/7).** Admin→Økonomi→"Rytter-værdi v4". Mega-stjerner v4 35-82M, ukøbelige; 6/7 gates grønne. Audit: [audits/2026-07-13-valuation-v4-shadow-scorecard.md](audits/2026-07-13-valuation-v4-shadow-scorecard.md).
> **💸 Løn-decoupling slice A (shadow) MERGED** (PR [#2433](https://github.com/NicolaiDolmer/CyclingZone/pull/2433), 16/7). Per-division `SALARY_RATE_PROD`; alle gates grønne, INGEN økonomi-ændring endnu (kun harness/model på main). Audit: [audits/2026-07-14-salary-decoupling-scorecard.md](audits/2026-07-14-salary-decoupling-scorecard.md).
> **🎯 NÆSTE (#2428, ejer-gated):** (1) **[#2594](https://github.com/NicolaiDolmer/CyclingZone/issues/2594)** Slice B cutover (predictBaseValue→v4 + lønmodel + migration bundlet, ejer merger; rør ALDRIG GENERATED/prize_earnings_bonus før da). (2) **[#2591](https://github.com/NicolaiDolmer/CyclingZone/issues/2591)** udvikl-og-sælg A/B/C (ROI 172%, needs-decision) — gater #2594.

> **v3-track: KOMPLET LIVE 16/7 (S1-S6).** S6 why-rapport merged + migration applied. Rest: `peak_planner_enabled` står på 'beta' — ejer tester (#2501/#2506-forbedringerne er inde) og flipper til 'on' når klar.

> **🎓 Træning/ungdom-addendum 16/7 — ejer-beslutninger LÅST:** [spec](superpowers/specs/2026-07-16-traening-ungdom-verdensklasse-addendum-design.md) + issues [#2484](https://github.com/NicolaiDolmer/CyclingZone/issues/2484)-[#2495](https://github.com/NicolaiDolmer/CyclingZone/issues/2495). Tre-tier klubstruktur = målbilledet (epic [#2492](https://github.com/NicolaiDolmer/CyclingZone/issues/2492), superseder #958). **Fase 0-sidestrøm klar (uge 30-31):** #2484 udviklings-moment · #2485 akademi-regnskab · #2486 spec-forlig · #2456-kodeoprydning (✅ PR #2483 fra bølgen).

> **Ejer-klikliste (åben):** [#2588](https://github.com/NicolaiDolmer/CyclingZone/issues/2588) /training-klik-test (#2578) _(PR #2587 A/B+merge ✅ klaret 17/7)_ · flip `peak_planner_enabled` beta→on (#2426) · #2461 Discord-svar-udkast (7 stk.) · Sentry alert 559456 regression-condition (#2389-kommentar pkt 7) · Alunta+CZ Pro testkøb (#1903) · flip-bølge-verify (#2357) · /training-verify · Supabase OTP-expiry+leaked-pw (#2258/#929) · TdF-dag (#2080) · #2276 rest-verify · #2288 dashboard-verify · #2100 loft-projektion · #2076/#2085/#1784 · organisk outreach-bølge 2 klar til post ([#2236](https://github.com/NicolaiDolmer/CyclingZone/issues/2236): kanaler + godkendte tekster). _(Discord-announce + CYCLINGZONE-2G/24 klaret 16/7.)_

> **Åbne pick-ups:** Klub-UX Slice 2 [#2311](https://github.com/NicolaiDolmer/CyclingZone/issues/2311) · v3-flip-forudsætninger #2376 · Palmarès-rest (#1997: roster-tidslinje, mulig S3) · #1996 del 2 (claude:blocked) · #2436 (lav) · perf/CI-rest [#2511](https://github.com/NicolaiDolmer/CyclingZone/issues/2511). **Kendt bug:** test-konti wipes (#2245, high). Mobil = 54,9% af app-besøg.

> **🩺 Sentry/Railway-triage 18/7:** 1 nyt Sentry-issue **CYCLINGZONE-35** (board_update-DM'er 100% skippet, #2571-guarden) — verificeret false-positive + fixet autonomt: board-DM'en re-fyrede hvert 30-min-tick uden for in-app 24h-dedup → DM-spam-latent + falsk guard-streak når eneste due modtager var ulinket (`discord_id=null`). Fix ([#2619](https://github.com/NicolaiDolmer/CyclingZone/issues/2619)/PR [#2620](https://github.com/NicolaiDolmer/CyclingZone/pull/2620), backend-only, ejer-merge): gate DM på `result.delivered`. Sentry resolvet, postmortem skrevet. Ingen 48h-restance. Railway ellers rent (transfer_offer no-recipient = benigne #449-drops til ulinkede hold; entry-sweep sund).

> **📋 v7.20 (denne PR):** In-game Kontakt-knap (#2602) — feedback/bug/idé-modal ved siden af Hjælp; player_feedback-migration (ejer applier separat efter merge); Discord-spejl kræver DISCORD_FEEDBACK_WEBHOOK_URL (no-op indtil sat).
>
> **🤖 Working agent:** Claude Code (Fable, main-checkout) — 18/7 formiddagsbølge: #2617 · #2616 · #2592 · #2624-verify · #2603 (subagenter i worktrees). #2461 Discord-svar-udkast venter stadig ejer-review.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: #1152 afventer godkendelse. Rytterprofil-rest: hero/rating #2006 + højde/vægt+compare #2266.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 16/7 (dagbølge-close-out); Discord-sweep 15/7-detaljer, #2437-forløbet og watchdog-triagen ligger i git-log, issue-tråde + bølge-artifacts._
