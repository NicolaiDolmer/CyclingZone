# NOW — Aktuel arbejdsstatus

## Aktiv slice
- **Economy tuning implementation prep**
- Mål: Brug baseline-simulationen til at vælge en minimal, testet tuningpakke. Admin/service-visible sæson 6 finance-verifikation er stadig en launch-gate før live tuning/deploy.

## Status 2026-04-29
- Auction first-bid bugfix er lukket lokalt:
  - Start af auktion på AI-, bank- eller fri rytter sætter nu initiatoren som `current_bidder_id`, så rytteren kan vindes uden efterfølgende overbud.
  - Første startpris valideres mod disponibel balance og squad-plads inkl. eksisterende auktionsføringer.
  - Auktionslisten, Min Aktivitet, Dashboard og auktionshistorik markerer kun manageren som sælger, når rytteren faktisk er managerens egen; AI/fri/bank-initiativer vises som førende bud i stedet.
  - Patch notes, Help, FEATURE_STATUS og PRODUCT_BACKLOG er afstemt. `npm test` i backend og `npm run build` i frontend passer.
- Auction implicit-bid safeguard er tilføjet efter live check:
  - Read-only live check fandt to Dolmer Racing-auktioner (`Luka Mezgec`, `Roman Ermakov`) som stadig var `active`, men havde `current_bidder_id=null` og ingen `auction_bids`.
  - `auctionFinalization` behandler nu ikke-ejede, ikke-garanterede auktioner uden `current_bidder_id` som initiatorens implicitte første bud, så eksisterende aktive auktioner stadig kan vindes af initiatoren ved finalisering.
  - UI-fallback viser samme implicitte føring på Auktioner, Min Aktivitet, Dashboard og historik. Patch notes v1.72 er tilføjet. Auction-tests og frontend build passer.
- Season-flow sanity er kørt som investigation + kontraktfix:
  - Deployed backend `/health` svarer 200, og admin preview/end endpoints svarer 401 uden token som forventet.
  - Live season-end write blev ikke kørt, fordi der ikke må laves admin/write-probe uden admin-session og explicit live action.
  - Read-only live sanity for sæson 6 bekræfter fortsat `races=98`, `completed races=18`, `race_results=709`, `season_standings=25`.
  - Local preview-runtime mod live read-only data gav `teams=24`, `salary=5.118.000`, `loan_interest=20.848` som gældsforøgelse, `teams_needing_emergency=3`, og `emergency_loan_amount=2.836.247`.
  - Contract audit fandt runtime/schema-drift for finance-/notification-typer; migration `database/2026-04-29-finance-notification-contract-types.sql` og schema/test er tilføjet.
  - Frontend build passer, og devserver er startet på `http://127.0.0.1:5173`; agent-browser CLI er ikke tilgængelig i denne shell, så browser-gut-check er ikke udført.
- Docs/context cleanup er gennemført som docs-only slice:
  - `docs/PRODUCT_BACKLOG.md` er slanket til launch roadmap + candidate queues.
  - Detaljeret nyere done proof er flyttet til `docs/archive/RECENT_DONE_PROOF_2026-04-29.md`.
  - Økonomituning er nu topprioriteret launch-spor, men sanity-verifikation kommer først.
- Live result-import er verificeret for sæson 6:
  - `races=98`
  - `race_results=709`
  - `season_standings=25`
  - `completed races=18`
  - prize finance rows `10` totaling `2922`
- Resultatimport kører via delt runtime:
  - xlsx import og approve deler `applyRaceResults`.
  - Google Sheets-resultatimport matcher løbsnavne robust og er idempotent for prize finance.
- Season-end preview quick fixes er lukket:
  - Preview bruger `buildSeasonEndPreviewRows`.
  - Lånerenter vises separat, men kontant `balance_after` følger runtime hvor renter lægges på lånets restgæld.
- `Slice UCI-R1`, `Slice UCI-R2`, `Slice R1`, `Slice UI-M1`, Discord/webhook transferhistorik, profilrouting, code-splitting og ranglisteindikator er lukkede. Done proof ligger i `docs/FEATURE_STATUS.md` og `docs/archive/`.
- Live season-end blev kørt for sæson 6 efter deploy:
  - `seasons.number=6` er nu `completed` med `end_date=2026-04-29`.
  - Division side-effect skete: `Ankuva CT` og `Liams geder` rykkede til Division 2.
  - Read-only postcheck fandt ingen synlige `finance_transactions` eller `board_plan_snapshots` for season 6, og team balances / finance-loan `amount_remaining` så uændrede ud.
  - Mest sandsynlige root cause: `processSeasonEnd` fetcher teams med embedded `riders(...)`; live DB har flere `teams`↔`riders` relationships, så PostgREST kan returnere PGRST201. Runtime checker ikke `teamsRes.error`, så finance/board loop kan blive skipped, mens divisioner og season completion stadig sker.
  - Økonomituning er blokeret indtil season-end finance/board side effects er fixed og sæson 6 er repareret.
- Repo-fix for season-end repair er implementeret 2026-04-29:
  - `processSeasonEnd` loader nu teams, riders og board_profiles separat og checker load/write errors før sæsonen markeres completed.
  - Finance/board køres før divisionsopdateringer, så en live relationship/load-fejl ikke kan flytte divisioner og derefter skippe finance.
  - Admin repair endpoint `POST /api/admin/seasons/:id/repair-finance-board` kører finance/board only og kan resume missing side effects uden `force`, så eksisterende salary/snapshots ikke duplikeres.
  - Backend regressionstests dækker live-like rider-load failure, finance/board side effects, repair uden season/division writes og resume uden duplikering.
