# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-02e leveret ✅ 2026-05-05 (v2.37).** 6-lags konsekvens-tier komplet ([boardConsequences.js](backend/lib/boardConsequences.js)): lag 1 passive (eksisterende), lag 2 lønloft <40, lag 3 signing-restriktion <30, lag 4 tvunget salg <15, lag 5 sponsor-pullout <10, lag 6 bonus-tilbud >75 + ≥75% mål nået. Hard-blocks i transfer/auction; pullout stacker multiplikativt med budget_modifier; bonus-card med Acceptér/Afvis. 41 nye tests (232/232 grønne). Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md). 4 sub-slices tilbage + polish.

## Soak-gate
**Aktiv: nej** — næste udløses ved S-02i (e2e efter alle 9 sub-slices).

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** Eneste P0 tilbage: S-02 (5/9 sub-slices leveret — S-02a + S-02b + S-02c + S-02d + S-02e). ~19 managers live.

## Senest leveret
- 2026-05-05: **S-02e Konsekvens-tier (6 lag)** (v2.37). Migration `2026-05-05-board-consequences.sql` (board_consequences-tabel m. unique-active-index) + ny [boardConsequences.js](backend/lib/boardConsequences.js)-motor (`evaluateAndApplyConsequences` + `assertSigningAllowed` + `selectForcedListingRider` + `acceptBonusOffer`/`declineBonusOffer`) + hooks i processTeamSeasonEnd (lag 4-6 inserts ved sat-tærskler) + processSeasonStart (lag 5 multiplicativ stack + auto-expire) + 3 transfer/auction routes hard-blockes via `assertSigningAllowed` + 2 nye routes `/api/board/bonus-offer/{accept,decline}` + BoardPage `BoardConsequencesPanel` + `BonusOfferCard` + 41 nye tests
- 2026-05-05: S-02d Udvidede mål-typer (v2.36) — 7 nye mål-typer + 3 integreret som 5. mål
- 2026-05-05: S-02c Navngivne board-medlemmer (v2.35) — 9 arketyper + 5 medlemmer/team + 270 reactions
- 2026-05-05: S-02b 1yr-auto-gen + identity-feeding + auto-accept (v2.34)
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
**"Start S-02f — Klub-DNA"** ELLER **"Start S-02g — Manager-konkurrence + mid-season"**
S-02f leverer 5 håndlavede klub-DNA-arketyper + sæson 2-tildelings-flow — har S-02c som dep, og kan også aktivere de 4 'sovende' mål-typer fra S-02d (monument_podium, jersey_wins, profitable_transfers via DNA-baseret valg). S-02g leverer relative_rank-mål m. live division-rangering, mid-season auto-banner, tradeoff-låsninger, drej-cooldown — har S-02a + S-02d som dep. ÉN slice = ÉN session = commit + push.

## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 260K, gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- NOW.md: maks 30 linjer — flyt historik til archive samme session arbejdet lukkes
