# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-02g leveret ✅ 2026-05-05 (v2.39).** Manager-konkurrence + mid-season + drej-låsninger komplet. 6 mini-features: F1 live `relative_rank` UI ("Du staar #X af Y managers"), F2 mid-season auto-banner ([boardMidSeason.js](backend/lib/boardMidSeason.js)) ved race_days_completed >= midpoint, F3 tradeoff-låsninger (deferred stramning af identity_riders eller sponsor_growth ved next renewal), F4 MAJOR pivot cool-down (én youth↔star-krydsning pr. plan-livscyklus), F5 window-blokering (sidste 5 race-days), F6 mid-cycle-låsning (5yr/3yr kræver ≥50% gennemført ELLER >30% satisfaction-delta). 36 nye tests (286/286 grønne). Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md). 2 sub-slices tilbage (S-02h + S-02i) + polish.

## Soak-gate
**Aktiv: nej** — næste udløses ved S-02i (e2e efter alle 9 sub-slices).

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** Eneste P0 tilbage: S-02 (7/9 sub-slices leveret — S-02a + S-02b + S-02c + S-02d + S-02e + S-02f + S-02g). ~19 managers live.

## Senest leveret
- 2026-05-05: **S-02g Manager-konkurrence + mid-season + drej-låsninger** (v2.39). Migration `2026-05-05-board-tradeoff-pivot.sql` (board_profiles.tradeoff_active_until_season_id + tradeoff_payload + major_pivot_used_at) + ny [boardMidSeason.js](backend/lib/boardMidSeason.js)-motor (`processMidSeasonReviewCron` + `evaluateMidSeasonTrigger`) hookt ind i [cron.js](backend/cron.js) (30-min interval) + `applyTradeoffTighteningToGoals` ([boardGoals.js](backend/lib/boardGoals.js)) anvendt sidst i goal-pipeline + buildBoardProposal accepterer tradeoffPayload + isMajorPivotRequest + getBoardRequestAvailability F4/F5/F6 guards + /api/board/proposal+sign reader/clearer tradeoff-felter + BoardPage relative_rank rich detail + '🔒 Strammet'-badge + 6 nye HelpPage FAQ + 36 nye tests
- 2026-05-05: S-02f Klub-DNA (v2.38) — 5 DNA-arketyper + 3 forslag i sæson 2 + DNA-bias på alignment + tradition-mål i 5yr
- 2026-05-05: S-02e Konsekvens-tier (6 lag) (v2.37) — 6-lags graduerings-system + hard-blocks
- 2026-05-05: S-02d Udvidede mål-typer (v2.36) — 7 nye mål-typer + 3 integreret som 5. mål
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
**"Start S-02h — Wizard-redesign Hybrid B+A"** ELLER **"Start S-02i — Bug-fix-pass + e2e + soak-gate"**
S-02h leverer compact strategisk dashboard m. mini-dialog board-member-portrætter + multi-plan-fornyelses-flow + mobile-stack — har S-02a + S-02c som dep. S-02i er den endelige soak-gate-slice (60-min e2e gennem alle plan-livscyklusser × arketyper × mål-typer × konsekvens-tiers) — har S-02a-h som dep. ÉN slice = ÉN session = commit + push.

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
