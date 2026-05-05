# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-02d leveret ✅ 2026-05-05 (v2.36).** 7 nye mål-typer + 3 integreret som 5. mål i focus-pakker (u25_development_delta i youth_development, signature_rider i star_signing, relative_rank i balanced) + ny shared kontekst-loader (`boardGoalContext.js`) brugt af både processSeasonEnd og /board/status. Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md). 5 sub-slices tilbage + polish.

## Soak-gate
**Aktiv: nej** — næste udløses ved S-02i (e2e efter alle 9 sub-slices).

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** Eneste P0 tilbage: S-02 (4/9 sub-slices leveret — S-02a + S-02b + S-02c + S-02d). ~19 managers live.

## Senest leveret
- 2026-05-05: **S-02d Udvidede mål-typer** (v2.36). Migration `2026-05-05-board-goal-types.sql` (u25_stat_sum + u25_count på board_plan_snapshots) + 7 nye entries i `GOAL_METADATA_BY_TYPE` + udvidet `evaluateGoal`/`evaluateGoalProgress`/`buildGoalLabel`/`buildNegotiatedGoal` for alle 7 typer + ny `boardGoalContext.loadGoalContextForBoard` shared mellem processSeasonEnd og /board/status + 3 nye 5. mål integreret i generateBoardGoals + 27 nye tests (191/191 grønne)
- 2026-05-05: S-02c Navngivne board-medlemmer (v2.35) — 9 arketyper + 5 medlemmer/team + 270 reactions
- 2026-05-05: S-02b 1yr-auto-gen + identity-feeding + auto-accept (v2.34)
- 2026-05-05: S-02a foundation — sekventiel forhandling + sæson-1-baseline (v2.33)
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
**"Start S-02e — Konsekvens-tier (6 lag)"** ELLER **"Start S-02f — Klub-DNA"**
S-02e leverer 6-lags konsekvens-tier (sponsor-mod / salary-cap / signing-restr / tvunget listing / sponsor-pull-out / bonus-tilbud) — har kun S-02a som dep. S-02f leverer 5 håndlavede klub-DNA-arketyper + sæson 2-tildelings-flow — har S-02c som dep, og kan også aktivere de 4 'sovende' mål-typer fra S-02d (monument_podium, jersey_wins, profitable_transfers via DNA-baseret valg). ÉN slice = ÉN session = commit + push.

## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 260K, gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- NOW.md: maks 30 linjer — flyt historik til archive samme session arbejdet lukkes
