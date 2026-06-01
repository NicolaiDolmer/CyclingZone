# Non-atomisk "write-then-derive" kan låse bruger-state (#878)

**Dato:** 2026-06-01
**Område:** `backend/routes/api.js` · `POST /board/dna-choose` → `backend/lib/boardMembers.js`
**Type:** Reliability-bug (fundet i sundhedsaudit, ikke prod-incident). Refs #820.

## Symptom
Manager kunne ende dna-sat-men-boardless: `team_dna_key` blev skrevet til teams-rækken
**før** board-members blev genereret. Fejlede genereringen midt i, returnerede den efterfølgende
409-guard ("allerede valgt") for evigt — manageren var låst ude af onboarding uden vej frem.

## Rod-årsag
To-trins state-mutation uden atomicitet: trin 1 (UPDATE team) committede, trin 2 (INSERT
board-members) kunne fejle, og en guard på trin-1-state antog at trin 2 altid lykkedes.

## Fix
`chooseDnaForTeam()` gør operationen:
- **Atomisk:** rul trin-1-skrivningen tilbage hvis trin 2 kaster.
- **Idempotent:** opdag den inkonsistente mellem-tilstand (DNA sat + board tomt) og genskab
  den manglende afledte state ved næste kald — i stedet for at afvise.

## Forward-guard (generaliserbart)
Når en guard afviser "allerede gjort" baseret på ÉT flag, men det "gjorte" består af flere
skrivninger: enten wrap alle skrivninger atomisk, ELLER gør operationen idempotent ved at
tjekke den afledte state (ikke kun flaget). Et enkelt "done"-flag der sættes før det afledte
arbejde er færdigt, er en lockout-fælde. Mistænk samme mønster ved andre
`UPDATE teams ...` + efterfølgende `INSERT/regenerate` i routes.
