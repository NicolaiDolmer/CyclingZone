# Postmortem · 2026-08-04 · #3345 værdi-refit blokeret — V4 er live (ikke V3), og V3-anchors er permanent knækket

## TL;DR
Fik til opgave at re-fitte værdimodellen (`scripts/fitRiderValuationModel.js` mod `riderValuationAnchors.json`) efter #3325's ryttertype-reklassificering. To uafhængige, verificerede blokeringer gjorde det umuligt at levere en gyldig re-fit:

1. **V3 er shadow, ikke live.** `predictBaseValue` dispatcher til V4 (`riderValuationModelV4.json`) når `model.version >= 4` — og `riderValueRefresh.js` (den faktiske trænings-tick-sweep der skriver `base_value`/`market_value` i prod) loader ALTID V4, aldrig V3. Et V3-refit rører derfor intet spillerne rent faktisk ser.
2. **V3's anchor-mekanisme har været død siden 2026-06-27**, uafhængigt af #3325: alle 26 navngivne anchor-ryttere (Tadej Pogačar m.fl. — PCM-import-data) blev permanent slettet i en ejer-godkendt oprydning (`database/2026-06-27-purge-pcm-and-pre-relaunch-riders.sql`, commit `c03ebac5`). `fitRiderValuationModel.js` resolver 0/26 anchors mod prod i dag.

I stedet for at forcere et resultat: byggede et read-only måle-harness der viser den ÆGTE, u-mitigerede risiko på V4 (den faktiske model) — total `market_value` falder **-24,5%** hvis backfillen kører uden nogen valuation-ændring, langt uden for ±5%-scorecardet. Rapporterede dette som en ny blocker på #3345 i stedet for at aflevere en re-fit der ikke rørte den rigtige model.

## Hvad blev bedt om
"Re-fit med `scripts/fitRiderValuationModel.js` mod `riderValuationAnchors.json` EFTER omklassificeringen. Mål før/efter på hele populationen. Ram ±5%." — formuleret ud fra issue #3345's egen analyse, som citerer `riderValuation.js:10`'s v3-formel som "modellen".

## Hvorfor det virkede ikke som antaget

### 1. V3 vs. V4 — den forkerte model var i fokus
`backend/lib/riderValuation.js`'s `predictBaseValue(rider, abilities, model)` er en DISPATCHER: `if (Number(model?.version) >= 4 && model?.fit) return predictBaseValueV4(...)`. #2594-cutover (dokumenteret i `riderValueRefresh.js`'s egen header: "modellen er nu v4") betyder at ALLE produktions-skrivestier — `refreshChangedRiderValues` (daglig trænings-tick, `trainingSweep.js` + `api.js:1976`), `runBaseValueBackfill` (`backfillCores.js`) — loader `riderValuationModelV4.json` som default, ALDRIG v3-filen.

