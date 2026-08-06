# Ryttertype-fundamentet v2 — design-spec

**Status:** Udkast til ejer-godkendelse (retning nikket 6/8 i chat; denne spec er den fulde plan).
**Ejer-mandat:** "Jeg vil have, at vi faktisk har styr på ryttertyperne en gang for alle" (6/8).
**Refs:** #3372 (efterskælv + målinger), #3325/#3343 (type=potentiale, "ren B"), #2720, #3448 (markedsmodellen forbruger typen som datapunkt).

## 1. Problemet, målt (alle tal 6/8, read-only mod prod, n=6.674-6.711 human-ejede)

1. **Skalaerne lyver på tværs:** de 8 viste type-ratings er ikke sammenlignelige — baroudeur/gc-formlerne giver strukturelt høje tal for næsten alle. Tildeles alle deres rå argmax-rolle, kollapser spillet til 92 % i to typer (baroudeur 77 %, gc 15 %) — #3325-sygdommen i ny forklædning.
2. **Populationen er udifferentieret:** percentil-normaliseres skalaerne, spreder argmax sig pænt — men specialiserings-dybden (bedste minus næstbedste rolle-percentil pr. rytter) har **median 0** (61,6 % har bogstaveligt 0). Showcase: en "klatrer" (potentiale 5,5) ligger 91.-93. percentil i alle 8 roller.
3. **Konsekvens:** typen er et label der PÅLÆGGES (rolle-faktorerne i `buildCapsForRider` skaber først specialiseringen efter tildelingen), ikke en identitet der OPDAGES. Kun 21 % af rytterne har deres tildelte type som rå-bedste rolle; 10,6 % under normaliseret skala. Enhver reklassificering føles derfor arbitrær for spillerne.
4. **Peak-talent er dog bevaret** (vigtig kontekst for kommunikation): 5/8-backfillen kostede ingen rytter mere end 5 point af sit bedste loft; store talenter (potentiale ≥6) er matematisk urørte.

Måle-harness (genbruges som QA-gates): `backend/scripts/measureBestType3372.js`, `measureNormalizedTypes3372.js`, `measurePeakTalent3372.js`, `measureCapsShift3372.js`.

## 2. Design

### Del A — Arketype-generation (nye ryttere fødes MED identitet)

Alle genererings-stier (akademi-intake, AI-fill, starter squads, pool-import-suppleringer) lægges om til arketype-først:

1. **Træk arketype** fra en mål-fordeling (ejer-justerbar konfiguration; startbud: sprinter 18 % · climber 22 % · tt 12 % · puncheur 12 % · baroudeur 12 % · brosten 8 % · rouleur 8 % · gc 8 % — ingen type under 5 %).
2. **Form basis-evnerne efter arketypen** (ikke kun caps): signatur-evner trækkes fra en løftet fordeling, modsatte evner fra en sænket, neutrale uændret. Separationen skal være stor nok til at klassifikatoren OPDAGER arketypen af sig selv (se success-kriterium G1) — typen skrives ikke direkte, den skal genfindes.
3. **Hybrid-støj:** ~15 % af nye ryttere trækkes med to-arketype-blanding (giver naturlige puncheur/climber-hybrider m.m. og undgår karikatur-population).
4. `potentiale` trækkes som i dag (uafhængigt af arketype — et stort talent kan være enhver type).

### Del B — Skala-ærlighed (visningen)

`buildTypeCeilingBands` (scout-rapporten) og øvrige flader der viser type-ratings side om side, viser fremover **percentil-normaliserede** tal: "84" betyder "bedre potentiale i rollen end 84 % af feltet" — samme betydning i alle 8 roller. Implementering: kvantil-tabel pr. type, genberegnet ugentligt (kan bo i søndags-sweepen fra #3448 — samme kadence-filosofi), committet som JSON-artefakt så visningen er deterministisk mellem genberegninger. Hjælpetekst (en+da) forklarer skalaen.

### Del C — Eksisterende ryttere: INGEN tredje rystelse

- `primary_type`/`secondary_type`, `ability_caps`-forme og `potentiale` for eksisterende ryttere RØRES IKKE.
- Kun deres VISTE tal skifter (Del B) — og det kommunikeres som del af den samlede pakke (den parkerede #3372-kommunikation opdateres og sendes FØRST når Del B er live, jf. ejer-beslutning 6/8: én forstyrrelse, ét sammenhængende system).
- Populationen konvergerer naturligt mod arketype-verdenen via udskiftning (pension/intake).

## 3. Success-kriterier (måles FØR ship, gates i harness)

| # | Kriterium | Mål |
|---|---|---|
| G1 | Nygenererede: klassifikatoren genfinder arketypen | ≥90 % |
| G2 | Nygenererede: specialiserings-dybde (bedste−næstbedste percentil) | median ≥8 point |
| G3 | Nygenererede: tildelt type = normaliseret bedste rolle | ≥90 % |
| G4 | Fordeling over 8 typer (nygenererede, n≥1.000 sim) | ingen type <5 % eller >30 % |
| G5 | Eksisterende ryttere: caps/type/potentiale uændret | 100 % (diff mod snapshot) |
| G6 | Eksisterende ryttere: tildelt type i normaliseret top-3 (med LIVE caps, ikke kontrafaktisk) | måles; rapporteres til ejer — forventet markant bedre end 10,6 %-tallet fordi rolle-faktorerne har formet deres caps |
| G7 | Ingen regression i værdimodel/marked (#3448-fittet re-valideres på ny skala) | holdout-MAE ±5 % |

## 4. Faser

1. **Fase 1 — Del B (skala-ærlighed):** kvantil-tabel + visning + hjælpetekst. Lille, isoleret, gør alle senere målinger læsbare. Inkl. G5/G6-måling.
2. **Fase 2 — Del A (generatoren):** arketype-trækning + evne-formning + sim-harness (1.000+ genererede ryttere → G1-G4). Rammer akademi-intake først (størst spiller-synlighed), derefter AI-fill/starter.
3. **Fase 3 — Kommunikation:** den opdaterede spillerkommunikation (inkl. peak-talent-beviset) sendes efter Fase 1 er live. Patch notes + help.json (en+da) pr. fase.

Hver fase = egen PR med simulér-før-ship-bevis i PR-body. Ingen prod-mutation af eksisterende ryttere i nogen fase.

## 5. Risici og fravalg

- **Percentil-drift:** normaliserede tal flytter sig når populationen flytter sig (en rytter kan "falde" uden at blive dårligere). Mitigeret: ugentlig (ikke daglig) genberegning + hjælpetekst der forklarer relativiteten. Fravalgt alternativ: fast kalibrering (ville rådne over tid).
- **Argmax-tildeling** (ejer-spurgt, målt, afvist): genskaber kollapset (92 % i 2 typer).
- **Re-klassificering af eksisterende** mod ny generator-baseline: fravalgt — tredje rystelse uden spillerværdi.
