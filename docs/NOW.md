# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-02a Foundation leveret ✅ 2026-05-05 (v2.33).** Sæson 1 = baseline; sæson-1-slut → `startSequentialNegotiation` (inline i `processSeasonEnd`) → window `pending_5yr` + baseline-rows slettes. Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md). 8 sub-slices tilbage + polish.

## Soak-gate
**Aktiv: nej** — næste udløses ved S-02i (e2e efter alle 9 sub-slices).

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** Eneste P0 tilbage: S-02 (1/9 sub-slices leveret). ~19 managers live, vokser løbende.

## Senest leveret
- 2026-05-05: **S-02a foundation** — sekventiel forhandling + sæson-1-baseline (v2.33). Migration `2026-05-05-board-foundation.sql` + `boardSequentialNegotiation.js` + `createBaselineProfile` + processSeasonEnd-integration + BoardPage observations-banner. 131/131 backend-tests grønne. Beta-reset opretter nu 1 baseline-row pr. team
- 2026-05-05: S-02 Q-batch 1A+1B+1C alle låst — 21 beslutninger total (vision+mekanik+UX) i master-doc
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
**"Start S-02b — 1yr-auto-gen + identity-feeding + auto-accept"** ELLER **"Start S-02c — Navngivne board-members"**
Begge har kun S-02a som dep og kan parallelt-køres af Codex/Claude. S-02b leverer `computeSeasonOneIdentity` + identity-feeding-badge på 5yr-mål + auto-accept ved race_day_count ≥ 5 + tier-styrede notifs. S-02c leverer 9 board-arketyper-rows + reaktions-templates + avatar-grid på BoardPage. ÉN slice = ÉN session = commit + push.

## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 260K, gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- NOW.md: maks 30 linjer — flyt historik til archive samme session arbejdet lukkes
