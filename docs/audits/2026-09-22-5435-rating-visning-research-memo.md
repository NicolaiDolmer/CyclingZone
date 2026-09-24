# Research-memo: #5435 rating = bedste rolle nu + badge "Naturlig rolle" (read-only kortlægning 22/9)

Formål: kort til den worker der bygger #5435 (model A, ingen loft-tal, bag app_config-kontakt). Ingen designvalg. Kilde: main 22/9.

## 1. `frontend/src/lib/riderRating.js`

- `riderTypeRating(rider, typeKey)` (51-53): rating for vilkårlig rolle via `ratingForRole`. Bruges af Udvikling-fanen og radarens 8 akser.
- `riderOverallRating(rider)` (57-59): `ratingForRole(rider, rider.primary_type)`. **Det er funktionen der skal skifte til bedste rolle nu.** Kommentaren 37-41 kræver at SIGNATUREN bevares, så de ~20 kaldsteder flytter sig i samme commit (samme greb som #3666).
- `ratingForRole` ligger i `frontend/src/lib/generated/displayRecipes.js` (GENERERET af `scripts/generate-ability-registry.mjs`, rør ikke): vægtet snit af rollens evner, afrundet, klampet [0,99]. Ingen evner på rækken → `null` (aldrig 0; #5321).

Kaldsteder af `riderOverallRating`:
- Rytterprofil: `pages/RiderStatsPage.jsx:1799` → prop `overallRating` (1922) → `components/rider/profile/RiderProfileHero.jsx:270-281` (rating-stat, `statPlateStyle`).
- Mit hold: `pages/TeamPage.jsx:638` (`_ovr`; vagtet af `TeamPage.squadTable.test.js:40` regex på kald-linjen), `components/TeamDevelopmentTab.jsx:58`.
- Rytterdatabase/marked: `pages/RidersPage.jsx:511`, `lib/riderColumnSort.js:160` (klient-sortering på rating).
- Auktioner: `pages/AuctionsPage.jsx:231, 572, 1550`.
- Watchlist: `pages/WatchlistPage.jsx:224, 304`.
- Træning: `pages/TrainingPage.jsx:2558`.
- Kommentarer: `lib/riderRatingTrajectory.js:13`, `lib/statColor.js:26`, `lib/useRiderFilters.js:277`.
- Tests der definerer kontrakten og SKAL opdateres: `lib/riderRating.test.js` (6, 20, 33, 62-65, 83: "rating = egen rolle, null uden primary_type"), `preview/seedData.consistency.test.js:26, 38, 58` (bygger på rating = primærtypens rating). Uberørt: `components/planner/plannerRating.guard.test.js:52`, `lib/riderRatingSort.test.js`.

## 2. Backend: `riders.best_role` / `best_role_rating` (PR #5487)

- Migration `database/2026-09-22-5443-best-role-data.sql` (constraint `riders_best_role_valid`). Beregning `backend/lib/riderValueRefresh.js:26-35` (max over 8 roller), diff 103-104, select 207-208. Ejer-regel 17/9 verificeret i `backend/lib/riderBestRole.test.js:81-116` (best_role_rating ≥ primærtypens rating).
- **Ikke eksponeret** i `backend/routes/api.js`: `GET /riders` (1250-1259, eksplicit kolonneliste: Rytterdatabase + team_id-hentning) og `GET /auctions` (6663-6681, nested rider-select 6671-6672). **Eksponeret** i `GET /riders/:id` (1289-1292, `select('*')`; kun `potentiale`/`archetype_draw` maskeres for ikke-admins). Watchlist/TeamStats: tjek hvilken af de tre routes de bruger.

## 3. app_config-kontakt i frontend (mønster)

Frontend læser aldrig `app_config` direkte. Backend-modul `backend/lib/<navn>Flag.js` (fx `autoCalendarFlag.js:1-19`, `seasonSignupFlag.js`) → `readFlagStage` + `evaluateFlagStage` (`backend/lib/featureStage.js:11-31`, `off|beta|on`, fail-safe false) → route lægger boolean i JSON (eksempel `season_signup_enabled`, `api.js:265`, ~13192) → komponent modtager prop (`components/SeasonSignupCard.jsx:3-4`). Ny nøgle = migration der INSERTer i `app_config` (eksempler `database/2026-09-14-2760-winback-app-config.sql`, `2026-08-19-3550-academy-intake-pull.sql`), default off. `docs/FEATURE_REGISTRY.yml` opdateres i samme PR (hard rule 30e); `scripts/check-feature-registry-flags.mjs` validerer nøglen mod app_config (nøgle der ikke findes i prod fejler CI: sæt `flag` først når migrationen er applied).

## 4. `RiderTypeBadge.jsx` + i18n

`components/rider/RiderTypeBadge.jsx:18` props `{ primaryType, secondaryType, size, stacked, className }`; `null` uden primaryType (20). Ingen "Natural/Naturlig"-label eller best-role-prop endnu. i18n `riderTypes.json` (en/da): `filter.label/all`, `badge.ariaLabel(Single)`, `types.<8 roller>`, `short.<8 roller>`. Nøgler `natural`/`bestRoleNow` findes ikke.

## 5. E2E og skærmbilleder

- Specs: `tests/e2e/riders-database-rating-sort.spec.js` (deterministisk sprinter med ens sprint-evner → rating = tallet; mock på `**/rest/v1/riders*`), `5292-riders-scout-filters.spec.ts`, `3761-3815-training-rider-info.spec.js`, `4036-rider-interest-self.spec.js`, `5089-rider-card-request-count.spec.js`, `rider-extend-cap-after-success.spec.js`, `rider-profile-auction-ux.spec.js`, `team-profile-tab-state.spec.js`. Snapshots `core-smoke.spec.js-snapshots/riders-*.png`, `team-*.png` (3 projekter).
- Skærmbilleder: `.shots.mjs`-mønster (`tests/e2e/4628-team-pages.shots.mjs:1-50`): `node tests/e2e/<N>-<navn>.shots.mjs <baseURL> <before|after>`, viewports desktop 1280×900 + mobil 375×812 (brug 1440/390 for PR), `addInitScript` sætter EN + lyst tema + samtykke + animationer fra, output `docs/screenshots/feat-<issue>-<navn>-kit/`. Port pr. worktree: `frontend/playwright.ports.js` (main 4173, worktrees 4300-4999, `$env:PW_PORT`); `/__worktree-id`-tjek i globalSetup (`docs/WORKTREE_WORKFLOW.md:121-133`).

## 6. `ratingGolden.5321.json`: rør ikke

`frontend/src/lib/__fixtures__/ratingGolden.5321.json`, frosset 17/9 (#5321), bruges kun af `lib/ratingNullIsNotZero.5321.test.js` (golden 109-130: `ratingForRole` pr. rolle uændret; paritet 141-155 mod backend). #5435 ændrer rolle-VALGET i `riderOverallRating`, ikke `ratingForRole`/opskrifterne, så golden-testene skal forblive grønne. Bliver de røde, har implementeringen rørt selve rolle-beregningen: stop, fix ikke fixturen.
