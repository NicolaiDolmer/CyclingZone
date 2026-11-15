# Langt angreb: teknisk design og målt udgangspunkt (#7884)

Status: design (Fable-arkitekt, 12/11). Kopi af designkommentaren på #7884, uden private tal (hard rule 17). Trin 0 (dette dokuments tabel i afsnit 5) er kun test og måling; motorens adfærd er uændret. Rå tal ligger privat under `balance-internals/7884/`.

Bygger oven på Codex' design i draft-PR #8014 (`docs/superpowers/specs/2026-11-11-7884-long-attack-design.md` på den gren) og er enig i fundamentet. Det, der er nyt i forhold til #8014, er mærket **Nyt**.

## Allerede afgjort af ejeren (genåbnes ikke)

- Ægte langt angreb, alle ryttere, valg via stigningens navn, ingen "km fra mål" (11/11).
- Ét forsøg: bliver rytteren hentet, er kræfterne brugt. Intet automatisk genangreb (11/11).
- Kun én angrebsordre i nye planer: "Angrib på" + stigning, fra foden. Gemte planer kører uændret. Prisen står ved valget (12/11).
- Kun spillerordrer i første byg; AI-holdene reagerer og jager efter de fælles regler (12/11).
- Udfaldet afgøres ikke af et nyt terningkast (12/11).
- Løbsfilmen fortæller kun det, der er sket, med ægte tidspunkter, aldrig som interval (#8045, PR #8033).

## 1. Sådan virker angreb i dag (hullet)

- "Angrib" er opgaven `attack` = indsatsen "alt ud" (`backend/lib/stagePlan.ts`), og punktet er altid stigningens TOP (`triggerKm` i `stagePlan.ts`, `stagePlanEngine.ts`). Målstigningen ved en topankomst findes ikke på listen (`stagePlanClimbsFromRaw`).
- "Alt ud" virker kun på etapens sidste stigning (`engine/v4/mechanics/climbSelection.ts`). Et angrebsled efter en TIDLIG stigning giver derfor ingen fordel, men fuld træthedspris. Codex' måling i #8014 viser det samme.
- Jagten kender kun morgenudbruddet (`mechanics/breakaway.ts`, `mechanics/chaseGroup.ts`). Et angreb fra feltet bliver i dag ikke jagtet af noget hold.
- Målt i prod (#8045): på de undersøgte etaper findes ingen tjekpunkter mellem angreb og top, og kun en mindre del af rytterne med "vinder tid" kom i mål foran den gruppe, de angreb fra.

## 2. Forslaget

**Princip:** rytteren sætter af ved FODEN af den valgte stigning, fra den gruppe han sidder i. Intet foræret: han kører hurtigere ved at bruge af sin reserve. Rækker det, får han et hul, og derfra gælder motorens almindelige regler for fart, læ, dal og jagt. Rækker det ikke, er han tilbage i gruppen med brugte kræfter.

### Datamodel

- Nyt skiftepunkt på `attack`: `from: { at: "climb_start", kom_index }` (som #8014). Navnet er kun en etiket, aldrig en nøgle.
- **Nyt:** ruten får en særskilt liste "stigninger man kan angribe på" med fod, top og navn, og den rummer også topankomstens stigning. Foden er `crest_km - length_km`, som i forvejen er starten på stigningens segment (`backend/lib/routeSegments.js`, `buildSegments`).
- Alle seks roller må få den nye form. Gamle led læses, køres og genafspilles præcis som før og laves aldrig stille om.
- Rutens fingeraftryk følger med ved læsning; gem afvises med en neutral konflikt, hvis ruten er ændret (udvides i `save_race_tactics_7864`).
- Slukkes kontakten, udleder serveren én effektiv plan: angrebsleddet erstattes af den forrige gyldige opgave, senere led bevares.

### Motorens regel

Ny ren mekanik, forslag: `backend/lib/engine/v4/mechanics/longAttack7884.ts`.

1. Afsæt ved stigningens første segment med hul 0, fra den gruppe han sidder i. Ingen flytning frem, intet startforspring.
2. Fart = egen evne plus et tillæg, der betales af reserven. Han står i vinden og betaler front-prisen. Når reserven er tom, falder farten under hans normale niveau ("gået død", med ægte årsag).
3. Motorens fælles gruppeklokke afgør, om han er væk eller samles op igen.
4. **Nyt:** angriberens tur op ad stigningen regnes i korte delskridt uden terningkast (længden kalibreres privat). Det giver ægte tjekpunkter midt på stigningen uden at dele ruten i flere segmenter, så de øvrige rytteres tilfældighedsstrømme ikke flytter sig.
5. Ryttere på "Følg med" og AI-ledere uden plan går med, hvis de kan betale farten (åbent valg 2).
6. Efter stigningen er angrebsgruppen en almindelig gruppe: uden læ alene, og dal-reglen gælder (`mechanics/timeModel.ts`). Terrænet er årsagen til, at et tidligt angreb med lang dal bagefter er svært.
7. At nå en gruppe foran er at køre op, ikke at blive hentet.
8. Ét forsøg pr. led; resten af leddet køres som "Følg med" uden gevinst (åbent valg 4).
9. Én ejer af tidsgevinsten pr. rytter og segment: "Alt ud"-gevinsten, frem-splittet, det sene soloangreb og nedkørselsangrebet giver intet oveni.
10. Ingen ny tilfældighed.

**Jagten:** en gruppe med aktivt langt angreb bliver et jagtmål. Hold med ordren Jag jager; neutrale hold jager, når angriberen truer deres etapechance eller klassementsrytter (#5978); et hold jager aldrig sine egne (#6187). Jægerne betaler med deres friskhed gennem den eksisterende regning. Et løb uden nogen langt-angrebs-ordre er uændret.

**Sammenhæng:** holdplanen "Stage win" lægger "Angrib på <sidste stigning>"; "Brug på flere etaper" kopierer aldrig stigningsindeks; en angriber får bjergpoint efter de almindelige regler (#7855); lederens angreb må ikke gøre hjælperne "sat" (#7635); solokilometer tæller som arbejde i trætheden; en træt rytter (#7801) får mindre hul og går tidligere død.

**Løbsfilmen:** hændelseskontrakten fra #8045 bruges uændret (angrebet, tjekpunkter med retning, kørt op, hentet, sat, holdt), plus en ny jagtlinje med fakta ("Hold A og B jager", "ingen hold vil jage").

**Kontakt:** `long_attack_7884`, slukket, bundet til løbet ved første etape som trøjejagten. Slukket er alt byte-identisk.

## 3. Realisme

Skal kunne: (1) angreb på næstsidste stigning, hentet i dalen eller ved foden af den sidste, taber tid til sidst; (2) den sjældne store dag, hvor den klart stærkeste holder hjem, fordi jagten mangler arbejdere; (3) køre op til resterne af udbruddet og bruge gruppen, og jagten koster jægerne.

Må ikke kunne: (1) lykkes hver gang for den stærkeste; (2) give gratis afstand eller gratis kræfter; (3) lade en solorytter holde et organiseret felt bag sig i en lang dal, eller lade en farlig klassementsrytter få minutter, uden at nogen jager.

## 4. Smuthuller, der lukkes med test

Hvile efter at være hentet · dobbelt gevinst · billig træthed ved straks at afløse leddet · nyt angreb via gruppeskift · hele holdet angriber for at trætte rivalerne · lederens angreb udløser hjælpernes "sat"-led · forbi morgenudbruddets spærring · eget hold jager egen mand · angreb på målstregen (#7965) · flyttet stigning eller ens navne · gemte planer når kontakten slukkes · kopi til andre etaper · mennesker mod AI · tidskørsler og grupetto. Hvert punkt får en test, der fejler uden lukningen.

## 5. Baseline, der måles FØR byg (trin 0)

| Nr. | Tal | Værktøj |
|---|---|---|
| B1 | Tid vundet eller tabt ved angreb fra en top mod en tvilling uden, pr. løbsgruppe og etapetype (flad og tidskørsel som negativ kontrol) | `backend/scripts/dev/tacticsEffects7266.mjs --experiments=longattack` (trin 0-armen) og `--experiments=plan,effort,chase` |
| B2 | Andel etaper vundet fra et frem-split på sidste stigning, pr. etapetype | `backend/scripts/dev/longAttackBaseline7884.mjs` oven på S5-benchens løb (`s5MotorBench.mjs --scope=all`) |
| B3 | Afstand vinder til nr. 10, favoritsejre, udbrudssejre, klassementsafstande | `backend/scripts/dev/lib/realismMetrics.mjs` på realisme-korpusset |
| B4 | Sejrstyper (solo, tæt, spurt) | `engine/v4/winType.ts` via `s5MotorBench.mjs` |
| B5 | Træthed dagen efter, over et etapeløb og en GT | `effortLevels6641.mjs`, `gtFatigueBench.mjs`, `tourDryRun.mjs --track-fatigue` |
| B6 | Sene soloangreb: hvor ofte, og hvor ofte de holder | `longAttackBaseline7884.mjs` (samme bench) |
| B7 | Jagtens ankre | `giroCaptainTimeLoss6088.mjs`, `dangerousRiderLeash5978.mjs`, `ownRiderAhead6187.mjs` |
| B8 | Hele feltet af kommende løb | `motorTestport.mjs --candidate-switch=<ENV>` (en kontakt som kandidat) |
| B9 | Frosne aftryk og byte-identitet | de frosne digest-tests, `cleanRevisionGate.mjs`, `replayStage1857.mjs` |
| B10 | Motorens tid pr. etape (median og p95) | `longAttackBaseline7884.mjs` |
| B11 | Hvor mange gemte planer har et angrebsled, hvor og for hvilken rolle | én SELECT på `race_team_orders.riders` (`longAttackBaseline7884.mjs --print-b11-sql`) |

**Grænser det nye skal holde** (tallene godkendes af ejeren; de private bånd bliver private): slukket er byte-identisk; tændt uden nogen ordre i feltet er også byte-identisk; realisme-båndene holder i tre scenarier (ingen bruger ordren, en realistisk andel, alle kaptajner); ingen fri frokost for feltets stærkeste; det må gerne give mening for ryttere lige under toppen; flertallet af forsøg ender som hentet eller mislykket; en træt rytter klarer sig målbart dårligere end en frisk; trætheden dagen efter er mindst som "Alt ud" i dag; jagtens ankre rykker sig ikke, når ingen angriber; menneskeholdenes andel af sejre mod AI rykker sig ikke mærkbart; alle fem løbsgrupper og alle etapetyper måles, med flad etape og tidskørsel som negativ kontrol.

## 6. Fladen

Ét valg, "Angrib på" plus stigningens navn i rutens rækkefølge, også målstigningen; prisordet "Meget hård" står før valget; den valgte stigning markeres på profilen fra foden. Under valget står fakta fra ruten (hvor mange stigninger kommer efter, er der dal bagefter) og reglen i ord: ét forsøg. Mobil følger beslutningslisten på #7778: chip på kortet, redigering i ark fra bunden, store rækker, ingen vandret rulning. Assistenten foreslår aldrig et langt angreb (#7885, #7369). Wireframe godkendes af ejeren før visningen bygges.

## 7. Byggeplan bag kontakten

| Trin | Indhold |
|---|---|
| 0 | Kun test og måling: B1 til B11 kørt og gemt privat, ingen adfærd ændret |
| 1 | Kontrakten: nyt skiftepunkt, angrebsstigninger med fod og målstigning, gamle led uændret, tilbagefald (`stagePlan.ts`, `StagePlanModel.ts`) |
| 2 | API og lagring: fingeraftryk, konflikt ved ændret rute, løbets stempel |
| 3 | Hændelseskontrakten fra #8045 som ren stempling |
| 4 | Mekanikken: afsæt, fart betalt af reserven, delskridt, ét forsøg, én ejer af gevinsten |
| 5 | Jagten og "følg med" |
| 6 | Træthed og regnskab |
| 7 | Fladen på desktop og mobil, holdplanen, filmens linjer, fem sprog, Hjælp og patch note |
| 8 | Kalibrering på alle løbsgrupper, uafhængig dommer, tænd-kort, prøveløb, tænding |

**Dommeren tjekker før merge (fra trin 1):** slukket og "tændt uden ordrer" er byte-identiske; intet nyt terningkast; intet gratis; én gevinst; ét forsøg; jagten er sand; de tre realismemønstre findes og de tre forbudte kan ikke fremprovokeres; alle løbsgrupper og etapetyper er målt; gamle planer giver samme løb; filmen siger intet, før det er sket; hvert smuthul har en test; prisen står ved valget, og Hjælp og patch note er skrevet.

## 8. Åbne valg til ejeren (anbefalingen først)

1. **Angreb pr. rytter pr. etape:** A (anbefalet) højst ét · B ét pr. stigning · C ét, men hjælpere må have to.
2. **Kan rivalerne gå med fra første byg:** A (anbefalet) ja, ryttere på "Følg med" og AI-ledere går med, hvis de har kræfterne · B nej, feltet kan kun jage · C kun menneskeryttere går med.
3. **Kan en rytter på langt angreb knække ved lodtrækning:** A (anbefalet) nej, han går kun død, når reserven er tom · B ja, det gamle "Alt ud"-knæk gælder også ham · C som A, og det gamle knæk fjernes senere også for almindelig "Alt ud".
4. **Hvad kører en hentet rytter resten af leddet:** A (anbefalet) "Følg med" · B "Kør i mål" · C fortsat alt ud uden gevinst.
5. **Afprøvning før fuld tænding:** A (anbefalet) pr. løb, alle hold i udvalgte løb får ordren · B kun staging, derefter alle nye løb · C pr. bruger (frarådes: uretfærdigt i samme løb).
6. **Etaper uden navngiven stigning:** A (anbefalet) ingen angrebsordre dér · B "Angrib de sidste 10 km" bevares kun dér · C senere udvidelse til brostenssektorer og bakker.
7. **Tjekpunkter midt på stigningen:** A (anbefalet) langt angreb får egne delskridt nu · B vent på #8045's trin B · C byg begge samtidig.
8. **Må assistenten foreslå angreb:** A (anbefalet) aldrig et langt angreb, kun på sidste stigning hvis afkrydsningen fra #7885 bygges · B aldrig · C også tidlige angreb for ryttere, der ikke kan vinde til sidst.

Roadmap-teksten siger "Angrib efter den stigning, du vælger". Ordren hedder "Angrib på" fra foden; teksten rettes, når ejeren har godkendt designet.

Refs #7884 #8014 #8045 #7864
