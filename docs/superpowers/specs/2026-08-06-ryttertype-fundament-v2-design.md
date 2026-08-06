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

**Design-princip (research-begrundet, 6/8):** Branchens to mest sammenlignelige forbilleder — Pro Cycling Manager (12-13 kontinuerte attributter → speciale-label AFLEDES) og Football Manager (attributter → rolle beregnes) — styrer IKKE efter en fast kvote pr. type; typen *emergerer* fra realistisk formede attributter. Del A følger samme princip: arketypen er en **formnings-prior for attribut-generatoren**, ikke en label der skrives direkte — klassifikatoren skal stadig selv OPDAGE typen (G1), og den emergente fordeling er gaten (G4), ikke en hård kvote.

Alle genererings-stier (akademi-intake, AI-fill, starter squads, pool-import-suppleringer) lægges om til arketype-prior-først:

1. **Træk arketype-prior** fra mål-fordelingen. Fordelingen er IKKE en smagssag — og den er heller ikke et fast tal: den AFLEDES parametrisk af tre input: (a) virkelighedens kvalitative knapheds-rækkefølge (research 6/8, kilder i afsnit 6: rouleur/domestique er pelotonens rygrad; rene GC-/TT-specialister er de sjældneste; baroudeur/brosten er delvist taktik-/terræn-roller; "rene sprintere" er en truet art — Astana kørte 2022 helt uden), (b) **MÅL-kalenderens efterspørgselsprofil** — IKKE den nuværende kalender (ejer-korrektion 6/8: den nuværende er vi utilfredse med, jf. #2177's manglende ITT/TTT, #3326's etaperækkefølge, #3371's arketype-mangel; S3-kalenderen bygges om FØR 23/8 per #3295) — via en demand-mapping (flade dage→sprinter-efterspørgsel, bjerg→climber/gc, kuperet+klassiker→puncheur, brosten→brosten, ITT/TTT→tt, rolling+udbruds-formater→rouleur/baroudeur), og (c) spillets egne principper som modifikatorer (scarcity-nedvægtning af GC/TT; gulv ~8-9 % så intet løbsformat er "dødt").

**Sekvens-krav (OPFYLDT 6/8):** S3-kalenderens mål-komposition er ejer-besluttet: **K-B gameplay-justeret** (flad 24 · kuperet 30 · bjerg 28 · ITT 8 · brosten 6 · TTT 4 — #3295, research-begrundet mod virkelige sæsoner 2023-2025). Tabellen nedenfor er formlen anvendt på K-B. Fordi fordelingen er en formel og ikke en tabel, følger den automatisk med når kalenderen senere justeres igen (kalender og population kan ikke drifte fra hinanden).

**Arbejdstal: formlen anvendt på K-B-målprofilen** (endelig finjustering i Fase 2's sim-harness; ved TTT-interim-scenariet — ITT 10/TTT 0, jf. #3295-forbeholdet — flyttes ~1 pp fra rouleur til tt):

| Type | Mål-% | Begrundelse (virkelighed × K-B-kalender × design) |
|---|---:|---|
| climber | 16 | Bjerg = 28 % af K-B-dagene; stor, veldefineret gruppe i virkeligheden (bjergetaper kræver hele klatre-hold) |
| rouleur | 16 | Pelotonens rygrad i alle kilder; limen i alle formater + TTT-motoren |
| sprinter | 14 | Flade dage = 24 % af K-B (fortsat stort, tilgængeligt format); bevidst over virkelighedens faldende trend |
| puncheur | 13 | Kuperet = K-B's største segment (30 %) — deles med baroudeur/rouleur; konsekvent hovedkategori i alle taksonomier |
| baroudeur | 12 | Reelt en taktisk rolle mange fysiologier kan bære (research); udbrudstaktik skal være bredt tilgængelig på kuperet+rolling |
| brosten | 10 | 6 % af K-B-dagene (bevidst løftet over virkelighedens 4) — dedikeret prestige-format med ægte konkurrence; Flandrien som knap markedsvare |
| gc | 9 | Bevidst i bunden: virkelighedens sjældneste rolle (1-2 pr. WT-hold) OG spillets scarcity-/prestige-driver |
| tt | 10 | ITT 8 % + TTT 4 % i K-B (mod 3,6 % i dag) — strategisk afgørende i etapeløb; knap og værdifuld |
2. **Form basis-evnerne efter arketypen** (ikke kun caps): signatur-evner trækkes fra en løftet fordeling, modsatte evner fra en sænket, neutrale uændret. Separationen skal være stor nok til at klassifikatoren OPDAGER arketypen af sig selv (se success-kriterium G1) — typen skrives ikke direkte, den skal genfindes.
3. **Hybrid-støj:** ~15 % af nye ryttere trækkes med to-arketype-blanding (giver naturlige puncheur/climber-hybrider m.m. og undgår karikatur-population).
4. `potentiale` trækkes som i dag (uafhængigt af arketype — et stort talent kan være enhver type).

### Del B — Skala-ærlighed (REVIDERET per ejer-beslutning 6/8 aften: ABSOLUT kalibrering, ikke relativ visning)

Ejeren afviste percentil-/"sammenlignet med feltet"-semantikken: ratings og potentialer skal vises som det de ER — på en absolut, stabil skala hvor samme tal betyder samme niveau i alle 8 roller og over tid (FM/PCM-princippet: sammenlignelighed bygges IND i modellen, ikke ovenpå som relativt lag).

Implementering: de 8 type-bedømmelsers output-skalaer **kalibreres én gang** (den empiriske måling 6/8 bruges til at FINDE justeringen — derefter fryses den som modelkonstant, `typeRatingCalibration.json`). Ingen automatisk/ugentlig regenerering — rekalibrering er en fremtidig design-beslutning, ikke en cron. UI-sproget er absolut ("tallene kan sammenlignes på tværs af roller"), aldrig relativt. Hjælpetekst (en+da) forklarer rekalibreringen.

**Fase 2-tilføjelse (ejer 6/8):** selve type-formlernes VÆGTE (hvilke evner definerer en fighter/bjergrytter/… og hvor meget) efterses grundigt sammen med generator-arbejdet — "modellerne skal bare blive bedre". Research-drevet som kalender-beslutningen; ingen hurtige laps.

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
- **Hård kvote-tildeling** (fravalgt, research 6/8): PCM/FM-præcedensen viser at typen skal emergere fra attributterne; en kvote der skriver labels direkte ville genskabe "pålagt identitet"-sygdommen med nye tal.

## 6. Research-grundlag (6/8 — "vi gætter ikke her", ejer-krav)

**Ærligt forbehold:** ingen offentlig kilde publicerer en optalt %-fordeling af WT-feltet på primær-speciale — tabellen i Del A er en designer-syntese af kvalitativ konsensus + vores egen kalender-måling, ikke en oversat statistik.

- ProCyclingStats' specialty-system (6 kategorier, eksplicit overlappende — klatrer-point discountes 50 % mod Hills): procyclingstats.com/info/rider-specialties. PCS' egen "single specialty riders"-side fremhæver rene enkelt-speciale-ryttere som kuriositet → multi-speciale er normen.
- CyclingScoop "Sorting Hat" (6 kategorier; Pogačar/Van Aert m.fl. beskrives som transcenderende anomalier): cyclingscoop.com/pros/what-is-specialization-cycling
- Biketips "8 Types of Road Cyclists" (tætteste match på vores taksonomi): biketips.com/types-of-cyclists-in-road-cycling-explained
- Baroudeur = taktisk rolle, ikke fysiologisk arketype: en.wikipedia.org/wiki/Breakaway_specialist
- "Pure Sprinters: Endangered Species" (Astana 2022 uden én ren sprinter): velo.outsideonline.com
- Holdstørrelser/GT-truppe-logik: theconversation.com (domestiques-sprinters-and-climbers), biketips.com, inrng.com, radmarkt.com
- PCM's attribut→afledt-speciale-model: web.cyanide-studio.com (PCM 2021 guide, basics-specialisations)
- FM's attribut→rolle-model: fmscout.com, fmdossier.dev
- Egen kalender-måling (SQL 6/8): 2.208 løbsdage fordelt flat 32,0 / mountain 23,2 / hilly 18,8 / high_mountain 8,1 / rolling 6,3 / cobbles 4,6 / itt 3,5 / classic 3,5 / ttt 0,1 %.
