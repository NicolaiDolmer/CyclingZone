# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-02i leveret ✅ 2026-05-05 (v2.41).** Bug-fix-pass + regression-tests + soak-gate (kode-audit + browser build-verificering). 1 bug fundet og rettet (renewal queue order). 293/293 tests grønne. Næste: S-02j (polish). Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md).

## Soak-gate
**Aktiv: kvitteret** — S-02i 2026-05-05: code-audit, 1 bug rettet (renewal queue-orden), 7 regression-tests for processSeasonEnd, 293/293 grønne, build ren. Manuel browser-test (login) anbefales inden S-02j.

## Open beta status
**Alle launch-gates ✅, 5/6 P0 leveret.** S-02 kode-slices 9/9 leveret (S-02a–S-02i). Tilbageværende: S-02j polish (HelpPage, onboarding-tour, doc-drift). ~19 managers live.

## Senest leveret
- 2026-05-05: **S-02i Bug-fix-pass + regression-tests** (v2.41). Bug: multi-plan renewal queue startede med clicked plan i stedet for PLAN_SEQUENCE-orden (Q19: "længste plan forhandles først") — rettet i [BoardPage.jsx](frontend/src/pages/BoardPage.jsx). 7 nye regression-tests for processSeasonEnd ([economyEngine.test.js](backend/lib/economyEngine.test.js)) dækker S-02c/d/e paths (replacement trigger, mid-review notif, triggerDoublePlanLapse, u25 snapshot, fejl-isolation). processReplacementTrigger + evaluateAndApplyConsequences gjort deps-injectable. 293/293 grønne.
- 2026-05-05: **S-02h Wizard-redesign Hybrid B+A** (v2.40). 3-kolonne dashboard, GoalMiniDialog, wizard modal overlay, multi-plan renewal queue. 286/286 grønne.
- 2026-05-05: S-02g–a leveret (v2.39–v2.33) — manager-konkurrence, mid-season, drej-låsninger, DNA, konsekvens-tier, mål-typer, foundation
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
**"Start S-02j — Polish"**
S-02j: onboarding-tour-trin på BoardPage (opdateret efter wizard-redesign), HelpPage bestyrelses-sektion fuld omskrivning, PatchNotesPage v2.33–v2.41 gennemlæsning, doc-drift sweep (ARCHITECTURE, DOMAIN_REFERENCE, FEATURE_STATUS). Kan splittes i 2 sessioner per master-roadmap. Anbefaling: lav manuel browser-test (login) af board-flows inden S-02j startes.
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
