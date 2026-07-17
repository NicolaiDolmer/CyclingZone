# Entry-generator TOCTOU vs. manuel udtagelse (#2436, Sentry CYCLINGZONE-32)

## Symptom
`runRaceEntryGenerator` skannede holdets manuelle entries ÉN gang (trin 6), men skrev
enhederne senere, én ad gangen. Gemte en manager sin udtagelse (`replace_race_selection`,
`raceSelection.js`) i vinduet imellem, var manual-mappet forældet. Guarden der nedgraderer
en auto-kaptajn til helper når manager har sat kaptajn (CYCLINGZONE-2D) så ingen manuel
kaptajn → insert kolliderede med `uq_race_entries_captain` (Postgres 23505). 1 hændelse i
Sentry, ingen kendt spillerskade.

## Rod-årsag
Klassisk time-of-check-to-time-of-use (TOCTOU): check (manual-scan) og use (write) er
adskilt af resten af sweepens arbejde (autopick, binding-beregning for ALLE hold/løb).

## Fix (issue-forslag 1 — snæver, ærlig)
- Fangede PRÆCIS `uq_race_entries_captain/_sprint_captain/_hunter` (regex på
  constraint-navn, ingen generel 23505-slugning).
- Én retry pr. enhed: genlæs enhedens manuelle rækker friskt, kør enheden om via samme
  kerne (`assignTeamAcrossRaces`), skriv igen.
- Lykkes retry'en → ingen Sentry-capture (var en samtidig manager-gem).
- Fejler den igen → captures som hidtil (samme signatur var symptom på ægte bugs 25/6 +
  12/7 — signalet må ikke forsvinde).

## Ekstraheret
`applyUnitDiff` (vacate→insert→delete→promote) er nu en delt funktion mellem
originalskrivningen og retry'en — ingen kodeduplikering, retry kan aldrig afvige i
skrive-rækkefølgen fra normalstien.

## Test
`backend/lib/raceEntryGenerator.test.js`: to nye #2436-tests simulerer TOCTOU'en via
`failUpsert`-hooken (udvidet til at kunne returnere en custom fejlbesked). Én test hvor
retry'en lykkes (ingen capture), én hvor begge forsøg kolliderer (fejl captures).