- Deploy/live status 2026-04-29:
  - Live DB migration `database/2026-04-29-finance-notification-contract-types.sql` er applied af bruger.
  - Backend-fix er committet og pushed til `main`:
    - `e643436` `Fix season-end finance board repair`
    - `51af288` `Allow season-end repair resume`
  - Railway/live API svarede `401` uden token på repair-endpointet efter deploy, dvs. endpointet findes live og kræver admin auth.
  - Bruger kørte live repair med admin auth mod season id `cc4410b4-9d19-4996-adbf-369e5b9e2df8`.
  - Repair-resultat: `success: true`, `teamsProcessed: 24`, `existingSalaryTransactions: 5`, `existingBoardSnapshots: 72`, `existingBoardSnapshotBoards: 72`.
  - Read-only postcheck bagefter kan stadig ikke se `finance_transactions` for season 6 (`0` synlige rows), men kan se `board_plan_snapshots=72`, `boardTeams=24`, og `Ankuva CT`/`Liams geder` står fortsat i Division 2. Finance-rækker skal derfor verificeres via admin/service-visible path, ikke read-only RLS.
- Economy baseline & simulation er gennemført 2026-04-29 som read-only investigation:
  - Ny gentagelig kommando: `node backend/scripts/economyBaselineSimulation.js --markdown` eller `cd backend; npm run economy:baseline -- --markdown`.
  - Rapport: `docs/archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md`.
  - Live baseline bruger sæson 7 teams/lån og sæson 6 resultater. De viste “prize” tal skal behandles som eksisterende result-/pointdata eller placeholder-finance, ikke som et færdigt præmiepenge-design.
  - Current rules: aktive squads med 9-10 ryttere og tung lønprofil ender i automatisk nødlånsrisiko; tomme/næsten tomme hold skjuler problemet i divisionsgennemsnittet.
  - Rigtige præmiepenge er ikke færdigdesignet/implementeret som økonomimodel endnu og skal laves før større økonomituning.
  - Kandidatretning før implementering er kun et lokalt scenarie, ikke en beslutning: effektiv salary rate ca. `15% -> 10%`, division-aware sponsor ca. D1 `600k`, D2 `400k`, D3 `260k`, og højere manuelle gældslofter ca. D1 `1.2M`, D2 `900k`, D3 `600k`.

## Næste konkrete handling
1. Add/run admin/service-visible verification for season 6 repair:
   - count season 6 salary rows and teams covered;
   - count/amount season 6 `loan_interest`, `interest`, `emergency_loan`;
   - verify active finance-loans had season-end interest applied where relevant;
   - verify human team balances changed consistently with salary/emergency-loan logic;
   - verify `board_plan_snapshots=72` for season 6 and no duplicate snapshots per board;
   - verify `Ankuva CT` and `Liams geder` remain Division 2 with no extra division movement.
2. Do **not** rerun full season-end and do **not** rerun repair blindly. If verification finds missing finance side effects, repair must be targeted/idempotent.
3. Design/implement real prize-money economy before larger economy tuning:
   - distinguish result points from CZ$ prize payouts;
   - decide payout scale by race class/result type;
   - verify finance transaction type/contracts and UI copy;
   - then rerun baseline with real prize income.
4. Economy tuning implementation can be prepared locally from baseline, but concrete live/deploy change should wait for both the verification gate and prize-money feature above.
5. Re-audit `/profile` remains a separate launch-critical item.

## Næste launch-spor
- **Prize-money economy** før større økonomituning: pointsystemet findes, men CZ$-præmiepenge skal designes/implementeres og indgå i baseline.
- **Economy tuning implementation** derefter, baseret på ny baseline med rigtige præmiepenge, centraliserede konstanter/config og tests for season start/end, loans, prize finance og salary recalculation.
- Target: **stram men fair** økonomi, hvor aktive kompetente managers kan overleve uden automatisk gældsspiral.

## Kommandoer
PowerShell skal stå i repo-root:

```powershell
cd "C:\Users\ndmh3\OneDrive\Skrivebord\cycling-manager"
$env:PYTHONIOENCODING='utf-8'
python scripts\uci_scraper.py --dry-run
```

Live Supabase-inspektion må kun ske read-only og uden at ekko credentials. `.codex.local/supabase-readonly.env` findes lokalt, men de tidligere `npm run db:ai:*` scripts findes ikke i root `package.json`; brug målrettede read-only probes eller tilføj scripts i en separat tooling-slice.

## Vigtige invarianter
- Runtime > current docs > spec docs > backlog.
- Workflow-success alene er ikke bevis på datakvalitet.
- `--dry-run` må aldrig skrive Sheets eller Supabase.
- UCI-sync må ikke nulstille eller ignorere eksisterende `prize_earnings_bonus`.
- Salary update kører efter godkendt UCI-sync i GitHub Actions workflowet og bruger eksisterende `updateRiderValues`-regel.
- Finance transaction types og notification types skal verificeres mod DB constraints før nye writes eller økonomituning.
- En afsluttet slice må ikke blive stående som aktiv/næste handling; tjek runtime/test/patch notes før samme opgave startes igen.
