# Postmortem · 2026-11-13 · Dubletter i build-stop.json på main gjorde PR-tjek røde

## Hvad skete der?
Lederen lagde fire ejer-go ind i `scripts/build-stop.json` og pushede direkte til main (`ed3a45b53`). Tre af opgaverne (#6584, #6912, #7535) stod allerede på en anden liste i filen. I ca. ti minutter var filen ugyldig på main: `wave-policy.mjs enqueue` afviste alt, og tjekkene `build-stop` og `ops-script-tests` blev røde på de PR'er, der kørte CI i det vindue (#8138, #8139).

## Root cause
Filen har tre lister (finishList, cleanupList, brandList), og en opgave må kun stå på én. Lederen tilføjede nye poster uden først at søge efter opgavenummeret i hele filen, og committede uden at køre filens egen test. JSON var gyldig, så en ren parse-kontrol fangede det ikke.

## Fix
Rettet i tre commits samme time (`89836a302`, `99c7dcfb7`): dubletterne fjernet, og ejerens ord fra 13/11 skrevet på de poster, der fandtes i forvejen. De røde PR-tjek er kørt igen.

## Forhindret-fremover
Før hver ændring af `scripts/build-stop.json`: søg efter opgavenummeret i HELE filen, og kør `node --test scripts/build-stop.test.mjs` før commit (21 prøver, under 5 sekunder). Findes opgaven allerede, skrives det nye ejer-citat på den eksisterende post. Opfølgning: testen bør køre i en pre-commit-hook for filen, så det ikke hviler på hukommelsen.

## Læring
En fil, der styrer, hvad der må bygges, er en delt kontrakt: en ugyldig udgave på main rammer alle åbne PR'er og hele bølgen på én gang. Chore-commits direkte på main skal have samme lokale test som en PR, også når ændringen "kun er en linje".
