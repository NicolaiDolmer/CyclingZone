# Relaunch-apply crashede midtvejs på uhåndteret FK i beta-reset (18/6)

## Symptom
Prod-relaunch (`relaunchSeason1.js --apply --target-prod`) kørte dry-run-preview fint,
men selve apply crashede i `resetBetaLoans`:
```
update or delete on table "loans" violates foreign key constraint
"finance_transactions_related_loan_id_fkey"
```
Prod stod halv-anvendt: legacy retiret + afkoblet (`team_id=null`) + marked/transfer-historik
slettet, men loans/balancer/sæsoner intakt og ingen frisk population/sæson.

## Rod-årsag
`finance_transactions.related_loan_id` er en NO ACTION FK til `loans`. `resetBetaLoans`
slettede loans uden først at nulle de pegende finance_transactions. P4-rehearsalen fangede
IKKE dette, fordi preview-branch-dataene ikke havde loans med finance_transactions der pegede
på dem — rehearsal-dataene spejlede ikke prods faktiske FK-relationer.

## Hvad vi gjorde (recovery)
Ejeren stillede det rigtige spørgsmål: "hvorfor gendanne til noget jeg alligevel sletter?"
Destruktionen var jo ønsket. Så i stedet for restore → **fix forlæns**:
1. Forensisk backup af den ødelagte tilstand (ud over den friske pre-apply-backup).
2. **Statisk FK-audit** mod prod-skemaet: alle FK'er med ON DELETE NO ACTION/RESTRICT der peger
   på tabeller reset sletter. Fandt 3 YDERLIGERE latente crashes ud over loans:
   - `races` <- `finance_transactions.race_id`
   - `seasons` <- `board_profiles.season_start_anchor_season_id` (kun `season_id` blev nullet)
   - `seasons` <- `academy_graduation.season_id` (0 rækker nu, men latent)
3. Fixede alle fire (null/slet child før parent-delete), re-kørte apply forlæns → fuldførte
   wipe (idempotente deletes) + byggede frisk sæson 1. Verificeret: 22 hold × 8 ryttere,
   sæson 1 active, 22 founder-badges, 86 akademi-kandidater, 0 legacy aktive.

## Læring
- **Destruktive reset-stier skal FK-auditeres statisk mod prod-skemaet, ikke kun rehearses.**
  En rehearsal er kun så god som dens data spejler prods FK-relationer. Tre FK-bugs (denne +
  to fra #1463) i samme reset = mønster: tilføj en gate der lister alle NO ACTION/RESTRICT-FK'er
  på reset-targets og asserter at hver er håndteret.
- **Idempotente deletes gør forlæns-recovery sikkert** når destruktionen er ønsket — restore er
  ikke altid svaret. Men kun fordi der var en verificeret backup som net.
- **Dry-run fanger ikke FK-fejl** (den skriver ikke), så preview-grøn ≠ apply-sikker.

## Opfølgning
- ✅ **Forward-guard unit-test (leveret):** `betaResetService.test.js` har nu en FK-håndhævende
  mock (NO ACTION blokerer parent-delete præcis som Postgres). Tre tests dækker resetBetaLoans/
  resetBetaRaceCalendar/resetBetaSeasons; verificeret ved at reverte hvert fix → hver test fejler
  med den nøjagtige FK-violation fra 18/6 (`finance_transactions_related_loan_id_fkey` m.fl.).
- ✅ **CI FK-audit (leveret):** RPC `audit_foreign_keys()` (`database/2026-06-18-audit-foreign-keys-helper.sql`)
  + `backend/scripts/audit-reset-fk-coverage.js` + workflow `reset-fk-audit.yml` kører FK-audit-queryen
  mod det LIVE prod-skema og fejler ved ny NO ACTION/RESTRICT-FK mod en reset-target der ikke er i
  `BLOCKING_FK_BASELINE` (betaResetService.js). Pure classifier i `lib/resetFkAudit.js` unit-testet.
  Knyttet til forward-guard-sporet #1464. **Bevis for prod>statisk:** statisk parsing ville fejlagtigt
  flage `board_profiles.tradeoff_active_until_season_id` (NO ACTION i dumps, SET NULL i prod) — live-
  auditen adjudicerer mod prod-skemaet, præcis postmortem-læringen.
- Straggler-oprydning: ~32 præ-eksisterende fiktive ryttere (test-data) overlevede; vurdér sletning.

Refs #1103 #1105 #1471
