# NOW — Aktuel arbejdsstatus

## Investigate
- Achievements tæller ikke korrekt
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

## Do Not Touch
- Board system
