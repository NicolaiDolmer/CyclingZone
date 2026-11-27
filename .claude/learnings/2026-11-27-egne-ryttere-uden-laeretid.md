# Postmortem · 2026-11-27 · Egne ryttere uden potentiale og uden Læres-tæller (#8855)

## Hvad skete der?
En spiller havde flere egne ryttere, der hverken viste potentiale eller "Læres · x af 5". Rytterne stod som "?" på Mit hold og i profilen. Prod-målingen (read-only, tal i privat evidens) viste to grupper af egne ryttere uden et gemt skøn: ryttere under grænsen for første skøn, og ryttere der havde passeret grænsen midt i ugen.

## Root cause
To huller, som rammer samme symptom:
1. Læse-siden (`backend/lib/potentialEstimateRead.js`, `loadEstimateContext`) gav kun akademitalenter læretiden. Writeren (`potentialEstimate.js` ownLevel) giver derimod ENHVER egen rytter sit første skøn efter samme grænse for egne datoer. En købt eller hentet seniorrytter lærte altså, men læse-siden sagde "uscoutet".
2. Det første skøn blev kun skrevet ved et kig, ved holdskiftet eller om søndagen. En rytter der nåede grænsen midt i ugen, stod uden række til næste søndag, og læse-siden faldt fra "Læres" til "?".

## Fix
1. Denne PR: læretiden gælder alle egne ryttere uden gemt skøn (`isLearningOwn`), med tests for seniorrytteren og for at en andens rytter aldrig får læretiden.
2. Hul 2 lukkes af PR #8825 (#8604): et timesweep skriver det første skøn med årsagen backfill, og læse-siden holder egne ryttere på "x af x", til skønnet er skrevet. Ingen separat datareparation er nødvendig: hul 1 er løst ved deploy, hul 2 af sweepets første kørsel (ellers søndagskørslen).

## Forhindret-fremover
Testen "egen seniorrytter uden skøn læres" låser, at læse-siden og writeren bruger samme definition af "egen rytter i læretiden".

## Læring
Når en tilstand vises ud fra en regel, skal læse-siden bruge præcis samme udvalg som writeren. Her var writerens regel "egen rytter", mens læse-siden havde indsnævret den til "egen ungdomsrytter" ud fra specens eksempel.
