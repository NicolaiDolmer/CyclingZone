# 2026-11-25 · Dublet i build-stop.json brød bølge-admission

**Hvad:** Claude tilføjede ejer-go 25/11 til `finishList` (d8a2f28a4), heriblandt #7659, som allerede stod på `brandList`. `wave-policy` afviser et issue på flere lister, så ops-script-tests fejlede på PR #8699 ("#7659 står på flere lister").

**Rettelse:** dubletten fjernet (644c7e88a).

**Forebyggelse:** tjek alle lister i `build-stop.json` for issuet før tilføjelse (én-linjers node-tjek for dubletter efter hver ændring). Brug altid en sessions-unik fil til PR-body (scratchpad), aldrig delt `$TEMP/body.md`: en anden session overskrev den, og #8699 fik den forkerte PR-tekst.
