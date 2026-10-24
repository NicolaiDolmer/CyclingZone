# 2026-10-23: Udvikling 2.0 designfase, træningsscore-lækage og ejer-kort

## Hvad skete
- Designfasen for Udvikling 2.0 (#6110) blev gennemført på én dag: kortlægning, spec, mockups, 29 ejer-spørgsmål (S1-S29) og K1-K3b efter harness på prod-data. Byg påbegyndt (#7113, #7075, #7114, #7115).
- Under baseline-målingen for Udviklingsscore B blev en live sidekanal fundet: `rider_training_scores.contributions` blev sendt til klienten med `potential` og `noise` som point. Skærmen viste "Talentet +N", og tabellen kunne også læses direkte via RLS for eget hold. Lukket i #7115 (API-filter + kolonne-privilegie).
- To fejl på ejer-kort: evnenavne, der ikke findes ("Holdbarhed", "Prolog"), og eksempeltabeller med talent-tal, der ikke svarede til virkelige percentiler.

## Rod-årsag
- Lækagen: scorens "hvad trak op/ned"-design (#4851) viste alle faktorer, også talent, og støjen gjorde talentet direkte aflæseligt. Kolonne-privilegie-modellen (#1162) dækkede kun `riders` og `rider_derived_abilities`, ikke nyere tabeller med afledte talent-signaler.
- Kort-fejlene: navne skrevet fra hukommelse i stedet for locales, og eksempler valgt på skalaen i stedet for på populationen.

## Hvad vi gør fremover
- Ny tabel eller kolonne med noget, der kan regnes tilbage til potentiale/talent: tilføj kolonne-privilegie med det samme og registrér den i `ALLOWLIST_HIDDEN_COLUMNS` (`scripts/lint-riders-column-grant.mjs`).
- Doktrin S20: kun potentialet er en bevidst skjult værdi; alle andre flader og svar må ikke gøre det aflæseligt (gates H4, H4b, H6b).
- Ejer-kort: slå evne- og sessionsnavne op i `frontend/public/locales/da/rider.json` og `abilityRegistry.js`; brug virkelige percentiler fra prod i eksempler; ejeren vil se tal og grafer, ikke abstrakte valg.
- Codex-runder: højst 2 pr. PR uden ejerens ord; derefter vises fund for ejeren.
