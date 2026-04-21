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
- Season start opretter standings
- Season end opdaterer alt

---

## 🎯 EDGE CASES

- Samtidige bids
- Transfer + loan overlap

---

## 🧪 CONTRACT / DRIFT TESTS

- Frontend endpoint findes og matcher backend route
- Runtime writes bruger gyldige DB-typer og constraints
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
