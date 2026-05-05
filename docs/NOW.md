# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-02b leveret ✅ 2026-05-05 (v2.34).** identity-feeding-badge + auto-accept-cron + countdown-banner + Bestyrelse-feed. `teams.season_1_identity_basis` JSONB-felt populeres i `startSequentialNegotiation`. Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md). 7 sub-slices tilbage + polish.

## Soak-gate
**Aktiv: nej** — næste udløses ved S-02i (e2e efter alle 9 sub-slices).

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** Eneste P0 tilbage: S-02 (2/9 sub-slices leveret — S-02a + S-02b). ~19 managers live, vokser løbende.

## Senest leveret
- 2026-05-05: **S-02b 1yr-auto-gen + identity-feeding + auto-accept** (v2.34). Migration `2026-05-05-board-1yr-autogen.sql` + `computeSeasonOneIdentity` + `boardAutoAccept.js` (T-3/T-1/auto-accept ved race_days_completed=2/4/≥5) + identity-feeding-badge på 5yr-mål-kort + countdown-banner + Bestyrelse-feed-sektion. 146/146 backend-tests grønne (15 nye)
- 2026-05-05: S-02a foundation — sekventiel forhandling + sæson-1-baseline (v2.33)
- 2026-05-05: S-02 Q-batch 1A+1B+1C alle låst — 21 beslutninger total (vision+mekanik+UX) i master-doc
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
**"Start S-02c — Navngivne board-members"** ELLER **"Start S-02d — Udvidede mål-typer"**
Begge har S-02a som dep (S-02c uafhængig af S-02b, S-02d uafhængig af S-02b). S-02c leverer 9 board-arketyper-rows + ~270-450 reaktions-templates + avatar-grid på BoardPage + udskiftnings-trigger. S-02d leverer 7 nye mål-typer (monument_podium, jersey_wins, signature_rider, profitable_transfers, u25_development_delta, relative_rank, domestic_dominance). ÉN slice = ÉN session = commit + push.

## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 260K, gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- NOW.md: maks 30 linjer — flyt historik til archive samme session arbejdet lukkes
