# Design: løbets session afregnes, når etapen er afgjort (#7982)

Ejer 15/11. Erstatter første udkast samme dag ("hele dagen straks"), som ejeren valgte fra. Status: ejer-godkendt retning; intet er bygget.

## 1. Ejerens beslutninger (15/11, ordret hvor det er citeret)

1. Ryttere med løb skal ikke vente på aftenkørslen: "Kan det ikke bare blive afregnet efter løbet?"
2. "Man kan ikke ændre den session løbet er i. Men man må gerne ændre resten af træningerne for dagen ... bare ikke dem der er kørt allerede."
3. Kun løbets session køres ved etapens afgørelse. En træningssession, der ligger før løbet i dagens rækkefølge, står åben til aften.
4. De øvrige sessioner køres kl. 20 som i dag, eller ved Træn nu.
5. "Løbets træthed gives lige efter løbet, og øvrige ting der kommer i forbindelse med løbet, skal ske ved løbet."
6. To etapper samme dato: der afregnes efter hver etape.
7. Planen kører som lagt; spillet beskytter ikke mod hård træning på en løbsdag.
8. Ingen ny indbakke-besked; det ses i træningsvisningen.
9. Teksten "Riders racing today are settled after their stage" beholdes.

## 2. Problemet, målt (12.-14/11, kun læsning)

- 2.083-2.590 løbsryttere pr. dag hos 245-249 hold får først løbets udbytte og træthed i aftenkørslen (20:00:30 til 20:43-20:49).
- Median ventetid fra etapens afgørelse: 148-159 min; de 10 % der venter længst: 342-505 min. Etaper afgøres kl. 11-19.
- Før kl. 20 ser spilleren åbningstallene fra aftenen før; løbets træthed vises ikke (`riderFatigueNow.js`, `fatigue_now_7801` er ikke tændt).

## 3. Sådan er motoren i dag

- En dato har præcis 5 sessioner i fast rækkefølge (`dailyTrainingEngine.js:569-571`). Kun løbssessioner har et klokkeslæt (etapens); hver etape har sin egen session, også to etaper samme dato.
- `commit_training_date_tick` kræver, at tidligere sessioner er gemt først, medmindre rytteren er stemplet af Træn nu (instant). Konditionen (form og træthed) lukkes én gang pr. dato, på rytterens sidste session.
- Løbets belastning ligger allerede i `training_race_loads`, skrevet af etapens træthedstrin (`raceFatigue.js:110-121`).
- Planen er pr. ugedag med én celle pr. session, så de øvrige sessioner kan allerede sættes hver for sig. På en løbssession er planen ikke input.
- To tidsgates holder det hele til kl. 20: `TRAINING_DATE_SETTLEMENT_HOUR` (`seasonTransitionReadiness.js:355`, brugt i `trainingDateClose.js:133-137`) og filteret i `startTrainingDayCloseAfterStages` (`trainingDayCloseTrigger.js:1116-1146`).

## 4. Løsning

**Princip: samme tal som i dag, bare tidligere.** Løbssessionen regnes af samme motor og gemmes af samme RPC; de øvrige sessioner regnes kl. 20 præcis som nu.

1. **Løbssessionen afregnes pr. etape.** Når scheduleren har afgjort etaper (`stageScheduler.js:393`), køres motoren for netop den session for løbets ryttere. Ikke i etapens egen afslutning (`raceRunner.js`): en fejl i træningen må aldrig kunne vælte en etape.
2. **RPC'en tillader en løbssession uden for rækkefølgen** uden Træn nu-stempel, med samme snapshot-tjek som den stemplede vej. Træningssessioner følger rækkefølgen som i dag.
3. **Klarhed pr. session** i stedet for "alle rytterens sessioner eller ingen" (`trainingDateReadiness.js:112`), så en rytter med to etaper afregnes efter hver.
4. **Løbets træthed og form gælder straks.** Når løbssessionen gemmes, skrives rytterens kondition efter løbet som gældende tal (samme mekanisme som den foreløbige kondition i instant-vejen), og træningsvisningen viser dem. Datoens endelige lukning sker stadig på sidste session.
5. **Låsen følger det, der er kørt.** En session med kvittering kan ikke ændres; alle andre celler på dagen er åbne, også dem før løbet. Løbssessionen har ingen plan at ændre.
6. **Aftenkørslen kl. 20 og Træn nu er uændrede** for de øvrige sessioner og samler alt op, der mangler. En session med kvittering springes over.
7. **Rigtigt tidsstempel pr. kvittering**, så ventetiden kan måles (i dag står alle rækker med kørslens starttid).

