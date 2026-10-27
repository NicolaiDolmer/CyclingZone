# #7290 (trin 2 af #7289): motoren kører bakkerne fra højdeprofilen

Status: design + målt baseline før kode (AGENTS 36). Bag en slukket kontakt; kun regel-revision `s5_profiles_v3`.
Tal og løbsnavne er private (hard rule 17): `OneDrive/CyclingZone-context/private-handoffs/7289/`.

## 1. Problemet

Etaper-fanen tegner `race_stage_profiles.elevation_profile` (#6594). Serien placerer hele etapens
`elevation_gain_m`, også den del der ikke hører til en kategoriseret stigning ("vejens bølgen", #6366).
Motoren læser kun `segments` (`engine/v4/adapters/routeAdapter.ts`). Rutegeneratoren fylder hullerne
mellem stigningerne ud fra profiltypen: flade etaper (og brosten, tidskørsler) får `flat`, de bakkede
og bjergetaperne får `rolling`. En flad etape kan derfor være næsten ét langt `flat`-segment, mens
profilen spilleren ser har mange korte bakker. Spilleren ser én etape, motoren kører en anden.

Read-only gennemgang af S5-eksporten (alle etaper har både `segments` og `elevation_profile`):
de flade etaper bærer en stor del af deres højdemeter på `flat`-segmenter, fordelt som glatte
bølger af få kilometers længde. De fleste bølger er svage; en mindre del er rigtige bakker
(stigende strækninger på flere procent over mere end en kilometer). Bakkede og bjergetaper er
allerede `rolling` mellem stigningerne, så for dem ændrer dette intet.

## 2. Valgt løsning (A): bakkerne bliver `rolling` på de flade strækninger

Under `s5_profiles_v3` og kun når kontakten er tændt afleder adapteren korte bakke-segmenter fra
højdeprofilen:

1. Profilen læses som gitter (`h`, ét punkt pr. skridt over hele distancen). En profil der ikke
   passer til etapens distance, ignoreres (fail-safe: ruten er uændret).
2. Kun skridt hvis midtpunkt ligger i et `flat`-segment tæller. Stigninger, nedkørsler, brosten
   og eksisterende `rolling` har forrang og røres ikke. Afslutningsrampen (`sprints[].ramp_km`
   på finish, når den ikke ligger i en stigning) er udelukket: finalen modellerer den allerede.
3. En bakke er en sammenhængende stigende strækning inden for ét `flat`-segment, med en
   gennemsnitsstigning og en samlet stigning over hver sin tærskel (konstanterne står i
   `routeProfileHills7289.ts`). Svage bølger forbliver `flat`.
4. Hver bakke skæres ud af sit `flat`-segment som et `rolling`-segment (km afrundet som resten af
   adapteren). Resten af `flat`-segmentet består. Derefter kører den eksisterende opdeling af
   lange flade/rullende segmenter (#5812) som før.

Hvorfor `rolling` og ikke en ny stigning: motoren har allerede et terræn for bølget vej (højere
krav, mindre læ, lavere fart, samme indsats-regel som på stigning, #4914/#6641). Generatorens
egen kontrakt er at en ukategoriseret bakke ligger under kategoriserings-loftet; en `climb`
kræver en kategori og udløser M2-selektionen, finale-genkendelsen (sidste segment er en
stigning), nedkørsels-samlingen (#6486) og tidsmodellens "efter første stigning". Det ville
flytte langt mere end bakkerne og ramme G19.

Forkastet (B): ukategoriserede stigninger som `climb` uden kategori. Kræver en ændring af
`ClimbSegment`-kontrakten og alle tabeller pr. kategori; kan genovervejes hvis målingen viser at
A ikke flytter sprinternes chancer nok på de bakkede flade etaper.

## 3. Kontakten

- Adapter-option: `routeFromStageProfileRow(row, { profileHills })`. Default er rækkens egen
  markør `routeProfileHills === true`, ellers fra. Uden markør og uden option er ruten byte for
  byte som før (test).
- Markøren sættes af `backend/lib/routeProfileHillsFlag.js` på etape-rækkerne, kun når
  app_config-flaget `route_profile_hills` er tændt OG løbets regel-revision er `s5_profiles_v3`
  eller senere. Fail closed: fejl i opslaget = slukket.
- Hvorfor en markør på rækken: broen (`raceEngineV4Bridge.js`) kalder adapteren med rækken alene,
  tre steder (ruten, løbskonteksten, klassementsetaperne). Markøren følger rækken alle tre steder
  uden at broen ændres, og den ligger i motor-inputtet som genafspilningen (#1857) gemmer, så en
  genafspilning kører samme rute.
- Run-identitet: `input_checksum` får `profileHills: true` kun når markøren er sat (som
  `formPeaks: false` for #6156), så tændt og slukket aldrig deler identitet, og alle eksisterende
  checksums er uændrede.
- Koblingen i `raceRunner.js` er ikke en del af denne PR (filen ejes af #6649). Den præcise
  kobling står i KLAR-meldingen på #7153.

## 4. Måling (før tænding)

S5-eksporten, `motorTestport --from-dir`, revision `s5_profiles_v3` mod sig selv, kontakt fra
(eksporten som den er) og til (samme eksport med markøren på alle etaper), samme seeds,
`--track-fatigue`, privat tærskelfil (`v3-bands-2026-10-25`). Benchen (`s5MotorBench`) bruger sine
egne fiksturer og påvirkes ikke.

Det der sammenlignes:
- Hvem vinder de flade etaper: sprinternes andel af etapesejrene, særligt på flade etaper med
  mange højdemeter på de flade strækninger.
- Hvem vinder de bakkede etaper og bjergetaperne (bør være uændret, da de allerede er `rolling`).
- Gates G16, G17, G18, G19 og gcFromBreakaway må ikke blive værre.

Baseline (kontakt fra) er målt før koden og ligger privat. Resultatet med kontakten til ligger samme
sted. Ejeren ser tallene og giver go før tænding.

## 5. Ikke i denne PR

- Koblingen i `raceRunner.js` (flag-opslag, markør, checksum) — efter #6649 er merget.
- `stageFlagCatalog.js` (flaget i admin-oversigten) — samme omgang som koblingen.
- Bakker på `rolling`-strækninger eller flade strækninger på bakkede etaper (profil → `flat`).
- Ingen patch note (ingen spillerændring før tænding).
