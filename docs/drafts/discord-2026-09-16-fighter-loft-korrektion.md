# Discord-udkast 16/9: korrektion i traaden "New stats - Teamwork and leadership"

Kanal: #feedback-and-ideas. **Ejeren poster selv.** Tone: TONE_OF_VOICE.md (jeg/du, ingen em-dash, ingen "vi").
Formaal: rette det forkerte svar fra 16/9 om at faldet skyldtes de tomme evner.

---

## EN

Small correction to what I said earlier in here, because I got it wrong.

The drop you saw on your fighters had nothing to do with Teamwork and Leadership being empty. Empty abilities are skipped entirely when the rating is calculated, so they cannot pull a number down.

The real cause was a ceiling I set on Monday. I lowered the ceiling on aggression to 70, and I did not check who that number actually hit. It turned out to hit exactly one rider type: the baroudeur, where aggression is his signature ability. Every other type was already below 70, so for them the change did nothing. For a baroudeur it cut 23 points off his best ability, which is the 7 to 8 points you saw disappear from his potential.

That is fixed now, and the ceiling is back at 93. Open your fighter and the old number should be there again. You do not have to do anything.

Thanks for flagging it so fast. Four of you reported it within a day, and that is the only reason it was found before the weekend.

---

## DA

En rettelse til det jeg skrev tidligere herinde, for jeg tog fejl.

Faldet du saa paa dine fightere havde ikke noget med Holdarbejde og Lederskab at goere. Tomme evner springes helt over naar ratingen regnes ud, saa de kan ikke traekke et tal ned.

Den rigtige aarsag var et loft jeg satte mandag. Jeg saenkede loftet paa angrebslyst til 70, og jeg fik ikke tjekket hvem det tal egentlig ramte. Det viste sig at ramme praecis en type: baroudeuren, hvor angrebslyst er hans signaturevne. Alle andre typer laa allerede under 70, saa for dem gjorde aendringen ingenting. For en baroudeur skar den 23 point af hans bedste evne, og det er de 7 til 8 point du saa forsvinde fra hans potentiale.

Det er rettet nu, og loftet er tilbage paa 93. Aabn din fighter, saa skulle det gamle tal staa der igen. Du skal ikke goere noget selv.

Tak fordi I sagde til saa hurtigt. Fire af jer meldte det inden for et doegn, og det er den eneste grund til at det blev fundet inden weekenden.

---

## Noter til ejeren (postes ikke)

- "Du skal ikke goere noget selv" er verificeret: loftet regnes friskt ved hvert kald til `/api/scouting/estimates` (`scoutingReport.js:192` -> `buildCapsForRider`, `api.js:2189`). Det er ikke laest fra databasen, saa tallet er rettet i samme oejeblik backend er deployet. Deploy verify var groen paa a9de617a0.
- Beskeden naevner ingen spillernavne med vilje, selvom tallene kom fra to navngivne traade.
- Den naevner heller ikke taktik-loftet (55), som stadig staar. Det er daekket af patch note 7.277 og er en tilsigtet aendring, ikke en fejl.
