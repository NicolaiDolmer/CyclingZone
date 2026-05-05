# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-02 Bestyrelse-redesign — Vision+mekanik+UX låst (1A+1B+1C) ✅ 2026-05-05.** Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md). 9 sub-slices + polish. Estimat: ~10-12 sessioner. **Klar til S-02a foundation.**

## Soak-gate
**Aktiv: nej** — næste udløses ved S-02i (e2e efter alle 9 sub-slices).

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** Eneste P0 tilbage: S-02 (al spec låst, kode næste). ~19 managers live, vokser løbende.

## Senest leveret
- 2026-05-05: S-02 Q-batch 1A+1B+1C alle låst — 21 beslutninger total (vision+mekanik+UX) i master-doc
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
**"Start S-02a — Foundation: sekventiel forhandling + sæson-1-baseline"**
Læs `docs/slices/02-board-redesign-MASTER.md` "S-02a"-sektionen. Migration + `boardEngine.startSequentialNegotiation` + `cron.js`-trigger + `BoardPage`-state. Full reset i Q6. ÉN slice = ÉN session = commit + push.

## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 260K, gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- NOW.md: maks 30 linjer — flyt historik til archive samme session arbejdet lukkes
