# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-02 Bestyrelse-redesign — Vision-lock 1A ✅ 2026-05-05.** Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md). 9 sub-slices + polish. Estimat: ~10-12 sessioner.

## Soak-gate
**Aktiv: nej** — næste udløses ved S-02i (e2e efter alle 9 sub-slices).

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** Eneste P0 tilbage: S-02 (vision låst, mekanik-Q'er åbne). ~19 managers live, vokser løbende.

## Senest leveret
- 2026-05-05: S-02 vision-lock + master-roadmap (FM-inspireret, navngivne board-members, hybrid B+A wizard, 6-tier konsekvens, full reset, manager-only)
- Ældre (v2.32 ønskeliste m.fl.) → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
**"Fortsæt S-02 vision-lock — Q-batch 1B mekanik"**
1. Læs `docs/slices/02-board-redesign-MASTER.md` (kanonisk)
2. 5-8 mekanik-Q'er: board-arketyper, klub-DNA, mål-tærskler, konsekvens-grænser, manager-konkurrence-scope
3. INGEN kode. Ren Q-session. Efter 1B + 1C → S-02a kan starte.

## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 260K, gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- NOW.md: maks 30 linjer — flyt historik til archive samme session arbejdet lukkes
