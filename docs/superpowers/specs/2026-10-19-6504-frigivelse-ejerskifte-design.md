# #6504 — Frigivelse uden ejerskifte-spor og falsk "skal afstemmes"-alarm: teknisk design

Status: design (19/10, Claude). Rører DB + samtidighed, derfor design + målt baseline før første PR (AGENTS regel 36). Ingen spillervendt ændring: ingen tekst, ingen tal, intet flag.

## Problemet i én sætning

En rytter, der forlader et hold i løbet af dagen (frigivelse, kontraktudløb, pension, graduering), efterlader intet ejerskifte-spor, og aftenafregningen sætter ham derfor i karantæne som "beviser mangler". Det giver en `needs_reconciliation`-alarm i Sentry (CYCLINGZONE-9B) for noget, der er helt i orden.

## Målt baseline (prod, read-only, 19/10)

**Karantæner de seneste 14 dage** (`training_date_work.quarantine_evidence`):

| Årsag | I alt | Frigivet nu (`team_id = null`) | På andet hold nu | Samme hold | Med ejerskifte-hændelse |
|---|---|---|---|---|---|
| `roster_or_opening_evidence_unavailable` | 17 | **12** | 5 | 0 | 5 |
| `unsafe_current_state` | 3 | 0 | 0 | 3 | 3 |
| `unsafe_roster_or_missing_opening` | 2 | **2** | 0 | 0 | 0 |

Alle 22 endte i `needs_reconciliation`. **14 af 22 (64 %) er frigivne ryttere**, som en fri agent ikke skal have afregnet. De drukner de 8 reelle fund.

**Ejerskifte-loggen** (`rider_ownership_events`, alle rækker): 1.385 hændelser, **0 med `to_team_id = null`**. Ingen vej, der fjerner en rytter fra et hold, skriver en hændelse. Alle eksisterende skrivninger går hold → hold eller fri → hold (auktion, handel, bytte, udskudt etapeløbs-flush).

## Del A: alle udgange fra et hold skriver en ejerskifte-hændelse

### Valgt: DB-trigger på overgangen hold → ingen hold

```sql
-- AFTER UPDATE OF team_id ON riders
-- WHEN (OLD.team_id IS NOT NULL AND NEW.team_id IS NULL)
INSERT INTO rider_ownership_events(rider_id, rider_firstname, rider_lastname,
  from_team_id, to_team_id, reason, actor_type)
VALUES (NEW.id, NEW.firstname, NEW.lastname, OLD.team_id, NULL,
  CASE WHEN NEW.is_retired THEN 'retirement' ELSE 'release' END, 'system');
```

- **Hvorfor trigger og ikke 7 JS-kald:** udgangene ligger både i JS (`api.js` release ~2054 og academy-release ~2180, `contractExpiryRelease.js`, `retirementRelease.js`, `legacyRiderRetirement.js`, `betaResetService.js`, `academyGraduation.js` 525/637) og potentielt i SQL-RPC'er. En trigger fanger dem alle, også fremtidige, og kan ikke glemmes. JS-kald + vagt-test fanger kun det, testen kender.
- **Ingen dobbeltregistrering:** målt 0 eksisterende hændelser med `to_team_id = null`, så ingen eksisterende kode skriver den overgang. Triggeren rører ikke hold → hold eller fri → hold.
- **Best-effort som `recordRiderOwnershipEvent`:** triggeren må aldrig rulle en frigivelse tilbage. Indsættelsen pakkes i `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING ... END`, så en fejl i loggen ikke kan blokere spillets handling. Samme princip som helperen (filens header).
- **Årsag:** CHECK-constrainten udvides additivt med `'retirement'`. Finere årsager (kontraktudløb, graduering) kan en SQL-sti sætte via `set_config('cz.ownership_reason', ..., true)`, som triggeren læser med fallback. Det bygges kun, når en revision har brug for det; v1 er `release`/`retirement`.
- **Fravalgt:** JS-kald i hver sti (glemmes ved næste nye sti, rammer ikke SQL-stier) og en natlig diff-rapport (opdager hullet bagefter, retter det ikke).

