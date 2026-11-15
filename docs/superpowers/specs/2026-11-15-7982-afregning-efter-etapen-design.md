# Design: ryttere med løb afregnes, når deres etape er afgjort (#7982)

Ejer 15/11: "Kan det ikke bare blive afregnet efter løbet?" Ja. Teksten "Riders racing today are settled after their stage" beholdes og bliver sand. Status: design til ejerens godkendelse; intet er bygget.

## 1. Problemet, målt (12.-14/11, kun læsning)

- En rytter med løb i dag får først sin træningsdag afregnet i aftenkørslen. Den starter 20:00:30 og er færdig 20:43-20:49, hold for hold.
- 2.083-2.590 løbsryttere pr. dag hos 245-249 hold venter. Median ventetid fra etapens afgørelse til afregning: 148-159 min; de 10 % der venter længst: 342-505 min.
- Etaperne afgøres mellem kl. 11 og 19. Ca. 58 % af løbsrytterne afgøres kl. 18 (gevinst ca. 2-2,5 time); dem der kører kl. 12-14 venter 6-8 timer.
- Kun 11-17 hold pr. dag trykker Træn nu. Et tryk efter etapen afregner allerede rytteren med det samme; alle andre venter.

## 2. Hvorfor venter de

Ingen regel for den enkelte rytter kræver, at alle dagens etaper er afgjort. Klarhed afgøres allerede pr. rytter og pr. etape (`trainingDateReadiness.js:79-113`), og skrivningen låser pr. hold og pr. rytter (`commit_training_date_tick`). Det, der holder dem tilbage, er to tidsgates:

- `TRAINING_DATE_SETTLEMENT_HOUR = 20` (`seasonTransitionReadiness.js:355`), brugt i `loadTrainingDateIndex` (`trainingDateClose.js:133-137`): før kl. 20 kommer dagens dato ikke på joblisten.
- `startTrainingDayCloseAfterStages` (`trainingDayCloseTrigger.js:1116-1146`) starter kun kørslen efter kl. 20, selv om stage-scheduleren kalder den efter hvert tick med kørte etaper (`stageScheduler.js:393`).

## 3. Løsning (anbefalet): kørslen starter pr. løb, når løbet er afgjort

Samme motor, samme RPC, samme låse og samme cron som fallback. Ingen kode i den varme løbssti (`raceRunner.js`).

1. **Delkørsel "kun løbsryttere".** Når scheduleren har afgjort etaper, starter en delkørsel for dagens dato med de afgjorte løb. Den afregner kun hold, der har en løbsrytter uden åbne pladser på datoen, og kun de ryttere. Rytteren får hele datoen (løbet og de øvrige dagsfelter), præcis som ved et Træn nu-tryk efter etapen.
2. **Ryttere uden løb** afregnes som i dag (Træn nu eller kl. 20). Uændret.
3. **Aftenkørslen kl. 20** består som opsamling: alt, der ikke er afregnet, tages dér. En rytter, der allerede er afregnet, springes over (kvitteringsnøglen findes).
4. **Samme mærke som trykket.** Tidlig afregning sætter rytterens dato-mærke, så han ikke kan tilmeldes et nyt løb samme dato, og hans plan for datoen ikke kan ændres bagefter. I dag findes værnet kun for hold, der har trykket; det skal gælde pr. rytter.
5. **Delkørsel og fuld kørsel holdes adskilt** i processens huskeliste (`completedDates`/`fullPassDates`), så en delkørsel aldrig får en fuld kørsel til at tro, at datoen er færdig.
6. **Rigtig tidskolonne.** Kvitteringen får sit faktiske afregningstidspunkt. I dag står alle rækker med kørslens starttid, så ventetiden ikke kan måles.

Bag en ny binær kontakt `training_settle_after_stage` (seed "off"). Slukket = præcis som i dag, bevist bit for bit mod de eksisterende facit-prøver (`trainNowSameResult7982`, `trainNowInstant7737`, `trainingDateClose.test.js`).

### Afgrænsning

- Kun aktiv sæson og ikke sæsonens sidste dato (den har sin egen sti, `trainingDateClose.js:75-98`).
- Kun ryttere, hvis alle etaper på datoen er lukkede (`finalize_state == null`, snapshot findes). Etapeløb med flere etaper samme dato: efter rytterens sidste etape den dato.
- Rangeringerne opdateres efter delkørslen for de berørte hold; den fulde opdatering kl. 20 består.

## 4. Fravalgt

- **Afregning inde i etapens afslutning (`raceRunner.js`).** Kortest ventetid, men lægger træningslogik i løbets varme sti; en fejl i træningen må aldrig kunne vælte en etape. Samme gevinst opnås uden for stien.
- **Behold kl. 20, kør Træn nu-hold først.** Lille ændring, men opfylder ikke beslutningen: alle venter stadig til kl. 20.

## 5. Risici og hvordan de lukkes

| Risiko | Lukkes ved |
|---|---|
| En etape køres om efter afregning | Afregningen fortryder intet i dag heller ikke. Prøve + regel: omkørsel af en etape med afregnede ryttere kræver den manuelle recovery (`trainingRaceRecovery.js:74`); delkørslen afregner aldrig en etape med `finalize_state` sat |
| Manageren ændrer planen efter etapen | Planlås pr. rytter ved afregning (punkt 4); UI viser rytteren som afregnet |
| Ny tilmelding samme dato efter afregning | Dato-mærket pr. rytter (punkt 4). Prod 12.-14/11: 0 ryttere i to løb samme dato |
| Belastning kl. 18 (10 etaper, ca. 3.900 rytter-dage over tre dage) | Delkørslen kører hold for hold som i dag; målt varighed pr. delkørsel før tænding; samme lås som aftenkørslen, så to kørsler aldrig overlapper |
| Sæsonskifte | Udelukket (afgrænsning) |

## 6. Måling før og efter

- Ventetid fra etapens afgørelse til rytterens afregning (kræver tidskolonnen): median og de langsomste 10 %, pr. dag.
- Antal delkørsler pr. dag og deres varighed; aftenkørslens varighed (bør falde, fordi løbsrytterne er taget).
- Etapernes egen varighed uændret.
- Samme resultat: en rytter afregnet tidligt får bit for bit det samme som i aftenkørslen (facit-prøve).

## 7. Rækkefølge

1. PR A: tidskolonnen + måling af dagens ventetid (ingen adfærdsændring).
2. PR B: delkørslen, mærket pr. rytter og kontakten (slukket). Fable-dom før merge (træning).
3. Prøvekørsel mod et prod-billede, ejerens "kør" for tænding, patch note.

## 8. Ejerens valg

1. **Planlås:** når en løbsrytter er afregnet efter sin etape, kan hans træningsplan for den dato ikke ændres. Anbefalet: ja (ellers kan en brugt plan ændres bagefter).
2. **Synlighed:** rytteren vises som "afregnet" i træningsvisningen straks efter etapen. Anbefalet: ja, med den eksisterende tekst.

## Antagelser

- "Binder til sidste etape" i træningens realisme-regel gælder feltet over hele løbet, ikke afregningen pr. dato; pr. dato er reglen allerede opfyldt af klarheds-tjekket.
- Ingen evidens for, at en omkørt etape i dag genberegner træningen.
