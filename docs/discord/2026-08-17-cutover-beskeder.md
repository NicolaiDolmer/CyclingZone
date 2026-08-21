# Discord-udkast · cutover-beskederne til 23/8 (17/8, revideret efter design-sessionen)

> **Klar til copy-paste. Ejeren poster selv.** Kopiér fra RÅteksten, ellers falder linjeskift ud.
>
> **Besked 1 (race-day) SKAL postes FØR søndag 23/8** (ejer-beslutning 17/8: spillerne hører om AI-loft-korrektionen fra os, ikke fra deres egne observationer).
>
> **Besked 2 (værdier) og besked 3 (løn) SKAL begge postes FØR søndag 23/8.** Ejer-beslutning 17/8 (design-sessionen): refit-gaten er RØD, markedsvægten flipper ikke, værdierne står stille søndag, og lønreformen (#3393, A = 23.300) rammer alle ryttere ved sæsonstart. Besked 3 postes når løn-PR'en er merged og dry-run bekræftet, og senest lørdag 22/8.
>
> ⛔ **STATUS 21/8 (aften-revision):** **Besked 3 er OVERHALET og må IKKE postes.** Lønmodellen blev 19/8 ændret til `current_production_value` × global sats 0,35 uden divisions-skalering ([#3989](https://github.com/NicolaiDolmer/CyclingZone/issues/3989), #3393 parkeret), og ejeren postede selv en korrekt løn-besked i #the-roadbook 20/8 kl. 09:08 ("Heads-up: salaries are being reworked for Season 3"). Besked 3's præmis ("a salary is a price on the rider's value", A = 23.300) er dermed faktuelt forkert.
> **Besked 1 (race-day) og besked 2 (værdier) er stadig aktuelle og stadig IKKE postet pr. 21/8 aften** (verificeret mod #the-roadbook; seneste opslag er 20/8-lønbeskeden). Begge skal fortsat ud FØR søndag. Én sætning i besked 2 er opdateret 21/8 så den peger på det allerede-postede løn-opslag i stedet for at love et kommende.
>
> Den gamle grøn-gate-variant og 30/8-fallbacken (`2026-08-14-vaerdi-besked.md`, aldrig postet) er begge overhalet og må ikke bruges.
>
> **Kanal:** #the-roadbook (EN), DA til de danske kanaler.

---

## Besked 1 · Race-day-motoren (EN)

**Race days now develop your riders, and one engine for everyone (Sunday 23 Aug)**

From Sunday, racing is no longer a day off from development.

When one of your riders races, the race replaces that day's training session. It develops the abilities the race actually uses, and it is slightly stronger than a normal session. A mountain race builds climbing legs. Recovery after racing has been tuned to match.

AI teams also move onto the same engine. Until now they trained under a simpler separate system. From Sunday they train, develop and recover under exactly the same rules as you.

One side effect you may notice: AI riders' development ceilings are recalculated with age for the first time. Many older AI riders will see their ceiling drop. No rider loses any current ability, and your own riders are not affected by this correction. A 34-year-old should not have the ceiling of a 22-year-old, and until now the AI riders did.

## Besked 1 · Race-day-motoren (DA)

**Løbsdage udvikler nu dine ryttere, og én motor for alle (søndag 23/8)**

Fra søndag er en løbsdag ikke længere en pausedag for udvikling.

Når en af dine ryttere kører løb, erstatter løbet dagens træningspas. Det udvikler de evner løbet faktisk bruger, og det er en anelse stærkere end et normalt pas. Et bjergløb bygger klatreben. Restitutionen efter løb er justeret så den passer til.

AI-holdene flytter også over på samme motor. Indtil nu har de trænet under et enklere separat system. Fra søndag træner, udvikler og restituerer de under præcis samme regler som jer.

Én bivirkning I kan lægge mærke til: AI-rytternes udviklingslofter genberegnes med alder for første gang. Mange ældre AI-ryttere får et lavere loft. Ingen rytter mister nuværende evner, og jeres egne ryttere påvirkes ikke af denne korrektion. En 34-årig skal ikke have en 22-årigs loft, og det har AI-rytterne haft indtil nu.

---

## Besked 2 · Værdierne (EN)

**Values: an honest update**

Last week I told you the next value update would blend the old formula with a new one built on real trades. I have now rebuilt and remeasured that model twice. Here is where it stands.

The model was refit on the corrected rider types, and bank sales at the fixed starting price no longer count as evidence, so it only learns from real trades. Even after that, it still predicts real sale prices worse than the model running today. I will not ship something that makes values less accurate. So on Sunday your riders keep the values they have.

But the measuring found something better than what it was looking for. The market agrees with the current model about which riders are worth more than others. It only disagrees about the overall level: real trades between managers happen below the listed values.

That makes the fix much simpler than a new model. One level adjustment, applied once, so values match what riders actually trade for. I am not giving you a date for it, because dates are what went wrong last time. Instead there is a standard: I measure the trade evidence every Sunday, and the adjustment runs the first Sunday the evidence is solid enough to defend it. When it runs, values come down. Your riders are not getting worse, and the adjustment will not change a single salary. Wages are set by their own system from Sunday, as covered in the salary post earlier this week.

The direction has not changed. Values are moving toward what you actually pay for riders.

## Besked 2 · Værdierne (DA)

**Værdier: en ærlig status**

I sidste uge fortalte jeg jer at næste værdi-opdatering ville blande den gamle formel med en ny bygget på rigtige handler. Jeg har nu bygget den model om og målt den igen. Her er status.

Modellen er tilpasset de rettede ryttertyper, og bank-salg til den faste startpris tæller ikke længere som evidens, så den lærer kun af rigtige handler. Selv efter det rammer den stadig rigtige salgspriser dårligere end den model der kører i dag. Jeg sender ikke noget der gør værdierne mindre præcise. Så på søndag beholder jeres ryttere de værdier de har.

Men målingen fandt noget bedre end det den ledte efter. Markedet er enigt med den nuværende model om hvilke ryttere der er mere værd end andre. Den er kun uenig om det samlede niveau: rigtige handler mellem managere sker under de listede værdier.

Det gør løsningen langt enklere end en ny model. Én niveau-justering, kørt én gang, så værdierne passer med det ryttere faktisk handles til. Jeg giver jer ikke en dato, for datoer var det der gik galt sidst. I stedet er der en standard: jeg måler handels-evidensen hver søndag, og justeringen kører den første søndag evidensen er solid nok til at bære den. Når den kører, kommer værdierne ned. Jeres ryttere bliver ikke dårligere, og justeringen ændrer ikke én eneste løn. Lønnen styres af sit eget system fra søndag, som beskrevet i løn-opslaget tidligere på ugen.

Retningen er uændret. Værdierne bevæger sig mod det I faktisk betaler for ryttere.

---

## Besked 3 · Lønnen (EN)

**Salaries: from Sunday, wages are a price on value**

At the season start on Sunday, every rider's salary is recalculated. One time, all riders at once. Here is why, and what to expect.

Today salaries are based on a number that barely differs between riders. The result is absurd: the most expensive rider in the game pays less per season than a 17-year-old worth a sixth of him. Your stars have effectively been riding for free, and old cheap riders have been your biggest wage bills.

From Sunday a salary is a price on the rider's value. A rider worth 100,000 costs about 23,000 a season. The curve is soft at the top: ten times the value costs about 3.5 times more, not 10 times. So most wages go up, and wages for the best riders go up a lot. That is the point. Owning great riders should be a real commitment, not a free ride.

Two things to hold on to. Season 3 is more than twice as long as season 2, and your income grows with it. And the total wage level is calibrated against what teams actually earned, deliberately on the low side for this first season, so the league can carry it comfortably.

The contract rule does not change: a salary is locked for the length of the contract, and renegotiation happens at the going rate. Sunday is the one-time correction of a miscalibrated base, not a new habit.

Next on this track: showing a rider's expected salary before you bid, so you always know what you are committing to.

## Besked 3 · Lønnen (DA)

**Løn: fra søndag er lønnen en pris på værdi**

Ved sæsonstart søndag genberegnes alle rytteres løn. Én gang, alle ryttere samtidig. Her er hvorfor, og hvad I skal forvente.

I dag er lønnen baseret på et tal der næsten ikke adskiller ryttere. Resultatet er absurd: den dyreste rytter i spillet betaler mindre pr. sæson end en 17-årig der er en sjettedel værd. Jeres stjerner har reelt kørt gratis, og gamle billige ryttere har været jeres største lønudgifter.

Fra søndag er en løn en pris på rytterens værdi. En rytter der er 100.000 værd koster cirka 23.000 pr. sæson. Kurven er blød i toppen: ti gange værdien koster cirka 3,5 gange mere, ikke 10 gange. Så de fleste lønninger stiger, og lønnen på de bedste ryttere stiger meget. Det er meningen. At eje fantastiske ryttere skal være en reel forpligtelse, ikke en gratis tur.

To ting at holde fast i. Sæson 3 er mere end dobbelt så lang som sæson 2, og jeres indtægt vokser med den. Og det samlede lønniveau er kalibreret mod det holdene faktisk tjente, med vilje sat lavt i denne første sæson, så ligaen kan bære det uden problemer.

Kontraktreglen ændrer sig ikke: en løn er låst i kontraktens længde, og genforhandling sker til dagens takst. Søndag er engangs-korrektionen af et fejlkalibreret grundlag, ikke en ny vane.

Næste skridt på dette spor: at vise en rytters forventede løn før I byder, så I altid ved hvad I forpligter jer til.

---

## Kilder og forbehold

- Race-day-mekanikken: `dailyTraining.js` (applyRaceDevelopmentTick, devMult ~1,15), `trainingSweep.js` (is_ai-filteret fjernes), `aiRecoverySweep.js` (no-op), `raceFatigue.js` (RACE_DAY_ENGINE_RECOVERY_CONFIG). AI-loft-korrektionen: 45,4 % af 3.473 AI-ryttere taber loft, p10-tab 29 point på bedste evne (#3591-målingen 10/8). "Jeres egne ryttere påvirkes ikke": korrektionen rammer kun AI-holdenes ryttere, menneskeholdenes caps alders-tickes allerede.
- Besked 2: refit-gaten RØD (0 af 3) pr. scorecardet 17/8 (`docs/audits/2026-08-17-vaerdimodel-refit-scorecard.md`); niveau-korrektionen er gate-styret fra 30/8 (ejer-beslutning 17/8, logget på #3750). "Ændrer ikke én eneste løn": korrektionen bundles løn-neutral (A ganges med c^-0,55).
- Besked 3: A = 23.300 (ejer-beslutning 17/8, logget på #3393). Eksemplet "dyreste rytter betaler mindre end en 17-årig": målt 17/8, rytter til 23,76M betaler 23.305 i dag mod 63.333 for en 17-årig til 4,0M. "100.000 værd koster cirka 23.000": 23.300 × (100.000/100.000)^0,55 = 23.300, afrundet nedad i spillertekst. "3,5 gange": 10^0,55 = 3,55. "Mere end dobbelt så lang": S3 har 60 løbsdage mod S2's 28 (seasons-tabellen). "Med vilje sat lavt": lønsummen lander på ~25 % af S3-fremskreven indtægt mod 35 %-målet.
- Besked 3 postes først når #3393 er merged og genberegningens dry-run er bekræftet mod A = 23.300. Ændrer dry-runnen forudsætningerne, opdateres beskeden FØR posting.
- 25 %-ugeloftet er bevidst IKKE nævnt i besked 2: engangs-korrektionen er undtaget fra ugeloftet (audit 14/8, "engangs-korrektion ejeren har set og godkendt"), så at love loftet ville være usandt for netop den.

Refs #3645 #3459 #3591 #3750 #3449 #3393 #3757
