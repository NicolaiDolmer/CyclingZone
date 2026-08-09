# Gates der måler relativt, fanger ikke absolutte niveauer

**Dato:** 2026-08-09 · **Issue:** [#3561](https://github.com/NicolaiDolmer/CyclingZone/issues/3561) · **Kilde:** [#3458](https://github.com/NicolaiDolmer/CyclingZone/issues/3458) fase 2 (merged 7/8)

## Hvad skete der

#3458 fase 2 skulle få klassifikatoren til at genfinde en ungdomsrytters anlæg (gate G1). Tuningen landede på `signatureBoostPerWeight: 15` og `statCeilBoosted: 99`, hvilket løftede signatur-stats +45 rå point over en base på ~48-51 og mættede dem ved loftet.

To dage senere havde prod 374 akademi-kandidater med afledt bedste evne **90 i snit** — mod 20 for seniorer og 80 for spillets 50 dyreste ryttere. Højeste markedsværdi: 42,5 mio. Fire ryttere nåede spillerhænder før det blev opdaget; 1.473.300 måtte refunderes.

## Rod-årsagen

`buildCapsForRider` gør `caps = max(potentiale-loft, current)`. Gulvet findes af en god grund (en voksen må aldrig få et loft under sin nuværende evne), men det betyder at **en tilstrækkelig høj start-evne overskriver hele potentiale-systemet**. En pot-1,0-rytter, hvis loft skulle være 35, fik caps 99.

Generatoren og loft-mekanikken var altså koblet gennem en `max()`, uden at nogen test kendte til koblingen.

## Hvorfor gates ikke fangede det

De fire eksisterende gates målte alle **relative** forhold:

- G1: genfinder klassifikatoren anlægget?
- G2: er der dybde mellem bedste og næstbedste?
- G3: matcher tildelt type den normaliserede bedste rolle?
- G4: er fordelingen over de 8 typer jævn?

Ingen af dem ser på absolutte niveauer. En rytter med evne 99 hele vejen rundt scorer lige så godt på "genfinder klassifikatoren anlægget?" som en med evne 12. Da tuningen skruede alt op, blev G1 endda **bedre** (95,6 %) — gaten belønnede det der ødelagde spillet.

Verificeret ved at genindsætte de defekte værdier: G1 og G2 består, mens de tre nye invarianter fejler.

## Læringen

**Når en gate måler et forhold, skal der findes en søster-gate der måler niveauet.** Et forholdstal kan altid opnås ved at skalere begge sider op — og hvis kun forholdet måles, er den vej gratis for en optimering.

Konkret tilføjet:

- **G5:** current må aldrig løfte `ability_caps` over det potentiale-drevne loft (100 %, ingen tolerance)
- **G6:** ingen afledt fysisk evne over ungdomsbåndet
- **G7:** højst 5 % af 16-17-årige må fødes på graduerings-niveau

Alle tre er bevist at fejle på den defekte konfiguration.

## To sekundære fælder

**Medianen skjuler halen.** Efter første rettelse lå medianerne pænt under den aftalte tabel (#2064 §2a: kerne 1/bedste 4 mod aftalens 3/6), mens 7,1 % af de 16-17-årige stadig blev født på graduerings-niveau — to tredjedele af dem med potentiale ≤ 2. En aftale formuleret i medianer skal have en gate på fordelingens top, ellers er den kun halvt håndhævet.

**Referencedata skal være rene.** Første sammenligning holdt sim-startværdier op mod prod-tal fra ryttere der havde trænet i op til tre uger, hvilket fik den gamle kalibrering til at se 1-2 point for lav ud. Den rigtige reference var de 384 kandidater der aldrig fik et hold. Spørg altid: har populationen i referencen været udsat for noget sim'en ikke har?

## Forward-guards

- `backend/lib/archetypeGenerationGates.test.js` — G5/G6/G7 kører i `node --test`
- `backend/scripts/simArchetypeCalibration3458.js` — sweep med G5/G6 over kalibreringsrummet
- `backend/scripts/dev/checkYouthBand2064.mjs` — verificerer mod §2a-tabellen som medianer
- `backend/scripts/dev/fitYouthCalibration3561.mjs` — fitter mod prod-referencen

`simArchetypeGeneration3458.js` er bevidst efterladt **rød** på G1/G3 med en forklaring i headeren: de 95,6 % var kun opnåelige ved at bryde ungdomsbåndet, og gaten må ikke "rettes" ved at skrue på stats igen. Den ægte rettelse (ungdoms-fittet klassifikations-baseline, G1 27 % → 72 % målt) ligger i [#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564).
