# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT:** [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md). **Rækkefølge-SSOT:** [docs/MASTERPLAN.md](MASTERPLAN.md). **Vision (ejer 10/7):** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, udførende subagenter på sonnet i worktrees; PR der afventer aftalt justering = draft.

## Aktiv styring

> **🎯 Next action (14/7 — [#2430](https://github.com/NicolaiDolmer/CyclingZone/issues/2430), ejer-planlagt):** Verificér stage-scheduler-throughput i prod + luk resterende stall-årsag. #2391-fixet (`recompute_season_standings`-RPC ~190ms, PR #2396) er merged+applied men aldrig prod-verificeret (Railway-MCP ikke auth'et). (1) auth Railway → tjek stage-scheduler-log viser standings `(RPC)` + INGEN `⏭️ forrige tick`-overlap; (2) hvis 18:00-klyngen (22 etaper) stadig dræner >2t, find resterende langsomme del (etape-sim/persist/Discord-notify). Rel: #2251/CYCLINGZONE-24.

> **💰 Værdimodel v4 (#2428) — SLICE 1 SHADOW MERGED til main 14/7** (PR [#2431](https://github.com/NicolaiDolmer/CyclingZone/pull/2431) squash 1c20dc46, prod-deploy READY; ingen migration/økonomi-ændring, v3 uændret; admin-preview live Admin→Økonomi). Sim + fit + karriere-NPV (`predictBaseValueV4`) + scorecard + admin-preview (Admin→Økonomi). **Ejer-review før cutover:** [audit](audits/2026-07-13-valuation-v4-shadow-scorecard.md) — **7/7 gates grønne** (free-agent-måling som virtuelle hold + blødt top-loft gamma=0,65): runaway ×3,2→×1,48, skala-drift −4,9%. β_pt degenereret (prize=75×point); type-økonomi inverterer v3 (puncheur/gc tjener mest, sprinter/tt mindst). Modellen er mekanisk cutover-klar; tilbage er ren tuning. **Cutover (slice 2) = separat ejer-gated session:** tune soft-cap gamma (frontier i audit-doc) + maxRoi + Q1-Q3 → migration (ejer merger). Rør ALDRIG GENERATED-kolonner/prize_earnings_bonus før da.

> **v3-track (roadmap-SSOT: MASTERPLAN):** race-engine-dybde [spec ejer-godkendt](superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md). S1-S4 LIVE (`race_engine_v3_scoring='on'` 12/7). **S5 planner-cockpit MERGED (#2426)** — ejer: flip `peak_planner_enabled` når verificeret. Næste: S6 why-rapport. Disciplin: ≥2 ugentlige v3-sessions. Andre specs klar til slices (ejer vælger): træning+ungdom-dybde, narrativ (palmarès/recap).

> **Ejer-klikliste (åben):** flip `peak_planner_enabled` (#2426) · Discord-announce race-v3 (afventer ordret tekst) · Sentry alert 559456 regression-condition (#2389-kommentar pkt 7) · Alunta+CZ Pro testkøb (#1903) · flip-bølge-verify (#2357: scout+faciliteter live) · /training-verify · Supabase OTP-expiry+leaked-pw (#2258/#929) · TdF-dag (#2080) · #2276 Div4-kaskade rest-verify · #2288 dashboard-verify · #2100 loft-projektion · #2206 rangliste · #2081 slice 1 (PR #2225) · #2076/#2085/#1784.

> **Åbne pick-ups:** Klub-UX Slice 2 [#2311](https://github.com/NicolaiDolmer/CyclingZone/issues/2311) (tier-preview + facilitets-help) · v3-flip-forudsætninger #2376 · Palmarès-småvalg (#1997) · #1996 del 2 (fælles session, claude:blocked). **Kendt bug:** test-konti wipes (#2245, high). Vercel-preview mangler mock (#1834) → ejer-gennemklik = lokal dev-server.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: #1152 afventer godkendelse. Rytterprofil-rest: hero/rating #2006 + højde/vægt+compare #2266.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 13/7 (v4 slice 1 close-out); afsluttet arbejde (natbølge 11-12/7, Sentry-hærdning #2394, stage-scheduler #2391/#2396, hotfix 13/7 #2420/#2421/#2429, Fase 3-flip #2357, talentspejder-flip) i git-log + issue-tråde._
