# #6061: recovery-forberedelse 3/10

SSOT: [TRAINING_RULES](../TRAINING_RULES.md), førstegangstilstand og atomisk datoafregning; [PROGRESSION_RULES](../PROGRESSION_RULES.md), udvikling og lofter.
Ejer-go i Codex 3/10: forebyg og forbered genopretning. Intet go til prod-skrivning.

Read-only inventar gennem 2/10: 20 ryttere, 10 hold, 151 unikke uafregnede rytter-løbsdage. Datoerne har henholdsvis 45, 10, 50 og 46 unafregnede slots fra 29/9 til 2/10. En manglende kvittering er ikke bevis for et tabt træningspas: slots kan være løb eller hvile. To ejer-rækker på samme slot krediteres aldrig dobbelt.

Otte aktuelt ejede ryttere er førstegangskandidater; eksisterende tilstand, tidligere aktiviteter, holdskifte og fravær af ejerskab er separate review-klasser. Trigger-installation retter ingen af disse historiske datoer.

Manifestet er ikke apply-klar. Frosne opening conditions mangler i berørte datoer, og der findes ingen historiktabel for træningsplaner. Nuværende plan/staff-data beviser ikke det præcise gamle pas. Ingen gevinster eller tilstandsændringer opfindes. Ejeren er forelagt valget mellem kontrolleret kompensation med nuværende planer/motor og kun præcist dokumenterbar historisk genopretning.

Privat manifest og kildeudtræk: OneDrive-context/private-recovery/6061. Den lokale balance-internals-kopi er en cache. Den nye prepare6061TrainingRecovery.mjs er read-only, kræver eksplicit cutoff og as-of og afviser --apply. SQL- og SDK-udtræk giver samme anonyme facit.

Efter beslutning: beregn og test den konkrete kompensationsplan; bevar nyere condition/skader, compare-before-write og atomisk idempotens pr. rytter-slot. Først derefter fremlægges den præcise skrivepakke til ejer-go. Ingen prod-skrivning er udført.
