# #6132: bulk-regenerate overså brugte løbsdage efter holdskifte

## Hvad skete der
Race Hubs "Auto-udfyld igen" (POST /races/distribution/regenerate) byggede sine låse kun
ud fra holdets EGNE entries. En rytter der havde kørt en løbsdag hos et tidligere hold
(løbet completed, den gamle entry slettet) var derfor fri i tildelingen. DB-vagten
(#5860, find_spent_race_days) afviste så insert'en, og writeren efterlod målløbet tomt,
fordi den sletter holdets rækker før insert.

## Rod-årsag
To kodeveje løste samme problem hver for sig. #6131 gav entry-generatoren et kanonisk
preload (race_entries.binding_span + race_day_participation), men ruten fik det aldrig.
Ruten tildelte (assignTeamAcrossRaces) før writeren, uden at kende de kanoniske dage.

## Rettelse
- `loadRegenerateBindingLocks` (raceEntryGeneratorBindings.ts) genbruger
  `loadSpentRaceDays` (samme RPC som DB-vagten) pr. mål-løb og andre holds kanoniske
  entries, og laver låse via de eksisterende `indexGeneratorBindings`/`generatorBindingLocks`.
  Ruten lægger dem til sine låse før tildelingen.
- En brugt dag forbliver én præcis dag. Den forklædes ikke som en entry med hele
  løbets vindue, ellers ville lovlige senere dage i et etapeløb blive blokeret.
- `writeRegeneratedLineupsPreservingTarget` genskaber holdets hele eksisterende
  måludtagelse, hvis writeren fejler: slet først alle berørte rækker, indsæt så den
  gamle udtagelse i ét statement.

## Læring
- Når en invariant får et kanonisk preload ét sted, så find ALLE tildelingsveje der
  træffer samme valg (generator, runner, Race Hub, manuel gem) og giv dem samme kilde.
- En delete-så-insert-writer skal have en fuld genskabelse, ikke kun af flyttede ryttere.
- Genskabte rækker får ingen auto_filled_source (tæller som "unknown" i målingen), samme
  begrænsning som #5789's genskabelse. Kun fejlstien rammes.
