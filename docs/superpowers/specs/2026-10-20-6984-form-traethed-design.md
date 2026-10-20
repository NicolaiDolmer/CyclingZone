# Form og træthed 2.0 (#6984): design

**Status:** ejer-beslutninger B1-B5 taget og låst 20/10 2026 (§9). Byg bag flaget `condition_model_v2`; intet tændt, ingen prod-skrivning.
**Tal:** alle målinger, konstanter og simuleringer ligger privat i `balance-internals/6984/` (hard rule 17). Denne spec indeholder kun mekanik og retning.
**Relateret:** #5928 (én opgørelse pr. dato) · #5884 (formmål 29/9) · #3413 (udbrud er gratis) · #6156 (form og formtoppe i v4 fra S5) · #6110 (Udvikling 2.0) · #6649 (dagsform).
**SSOT:** [`docs/TRAINING_RULES.md`](../../TRAINING_RULES.md) §5 (restitution, form og skader) og [`docs/RACE_ENGINE_RULES.md`](../../RACE_ENGINE_RULES.md) (løbsmotorens input). Begge opdateres i byg-PR'en, så de beskriver v2 bag flaget; denne spec ændrer dem ikke.

## 1. Problemet

Spillerne (staff, 20/10) melder, at ryttere kan holdes på fuld form og næsten ingen træthed, også gennem en Grand Tour, og at man derfor kan køre alle tre Grand Tours på fuld styrke. Ejeren 20/10: "Alle tilvalg har også et fravalg."

## 2. Målt baseline (offentlig version)

Målt read-only i prod 20/10 på Vuelta-feltet (første to afregnede GT-datoer), de to tidligere S4-GT'er og en kontrolgruppe af alle øvrige ryttere. Tallene ligger i `balance-internals/6984/baseline-og-konstanter-2026-10-20.md`.

- **Påstanden er delvist bekræftet.** Omkring halvdelen af Vuelta-humanrytterne står på (næsten) fuld form, og en stor andel ligger tæt på nul træthed. Ikke alle: ryttere, der træner hårdt på datoens frie pladser, ligger midt på skalaen. Men selve Grand Touren flytter næsten intet. En dato med fire etaper gav en træthedsstigning på få point i gennemsnit.
- **Spillerens valg på de frie pladser styrer næsten alt.** Hvile eller restitution på de frie pladser holder rytteren nede nær nul gennem en GT. Recovery-evnen gør kun en lille forskel.
- **Form stiger næsten altid.** I hele populationen steg formen på langt de fleste rytter-datoer siden 30/9. Formen falder kun, når trætheden er høj, og det sker sjældent.
- **#5928 virker som bygget:** tilstanden opdateres én gang pr. dato, og formen springer ikke længere. Men den samme normalisering er rod-årsagen nedenfor.

## 3. Rod-årsag (kode)

