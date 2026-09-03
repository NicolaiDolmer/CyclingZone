# Postmortem · 2026-09-03 · Assistentens accept-knapper skrev 0 rækker for hold med fuld plan

## Hvad skete der?
Spilleren _chriskp_ rapporterede (Discord 2/9) at "Get suggestions from the assistant"-panelet på
Daglig træning ikke kunne anvendes — hverken ved at markere enkelte rækker eller via "Accept all".
Ikke reproduceret af rapportøren med et konkret skærmbillede af mekanismen, kun symptomet.

## Root cause
Ikke en regression fra #4673/#4675/#4677/#4678 (verificeret: ingen af dem rører panelet, dets lib-fil
eller `/api/training/bulk`). Adfærden har eksisteret siden #4522 (panelet) + #1894 variant 3
(smart-bulk-serverens `partitionSmartBulkTargets`): server-siden springer ALTID en rytter med en
eksisterende plan over — assistenten må aldrig overskrive managerens eget valg (§9.3,
`docs/ASSISTANT_RULES.md`). Panelet viste og tilbød checkbox på ALLE rækker, inkl. dem med
`hasPlan: true`, og "Accept all" sendte hele visningen. For et hold hvor HVER ikke-pensioneret rytter
allerede har en plan i sæsonen — målt i prod 3/9: 65 af 241 manager-hold — skrev ethvert klik derfor
altid `applied: 0`, uanset hvad brugeren markerede. Kontrakten var korrekt implementeret server-side,
men UI'et lovede en handling den aldrig kunne udføre for netop de aktive hold der har styr på deres
trup — nøjagtigt den population der ville bruge panelet mindst men støde på det oftest.

## Fix
`frontend/src/lib/assistantTrainingSuggestions.js`: ny `acceptableAssistantSuggestions` /
`acceptableSuggestionIds` / `acceptableSelectionIds` — det ENE sted der definerer hvad accept-stien
kan skrive (rækker uden `hasPlan`).
`frontend/src/pages/TrainingPage.jsx`: `assistantAcceptableIds` (memo over de synlige rækker) styrer
nu `toggleAssistantSelect` (afviser en uacceptabel rytter), `handleAcceptAssistantSelected` (beskærer
markeringen) og `handleAcceptAssistantAll` (sender kun det acceptable sæt, ikke hele visningen).
`frontend/src/components/training/AssistantSuggestionsPanel.jsx`: en række med `hasPlan` får en
"Your plan"-markør og en slået-fra checkbox; "Accept all" er slået fra og viser antallet (`n`) af
faktisk-anvendelige rækker; en forklarende note vises når et fuldt planlagt hold ikke har noget at
acceptere.

## Forhindret-fremover
- `assistantTrainingSuggestions.test.js`: 13 nye unit-tests dækker begge accept-stier (enkelt +
  accept all), inkl. et fuldt planlagt hold der ikke må kunne sende noget.
- `AssistantSuggestionsPanel.test.js` (ny fil) + `TrainingPage.wiring.test.js`: source-string-guards
  der pinner at UI'et bruger de delte helpers og ikke genopfinder en parallel regel.

## Læring
En server-side "spring altid over"-regel skal have et UI-modstykke der viser regel-resultatet FØR
klik, ikke kun efter (fejl/skip-besked). Ellers ser en korrekt implementeret invariant ud som en
knap der "ikke virker" for præcis de brugere invarianten er lavet for at beskytte.
