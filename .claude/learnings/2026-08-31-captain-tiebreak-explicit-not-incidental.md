# Kaptajn-tiebreak: gør determinismen eksplicit, stol ikke på en kaldeers sortering

Dato: 2026-08-31 · Issue: [#4357](https://github.com/NicolaiDolmer/CyclingZone/issues/4357) · Opfølgning på [#4344](https://github.com/NicolaiDolmer/CyclingZone/issues/4344)/[#4353](https://github.com/NicolaiDolmer/CyclingZone/pull/4353)

## Symptomet (rapporteret)

`backend/lib/raceRunner.js`'s `loadEntrantsForRace` henter `race_entries` uden `ORDER BY`. `raceSimulator.js`'s `buildTeamContext` afgjorde to kaptajner på samme hold ved tavs sidste-skrivning (`t.captainId = e.rider_id`). Sammen: Postgres garanterer ingen rækkefølge → hvem der får leder-beskyttelsen kunne i teorien flippe mellem visninger.

## Hvad verifikation faktisk viste

`buildTeamContext` kaldes ÉT sted i produktionskode: `simulateStage` (raceSimulator.js:619), som ALTID sorterer `entrants` stabilt på `rider_id` (streng-sammenligning) FØR kaldet — af en helt anden grund (rng-sekvens-determinisme, se filens header). Det betyder captain-tiebreaket allerede var deterministisk i praksis (højeste `rider_id` vandt konsekvent), ikke rækkefølge-tilfældigt på tværs af visninger, fordi `loadEntrantsForRace`'s DB-rækkefølge aldrig når frem til `buildTeamContext` uændret.

Konklusionen "determinismen mangler" var altså delvist forkert som beskrivelse af LIVE-risikoen — men det var stadig KORREKT at fixe: determinismen var en **tilfældighed** (en sortering skrevet til et andet formål, i en ANDEN funktion), ikke en **kontrakt** `buildTeamContext` selv håndhævede. Enhver fremtidig kalder af `buildTeamContext` der ikke går via `simulateStage`s sort ville arve den skjulte antagelse uden at vide det.

## Klassen

**En funktions determinisme skal stå i funktionen selv, ikke afledes af en sortering i dens kalder skrevet til et andet formål.** Grep efter "denne funktion er allerede deterministisk fordi kalderen sorterer" — flyt garantien ind, eller dokumentér den eksplicit som en forudsætning kaldere SKAL opfylde.

## Hvad vi gjorde

- `loadEntrantsForRace`: tilføjede `.order("team_id").order("rider_id")` — billig DB-hygiejne, ændrer intet target for `buildTeamContext` (som allerede fik sorteret input), men lukker hullet for alt ANDET der måtte konsumere `entries` direkte.
- `buildTeamContext`: FØRSTE forekomst af en beskyttet rolle (captain/sprint_captain) pr. hold vinder nu eksplicit i funktionen selv; en konflikt rapporteres til Sentry (injicerbar `captureExceptionFn`) i stedet for at ændre resultatet tavst.
- Retningen skiftede (sidste- → første-forekomst). Ejer-beslutning 31/8 (#4356: "resultaterne står — kun fremadrettet") dækkede eksplicit at dette må ændre hvad de 34 legacy-etaper viser ved fremtidig re-simulering — ingen backfill/migration udført.

## Forward-guard

Før du stoler på at en funktion er deterministisk "fordi kalderen sorterer": grep alle produktions-callsites. Én kalder i dag er ikke en garanti i morgen.
