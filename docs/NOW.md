# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-02j leveret ✅ 2026-05-05 (v2.42).** Polish: BOARD_TOUR_STEPS opdateret, HelpPage Bestyrelse-sektion tilføjet (9 blokke), PatchNotes v2.42, doc-drift sweep (ARCHITECTURE, DOMAIN_REFERENCE, FEATURE_STATUS). S-02 KOMPLET (10/10 slices leveret). Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md).

## Soak-gate
**Ikke aktiv** — S-02j er doc/polish, ingen ny kode-slice.

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** S-02 KOMPLET (S-02a–S-02j, 10/10 slices). ~19 managers live. Næste: product backlog for ny slice (se PRODUCT_BACKLOG.md).

## Senest leveret
- 2026-05-05: **S-02j Polish** (v2.42). BOARD_TOUR_STEPS: 3 trin opdateret med nyt dashboard-/konsekvens-/DNA-sprog. HelpPage: ny 'Bestyrelse'-sektion (◧) som 2. sidebaritem med 9 indholds-blokke (baseline, sekventiel onboarding, dashboard, board-members, DNA, konsekvens-tabel, requests+drej-låsninger, mid-season). PatchNotes v2.42. ARCHITECTURE.md: Board API +4 ruter, Backend Lib +8 board-moduler, DB-tabeller +5 nye (team_board_members, board_consequences, team_dna, teams-ext, transfer_windows-ext). DOMAIN_REFERENCE.md: Board-sektion komplet omskrevet med S-02 features. FEATURE_STATUS.md: S-02h + S-02i entries tilføjet.
- 2026-05-05: **S-02i Bug-fix-pass + regression-tests** (v2.41). 293/293 grønne.
- 2026-05-05: **S-02h Wizard-redesign Hybrid B+A** (v2.40). 286/286 grønne.
- 2026-05-05: S-02g–a leveret (v2.39–v2.33) — manager-konkurrence, mid-season, drej-låsninger, DNA, konsekvens-tier, mål-typer, foundation
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
Læs PRODUCT_BACKLOG.md og vælg næste slice. S-02 er afsluttet.
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
