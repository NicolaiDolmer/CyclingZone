# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-02c leveret ✅ 2026-05-05 (v2.35).** 9 board-arketyper + 5 navngivne medlemmer pr. team (3 identity + 2 non-conflicting wildcards) + 270 reaktions-templates + avatar-grid + GoalCard-reactions + chairman-replacement-trigger. Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md). 6 sub-slices tilbage + polish.

## Soak-gate
**Aktiv: nej** — næste udløses ved S-02i (e2e efter alle 9 sub-slices).

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** Eneste P0 tilbage: S-02 (3/9 sub-slices leveret — S-02a + S-02b + S-02c). ~19 managers live.

## Senest leveret
- 2026-05-05: **S-02c Navngivne board-medlemmer** (v2.35). Migration `2026-05-05-board-members.sql` + `boardArchetypes.js` (9 arketyper, 270 reactions) + `boardMembers.js` (assignment + sample-reaction + replacement-trigger) + hooks i sequential negotiation + economyEngine + boardEvaluation + API + BoardPage avatar-grid + GoalCard 'X reagerer'-expand. 164/164 backend-tests grønne (16 nye)
- 2026-05-05: S-02b 1yr-auto-gen + identity-feeding + auto-accept (v2.34)
- 2026-05-05: S-02a foundation — sekventiel forhandling + sæson-1-baseline (v2.33)
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
**"Start S-02d — Udvidede mål-typer"** ELLER **"Start S-02e — Konsekvens-tier (6 lag)"**
Begge har S-02a som dep og er uafhængige af S-02b/S-02c. S-02d leverer 7 nye mål-typer (monument_podium, jersey_wins, signature_rider, profitable_transfers, u25_development_delta, relative_rank, domestic_dominance). S-02e leverer 6-lags konsekvens-tier (sponsor-mod / salary-cap / signing-restr / tvunget listing / sponsor-pull-out / bonus-tilbud). ÉN slice = ÉN session = commit + push.

## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 260K, gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- NOW.md: maks 30 linjer — flyt historik til archive samme session arbejdet lukkes
