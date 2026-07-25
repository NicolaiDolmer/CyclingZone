# Postmortem · 2026-07-25 · starterSquadAllocator satte team_id men aldrig kontrakt-felterne

## Hvad skete der?

Cutover-audit 25/7 fandt 1.326 ryttere på 138 menneske-hold med `contract_end_season IS NULL` + `contract_length IS NULL` — 100% co-occurrence med `starter_squad_allocated_at` sat (#2894/#2902). Salary var allerede lappet af en tidligere, separat backfill (#2746), så problemet var usynligt i enhver salary-baseret rapport. ~1 nyt hold/dag (signup) blev ved med at lægge til gabet.

## Root cause

`starterSquadAllocator.js` har to skrive-stier for en ny start-trup:

- Single-team (signup): `insertWeakSquadForTeam` insertede ryttere med `team_id` sat, kørte derive-kæden (physiology→abilities→type→base_value/current_production_value), og returnerede — uden nogensinde at kalde noget der satte `salary`/`contract_length`/`contract_end_season`.
- Batch-relaunch: `writeTeamAssignments` skrev udelukkende `{ team_id }` pr. rytter.

`contractSeed.js` findes og har en veldefineret formel for præcis dette (`computeFrozenSalary` + `pickContractLength` + `computeContractEndSeason`, brugt af `runContractSeed` ved relaunch og `contractOnAcquirePatch` ved erhvervelse) — men starterSquadAllocator kaldte aldrig ind i den. Ingen af de to moduler har nogensinde importeret den anden.

En sekundær forstærker: `contractOnAcquirePatch`'s guard (`if (rider.salary != null) return {}`) betød at selv et FREMTIDIGT erhvervelses-kald (auktion/transfer) på en sådan rytter ikke ville hele den — #2746's salary-backfill gjorde `salary != null` sandt, hvilket blindede selv-helingen for netop de rækker der havde mest brug for den.

## Fix

- `insertWeakSquadForTeam` og `runStarterSquadAllocation` sætter nu kontrakt-felterne EFTER derive (current_production_value findes først der), via en ny `applyContractFieldsForRiders`-helper der genbruger `contractSeed.js`' eksporterede pure funktioner direkte (ingen dupliceret formel).
- `contractOnAcquirePatch`-guarden kræver nu `salary != null && contract_end_season != null` — en rytter med kun det ene felt sat behandles som ufuldstændig og heales af næste erhvervelse.
- `backend/scripts/backfill-2902-contract-fields.mjs`: engangs-backfill for de 1.326 eksisterende rækker, dry-run default, idempotent (SELECT + `.is("contract_end_season", null)`-guard pr. UPDATE), læser aktiv sæson LIVE. Kører EFTER cutover, ikke i denne PR.

## Forhindret-fremover

Forward-guard-tests i `starterSquadAllocator.test.js` (single-team + batch-relaunch + "re-derived" heal-gren) og `contractSeed.test.js` (guard-ændringen) verificerer at alle tre felter altid sættes, og at salary/contract_end_season følger den AKTIVE sæson (aldrig en hardcodet sæson 1).

## Læring

**To moduler der begge "ejer" en del af samme radede (kontrakt-felter på riders) skal dele ÉN skrive-sti, ikke to uafhængige.** starterSquadAllocator og contractSeed havde hver deres opfattelse af hvornår en rytter "har en kontrakt" — allokatoren troede "team_id sat" var nok, contractSeed troede "salary sat" bekræftede resten. Et efterfølgende delvist backfill (#2746, kun salary) fjernede det ene symptom uden at røre roden, hvilket gjorde den underliggende bug usynlig for endnu en runde audits. Når et felt-sæt logisk hænger sammen (her: salary+length+end_season = "kontrakten"), bør skrivning af ét felt uden de andre behandles som en kontraktbrud-kandidat, ikke en delvis fix.

Refs #2894, #2902.