Bag en ny binær kontakt `training_settle_race_session` (seed "off"). Slukket = bit for bit som i dag.

### Afgrænsning

- Kun aktiv sæson og ikke sæsonens sidste dato (egen sti, `trainingDateClose.js:75-98`).
- Kun etaper, der er lukkede (`finalize_state == null`, snapshot findes).
- Ryttere uden løb: ingen ændring.

## 5. Det, der skal bevises før merge (Fable-dom, træning)

| Spørgsmål | Bevis |
|---|---|
| Får rytteren de samme tal, som hvis alt var kørt kl. 20? | Facit-prøve: tidlig løbssession + resten kl. 20 mod alt kl. 20, for alle løbsgrupper, én og to etaper, med og uden Træn nu før og efter etapen |
| Kan en træningssession før løbet, kørt efter løbet, give et andet resultat end i dag? | Samme facit. I dag regnes alt kl. 20 i sessionsrækkefølge med løbets belastning kendt; det skal være uændret |
| Kan konditionen skrives to gange eller lukkes for tidligt? | Prøve på RPC'en: løbssessionen lukker aldrig datoen, medmindre den er rytterens sidste manglende |
| Samtidighed med Træn nu og aftenkørslen | Samme holdlås som i dag; prøve med tryk under delkørslen (409 som i dag) |
| En etape køres om efter afregning | Delkørslen rører aldrig en etape med `finalize_state` sat; omkørsel kræver den manuelle recovery (`trainingRaceRecovery.js:74`) |
| Slukket kontakt | Bit for bit mod `trainNowSameResult7982`, `trainNowInstant7737`, `commitTrainingDateTick7982*` og `trainingDateClose.test.js` |

## 6. Måling før og efter

- Ventetid fra etapens afgørelse til løbssessionens kvittering: median og de langsomste 10 % pr. dag (kræver tidsstemplet).
- Varighed pr. delkørsel og aftenkørslens varighed.
- Etapernes egen varighed uændret.

## 7. Fravalgt

- Hele dagen straks efter etapen (første udkast): fjerner muligheden for at justere resten af dagen.
- Sessioner før løbet køres sammen med løbet: ejeren valgte, at kun løbet køres.
- Løbende afregning efter dagens etapetider og et fortrydelsesvindue: større motorændring uden for beslutningen.
- Afregning inde i etapens afslutning (`raceRunner.js`): træning hører ikke til i løbets varme sti.
- Automatisk let træning eller advarsel på løbsdage: ejeren valgte, at planen kører som lagt.

## 8. Rækkefølge

1. Én PR: tidsstemplet, løbssessionens afregning, klarhed pr. session, kondition efter løbet, låsen pr. session, kontakten (slukket). Fable-dom før merge.
2. Prøvekørsel mod et prod-billede; ejerens "kør" for tænding; patch note.

## Antagelser

- "Binder til sidste etape" i træningens realisme-regel gælder feltet over hele løbet, ikke afregningen pr. dato.
- Ingen evidens for, at en omkørt etape i dag genberegner træningen.
- At tallene er uændrede, når løbssessionen gemmes før de tidligere sessioner, er ikke prøvet; det er facit-prøvens opgave.
