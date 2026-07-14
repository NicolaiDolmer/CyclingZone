# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT:** [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md). **Rækkefølge-SSOT:** [docs/MASTERPLAN.md](MASTERPLAN.md). **Vision (ejer 10/7):** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, udførende subagenter på sonnet i worktrees; PR der afventer aftalt justering = draft.

## Aktiv styring

> **🎯 Next action (14/7 — [#2430](https://github.com/NicolaiDolmer/CyclingZone/issues/2430), ejer-planlagt):** Verificér stage-scheduler-throughput i prod + luk resterende stall-årsag. #2391-fixet (`recompute_season_standings`-RPC ~190ms, PR #2396) er merged+applied men aldrig prod-verificeret (Railway-MCP ikke auth'et). (1) auth Railway → tjek stage-scheduler-log viser standings `(RPC)` + INGEN `⏭️ forrige tick`-overlap; (2) hvis 18:00-klyngen (22 etaper) stadig dræner >2t, find resterende langsomme del (etape-sim/persist/Discord-notify). Rel: #2251/CYCLINGZONE-24.

> **💰 Værdimodel v4 (#2428) — SHADOW LIVE (elite-præmie-retning, ejer 14/7).** Admin→Økonomi→"Rytter-værdi v4". Ingen økonomi-ændring, v3 uændret. Retning skiftet fra soft-loft (klemte eliten ned) til **elite-præmie**: de enormt gode ryttere skal være UKØBELIGE. Stejl konveks præmie + gulv (8,2M for overall≥58) kalibreret mod hold-økonomi (rigeste 1,23M, sponsor 240k). Resultat: mega-stjerner v3 42-54M → v4 35-82M, alle ukøbelige; samlet +25%. 6/7 gates grønne. Audit: [audits/2026-07-13-valuation-v4-shadow-scorecard.md](audits/2026-07-13-valuation-v4-shadow-scorecard.md).
> **🎯 NÆSTE SESSION (#2428, ejer giver feedback på admin-preview FØRST):** (1) **Løn-decoupling** — løn=market_value×0,067 i dag → v4 ville hæve unge talenters løn (5,56M-værdi → 373k/sæson > sponsor). Fix: løn ← nuværende produktion/resultater, IKKE fremtids-NPV-værdi (værdi=køb/salg-pris, løn=ugeløn for levering). Egen økonomi-kritisk sim/scorecard-slice; shipper MED cutover. Design tallene først. (2) **Udvikl-og-sælg A/B/C** — ROI 172% (ukøbelig elite ⟹ lukrativt at udvikle til elite). (3) **Cutover slice 2** når 1-2 afklaret: predictBaseValue→v4 + løns-model + migration (ejer merger). Rør ALDRIG GENERATED/prize_earnings_bonus før da.

> **v3-track (roadmap-SSOT: MASTERPLAN):** race-engine-dybde [spec ejer-godkendt](superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md). S1-S4 LIVE (`race_engine_v3_scoring='on'` 12/7). **S5 planner-cockpit MERGED (#2426)** — ejer: flip `peak_planner_enabled` når verificeret. Næste: S6 why-rapport. Disciplin: ≥2 ugentlige v3-sessions. Andre specs klar til slices (ejer vælger): træning+ungdom-dybde, narrativ (palmarès/recap).

> **Ejer-klikliste (åben):** flip `peak_planner_enabled` (#2426) · Discord-announce race-v3 (afventer ordret tekst) · Sentry alert 559456 regression-condition (#2389-kommentar pkt 7) · Alunta+CZ Pro testkøb (#1903) · flip-bølge-verify (#2357: scout+faciliteter live) · /training-verify · Supabase OTP-expiry+leaked-pw (#2258/#929) · TdF-dag (#2080) · #2276 Div4-kaskade rest-verify · #2288 dashboard-verify · #2100 loft-projektion · #2206 rangliste · #2081 slice 1 (PR #2225) · #2076/#2085/#1784.

> **Åbne pick-ups:** Klub-UX Slice 2 [#2311](https://github.com/NicolaiDolmer/CyclingZone/issues/2311) (tier-preview + facilitets-help) · v3-flip-forudsætninger #2376 · Palmarès-småvalg (#1997) · #1996 del 2 (fælles session, claude:blocked). **Kendt bug:** test-konti wipes (#2245, high). Vercel-preview mangler mock (#1834) → ejer-gennemklik = lokal dev-server.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: #1152 afventer godkendelse. Rytterprofil-rest: hero/rating #2006 + højde/vægt+compare #2266.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 13/7 (v4 slice 1 close-out); afsluttet arbejde (natbølge 11-12/7, Sentry-hærdning #2394, stage-scheduler #2391/#2396, hotfix 13/7 #2420/#2421/#2429, Fase 3-flip #2357, talentspejder-flip) i git-log + issue-tråde._
