# Postmortem · 2026-07-19 · Coach specialty headline mixed skill dimension with age-band affinity

## Hvad skete der?
Discord-rapport (#2695): en trænings-chef hyret før #2529 (U23-bånd-kollapset) viste "Best at senior" på sin profil, selvom spilleren forventede "physical" (hans faktiske coaching-skill) eller "U23". Fremstod som en data-regression fra bånd-omlægningen.

## Root cause
Ren display-bug, ikke data-korruption. `topSpecialization()` (backend, `staffAbilityDerivation.js`) og `topStaffAxis()` (frontend, `staffAbilities.js`) rangerede ALTID `dimensions` (physical/mental/technical — en skill) sammen med `levels` (u23/senior — et alders-FOKUS, semantisk noget helt andet) i ÉN fælles "top-akse"-sammenligning til hero-headline'en ("Best at {axis}"). Det var sådan siden A4b (0d8f9c67), IKKE noget #2529 introducerede direkte — men #2529's kollaps fra 3 niveau-bånd (youth/junior/senior) til 2 (u23/senior) gjorde niveau-akserne systematisk mere ekstreme: `applySpecialization` booster ALTID toppen og trækker ALTID bunden ned i sit input-array; med 3 bånd var der en "midter"-akse tilbage nær baseline som dæmpede konkurrencen mod dimensions, med kun 2 bånd polariserer den fuldt hver gang — så et niveau-bånd vinder nu oftere den rå-tal-sammenligning mod den faktiske skill-specialisering.
Verificeret via `execute_sql` mod prod-DB: migrationen `staff_u23_band_collapse_2529` (20260717092245) er allerede kørt og ALLE `staff_derived_abilities.levels`-rækker har korrekt `{u23,senior}`-format (0 rækker med gamle `youth`/`junior`-nøgler) — så ingen data at reparere.

## Fix
`backend/lib/staffAbilityDerivation.js::topSpecialization()` og `frontend/src/lib/staffAbilities.js::topStaffAxis()` udelukker nu `levels` fra top-akse-søgningen — kun `dimensions`/`roleSkills` (rene skills) konkurrerer om headline'en. Niveau-affiniteten (u23/senior) vises fortsat, i sin egen "Coaching group focus"-kolonne (`StaffAbilityColumns.jsx`) — den var aldrig meningen at den skulle kunne kapre "Best at X"-linjen.

## Forhindret-fremover
Ny test `frontend/src/lib/staffAbilities.test.js` asserterer eksplicit at `topStaffAxis` aldrig returnerer `u23`/`senior` selv når de rå-tal er højest. Opdateret `backend/lib/staffCandidates.test.js`-testen til samme kontrakt (skill-akser only).

## Læring
Når en UI-headline er "top-scorende akse på tværs af X kolonner", tjek om kolonnerne rent faktisk er SAMMENLIGNELIGE størrelser (samme semantik/skala), ikke bare samme numeriske range [1,99]. To facetter der besvarer forskellige spørgsmål ("hvad er han god til" vs. "hvilken aldersgruppe passer han til") bør aldrig konkurrere i én rangering, uanset at de tilfældigvis begge er tal 1-99. En bånd-kollaps-migration (2529) kan gøre en LATENT designfejl (mixed-scale ranking) markant mere synlig uden selv at være root cause.
