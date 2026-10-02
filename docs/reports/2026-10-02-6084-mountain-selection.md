# #6084: Bjergetaper holder samlet til finalen under `orders_gc_v2`

Dato: 2. oktober 2026. Refs #6084, #6075, #5957.

Rapporten er kvalitativ, fordi repoet er offentligt. Tal, konfigurationer og harness-output ligger privat i `balance-internals/6084/` (gitignoreret): `RESULTS.md`, `analyze6075.mjs`, `summarize6075.mjs`, `calibrate.mjs`, `cal-compare.mjs`, `identity.mjs`, `sweep.sh`, `sweep-cal.sh` og JSON-filerne.

## Hvad er bygget

En ny regel-revision `orders_gc_v2` = hele `orders_gc_v1`-pakken plus forslag B og A fra #6075 på bjerg- og højfjeldsetaper. Nye løb bindes stadig til `orders_gc_v1`. Skiftet er et separat ejer-go.

Revisionen skelner mellem stigningerne **før finalestigningen** og **finalestigningen** (etapens sidste blok af sammenhængende stigningssegmenter):

- **B, blødere selektion før finalestigningen**: en tom reserve tvinger kun en rytter af på en alvorlig stigning, og split-tærsklen er højere. De to håndtag ændres sammen. Hver for sig flytter de næsten intet (#6075).
- **A, tempoet mod udbruddet før finalestigningen**: på stigningerne flytter favoritgruppens klatretempo ikke længere hullet til dagens udbrud. Kun jagten gør, ligesom på fladt og rullende terræn.
- **Jagten kalibreret med**: `orders_gc_v1`'s lad-gå-balance var sat til at kompensere for den tidlige elitegruppe. Når feltet holder samlet, giver feltet udbruddet mindre plads. Jagten før finalestigningen er kontrolleret, og på finalestigningen jager favoritternes hold for alvor. En GC-reaktion mod et farligt udbrud jager altid udæmpet.

Finalestigningens selektion og tempo er uændrede.

## Ejer-målene

Målt på samme to harnesses som #6075 (proxy: låst population og proxy-etaper med AI-ordrer; replay: S4-bjerg- og højfjeldsetaperne fra #5957), plus etapeløb med klassement (`calibrate.mjs`).

1. **Favoritgruppen ved foden af finalestigningen**: medianen ligger nu inden for eller tæt på målet (ca. 15-25) i begge harnesses, mod en lille håndfuld i dag. Spredningen mellem etaperne er stor: en etape uden en rigtig stigning før finalen kommer med næsten hele feltet til foden, og en etape med en hård stigning tidligt giver stadig en lille gruppe. Det er realistisk, men betyder at "typisk" er en median, ikke en garanti for hver etape.
2. **Fangsten sker typisk på finalestigningen**: tydeligt flertal i proxy, og også flest i replay. Fangsten sker markant tættere på mål end i dag.
3. **Udbruddet foran favoritterne ved mål**: på niveau med i dag i både proxy og replay.

Top-10-spredningen på bjergetaper falder tydeligt, og de bedste klatrere taber mindre tid. Det var #5957's klage.

## Hvad ellers ændrer sig

- **Kuperede og alle andre profiler**: byte-identiske med `orders_gc_v1` (verificeret på alle golden fixtures og alle proxy-etaper).
- **Specialist-korrelationen** (replay5957, klatreevne mod placering): højfjeld uændret, bjerg en anelse lavere, men stadig over prod-niveauet fra S4.
- **Etapeløb med klassement**: på bjergetaper vinder en udbryder lidt oftere, og en klassementsrytter i udbruddet tager oftere førertrøjen. Det følger af, at favoritterne nu kommer samlet til finalen i stedet for at have knækket feltet tidligt. Det bør ses af ejeren før aktivering.
- **Legacy og `orders_gc_v1`**: byte-identiske med main før ændringen (verificeret mod origin/main's motor på fixtures og proxy-etaper i begge revisioner, og låst af tests).

## Sådan er det låst

- Kontrakt: `orders_gc_v2` er kendt, `CURRENT_RACE_RULES_REVISION` er uændret, broen bærer v2 med samme GC-kontekst som v1, og migrationens CHECK-liste matcher de kendte revisioner (`raceEngineRulesRevision.test.ts`).
- Motoren: fasen findes kun under `orders_gc_v2` på bjergprofiler, selektionen er blødere før og uændret i finalen, tempo-neutraliseringen rammer kun dagens udbrud og kun med en andel, og uden for bjerg er v2 = v1 (`mechanics/mountainSelection.test.ts`).
- Golden fixtures (legacy) er uændrede.

## Hvad målingen ikke dækker

- Træthed fra etape til etape ud over det, `calibrate.mjs` modellerer.
- Replay-felterne bruger rytternes nuværende evner, ikke evnerne på løbsdagen.
- Løbsfilm og tidslinjetekster er ikke vurderet. De følger motoren.
- Størrelsen af favoritgruppen er følsom over for split-tærsklen. En lille ændring kan give en stor ændring. Det er værd at holde øje med ved senere tuning af selektionen.
