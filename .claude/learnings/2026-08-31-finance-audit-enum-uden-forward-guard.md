# Finance-audit-enums havde ingen forward-guard, og den gamle finance-test var falsk tryghed

Dato: 2026-08-31 (Europe/Copenhagen) · Issue #1464 · Branch `test/1464-finance-enum-constraint-guard`

## Rod-årsag

To ting, begge i familien "enum-værdi i kode uden CHECK-migration" (#1463/#1465/#2948).

**1. Guarden dækkede kun én af tre enum-kolonner.**
`scripts/lint-finance-types.mjs` (#2957) er en god, allowlist-fri guard for
`finance_transactions.type`. Men `type` er ikke den eneste CHECK-begrænsede
enum-kolonne på tabellen: de samme write-sinks sætter også `actor_type` og
`related_entity_type`, og begge har en rigtig CHECK-constraint i prod. Værdierne
kommer fra to frosne konstant-objekter i `backend/lib/economyConstants.js`, hvis egen
kommentar ordret siger at de "MUST matche database CHECK constraints" — uden at noget
håndhævede påstanden. En kommentar er ikke en guard. En ny nøgle i
`FINANCE_ACTOR_TYPE` eller `FINANCE_RELATED_ENTITY` ville derfor være sluppet grøn
gennem CI og først fejlet med `check_violation` (23514) på den første ægte prod-INSERT
der brugte netop den actor eller relation.

**2. Den gamle finance-paritetstest var grøn af den forkerte grund.**
`backend/lib/financeNotificationContract.test.js` matchede en **håndholdt** liste på 11
finance-typer mod den **inline CHECK i `database/schema.sql`**. Begge sider var
forældede, så testen bestod uanset hvad. Målt 2026-08-31: `schema.sql` tillader 18
værdier, det levende constraint (og den autoritative migration
`database/2026-07-25-sponsor-choice-2.sql`) tillader 30. De 12 der manglede:
`facility_purchase`, `facility_upkeep`, `forced_debt_sale`, `parachute`, `scout_travel`,
`sponsor_objective_bonus`, `sponsor_race_day`, `sponsor_result_bonus`,
`sponsor_signing_bonus`, `staff_salary`, `staff_severance`, `upkeep`.
Ejeren flaggede præcis dette i audit-kommentaren 7/8 på #1464.

## Fix

- `scripts/lint-finance-types.mjs` udvidet med et `AUDIT_ENUM_COLUMNS`-register plus
  `loadNamedCheckValues()` (generisk parser for en navngiven CHECK-constraint),
  `extractConstantValues()` (læser `Object.freeze`-konstantobjekter) og
  `extractLiteralEnumValues()` (fanger rå literaler der springer konstanten over, fx
  `stageRaceTransferDefer.js`'s `actorType: "cron"`). CLI'en fejler nu også på drift i
  `actor_type` / `related_entity_type`.
- Paritets-testen kører både i backend-suiten
  (`backend/lib/financeTypeConstraintGuard.test.js`, altså `npm test --prefix backend`)
  og i CI-jobbet `finance-type-guard` — samme logik begge steder, ingen anden kopi.
- Den håndholdte finance-liste er pensioneret. I stedet står en test der håndhæver at
  `schema.sql` er en **delmængde** af det autoritative CHECK, så baselinen aldrig igen
  bliver forvekslet med en autoritet.

## Læring

1. **En kommentar der siger "skal matche X" er en TODO, ikke en guard.** Netop de
   steder hvor koden selv erklærer en invariant, er de steder hvor invarianten er
   uhåndhævet. Grep efter "MUST match" / "skal matche" er en billig måde at finde flere.
2. **Guard én kolonne, og naboen driver stille.** Da `type` fik sin guard, blev de to
   andre enum-kolonner på samme tabel, skrevet af de samme funktionskald, ikke tjekket.
   Når man bygger en guard, så spørg: hvilke andre kolonner i samme write-path har
   samme constraint-form?
3. **En grøn test der matcher to forældede lister er værre end ingen test.** Verificér
   at begge sider af en paritetstest er levende. Her var facit et enkelt SELECT mod
   `pg_constraint` — 18 mod 30.

## Forward-guard

`node --test backend/lib/financeTypeConstraintGuard.test.js` og
`node --test scripts/lint-finance-types.test.mjs` fejler nu hvis en ny værdi i
`FINANCE_ACTOR_TYPE` / `FINANCE_RELATED_ENTITY` (eller en rå literal på de nøgler)
mangler i sit CHECK. Begge suiter har en negativ kontrol med en fiktiv værdi, så det er
bevist at guarden bider og ikke bare er grøn.

## Rest (ikke løst her)

- `loans.loan_type` og `loans.status` har CHECK-constraints i prod (`short/long/
  emergency/reset` og `active/paid_off`), men `loans`-tabellen har **ingen DDL i
  `database/*.sql`** overhovedet. Der er derfor ingen autoritativ kilde i repoet at
  sammenligne imod. Kræver en migration der skriver constraintet ind i repoet først —
  bevidst ikke gjort her.
- Notifikations-halvdelen af `financeNotificationContract.test.js` læser stadig
  `database/schema.sql`. Samme audit-punkt, andet spor.
