# TEST SCENARIOS — Cycling Zone

---

## 🔁 CORE FLOWS

### Auction
- Winner betaler korrekt
- Sælger modtager korrekt beløb
- Fri/AI-rytter giver ikke provenu til auktions-initiatoren
- Auktion annulleres sikkert hvis rytteren ved afslutning ejes af en anden menneskelig manager end initiatoren
- Guaranteed sale på ejet rytter sender rytteren til banken og krediterer korrekt pris ved ingen bud
- Guaranteed sale på ikke-ejet rytter må ikke skabe payout eller falsk salgs-historik
- Lukket transfervindue giver `pending_team_id` i stedet for direkte holdskifte
- Fuldt vinderhold annullerer overdragelsen uden forkert payout

### Transfers
- Blocked når window lukket
- Accept korrekt
- Begge parter skal bekræfte før transfer eller byttehandel lukkes
- Endelig bekræftelse annullerer handlen hvis sælger ikke længere ejer rytteren
- Endelig bekræftelse annullerer handlen hvis køber mangler saldo eller rammer squad limit
- Gennemført transfer rydder relaterede listings, transferbud og bytteforslag op for rytteren

### Loans
- Loan oprettes korrekt
- Loan oprettes ikke hvis låneren allerede rammer squad limit via egne ryttere, pending handler eller aktive indlån
- Loan kan ikke aktiveres hvis lånerens squad-limit er fyldt siden forslaget blev sendt
- Loan fee for fortsatte rider-lån trækkes ved hver dækket sæsonstart efter første aktivering
- Repayment virker

### Season Flow
- Live smoke: `POST /api/admin/seasons` virker på deployed backend
- Live smoke: `POST /api/admin/races` virker på deployed backend
- Smoke-testdata ryddes op bagefter
- Season start opretter standings
- Season end opdaterer alt
- Season end bruger den delte board-engine og opdaterer `satisfaction` + `budget_modifier` konsistent
- `POST /api/admin/import-results` recalculerer standings og prize-transaktioner via samme shared runtime-path som `POST /api/admin/approve-results`

### Board
- `POST /api/board/request` kan justere den aktive plan via delt board-engine og skriver outcome til `board_request_log`
- En anden `POST /api/board/request` i samme sæson afvises uden at skabe endnu en board-request-log
- Board request kan opdatere `current_goals` og evt. `focus`, men må ikke bryde det eksisterende `/api/board/status`-read path

---

## 🎯 EDGE CASES

- Samtidige bids
- Transfer + loan overlap

---

## 🧪 CONTRACT / DRIFT TESTS

- Frontend endpoint findes og matcher backend route
- `POST /api/admin/seasons`, `POST /api/admin/races`, `POST /api/admin/seasons/:id/start` og `POST /api/admin/seasons/:id/end` findes live og auth-gater korrekt
- `backend/server.js` må ikke konkurrere med `backend/routes/api.js` om `POST /api/admin/import-results`, `POST /api/admin/seasons/:id/start` eller `POST /api/admin/seasons/:id/end`; kun én execution path må eje hvert route-path
- Signup og Min Profil bruger den kanoniske backend-route `PUT /api/teams/my` til holdnavn/managernavn i stedet for direkte browser-writes til `teams`
- `PUT /api/teams/my` kan både opdatere eksisterende hold og bootstrappe manglende `teams`- og `board_profiles`-rækker for managerens egen konto
- Runtime writes bruger gyldige DB-typer og constraints
- Result-godkendelse skriver `team_id` på `race_results`, så standings kan recalculeres fra persisted data
- Cron-finalisering og manuel auktionsfinalisering giver samme resultat
- `finalizeExpiredAuctions()` kan køre som no-op uden udløbne auktioner; manglende helper-imports eller andre bootstrap-referencefejl skal fanges før deploy
- AI-auktionssalg betaler korrekt ejer
- `POST /api/achievements/check` kan låse op for de contexts frontend faktisk sender (`watchlist_add`, `auction_bid`, `transfer_done`)
- Rider loans og finance loans kan ikke forveksles
- Dashboard-rangering bygger på korrekt scope
- Dashboard og Hold-siden viser aktive hold med 0 point, hvis `season_standings` endnu ikke er initialiseret for den aktive sæson
- Board-felter matcher backend-navne
- Dashboard og Board-siden læser board-state via `GET /api/board/status`
- `GET /api/board/status` returnerer board-outlook/personality fra den delte board-engine
- `GET /api/board/status` returnerer også `request_status` og `request_options`, så Board-siden ikke bygger request-state lokalt
- `approve-results` og `import-results` bruger samme finance-type (`prize`) og samme standings-recalculation
- Shared notification-writer deduplikerer nylige identiske payloads, så samme event ikke indsættes igen ved cron/retries

---

## ⚠️ INVARIANT TESTS

- Én rytter ender kun i én sammenhængende owner-state
- Ingen betaling går til forkert team
- Squad limit holder efter alle markedsflows
- Transfer window håndhæves både ved create og accept/confirm
- Finance transactions logges med gyldig type
- Notification writes bruger gyldig type
- Notification dedupe må ikke skjule forskellige events med forskellig tekst eller `related_id`

---

## 🧪 RULE

Alle bugfixes skal testes her eller have en begrundet test-note
- Brug `pwsh -File scripts/verify-local.ps1` som standard lokal preflight, og forvent gron GitHub Actions for backend-tests + frontend-build før deploy

---

## Operative Smoke Playbooks

### Auktion: payout og ejerskab
- Opret én auktion på egen rytter og én auktion på fri/AI-rytter
- Gennemfør begge med vindende bud
- Bekræft: buyer debiteres i begge cases
- Bekræft: kun den faktisk ejede rytter giver `transfer_in` til sælger og tæller som salg
- Bekræft: cron-finalisering og manuel/admin-finalisering giver samme slutstate

### Auktion: no-bid og guaranteed sale
- Opret guaranteed sale på en rytter du ejer
- Lad auktionen udløbe uden bud
- Bekræft: banken overtager rytteren og sælger får `guaranteed_price`
- Opret derefter guaranteed sale på fri/AI-rytter
- Lad den udløbe uden bud
- Bekræft: ingen payout, ingen falsk salgs-historik, ingen forkert owner-state

### Deploy smoke
- Push til `origin/main`
- Bekræft seneste Vercel production deployment = `READY` og matcher commit SHA
- Kald backend `GET /health`
- Kald backend `GET /api/auctions` uden token og forvent `401`
- Kør ét lille sanity-check på det berørte flow mod live miljø

### Manager signup/profile smoke
- Opret en managerkonto med holdnavn og managernavn
- Bekræft at signup opretter holdet via backend og at Min Profil viser de gemte værdier efter reload
- Ret holdnavn og managernavn på Min Profil
- Bekræft at ændringerne persisterer efter reload og ikke bliver stoppet af RLS på `teams`
- For en halv-oprettet managerkonto: gem holdinfo fra Min Profil og bekræft at hold og board-profile bliver bootstrap'et igen