1. **En etape vejer 1/5 døgn.** `backend/lib/trainingDateCondition.js:35-38` tager gennemsnittet af datoens fem pladser (træning og etaper) og kører én restitution. Det var rigtigt for træning (fem træningspas = én dags træning, ejerens ønske 29/9), men det dividerer også etapens belastning med fem. En GT på seks datoer får dermed belastning svarende til få døgn, men seks fulde restitutioner.
2. **Én hvileplads udligner en etape.** Hvile har en stor negativ belastning (`backend/lib/dailyTraining.js:27`), og den indgår i samme gennemsnit som etaperne.
3. **Inaktivitet bygger form.** `backend/lib/riderCondition.js:67-70` (`nextForm`) giver plus under formzonen og i zonen; minus kun ved høj træthed. Det strider mod ejerens formmål 29/9 (#5884): "længere inaktivitet og overbelastning svækker den".
4. **Recovery-evnen betyder lidt.** `backend/lib/riderCondition.js:39-42`: evne-leddet er lille, og den proportionale andel er ens for alle.
5. **Ingen ophobning mellem dagens etaper.** Under dato-modellen køres alle etaper på samme dato på åbningstrætheden (`backend/lib/raceRunner.js:963-973`, `raceFatigue.js:79/84` med `trainingOwnsRecovery`).
6. **GT-akkumuleringen fra 15/10 drukner.** `backend/lib/raceFatigue.js:184-193` (kun `s5_profiles_v1`) gør sene etaper dyrere, men tillægget divideres med fem i punkt 1.
7. **Ingen sæsonbelastning** findes.

## 4. Mål (spillernes seks krav, #6984)

| # | Krav | Hvordan designet svarer |
|---|---|---|
| 1 | Træthed pr. etapetype og længde | §5.2 profiltabel med større spænd + længdefaktor |
| 2 | Sæsonbelastning | §5.3 glidende tillæg pr. løbsdag i sæsonen |
| 3 | Restitution og modstandskraft betyder mere | §5.4 recovery-evnen styrer også den proportionale restitution |
| 4 | Indsats og mislykkede angreb koster | §5.5 genbrug af indsats og frontarbejde + tillæg for hentet udbrud |
| 5 | Simpelt og forudsigeligt | §5.7 én forklaring, forventet belastning vist før etapen |
| 6 | Muligt at holde rytterne under 100 | §5.8 hvile på frie pladser og spareordre skal kunne holde en GT-rytter under grænsen |

## 5. Design

Alt bag **ét flag**: `condition_model_v2` (app_config, samme mønster som `training_condition_per_date`, med aktiveringsdato). Flag off = bit-identisk med i dag.

### 5.1 En etape er en løbsdag for kroppen
Opgørelsen pr. dato bevares (#5928). Inden for datoen:
- Etaperne tages ud af gennemsnittet med træningen og regnes hver for sig som en løbsdag for kroppen: etapens belastning lægges til, og rytteren restituerer imellem, i etapernes rækkefølge.
- De frie pladser regnes som i dag.
- En dato uden etaper giver præcis samme resultat som i dag. Træning bliver ikke dyrere.
- B1 (ejer 20/10): en etape vejer et helt døgn. Kalibreringen står privat i `balance-internals/6984/`.

Konsekvens: en dato med flere etaper føles som flere hårde dage. Det er det, spillerne kaldte "S4 virkede": hviledage skal times.

**Etapernes rækkefølge inden for datoen (§3 punkt 5)** følger med: etape 2 køres på trætheden efter etape 1. B2 (ejer 20/10): med. Det er en ændring i løbsmotorens input og kræver derfor en regel-revision (mønster fra #5955) ud over flaget.

### 5.2 Profil og længde
- Profiltabellen får større spænd mellem flad og højbjerg, i spillernes rækkefølge: flad < bølget < kuperet < klassiker/brosten/grus < mellembjerg < bjerg < højbjerg; enkeltstart lidt over flad.
- Længdefaktor omkring en normaletape: korte etaper lidt billigere, lange lidt dyrere. Enkeltstarter får ingen længdefaktor (distancen er allerede lille).
- Stigningernes antal og størrelse er IKKE med i første version (holder det simpelt; kan lægges på profilen senere).

### 5.3 Sæsonbelastning
- Hver rytter tæller sine løbsdage i sæsonen (samme tal som Udvikling 2.0's løbsbremse, D4 i #6110, så der findes én kilde).
- Efter et antal frie løbsdage bliver hver etape glidende dyrere, op til et loft. Ingen trappe (samme princip som ejerens D4-valg 11/10).
- Tælleren nulstilles ved sæsonskiftet.
- Effekt: den tredje Grand Tour er klart hårdere end den første for en rytter, der har kørt de to andre. Man kan godt køre alle tre, men ikke på fuld styrke.

### 5.4 Restitution og modstandskraft
- Recovery-evnen styrer både det faste fradrag og den andel af trætheden, der forsvinder pr. døgn. En middel-rytter restituerer som i dag; en rytter med høj recovery restituerer klart hurtigere, en lav klart langsommere.
- Hvile på datoens frie pladser under en GT (kalenderen har ingen hele hviledatoer midt i en GT, CALENDAR_RULES 15/10) giver dermed mest til de ryttere, der er bygget til det.

### 5.5 Indsats koster
- Genbruges: indsatsordren (`effortFatigueMultiplier`, hjælper der arbejder > normal > spare > grupetto) og frontarbejdet (`stageWorkExposure`: andel af etapen i udbrud, alene eller i jagtgruppe) fra #5928/15-10-pakken.
- Nyt: **et udbrud, der hentes**, koster et ekstra tillæg oven i frontarbejdet (ejeren 09:30, #3413). Et udbrud, der kommer hjem, koster kun frontarbejdet.
- At føre feltet hele dagen på flad (hjælper med arbejdsordre) kan koste mere end at sidde med i bjergene. Det følger af frontarbejde × indsats og kræver ingen særregel.
- GT-akkumuleringen fra 15/10 bevares som mekanik, men skrues ned, fordi fuld belastning pr. etape nu selv hober sig op (tal privat).

### 5.6 Form
Formen skal bygges af passende aktivitet og svækkes af både inaktivitet og overbelastning (ejermål 29/9, #5884):
- Meget lav træthed i længere tid (ren hvile): formen falder langsomt.
- Let belastning: formen står stille.
- Passende belastning (formzonen): formen stiger; de sidste point mod toppen stiger langsommere.
- Høj træthed: formen falder, mere jo højere.
- Stadig én ændring pr. dato og små skridt (ingen store formfald på én dag).

Konsekvens: fuld form kræver planlægning, og en hård GT tærer på formen. Det er forudsætningen for, at formtoppe (#6156) betyder noget fra S5: står alle på fuld form, kan en top intet løfte.

### 5.7 Simpelt og forudsigeligt
Forklaringen til spilleren er én sætning: *"Hver etape koster træthed efter type, længde og arbejde; jo flere løbsdage i sæsonen, jo dyrere; recovery afgør, hvor hurtigt det går væk."*
- Holdudtagelse og etapesiden viser forventet belastning som kategori (lav/middel/høj/meget høj), ikke tallet. Lidt "fog of war" er ok (friisisch 09:27).
- Rytterens side viser sæsonens løbsdage og om sæsonbelastningen er begyndt.
- Ugeprognosen (`trainingWeekPlanForecast.js`) bruger samme afregningsfunktion som aftenen. Før etapen er arbejdet ukendt (frontarbejde, hentet udbrud, indsatsen motoren kører), så prognosen antager normal indsats og intet frontarbejde og vises som et "ca."-estimat. Testen kræver paritet for kendte input (registrerede belastninger), ikke for etaper der endnu ikke er kørt.
- help.json (EN+DA) + patch note ved tænding. Discord-opslag kun EN.

### 5.8 Stadig muligt at holde under 100
To adskilte krav, der testes hver for sig i harness:
- **Garantien (spillerkrav 6):** en rytter med middel recovery, der kører en hel GT på normal indsats og hviler på alle frie pladser, slutter under 100 i træthed.
- **Skadeeksponering (egen gate):** andelen af rytter-datoer over skadegrænsen (70, `riderCondition.injuryFatigueFloor`, hvor trænings-skaderisikoen starter) måles og vises ejeren som G2; den er ikke selve garantien.

En rytter, der træner hårdt på de frie pladser og har mange løbsdage bag sig, kan godt nå 100. Spareordre og hvile på de frie pladser (især på de lette GT-datoer) skal kunne bringe en rytter tilbage under grænsen.

## 6. Samspil

- **Formtoppe (#6156, tændes ved S5):** toppen lægges oven i rytterens form. Med v2-form står færre på fuld form, så toppen mærkes. Formtoppens dyk efter vinduet bevares. Test fra #6158: S4-toppe må ikke give formdyk i S5.
- **Udvikling 2.0 (#6110):** løbsdagstælleren deles med D4 (løb bremser tilbagegang). Træningsscorens konditionsled (`conditionMultiplier`) er uændret, men får nu reelle input: træthe ryttere udvikler sig lidt mindre. D2 ("løb slår træning") bevares; træthed er prisen for løbets ekstra udvikling.
- **Dagsform (#6649):** træthed og form er input til dagsformen, når den designes. v2 giver dem den spredning, dagsformen skal bruge.
- **AI-hold:** AI-assistenten vælger frie pladser og indsats; den skal kende sæsonbelastningen, ellers kører AI-ryttere sig i stykker. Del af harness-gaten.

## 7. Gate før tænding (simulér-før-ship)

1. Harness på hele populationen med S5-kalenderen og S4-programmerne: D3-gates fra #5928 (G1 median i båndet, G2 andel over skadegrænsen, G3 etapeløb kan skubbe over grænsen), nu også pr. GT og pr. sæsontredjedel.
2. §5.8-garantien som test.
3. Formfordeling: andelen på fuld form skal falde markant, uden store formfald pr. dato.
4. Skaderisiko pr. 1.000 rytter-datoer må ikke eksplodere.
5. Regressionstest: flag off = bit-identisk; dato uden etaper = bit-identisk med i dag.
6. Ejer ser tallene (privat) og giver ordret go.

**Verifikationsniveau:** TIER FULL (backend-motor, delte libs, i18n): `scripts/verify-local.ps1` + hele `npm run test:e2e` for UI-delen (§5.7).
**Preview:** ejeren ser på preview (flag on via preview-override) holdudtagelsens belastningskategori, rytterens løbsdage/sæsonbelastning og ugeprognosen, desktop og Android-bredde, med rigtige skærmbilleder.
**Testrunde:** staff-testerne (egomadsen, friisisch) får de private gate-tal i kort form og én runde på preview, før tænd-kortet.

## 8. Tænding

- Flaget tændes ved en dato-grænse (aftenopgørelsen), aldrig midt på en dato.
- B5 (ejer 20/10): fra S5's første dato (sæsontælleren starter på nul, ingen GT i gang), kun på ejerens ordrette go efter harness-tallene. Er gaterne ikke grønne inden 25/10, spørges ejeren, før noget flyttes.
- Rollback: flag off ved næste dato-grænse, og kun på en dato hvor intet etapeløb bundet til `s5_profiles_v2` er i gang. Grunden er regel-revisionens kontrakt (RACE_ENGINE_RULES "Regel-revision pr. løb"): B2 kræver både revisionen og flaget, så et flag-off midt i en Grand Tour ville ændre løbets regler undervejs. Skal der rulles tilbage midt i et etapeløb, er det en ejer-beslutning (løbet kører færdigt under v2, eller B2 ophører fra næste etape som en bevidst undtagelse).
- Medicin ved rollback: sporet skjules igen, og effekten slukker. Køb og ansatte bevares i databasen. Om spillerne skal kompenseres for opgraderinger eller løn i den periode, er en ejer-beslutning, der tages, før en rollback gennemføres.
- Træthed/form ved rollback: den tilstand, v2 allerede har skrevet i `rider_condition`, bliver bevidst stående og er åbning for den gamle model; den gamle model trækker den selv tilbage mod sin ligevægt over få datoer. Før tænding tages et snapshot af `rider_condition` (træthed, form) pr. rytter; skal tilstanden rulles tilbage, er det en særskilt, ejer-gated datareparation fra snapshottet med dry-run og tal først, aldrig automatisk.

## 9. Ejer-beslutninger 20/10 (låst, kommentar på #6984)

- **B1** En etape vejer et helt døgn.
- **B2** Trætheden hober sig op mellem dagens etaper, også inde i løbet (regel-revision).
- **B3** Sæsonbelastningen er glidende og deler løbsdagstælleren med Udvikling 2.0's løbsbremse.
- **B4** Både inaktivitet og overbelastning koster form.
- **B5** Tændes ved S5-start på ordret go efter harness-tallene.
- **Tillæg:** medicin-faciliteten bygges færdig i samme omgang og påvirker form og træthed. Forslag: [`2026-10-20-6984-medicin-facilitet-forslag.md`](2026-10-20-6984-medicin-facilitet-forslag.md).

## 10. Byg-plan

1. Ren funktion `settleTrainingDateConditionV2` + tests (etaper uden for træningsgennemsnittet, frie pladser som i dag, flag off bit-identisk).
2. Profil/længde/sæson-belastning i `raceFatigue.js` (`stageRaceConditionLoad`), hentet-udbrud-tillæg fra v4's gruppe-snapshots.
3. Ny `nextForm`-variant bag flaget.
4. Sæsontæller (deles med #6110 D4).
4b. B2 i selve løbet: under dato-modellen springer `stageEnteringFatigues` ophobningen over (`trainingOwnsRecovery`), og afregningen sker først om aftenen. Derfor regnes etapens starttræthed i stage-runneren før simuleringen: åbningen plus datoens endnu ikke afregnede belastninger fra ledgeren, med samme døgnregnestykke som afregningen. Regressionstest: etape 2 samme dato får motor-input med etape 1's belastning; andre revisioner og flag off er uændrede.
5. Prognose + UI-kategorier + help.json + patch note.
6. Harness-gate (§7) → privat tal-kort → ejer-go → tænding.