## Del B: en rytter, der beviseligt har forladt holdet, er ikke et afstemningsfund

### Valgt: ny RPC `depart_training_date_riders`, ingen ændring af commit-RPC'en

Afregningen (`backend/lib/trainingDateClose.js` ~237) deler de utilgængelige ryttere i to:

- **Forladt holdet:** `!currentIds.includes(id)` og rytterens `team_id` er `null` nu. Kaldes med den nye RPC.
- **Alt andet** (fx skiftet hold uden åbnings-tilstand, usikker sæson, bank/frosset/test-hold): uændret `quarantine_training_date_riders`, stadig alarm.

RPC'en, i samme transaktionsmønster som karantæne-RPC'en (samme to advisory locks, `FOR UPDATE` på arbejdsrækken):

1. Kræver at alle id'er står i `expected_rider_ids` (ellers `RAISE`) og tager **server-side** kun dem, der lige nu har `riders.team_id IS NULL` (stoler ikke på klienten). Resten returneres ikke, og kalderen karantænerer dem som før.
2. Lægger dem i `quarantined_rider_ids` (uændret semantik), men skriver beviset i en ny additiv kolonne `departure_evidence jsonb DEFAULT '[]'` (tidspunkt, `applied_receipt_days`, åbnings-tilstand) i stedet for `quarantine_evidence`.
3. Genberegner `missing_evidence` og status med **samme formel** som commit-RPC'en. `departure_evidence` indgår ikke, så en dato, hvor kun frigivne ryttere mangler, bliver `complete`.
4. Skriver **ikke** til `training_condition_timeout_outbox`. Altså ingen Sentry og ingen Discord-ops.

**Rettet 19/10 under byg (#6894): rytteren bliver i den frosne trup.** Første udkast fjernede ham fra `expected_rider_ids`. Det er usikkert. `register_training_date_work` bruger `expected − quarantined` til at afgøre, om et andet hold må registrere rytteren samme dato, og commit-RPC'en bruger de samme lister i værnet for tidligere datoer. Ved at blive i `quarantined_rider_ids` opfører rytteren sig præcis som i dag. Kun "manglende beviser" ser ham ikke længere. Commit-RPC'en røres stadig ikke.

**Kant-tilfælde:**
- Frigivet og genansat hos et andet hold samme dag: `team_id ≠ null`, altså ikke "forladt". Den eksisterende "træning følger rytteren"-regel (#6439) gælder.
- Pension: `team_id = null` og `is_retired`. Forladt, uden alarm. Del A logger `retirement`.
- De 5 målte "på andet hold nu"-tilfælde er **ikke** omfattet. De er stadig reelle karantæner og undersøges særskilt (åbent spørgsmål nedenfor).

## Leverancer (to PR'er, A før B)

1. **PR A (migration + test):** trigger + CHECK-udvidelse, idempotent (`CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`). Test: SQL-fixture, hvor hver kendt udgang giver præcis én hændelse, og hold → hold giver ingen ekstra. Post-merge: apply via auto-migrate, post-verify med en ægte frigivelse i prod (én række med `to_team_id = null`).
2. **PR B (#6894, migration + JS + test):** kolonne + RPC + klassificering i `trainingDateClose.js`. Test: en frigivet rytter giver `complete` uden outbox-række, en rytter på andet hold uden åbnings-tilstand giver stadig `needs_reconciliation` + outbox, og RPC'en afviser en rytter med `team_id ≠ null`. Post-verify: næste aftenafregning med frigivelser giver 0 nye CYCLINGZONE-9B.

Done = 14 dage efter PR B: 0 karantæner med `team_id = null`, og hver ny frigivelse har en ejerskifte-hændelse.

## Åbent (teknisk, ikke ejer-beslutning)

- **De 5 ryttere "på andet hold nu"** (med ejerskifte-hændelse): hvorfor fulgte træningen dem ikke (#6439)? Sandsynligvis manglede åbnings-tilstanden ved holdskiftet. Undersøges som eget fund efter PR B, så det ikke blander sig med denne rettelse.

Refs #6504 #6470 #6474 #6439 #3582
