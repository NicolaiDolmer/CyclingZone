# TEST SCENARIOS — Cycling Zone

---

## 🔁 CORE FLOWS

### Auction
- Winner betaler korrekt
- Sælger modtager korrekt beløb
- Fri/AI-rytter giver ikke provenu til auktions-initiatoren
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
- Repayment virker

### Season Flow
- Live smoke: `POST /api/admin/seasons` virker på deployed backend
- Live smoke: `POST /api/admin/races` virker på deployed backend
- Smoke-testdata ryddes op bagefter
- Season start opretter standings
- Season end opdaterer alt

---

## 🎯 EDGE CASES

- Samtidige bids
- Transfer + loan overlap

---

## 🧪 CONTRACT / DRIFT TESTS

- Frontend endpoint findes og matcher backend route
- `POST /api/admin/seasons`, `POST /api/admin/races`, `POST /api/admin/seasons/:id/start` og `POST /api/admin/seasons/:id/end` findes live og auth-gater korrekt
- Runtime writes bruger gyldige DB-typer og constraints
- Result-godkendelse skriver `team_id` på `race_results`, så standings kan recalculeres fra persisted data
- Cron-finalisering og manuel auktionsfinalisering giver samme resultat
- `finalizeExpiredAuctions()` kan køre som no-op uden udløbne auktioner; manglende helper-imports eller andre bootstrap-referencefejl skal fanges før deploy
- AI-auktionssalg betaler korrekt ejer
- Rider loans og finance loans kan ikke forveksles
- Dashboard-rangering bygger på korrekt scope
- Board-felter matcher backend-navne

---

## ⚠️ INVARIANT TESTS

- Én rytter ender kun i én sammenhængende owner-state
- Ingen betaling går til forkert team
- Squad limit holder efter alle markedsflows
- Transfer window håndhæves både ved create og accept/confirm
- Finance transactions logges med gyldig type
- Notification writes bruger gyldig type

---

## 🧪 RULE

Alle bugfixes skal testes her eller have en begrundet test-note

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
