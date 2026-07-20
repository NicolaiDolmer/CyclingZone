# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT:** [ejer-dashboard](audits/2026-07-02-ejer-dashboard.md). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md). **Vision (10/7):** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Next action (ejer):** (1) **⏸️ Auktions-skub: beslut nerf/behold + evt. nyt skub inden 20/7 ~22:53** (59 auktioner +24t, backup `backup_auction_push_24h_20260719`, patch 7.32). (2) **📈 Growth-sprint 20/7:** godkend 3 e-mail-tekster (PR #2728-body / chat) + RESEND_API_KEY+EMAIL_UNSUB_SECRET i Railway → flip `email_loop_enabled` off→dry_run→on · Alunta-config + testkøb (#1903) · Hattrick/bølge-2-udkast på [#2236](https://github.com/NicolaiDolmer/CyclingZone/issues/2236). (3) **👍/👎 [#2639](https://github.com/NicolaiDolmer/CyclingZone/issues/2639)** trim 7 D4-AI-hold — **blokerer nu audit-checket på ALLE PR'er** (#2728 krævede admin-merge). (4) **#2449 S2-kalender LIVE** (455 løb 27/7→23/8, PR #2726, patch 7.34) — kør transition #2361 ~27/7; hurtigt browser-tjek: Kalender → Sæson 2. (5) Åbne ejer-beslutninger: #2699 akademi-overflow (sim klar) · #2589 sponsor-divisor · #2697 scout-slot · #2670 ROI-loft · #2452+#2176 når v4-adfærd kan måles. (6) AI-audit [#2689](https://github.com/NicolaiDolmer/CyclingZone/issues/2689) (#2679/#2681/#2682; klik: #2680). (7) Supabase-audit: [#2677](https://github.com/NicolaiDolmer/CyclingZone/issues/2677) RLS-perf · [#2678](https://github.com/NicolaiDolmer/CyclingZone/issues/2678) matview · #929/#2258 OTP+leaked-pw (2 dashboard-klik) · #2259 backup-oprydning.

> **📈 Growth-sprint 20/7 (mål: 500 brugere + 25 betalende / 30 dage; baseline 154 brugere, 38 WAU, D1-retention ~24%):** Founder først-50 LIVE (PR #2727, patch 7.33, seat-counter på /pro; venter kun på Alunta-config). E-mail-loop (D0/D1/dagligt digest, Resend) MERGED + migration applied, DORMANT bag `email_loop_enabled` (#2725 done; patch note ved flip). Første-session verificeret OK (62% bydder dag 0; gap = resultat-latens → dækkes af mails). Kanal-fund på #2236: Hattrick-omtale (45 sessions), Google organisk 148/2d, ChatGPT-referral. Bølge 2 fyres EFTER mails er live (ejer-valg A).

> **💰 Værdi v4 + løn-decoupling LIVE 18/7** (scorecards i docs/audits/). Kø derefter: #1281 market_premium (parkeret) · #2064-slices: S1 sim-harness → S3 Årgangsdagen **26/7** (S2-kalender ✅) · cutover-efterslæb #2667/#2669/#2672. Akademi: #2262, #2494/#2495, bugs #1799/#2257. #2064 S0 søndags-drip LIVE 19/7 (127 hold, ejer-låst spec). Rest fra 19/7: #2675 stemplede udløbs-auktioner + other_teams-rapport.

> **🎓 Træning/ungdom-addendum (ejer-låst 16/7):** [spec](superpowers/specs/2026-07-16-traening-ungdom-verdensklasse-addendum-design.md), epic [#2492](https://github.com/NicolaiDolmer/CyclingZone/issues/2492). Fase 0 (uge 30-31): #2484 · #2485 · #2486. Ejer-rest fra tidligere: #2645B + #2650 fatigue (simulér-før-ship) · #2461 Discord-udkast · flip `peak_planner_enabled` beta→on (#2426).

> **Ejer-klikliste (øvrig):** #2588 /training-klik-test · Sentry alert 559456 regression-condition · #2357 flip-bølge-verify · TdF-dag (#2080) · #2276/#2288/#2100 · #2076/#2085/#1784.

> **Åbne pick-ups:** Klub-UX Slice 2 [#2311](https://github.com/NicolaiDolmer/CyclingZone/issues/2311) · v3-flip-forudsætninger #2376 · Palmarès-rest #1997 · #1996 del 2 (blocked) · #2436 (lav) · perf/CI-rest [#2511](https://github.com/NicolaiDolmer/CyclingZone/issues/2511). **Kendt bug:** test-konti wipes (#2245, high). Mobil = 54,9% af app-besøg.
>
> **🔕 Ops-hygiejne 20/7:** Discord-ops-spam stoppet ([#2730](https://github.com/NicolaiDolmer/CyclingZone/issues/2730)/PR #2733) — balance-drift-alarm var boot-kørt + dedup-løs → ét ping pr. deploy; nu edge-triggered via ny `ops_alert_state`-tabel (migration applied). Ægte balance-brud (maxRiderWinRate 0,67-0,75 vs mål 0,45) spores i [#2731](https://github.com/NicolaiDolmer/CyclingZone/issues/2731).
>
> **🤖 Working agent:** Ingen aktiv session.
>
## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: #1152 afventer godkendelse. Rytterprofil-rest: hero/rating #2006 + højde/vægt+compare #2266.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 20/7 (growth-sprint close-out); 17-19/7-bølgedetaljer ligger i git-log, issue-tråde + audits/night-wave-*.md._
