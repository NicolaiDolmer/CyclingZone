# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-02h leveret ✅ 2026-05-05 (v2.40).** Wizard-redesign Hybrid B+A komplet. 3-kolonne dashboard (lg:grid-cols-3, mobile stack), GoalMiniDialog (klik på mål → portræt + reaktion), wizard som modal overlay (ikke full-page takeover), multi-plan renewal queue Q19 (auto-advance + Tilbage-knap). 286/286 tests grønne. Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md). 1 sub-slice tilbage (S-02i) + polish.

## Soak-gate
**Aktiv: nej** — udløses ved S-02i (e2e efter alle 9 sub-slices, inkl. manuel browser-check af nyt 3-kolonne layout + GoalMiniDialog + wizard modal).

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** Eneste P0 tilbage: S-02 (8/9 sub-slices leveret — S-02a–S-02h). ~19 managers live.

## Senest leveret
- 2026-05-05: **S-02h Wizard-redesign Hybrid B+A** (v2.40). [BoardPage.jsx](frontend/src/pages/BoardPage.jsx) redesignet: 3-kolonne dashboard (grid-cols-3, mobile stack), ny `DashboardPlanPanel` (kompakt: tilfredshed% + sponsor× + top 3 mål + status-ikoner + detail-toggle), ny `GoalMiniDialog` (klik på mål → portræt + reaktion modal), wizard er nu modal overlay (ikke full-page takeover), multi-plan renewal queue (auto-advance + Tilbage-knap, Q19). 286/286 tests grønne.
- 2026-05-05: S-02g–d leveret (v2.39–v2.36) — manager-konkurrence, mid-season, drej-låsninger, DNA, konsekvens-tier, mål-typer
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
**"Start S-02i — Bug-fix-pass + e2e + soak-gate"**
S-02i er den endelige soak-gate-slice: 60-min e2e manuel test af alle plan-livscyklusser × arketyper × mål-typer × konsekvens-tiers × nyt 3-kolonne dashboard + GoalMiniDialog + wizard modal. Regressions-tests for processSeasonEnd. ÉN slice = ÉN session = commit + push.

## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests/Members/Consequences`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 260K, gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- AI/bank/frozen får ALDRIG board-state (members, identity_basis, dna, consequences) — manager-only per Q-batch 1A Q8
- NOW.md: maks 30 linjer — flyt historik til archive samme session arbejdet lukkes
