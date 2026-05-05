# NOW-historik 2026-05-05

## Senest leveret (flyttet fra NOW.md ved session-slut 2026-05-05 vision-lock)

- 2026-05-05: **Ønskeliste-stjerne (v2.32)** — ny delt komponent [WatchlistStar.jsx](frontend/src/components/WatchlistStar.jsx) erstatter inline `StarButton` i [RidersPage](frontend/src/pages/RidersPage.jsx) og bruges også i [WatchlistPage](frontend/src/pages/WatchlistPage.jsx) + [ActivityPage](frontend/src/pages/ActivityPage.jsx). Stjernen sidder nu i sin egen smalle kolonne lige efter Rytter-kolonnen — flyttet fra sidste kolonne efter alle 14 stats. Ønskelistens "★ Fjern"-knap fjernet fra Handling-kolonnen (stjernen alene er nok); Handling viser nu kun "Start auktion" for fri agents. ActivityPage's Ønskeliste-tab har nu fjern-stjerne med lokal state-update. Build grøn.

## S-02 Vision-lock-session 2026-05-05

Session afholdt med bruger; Q-batch 1A komplet. Master-roadmap skrevet til `docs/slices/02-board-redesign-MASTER.md` (erstatter `02-board-redesign-sequential.md`, der nu er S-02a af 9 sub-slices).

Låste vision-beslutninger (alle 8 godkendt):
1. Navngivne board-members: 5-7 håndlavede arketyper med 30-50 reaktions-templates
2. Plan-rytme: sæson 1 baseline → sæson 2 onboarding sekventielt → derefter forskudt naturlig rytme
3. "Drej men skift ikke": 3 låse (cool-down + evaluerings-vindue + mid-cycle-låsning)
4. Konsekvens-tier: 6 lag mild→hård (sponsor-modifier · salary cap · signing-restriktion · tvunget listing · sponsor-pull-out · bonus-budget-tilbud)
5. Manglende V1-features alle med (extended goals · klub-DNA · manager-konkurrence · mid-season aktiv påvirkning · tradeoff-låsninger)
6. Full reset af alle eksisterende managers' board-data
7. Wizard hybrid B+A: dashboard primær + mini-dialogs ved enkelt-mål-forhandling
8. Manager-only (ingen AI-board)

**Skalerings-præmis:** ~19 managers nu, vokser løbende. Al kode skal håndtere variabelt manager-tal — ingen hardcoded antal.

Estimat for S-02 totalt: ~10-12 sessioner over 4-6 uger.

## Tilføjet 2026-05-06 (rolled fra NOW.md ved v2.47-close-out)

- 2026-05-05: **Admin-fix v2.43** — 'Nulstil sæsoner' blokeret af FK fra `finance_transactions.season_id` (307 prod-rows). [betaResetService.js](backend/lib/betaResetService.js) nuller nu season_id på alle finance_transactions før `DELETE FROM seasons`. 1 ny regression-test, 294/294 grønne.
