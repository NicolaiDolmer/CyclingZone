# NOW — Aktuel arbejdsstatus

## Investigate
- Prioriteret bug-triage pr. 22. april 2026:
- P3: Evne-filter/slider kræver frisk reproduktion mod rigtige data; statisk kodegennemgang fandt ingen entydig root cause endnu, så den bør ikke stå over auktions-/season-drift før reproduktion
- Verificer deployed season flow end-to-end på beta: `season start -> result approval -> season end`
- Verificer standings/rangliste efter første live result-godkendelse på deployed backend

## Drift / Ops
- AI docs er ryddet op: `RUNTIME_GUARDRAILS.md` + `AI_EXECUTION_STANDARD.md` er nu de eneste regeldocs
- Repo-entry kræver nu git-worktree preflight, sa kopi-mapper uden `.git` stoppes tidligt
- `scripts/sync-docs.js` er opdateret til lean docs-strukturen og verificeret via bundled Node-runtime
- `scripts/verify-local.ps1` er nu den kanoniske lokale sundhedskontrol: verifierer git-root, korer backend-tests via `node --test` og bygger frontend hvis lokale dependencies findes
- GitHub Actions korer nu backend `npm test` og frontend `npm run build` pa push til `main` og pull requests
- Backend har nu `npm test`, som dækker shared market guardrails og direkte `finalizeExpiredAuctions` smoke; shared runtime-refactors må ikke deployes uden entrypoint-test
- Backend-notifikationer går nu gennem delt `backend/lib/notificationService.js`, som deduplikerer nylige identiske payloads og stopper cron/retry-spam af samme event
- Repo-schemaet og setup-filerne tillader nu `auctions.seller_team_id = null`, så shared auktionsfinalisering ikke driver fra databasen på AI/free/non-owned flows; deploy af denne fix kræver også at SQL-patchen i `database/2026-04-22-auctions-seller-team-id-nullable.sql` køres mod live DB
- Backend season/race admin-contract er genskabt og deployed til Railway
- Admin season/import-routes er nu konsolideret til `backend/routes/api.js`; `POST /api/admin/import-results`, `POST /api/admin/seasons/:id/start` og `POST /api/admin/seasons/:id/end` har ikke længere parallelle server-paths
- Direkte admin-import af løbsresultater bruger nu samme shared `applyRaceResults`-path som `POST /api/admin/approve-results`, inklusive standings-initialisering, standings-recalculation og entrypoint-regressionstest
- Live smoke test bestod for `POST /api/admin/seasons` og `POST /api/admin/races`; testdata blev ryddet op bagefter
- Finance-lån er skilt fra rider-lån på egne API-routes (`/api/finance/loans`) for at fjerne route-kollisionen på `POST /api/loans`
- Auktionsfinalisering er samlet i delt runtime-path for cron + admin/API; AI-/non-user-ejede auktioner krediterer nu den faktiske ejer ved afslutning, mens stale auktioner annulleres hvis rytteren nu ejes af en anden menneskelig manager
- Transfer- og swap-bekræftelse er samlet i delt runtime-path med commit-time checks for ejerskab, saldo og squad-limit samt cleanup af relaterede market rows
- Squad-limit tæller nu også aktive lejeaftaler i shared market state; lejeaftaler, auktionsfinalisering og dashboard-warning bruger samme holdstørrelses-sandhed
- Rider-loan gebyrer for fortsatte sæsoner opkræves nu automatisk ved sæsonstart og logges for både låner og udlejer
- Live smoke på production bestod for udløbet auktion via cron, transfer med endelig bekræftelse og swap med endelig bekræftelse; smoke-testdata blev ryddet op bagefter
- Dashboard og Hold-siden scope'er nu rangliste-data til aktiv sæson og falder tilbage til 0-point-rækker, så current-season vises stabilt før første live result-godkendelse
- Achievement-sync bruger nu live historikstabeller (`auction_bids`, `transfer_offers`, `rider_watchlist`, `riders`, `auctions`, `board_profiles`) i stedet for stale `condition_type`-felter, så almindelige unlocks kan blive fanget op ved næste app-load
- Delvis live smoke bestod den 22. april 2026 for `GET /health` og auth-gaten på `GET /api/auctions`; fuld admin-verifikation af sæsonflow kræver stadig en rigtig admin-session
- Signup og Min Profil bruger nu samme backend-route (`PUT /api/teams/my`) til holdnavn/managernavn, så writes ikke længere bliver stoppet af RLS på `teams`
- Hold-bootstrap via `PUT /api/teams/my` kan nu også genskabe manglende `teams`- og `board_profiles`-rækker for halv-oprettede managerkonti
- Auth-flowet har nu et rigtigt "Glemt password?"-entrypoint på login-siden og en dedikeret `/reset-password`-route til Supabase recovery-links
- Dropdown-fix for native selects var allerede til stede i runtimeen og er derfor fjernet som stale bug fra context

## In Progress
- Board System V1 fase 1 er genåbnet: proposal/sign/renew kører nu via delt `backend/lib/boardEngine.js`, og frontend genererer ikke længere sine egne board-mål
- Board System V1 fase 2 er delvist landet: season-end bruger nu vægtet, gradvis board-evaluering med derived personality, board feedback og 2-3 sæsoners hukommelse i `boardEngine`
- Dashboard og Board-siden læser nu board-outlook via `/api/board/status`, så read-pathen er mere kanonisk
- Board System V1 fase 3 er landet i beta: Board-siden kan nu sende én board request pr. aktiv sæson, og backend logger outcome/tradeoff i `board_request_log`
- Næste board-fase er dybere identity/specialization-logik og rigere request-tuning oven på den nye execution path
