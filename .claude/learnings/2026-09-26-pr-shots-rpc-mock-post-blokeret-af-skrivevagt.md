# Postmortem · 2026-09-26 · Billedstationens --mock kunne aldrig ramme en Supabase-RPC

## Hvad skete der?
Under billeder af SeasonEndPage (#5390) stod `POST .../rpc/get_season_recap` under `blockedWrites` i `report.json`, selv om `--mock=/rest/v1/rpc/get_season_recap=<fil>` var registreret. Siden viste sin "ingen data"-tilstand i alle billeder, og "har data"-renderingen kunne ikke fotograferes.

## Root cause
supabase-js' `.rpc()` sender ALTID `POST`, ogsaa for laesende (STABLE) Postgres-funktioner (`get_season_recap`, `get_season_honours`, `get_season_documentary_facts`, `dashboard_rider_ranking`). `mockFor()` i `scripts/lib/prShots.mjs` matchede kun `method === "GET"`, og skrive-vagten (`isWriteRequest`) besvarede alt ikke-laesende med et tomt 204. Ingen mock kunne derfor nogensinde ramme en RPC-drevet side.

## Fix
`--mock-rpc=<funktion>=<json-fil>` (eller `=status:<kode>`) i `scripts/lib/prShots.mjs` (`parseMockRpc`, `mockFor` accepterer POST+GET for RPC-mocks) og `scripts/pr-shots.mjs` (rapport, log, compose-note). Vagten er uaendret: mocken registreres som Playwright-route EFTER vagten, og sidst registrerede route koerer foerst, saa mocken svarer foer vagten ser kaldet. Kaldet naar aldrig prod. Docs: `docs/AI_OPS_REFERENCE.md` (billedstation-afsnittet) + `--help`.

## Forhindret-fremover
- Tests i `scripts/lib/prShots.test.mjs`: RPC-mock svarer paa POST og GET, kun paa sin egen funktion; en almindelig `--mock` paa rpc-stien svarer stadig kun GET; kildetekst-test paa at `installMocks` kaldes efter `installWriteGuard`.
- `--dry-run` printer `MOCK RPC <funktion> (POST /rest/v1/rpc/<funktion>)`, saa man ser FOER koerslen at mocken er af den rigtige slags.

## Laering
En "kun GET"-regel for mocks lyder sikker, men supabase-js' transportvalg (POST for funktioner) er uafhaengigt af om funktionen laeser eller skriver. Naar et vaerktoej skal fremkalde en tilstand, skal det matche det kald appen FAKTISK sender, ikke det kald der semantisk "burde" vaere en laesning. Tjek `report.json`'s `blockedWrites` foerst, naar et billede viser tom tilstand trods mock.
