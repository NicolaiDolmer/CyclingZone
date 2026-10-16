# Teknisk plan: fødselsdage, daglig aldring, oprykning og pension (#5833)

Status 16/10: **planlægning, ikke ejer-godkendt.** Skrevet af Fable (arkitekt) på ejerens ønske 16/10. Tal målt read-only i prod 16/10 (S4 aktiv, S5 `upcoming` med start 28/10). Private parametre (rytterårets længde, veteranalder, øvre aldersgrænse, aktivitetsvindue) står kun i den private plan i OneDrive (`private-handoffs/2026-10-14-rider-birthdays-and-aging-plan.txt`).

## 1. Målt baseline (prod 16/10)

13.464 aktive ryttere, **0 mangler fødselsdato**, 0 uden `squad`. Sæsonalderen regnes i dag kun ud fra fødselsåret (`riderSeasonAge.js`, S4 = 2029).

| Gruppe (sæsonalder S4) | Menneskehold | AI-hold | Frie |
|---|--:|--:|--:|
| ≤18 (junior) | 607 | 1.088 | 1.280 |
| 19-22 (U23) | 1.433 | 1.352 | 1.884 |
| 23-30 | 1.574 | 1.135 | 589 |
| 31-35 | 732 | 989 | 325 |
| 36-39 (pensionsvindue) | 139 | 238 | 81 |
| 40+ | 4 | 10 | 4 |
| I alt | 4.489 | 4.812 | 4.163 |

**Gruppeskift ved 25/10 (gammel model):**
- 288 ryttere på menneskehold fylder 19 (201 af dem står i juniortruppen), og 266 fylder 23 (51 står i U23).
- **41 juniorer på 12 menneskehold rykker op i en U23-trup, der allerede er fuld (12). Det samme gælder 2 U23-ryttere i en fuld seniortrup.** Dagens kæde ville sælge eller frigive dem.
- `academy_graduation` til dato: 196 rykket op, 3 solgt, 1 frigivet.

**Pension:**
- Ved S4-slut er 143 menneskeryttere i dagens vindue (4 af dem garanteret).
- 13 har allerede et frosset varsel om at stoppe efter S4, og 19 har et frosset "nej". 9 af de 13 har kontrakt ud over S4.
- I S5 er 223 menneskeryttere kandidater (18 garanteret).
- 57 veteraner (36+) har kontrakt ud over S4, og 5 af dem ud over S5.
- 875 menneskeryttere er 31+ og dermed i tilbagegangsområdet.

**Datafund:** 7.422 ryttere (55 %) har fødselsdato **15. juni**, generatorens standardværdi. De øvrige måneder har hver ca. 500. Med model A ("eksisterende fødselsdag") får over halvdelen af spillet derfor fødselsdag samme dag.

**Kode der modsiger de godkendte punkter:**
- `trainingDayCloseTrigger.js` springer dage uden aktiv sæson over.
- `raceDayBudgetDivisor` (`trainingRaceDayTick.js`) skalerer udbyttet med sæsonens antal løbsdage. Med 160 i S5 giver det 12,5 % mindre pr. dag end med 140.
- `academyGraduation.defaultResolveGraduate` vælger `sell`, når truppen er fuld.
- `riderProgression` ælder rytterne +1 ved hvert sæsonskifte.
- Pension er sæsonbaseret og frigives ved skiftet uden hensyn til igangværende etapeløb (`retirementRelease.js`).

## 2. Datamodel og migrationer (additive, idempotente)

Alle kolonner er nullable, og der er ingen backfill i SQL. Backfill sker i et Node-script med `--dry-run` som standard og en snapshot-tabel før skrivning.

- **`riders`:**
  - `game_age int`
  - `next_birthday date`
  - `birthday_cycle_anchor date`
  - `promotion_pending_to text`, `promotion_pending_since timestamptz`, `promotion_notice_sent_at`
  - `retirement_date date`, `retirement_notice_sent_at`, `retirement_reminder_sent_at`, `retirement_extended_for_race_id`
  - `contract_final boolean`
- **Nye tabeller:**
  - `rider_aging_carry(rider_id, ability, carry numeric)`
  - `rider_age_events(rider_id, event_type, event_date, from_value, to_value, dedupe_key unique)`
  - `daily_lifecycle_runs(tick_date pk, phase, started_at, completed_at, summary jsonb)`
