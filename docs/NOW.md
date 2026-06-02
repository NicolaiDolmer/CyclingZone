# NOW — Aktuel arbejdsstatus

> **🟢 Seneste close-outs** (detaljer i git-historik + issues/PRs): **2. juni — UCI-sync + scraper-guard:** Manuel `uci_sync.yml`-kørsel (nye UCI-point live, gates bestået: coverage 3000≥2400, downgrades 294/899). Kørslen afslørede at scraperen rørte fiktive ryttere (#669, pcm_id NULL) → 16 gulvet til MIN. Forward-guard `pcm_id=not.is.null` i `fetch_db_riders` (PR), postmortem i `.claude/learnings/`. Fiktive værdier bevidst ikke gendannet (omlaves). Max Poole (rigtig, frosset 342 siden 28/4 pga. navne-mismatch) rettet til 5 (ejer: reelle point = 0). **2. juni — #962 Division fyld-fra-toppen:** PR [#967](https://github.com/NicolaiDolmer/CyclingZone/pull/967) merged — nye hold til højeste division med ledig plads (`DIVISION_CAPACITY=20`, blød cap på bund); `rebalanceDivisions` ved sæson-slut. **Opfølgning:** test-konti talte fejlagtigt mod kapaciteten (usynlige på ranglisten men spiste div-1-pladser → 3 rigtige hold endte i div 2); fikset så kun "rigtige" hold (ekskl. AI/test/frosne) tæller — migration kørt, div 1 = 20, div 2 = 0. **2. juni — Pre-launch hærdnings-audit:** multi-agent adversarisk review af alle økonomi-/board-/transfer-commits merged sidste 48t. 3 verificerede regressions, alle i loan-buyout-windowing (#19 Del B, samme rod: overloadet `window_pending`). Fix i [#965](https://github.com/NicolaiDolmer/CyclingZone/pull/965) — ny distinkt `buyout_pending`-status; migration anvendt i prod; 895/895 + 147/147 grøn. Økonomi/board/frontend rene. #19 åben til #965 merged + buyout-verificeret. **2. juni — Pakke B+C** PR [#951](https://github.com/NicolaiDolmer/CyclingZone/pull/951) (search_path-hærdning #927) + [#952](https://github.com/NicolaiDolmer/CyclingZone/pull/952) (#913 dashboard sæson-filter + #915 mid-season plan-lås) merged; #914/#928 lukket working-as-intended. **2. juni — Brainstorm:** founder-feature-dump trieret → 10 nye issues (#954–#963) oprettet. **2. juni — GitHub-audit:** 21 issues lukket. **1. juni — Sundhedsaudit:** #876/#882/#878/#879/#792/#767 lukket; #1-prod-fejl (`lazyWithRetry`, #883) fixet.

## Aktiv styring

> **🎯 Next action:** [#959](https://github.com/NicolaiDolmer/CyclingZone/issues/959) V2-del: udvid resultat-importen så pr.-etape-klassementer (GC/point/bjerg/ungdom pr. etape) + tider/gaps gemmes (besluttet: før launch). Derefter [#961](https://github.com/NicolaiDolmer/CyclingZone/issues/961) hjælp. Ejer-verify udestår på #787/#816/#959-V1.
>
> **🤖 Working agent:** Ingen aktiv session.
>
> **Launch-sprint TdF** (`slice:tdf-launch`): ✅ #787 sprog (PR #971 merged) · ✅ #960 nulstil · ✅ #816 >100% (#972) · ✅ #271 dashboard (lukket) · ✅ [#959](https://github.com/NicolaiDolmer/CyclingZone/issues/959) etape-V1 (denne session — frontend) — V2-import udestår · [#961](https://github.com/NicolaiDolmer/CyclingZone/issues/961) hjælp · [#963](https://github.com/NicolaiDolmer/CyclingZone/issues/963) besøgs-log.
>
> **Epics (post-launch):** [#954](https://github.com/NicolaiDolmer/CyclingZone/issues/954) Transparens · [#955](https://github.com/NicolaiDolmer/CyclingZone/issues/955) Bestyrelse-UI · [#956](https://github.com/NicolaiDolmer/CyclingZone/issues/956) Deadline-hub · [#957](https://github.com/NicolaiDolmer/CyclingZone/issues/957) Popularitet · [#958](https://github.com/NicolaiDolmer/CyclingZone/issues/958) U23/Junior · [#959](https://github.com/NicolaiDolmer/CyclingZone/issues/959) Etape-resultater.

---

## Standing context (launch-deadline 20. juni)

- **Præmieudbetalinger på pause** indtil præmie-audit-epic [#893](https://github.com/NicolaiDolmer/CyclingZone/issues/893) er færdig — udbetal IKKE før da. Kerne-PRs #907/#909/#910 merged; #896-preview afventer ejer-verify (admin → Økonomi → Præmieudbetaling → sæson 1 → "Se status").
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SUPABASE_SERVICE_KEY-rotation åben · [#929](https://github.com/NicolaiDolmer/CyclingZone/issues/929) leaked-password = dashboard-toggle (ejer).
- **TdF launch-prep:** [#676](https://github.com/NicolaiDolmer/CyclingZone/issues/676) Race Engine V1 (stor risiko) · [#672](https://github.com/NicolaiDolmer/CyclingZone/issues/672) landing page · [#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671) brand · [#864](https://github.com/NicolaiDolmer/CyclingZone/issues/864) UI/UX-audit-fund.
- **Ejer-verify udestår:** #793/#19/#896 (claude:done) · merge PR #947 (skill-docs) · #669 fiktive-rytter-auktionstest.

_Opdateret af Claude (Claude Code) 3. juni 2026 — #959 etape-resultater V1 (ny `/races/:raceId` detaljeside: etape-faner + trøje-badges + Samlet-klassementer; data-akkurat — pr.-etape-klassementer + tider findes ikke endnu, V2-import udestår før launch)._
