# "Spejler X 1:1" er en verificerbar påstand — læs begge sider

**Dato:** 2026-08-28 · **Kontekst:** PR #4316 (#1146 bulk-gem-endpoint), CodeRabbit-review

## Hvad skete

Bulk-RPC'ens forward-guard bar denne kodekommentar:

> Spejler prepareSelectionChange (backend/lib/raceSelection.js) 1:1 som TO ADSKILTE regler, praecis som app-laget

Den påstand var falsk på to punkter, og begge var TOCTOU-huller:

1. **Kardinalitets-leddet manglede.** App-laget: `riderIds.length < currentRiderIds.size && riderIds.every(...)`. SQL: kun `v_rider_ids <@ v_current_rider_ids`. `<@` er inklusiv, så et uændret ryttersæt med ændrede roller slap gennem frys-guarden og fik feltet slettet+genindsat med nye roller — kaptajnsskifte i et løb der kørte.
2. **Frigivelserne var slet ikke dækket.** Guarden lå inde i `p_changes`-løkken; `p_auto_releases`-løkken kørte før den og slettede råt på `is_auto_filled` alene. App-laget (`classifyBindingConflicts`, raceBinding.js:225) kræver `isAutoFilled && !raceAlreadyStarted`.

Dertil et fejlkode-hul: guarden rejser to koder, kun én var mappet, så `selection_race_not_open` gav 500 + Sentry-alarm i stedet for 409.

## Hvorfor det slap igennem

Commit'en umiddelbart før (`fix(sql): split forward-guarden i to regler som app-laget`) **strammede netop denne guard** og skrev spejl-påstanden ind — men verificerede den aldrig mod det den påstod at spejle. Påstanden blev derefter læst som dokumentation af de næste læsere, inkl. mig selv i første gennemgang.

Samme fejlklasse to gange i træk på samme fil.

## Læringen

Når en kommentar hævder at spejle, matche eller svare til et andet lag, er det ikke prosa — det er en **påstand med en adresse**. Den kan efterprøves på et minut ved at åbne begge sider og sammenligne led for led. Gør det, både når du skriver påstanden og når du reviewer kode der bærer den.

Konkret tjek ved spejlede guards:
- Har begge sider **samme antal led**? (her: 2 vs. 1)
- Dækker guarden **alle indgange**, eller kun den løkke den tilfældigvis står i? (her: `p_changes` ja, `p_auto_releases` nej)
- Rejser den flere fejlkoder end kalderen **mapper**? (her: ja)

## Bonus: review-værktøjet fandt det, men tog også fejl

CodeRabbit fandt begge huller. Den rapporterede også en falsk positiv som Major — "fjern migrationen fra branchen" med henvisning til vores egne guidelines, mens AGENTS.md hard rule 9 siger det modsatte (`migration committes i PR → PR merges → apply`). Den forvekslede "apply efter merge" med "commit efter merge".

Brug den som input, ikke som facit. Verificér findings mod koden før du retter — og korrigér de falske i tråden, så `knowledge_base.learnings` lærer af det.

Refs #1146 #4310 #2637 #2074