- **Ny kolonne:** `training_day_runs.day_kind` (`race_axis`/`offseason`).
- **Flag (alle off):** `rider_birthdays_enabled`, `aging_daily_enabled`, `training_offseason_enabled`, `promotion_pending_enabled`, `retirement_date_enabled`, `contract_horizon_enabled`. `development_v2_aging_enabled` beholdes frem til 25/10.
- **Konstant:** `SEASON_RACE_DAY_TARGET[6] = 135` (27 datoer × 5).

## 3. PR'er i rækkefølge

Hver PR får sit eget flag, unit-tests med eksplicit testtid (dansk tid, sommertid 25/10) og en prøvekørsel mod et prod-snapshot.

| # | PR | Flag | Spilleren ser |
|---|---|---|---|
| 0 | Baseline-script (read-only) | – | intet |
| 1 | **Afventer oprykning:** fuld måltrup giver `promotion_pending` i stedet for salg/frigivelse; kapaciteten tælles i den gamle trup; "Ryk op" når der er plads. **Skal ligge før 25/10** | `promotion_pending_enabled` | status "Afventer oprykning" |
| 2 | **Fast udbytte pr. løbsdag:** divisoren forankres i 5 løbsdage pr. dato, ikke i sæsonens total. Skal ligge før 28/10 | ingen (spillervendt regel) | S5 bliver ikke udtyndet |
| 3 | **Træning på løbsfri dage** + dags-claim pr. dansk dato + direkte skifte med mindst 24 t planlægning | `training_offseason_enabled` | træningsrapport også på løbsfri dage |
| 4 | **Fødselsdage, skyggefase:** backfill (dry-run, diff, apply), `ageFromRow()` i alle kaldsteder, varsel om oprykning 7 dage før | `rider_birthdays_enabled` beta | "Næste fødselsdag" |
| 5 | **Fødselsdage live** + oprykning på fødselsdagen; igangværende etapeløb køres færdigt | `rider_birthdays_enabled` on | fødselsdag = oprykning |
| 6 | **Gradvis daglig tilbagegang** med carry; starter ved rytterens første nye fødselsdag (intet dobbelt fald) | `aging_daily_enabled` | små, spredte ændringer |
| 7 | **Personlig pensionsdato:** mindst 28 dages varsel og påmindelse 7 dage før; eksisterende varsler mappes 1:1 | `retirement_date_enabled` | "Stopper dd/mm" |
| 8 | **Kontraktgaranti + veteranregel** | `contract_horizon_enabled` | slutdato og "sidste kontrakt" før accept |
| 9 | SSOT-docs, Hjælp, samlet patch note | – | forklaringer |

## 4. Samspil med 25/10

- **Før 25/10:** PR 0, 1 og 2.
- **25/10:** den gamle sæsonaldring kører. Aldringsflaget afgøres efter prøvekørslen 23/10; anbefalingen er at tænde det, da det er det sidste sæsonbaserede fald.
- **S5:** PR 3-5. Fødselsdage kører i beta først og tændes tidligst 14 dage før 28/11.
- **28/11 (S5→S6, direkte skifte):** ingen aldring ved skiftet. PR 6-8 kan derefter merges i S6.

## 5. Risici

1. 15.-juni-klumpen (55 %).
2. Dobbelt fald mellem 25/10-faldet og den daglige model.
3. To sæsoner på samme dato (28/11).
4. Over 30 kaldsteder for alder.
5. Eksisterende pensionsløfter må ikke flytte sig.
6. Daglig skrivebelastning (#6490).
7. Sommertid 25/10.

## 6. Ejerbeslutninger (anbefaling)

1. **15.-juni-ryttere:** behold datoen bogstaveligt (A) eller spred dem deterministisk (B). **Anbefaling: B.**
2. **Fødselsdage:** beta efter 25/10, on ca. 14/11. **Anbefaling: ja.**
3. **Aldringsflaget 25/10:** **Anbefaling: tænd** efter prøvekørslen 23/10.
4. **Aktivitetsbremse:** brug sæsonens belastning, indtil vinduet er målt. **Anbefaling: ja.**
5. **Pensionsdato:** sidste løbsdato i kontraktens udløbssæson (A), med 28 dage som gulv. **Anbefaling: A.**
6. **Daglig kørsel:** kl. 06:00 dansk tid. **Anbefaling: ja.**
7. **Direkte skifte:** første gang 28/11. **Anbefaling: ja.**
8. **S7:** 28/12-23/1 (forslag).
