# Dashboard ny-bruger-UX-pakke — spec (#2288)

Ejer-godkendt 10/7. Branch: `feat/2288-dashboard-ux-pakke`. Alle player-facing tekster EN først, DA sekundært. Ingen em-dashes i copy.

## A. Onboarding-trin skal være ægte handlinger
Problem: 3 af 4 trin i `/api/me/onboarding-progress` (backend/routes/api.js:5252-5279) er completed fra start (team auto-navngives, start-trup gives, board-plan muligvis auto-seedet). Kun `first_bid_placed` er ægte.

Løsning: erstat trinnene med 4 handlinger spilleren faktisk selv udfører:
1. `first_bid_placed` — behold (bud i auktion).
2. `first_training_run` — mindst 1 række i `training_day_runs` for team_id.
3. `first_squad_selected` — spilleren har lavet mindst én holdudtagelse (find selection-tabellen som RaceSelectionPanel skriver til; verificér kolonner mod ægte DB-skema før du skriver queryen).
4. `board_plan_set` — VERIFICÉR først om board-plan auto-seedes ved team-oprettelse. Hvis ja: erstat med et andet ægte trin (fx besøg/ændring — vælg noget verificerbart i data; alternativt "profile completed"/discord er IKKE ønsket). Hvis baseline-planen kan skelnes fra en spiller-sat plan (fx created_by/opdateret), brug det. Hvis intet brugbart: drop trinnet og kør 3 trin.

Frontend: OnboardingProgressCard opdateres med nye trin-labels + links (`/auctions`, `/training` el. hvor træning bor, `/races`, `/board`). i18n en+da.

## B. Banner-prioritering
I DashboardPage: indtil onboarding er fuldført (completed_count < total_count), undertryk SurveyBanner og Discord-nudge. Onboarding-kortet flyttes til toppen af stakken (over NextActionsCard). Max 1 nudge-banner ad gangen også efter onboarding (survey vinder over discord, eller omvendt — vælg og kommentér).

## C. Empty-state CTA'er
Alle tomme dashboard-kort får en fremadpegende CTA-link i stedet for kun passiv tekst:
- auctions → link /auctions, "Browse the auction market"
- transfers → link /transfers, kort forklarende tekst
- races → link /races (kalender)
- standings → link /standings
- recentResults / riderRanking → kort "results appear after the first races" + link
Nøgler: `cards.*.empty` i frontend/public/locales/{en,da}/dashboard.json — tilføj `cards.*.emptyCta`-nøgler frem for at overskrive semantik. Diskret styling der matcher eksisterende kort (ingen AI-slop, ingen emojis/gradients).

## D. "Næste træk" udvides
NextActionsCard får nye items (prioriteret øverst = mest presserende):
1. **Holdudtagelse mangler**: brug `pickNextSelectableRace` + en check på om der allerede ER lavet udtagelse til det løb (samme kilde som RaceSelectionPanel). Link direkte til udtagelsen (se F).
2. **Ikke trænet i dag**: nyt letvægts-signal. Tilføj felt i et eksisterende dashboard-egnet endpoint ELLER nyt `GET /api/training/today-status` der kun querier `training_day_runs` på (team_id, tick_date=Copenhagen-dato). Respektér `daily_training_enabled`-flaget (skjul item når flag off). Link til træningsfladen.
3. **Board-plan mangler**: `!activePlan` fra allerede-hentet `/api/board/status` — intet nyt fetch.
i18n en+da for alle nye item-tekster.

## E. Saldo-affordance
Header-saldoblokken (linker allerede til /finance): tilføj synlig klikbar affordance (hover-state + lille chevron/pil), stilrent og konsistent med resten.

## F. Holdudtagelses-knap skal lande PÅ udtagelsen
TeamSelectionCtaCard linker til `/races/:id`, men brugeren lander øverst på race-siden og ser ikke udtagelsespanelet. Fix: link til `/races/:id#selection` (eller query-param) og få RaceDetailPage til at scrolle til / åbne RaceSelectionPanel når anchor/param er sat. Undersøg RaceDetailPage-strukturen (tabs?) og vælg den robuste løsning. Verificér i browser.

## G. Seneste resultater: kun egen division+gruppe
`/api/dashboard/recent-results` (backend/routes/api.js:7090-7157): tilføj filter `races.league_division_id = team.league_division_id` (mønster som nextRaces-query i DashboardPage.jsx:179-183). Sørg for at endpointet kender teamets league_division_id (hent fra req/teams). Empty-state-teksten skal stadig give mening.

## H. (Afkræftet) PageLoader ved refetch
Verificeret: loadAll sætter aldrig loading=true igen — refetch er allerede stille. INGEN ændring.

## Close-out-krav
- Patch note i PatchNotesPage.jsx (ny version, følg eksisterende mønster + CI-versionscheck) — EN+DA.
- help.json (en+da): opdatér onboarding-relateret hjælp hvis trinnene beskrives der.
- Tests: opdatér/tilføj node --test for onboarding-progress-logik og recent-results-filter (backend), og frontend-tests hvor mønstret findes.
- Preflight før push: `pwsh -File scripts/verify-local.ps1` + `npm run lint` i frontend + `npx playwright test core-smoke.spec.js` (alle 3 projekter).
