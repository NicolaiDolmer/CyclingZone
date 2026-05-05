# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-02f leveret ✅ 2026-05-05 (v2.38).** Klub-DNA komplet ([boardClubDna.js](backend/lib/boardClubDna.js)): 5 håndlavede DNA-arketyper (🌲 Skandinavisk udviklingshold · 🪨 Italiensk klassiker-traditionalist · ⚡ Sprint-fokuseret kommerciel · ⛰️ Fransk klatrer-arv · 🎯 Britisk all-rounder). Tildeling i sæson 2: 3 forslag (national_match + specialization_match + wildcard) computed fra `season_1_identity_basis`. DNA påvirker board-medlems-alignment ved chairman-replacement, mål-vægtning (×1.6 boost) og injicerer tradition-mål i 5yr-forslag. 18 nye tests (250/250 grønne). Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md). 3 sub-slices tilbage (S-02g + S-02h + S-02i) + polish.

## Soak-gate
**Aktiv: nej** — næste udløses ved S-02i (e2e efter alle 9 sub-slices).

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** Eneste P0 tilbage: S-02 (6/9 sub-slices leveret — S-02a + S-02b + S-02c + S-02d + S-02e + S-02f). ~19 managers live.

## Senest leveret
- 2026-05-05: **S-02f Klub-DNA** (v2.38). Migration `2026-05-05-board-club-dna.sql` (team_dna-reference-tabel seedet med 5 rows + teams.team_dna_key/team_dna_chosen_at) + ny [boardClubDna.js](backend/lib/boardClubDna.js)-motor (`computeDnaSuggestions` + `getDnaArchetypeAlignmentBonus` + `applyDnaWeightingToGoals` + `buildDnaTraditionGoal`) + DNA-bias hookt ind i `selectBoardMembers` (chairman-replacement) + `buildBoardProposal` (5yr tradition-injection + weighting med dedup mod base-pakken) + 2 nye routes `/api/board/dna-{suggestions,choose}` + BoardPage `ClubDnaSelectionCard` (før plan-cards) + `ClubDnaBadge` (efter valg) + 18 nye tests
- 2026-05-05: S-02e Konsekvens-tier (6 lag) (v2.37) — 6-lags graduerings-system + hard-blocks
- 2026-05-05: S-02d Udvidede mål-typer (v2.36) — 7 nye mål-typer + 3 integreret som 5. mål
- 2026-05-05: S-02c Navngivne board-medlemmer (v2.35) — 9 arketyper + 5 medlemmer/team + 270 reactions
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
**"Start S-02g — Manager-konkurrence + mid-season"** ELLER **"Start S-02h — Wizard-redesign Hybrid B+A"**
S-02g leverer relative_rank-mål m. live division-rangering, mid-season auto-banner, tradeoff-låsninger, drej-cooldown — har S-02a + S-02d som dep. S-02h leverer compact strategisk dashboard m. mini-dialog board-member-portrætter + multi-plan-fornyelses-flow + mobile-stack — har S-02a + S-02c som dep. ÉN slice = ÉN session = commit + push.

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
