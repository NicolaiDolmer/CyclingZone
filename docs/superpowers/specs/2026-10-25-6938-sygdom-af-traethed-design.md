# Sygdom af langvarig ekstrem træthed (#6938 U1-erstatning): design

Status: design 25/10 (PC1), intet bygget. Ejer-beslutning 24/10 (valg 2 på #6804): U1 "ikke-start af træthed" erstattes af sygdom af langvarig ekstrem træthed, bygges som egen PR og skal med til v3 tirsdag.
Refs #6938 #6804 #6984.
SSOT: `docs/TRAINING_RULES.md` §5 (træthed, restitution, træningsskader) og `docs/RACE_ENGINE_RULES.md` "Udgåede under `s5_profiles_v3`". Bygge-PR'en skriver reglen ind i begge.
Hard rule 17: ingen tal her. Tærskler, dage og risiko står privat i `balance-internals/6804-tilvalg/`. Baseline (AGENTS 36): `balance-internals/6804-tilvalg/2026-10-24/sickness-baseline.md`.

## 1. Ejerens krav (24/10, ordret indhold)

- Kun ekstremt trætte ryttere, flere dage i træk.
- Risikoen stiger med varighed og grad.
- Rytteren starter ikke (DNS) og er ude nogle dage, uden evneskade.
- Lægens besked i indbakken.
- Den medicinske afdeling sænker risikoen.
- Privat bånd pr. løbsgruppe (G17).

## 2. Målt baseline (kvalitativt, tal privat)

Prod, kun SELECT, 60 dage: ekstrem træthed flere dage i træk er meget sjælden under den nuværende model, og ingen stime er lang. Sygdom bliver derfor sjælden af konstruktion. Den alene løfter ikke G17. Det gør U2 og U3 (#7150). Målingen gentages efter første S5-uge under `condition_model_v2`.

## 3. Regel

1. **Hvornår.** Ved aftenens afregning (dailyTrainingEngine, samme sted som træningsskaden), for en rask rytter: tæl de seneste afregnede dage i træk, hvor trætheden lå over den ekstreme tærskel (`training_condition_settlements.applied_condition.fatigue`, plus dagens). Under en minimumsstime er risikoen 0.
2. **Risiko.** Stiger med stimens længde og med hvor langt over tærsklen trætheden ligger, med et loft pr. dag. Den medicinske afdeling ganger risikoen ned (samme bonus og kurve som M2, `medicalEffects.js`, egen andel). Seedet rul pr. (rytter, dato, "illness"), samme scope som træningsskaden, så udfaldet ikke afhænger af andre ryttere.
3. **Udfald.** Rytteren bliver syg: `rider_condition.injury_cause = 'illness'` og en varighed i løbsdage på løbsdagsaksen (samme mekanik som træningsskaden, #5462). Ingen evneskade og ingen ekstra træthed. En syg rytter starter ikke. Raceruneren registrerer ham som ikke-starter med `race_incidents.kind = 'illness'` (i dag `'injury'`), så DNF-listen viser "Syg, startede ikke" (mærkaten findes fra #7150).
4. **Besked.** Holdet får lægens besked i indbakken, når rytteren bliver syg, og når han er rask (samme kanal som træningsskaden, #7086). Teksten følger `docs/TONE_OF_VOICE.md` og vises ejeren før merge.
5. **Én ting ad gangen.** En rytter der allerede er skadet, kan ikke blive syg (og omvendt). Sygdom tæller ikke som en skade i skadestatistik og #4520-skadedage.

## 4. Gate og tænding

- Kun når `condition_model_v2` er on OG `CURRENT_RACE_RULES_REVISION` er `s5_profiles_v3` eller senere. Sygdommen tændes dermed sammen med v3 og kræver samme ordrette "tænd". Begge off = bit-identisk afregning (ingen læsning af stime-historikken).
- Ingen migration: `race_incidents.kind = 'illness'` bliver lovlig med #7150's migration. `injury_cause` er fritekst.

## 5. Testport og gate

- G17 (#7150) får sygdom med, når testporten kører med `--track-fatigue`. Sygdommens andel rapporteres for sig pr. løbsgruppe (privat bånd).
- Kaptajner må ikke blive syge oftere end hjælpere med samme træthed (rollen indgår ikke i risikoen; testen holder det).

## 6. Byg-rækkefølge (én PR, bag gaten)

1. Ren funktion `conditionIllness.js`: stime, risiko, medicin, seedet rul. Tests: 0 under tærsklen og under minimumsstimen, monoton i stime og grad, medicin sænker, loft, determinisme.
2. Kobling i `dailyTrainingEngine.js` efter træningsskaden (gate, én ekstra læsning af de seneste afregninger pr. hold). Tests: gate off bit-identisk, skadet rytter bliver ikke syg, varighed på løbsdagsaksen.
3. `raceRunner`/`raceIncidents.persistInjuryWithdrawals`: kind efter `injury_cause` ('illness' eller 'injury').
4. Indbakke-besked (syg + rask), en+da, help.json-afsnit.
5. Regler i TRAINING_RULES §5 og RACE_ENGINE_RULES.

## 7. Verifikation (TIER FULL)

Hele backend-suiten, `tsc` engine + routes, lokal PG17: læsningen af stime-historikken (index på `training_condition_settlements` (rider_id, tick_date)) måles før/efter på en kopi af en uges afregninger. Dry-run af én aften med gaten on på en prod-kopi: antal syge pr. løbsgruppe (privat).

## 8. Risiko

- For mange syge, hvis `condition_model_v2` giver flere lange stimer end i dag. Loftet pr. dag og G17-båndet fanger det; målingen gentages efter første S5-uge.
- En kaptajn kan blive syg før et mål. Det er ejerens hensigt (ekstrem træthed har en pris), og lægen advarer forinden via M4/M8 (træthed).
