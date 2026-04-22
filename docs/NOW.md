# NOW — Aktuel arbejdsstatus

## Investigate
- Achievements tæller ikke korrekt
- Notifikationer deduplikeres ikke; samme event sendes hvert minut i stedet for én gang
- Verificer auktions-sluttid/finaliseringslogik og AI-auktionsflows end-to-end
- Verificer transfer-window-regel for minimum squad-size samt cleanup af transferliste ved ejerskifte
- Verificer signup/profile-flow for `manager_name`, managernavn og holdnavn
- Verificer deployed season flow end-to-end på beta: `season start -> result approval -> season end`
- Verificer standings/rangliste efter første live result-godkendelse på deployed backend

## Drift / Ops
- AI docs er ryddet op: `RUNTIME_GUARDRAILS.md` + `AI_EXECUTION_STANDARD.md` er nu de eneste regeldocs
- `scripts/sync-docs.js` er opdateret til lean docs-strukturen og verificeret via bundled Node-runtime
- Backend har nu `npm test`, som dækker shared market guardrails og direkte `finalizeExpiredAuctions` smoke; shared runtime-refactors må ikke deployes uden entrypoint-test
- Backend season/race admin-contract er genskabt og deployed til Railway
- Live smoke test bestod for `POST /api/admin/seasons` og `POST /api/admin/races`; testdata blev ryddet op bagefter
- Finance-lån er skilt fra rider-lån på egne API-routes (`/api/finance/loans`) for at fjerne route-kollisionen på `POST /api/loans`
- Auktionsfinalisering er samlet i delt runtime-path for cron + admin/API; ikke-ejede ryttere betaler ikke længere provenu til initiatoren af auktionen
- Transfer- og swap-bekræftelse er samlet i delt runtime-path med commit-time checks for ejerskab, saldo og squad-limit samt cleanup af relaterede market rows
- Squad-limit tæller nu også aktive lejeaftaler i shared market state; lejeaftaler, auktionsfinalisering og dashboard-warning bruger samme holdstørrelses-sandhed
- Rider-loan gebyrer for fortsatte sæsoner opkræves nu automatisk ved sæsonstart og logges for både låner og udlejer
- Live smoke på production bestod for udløbet auktion via cron, transfer med endelig bekræftelse og swap med endelig bekræftelse; smoke-testdata blev ryddet op bagefter
- Dashboard og Hold-siden scope'er nu rangliste-data til aktiv sæson og falder tilbage til 0-point-rækker, så current-season vises stabilt før første live result-godkendelse
- Delvis live smoke bestod den 22. april 2026 for `GET /health` og auth-gaten på `GET /api/auctions`; fuld admin-verifikation af sæsonflow kræver stadig en rigtig admin-session

## In Progress
- Board System V1 fase 1 er genåbnet: proposal/sign/renew kører nu via delt `backend/lib/boardEngine.js`, og frontend genererer ikke længere sine egne board-mål
- Board System V1 fase 2 er delvist landet: season-end bruger nu vægtet, gradvis board-evaluering med derived personality, board feedback og 2-3 sæsoners hukommelse i `boardEngine`
- Dashboard og Board-siden læser nu board-outlook via `/api/board/status`, så read-pathen er mere kanonisk
- Race-result execution path er nu samlet mellem `POST /api/admin/import-results` og `POST /api/admin/approve-results`, så prize-writes og standings-recalculation ikke længere driver fra hinanden
- Næste board-fase er requests/tradeoffs samt dybere identity/specialization-logik oven på den nye execution path
