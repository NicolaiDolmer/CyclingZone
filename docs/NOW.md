# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Menu IA v2.44 klar 2026-05-05.** Venstremenu samlet i Klubhus / Marked / Sæson & Resultater / Liga. S-02 er komplet (10/10 slices). Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md).

## Soak-gate
**Ikke aktiv** — v2.44 er lille navigation/IA-slice uden ny domænelogik.

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** S-02 KOMPLET (S-02a–S-02j, 10/10 slices). ~19 managers live. Næste: product backlog for ny slice (se PRODUCT_BACKLOG.md).

## Senest leveret
- 2026-05-05: **Menu IA v2.44** — venstremenuen samlet i fire mentale rum, `/races` flyttet til Sæson & Resultater, `/deadline-day` label ændret til Deadline Day, HelpPage/PatchNotes/FEATURE_STATUS afstemt.
- 2026-05-05: **Admin-fix v2.43** — 'Nulstil sæsoner' blokeret af FK fra `finance_transactions.season_id` (307 prod-rows). [betaResetService.js](backend/lib/betaResetService.js) nuller nu season_id på alle finance_transactions før `DELETE FROM seasons`. 1 ny regression-test, 294/294 grønne.
- 2026-05-05: **S-02j Polish** (v2.42). BOARD_TOUR_STEPS: 3 trin opdateret med nyt dashboard-/konsekvens-/DNA-sprog. HelpPage: ny 'Bestyrelse'-sektion (◧) som 2. sidebaritem med 9 indholds-blokke. PatchNotes v2.42. ARCHITECTURE.md, DOMAIN_REFERENCE.md, FEATURE_STATUS.md doc-drift sweep.
- 2026-05-05: **S-02i Bug-fix-pass + regression-tests** (v2.41). 293/293 grønne.
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