`riderValuationModel.json` (v3) lever videre som SHADOW: `fictionalLaunchPopulation.test.js` (deraf PR #3343's "12→5, 203→105"-tal — de er v3-tal på en FIKTIV testpopulation, ikke prod), og nogle admin/preview-diagnostik-stier i `api.js` (eksplicit navngivet `v3Value` til sammenligning).

Issue #3345 citerede v3-formlen fordi den er den der er DOKUMENTERET i `riderValuation.js`'s filhoved-kommentar — men filhoved-kommentaren er skrevet til v2/v3-æraen og aldrig opdateret til at nævne V4-dispatchen tydeligt nok til at forhindre forvirringen. Selve mekanismen (offset[type] + type-afhængig blendedOutput) findes IDENTISK i V4's `predictBaseValueV4` (`riderCareerNpv.js`) — faktisk MED en tredje type-afhængighed oveni (V3 har 2: offset + O; V4 har 3: offset + O + `buildCaps(abilities, type, potentiale)` som styrer hele karriere-fremskrivningen) — så problemet #3345 beskriver er reelt STØRRE i den model der faktisk er live.

### 2. V3-anchors var allerede dødt værktøj
`riderValuationAnchors.json` matcher anchors MOD LIVE `riders`-tabellen via navn (`riders.find(x => norm(...).includes(key))`). De 26 referencerytterne var PCM-import-data (rigtige pro-ryttere brugt som kalibreringsreference) — slettet i en fuldstændig, ejer-direktiveret oprydning 5 uger FØR denne opgave (`c03ebac5`, "vi skal ikke have gammel ligegyldig historik gemt"). Sidste vellykkede v3-fit: 2026-06-17 — FØR sletningen. Ingen har kørt `fitRiderValuationModel.js` mod prod siden, fordi ingen har haft brug for det (V4 er live).

Konsekvens: selv UDEN #3325's reklassificering ville `fitRiderValuationModel.js` exit(1) mod prod i dag ("For få anchors fundet (0)"). Dette er ORTOGONALT til #3325 — men blev først synligt fordi #3345 var den første opgave siden 6/27 der faktisk prøvede at køre scriptet.

## Hvad blev leveret i stedet
`backend/scripts/measureValuationImpactAfterRiderTypeReclassification.js` — read-only harness der:
- Beregner NY `primary_type` for hele den aktive population (samme klassifikator + caps-baseline som #3343 committer) UDEN at skrive noget (backfillen er stadig ikke kørt).
- Sender BÅDE gammel type (persisteret) og ny type gennem BÅDE V3 og V4 (u-rørte, da ingen kunne re-fittes gyldigt) og rapporterer total/median/p90/tiers.
- Måler: V3 total -48,4%, V4 total -24,5% (V4 er det reelle tal). 239/367 rigtige hold ville se ≥10% squad-værdi-skift. Se PR/#3345-kommentar for fuld tabel.

## Læring
1. **"Modellen" i en kodebase med et pågående cutover er ikke entydig.** Et issue der citerer en formel fra en fil-header uden at verificere hvilken model der faktisk kører i den skrivende sti, kan pege på den forkerte model. Verificér ALTID hvilken kode-sti der faktisk skriver til DB (`grep` efter den skrivende funktion, ikke kun den model-fil et issue nævner) FØR du planlægger et fix — særligt i en kodebase med en dokumenteret cutover-kommentar ("#2594 CUTOVER") der er let at overse hvis man kun læser `riderValuation.js`'s header.
2. **En kalibrerings-mekanisme der matcher LIVE data ved navn har ingen levetids-garanti.** `riderValuationAnchors.json`s design (match mod `riders` ved navn) antog implicit at de navngivne referenceryttere ville blive ved med at eksistere. En helt urelateret, legitim oprydnings-migration (#1933) fjernede dem stille — ingen test eller CI-gate fangede at kalibreringsværktøjet døde, fordi V4-cutoveren allerede havde gjort V3 til shadow, så INGEN kørte scriptet i ugerne derefter. **Forward-guard-forslag:** kalibrerings-anchors der afhænger af specifikke DB-rækker bør enten (a) snapshotte de rå input-tal (abilities) DIREKTE i anchor-filen i stedet for at live-lookup'e dem, eller (b) have en committed smoke-test der kører scriptet i dry-run-mode mod prod i CI/nightly, så et brud opdages ved kilden i stedet for 5+ uger senere af en urelateret opgave.
3. **"Mål før/efter og ram ±5%" forudsætter at et gyldigt re-fit er MULIGT.** Når det ikke er (som her, to uafhængige blokeringer), er den rigtige handling at måle med de EKSISTERENDE, u-rørte koefficienter (det ægte "hvad sker der hvis vi bare backfiller" scenarie) og rapportere det ærligt, ikke at antage re-fit-stien virker og aflevere et resultat der aldrig blev valideret mod den model der faktisk styrer prod.

## Relateret
Forlænger [2026-08-04-rider-type-classifier-collapse-and-caps-circularity.md](2026-08-04-rider-type-classifier-collapse-and-caps-circularity.md)s pointe 3 ("`offset[primary_type]` gjorde typen økonomisk relevant") med det konkrete, målte tal og opdagelsen af at det er V4 — ikke V3 — der er den økonomisk relevante model. #3345, #3325, #3343.
