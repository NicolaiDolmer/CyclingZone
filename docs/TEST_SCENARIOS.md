# TEST SCENARIOS — Cycling Zone

---

## 🔁 CORE FLOWS

### Auction
- Winner betaler korrekt
- Sælger modtager korrekt beløb

### Transfers
- Blocked når window lukket
- Accept korrekt

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
