# Discord-udkast · cutover-beskederne til 23/8 (17/8)

> **Klar til copy-paste. Ejeren poster selv.** Kopiér fra RÅteksten, ellers falder linjeskift ud.
>
> **Besked 1 (race-day) SKAL postes FØR søndag 23/8** (ejer-beslutning 17/8: spillerne hører om AI-loft-korrektionen fra os, ikke fra deres egne observationer).
>
> **Besked 2 (værdier) postes KUN hvis spor 9-gaten er GRØN 22/8** (refit måler mindst lige så godt som den kørende model). Er gaten RØD, post i stedet fallback-beskeden fra `2026-08-14-vaerdi-besked.md` (30/8-datoen). Pladsholdere i [KLAMMER] SKAL erstattes med målte tal fra spor 9's rapport før posting.
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

## Besked 2 · Værdierne (EN) — KUN VED GRØN GATE, indsæt målte tal

**Values: market-based values arrive Sunday 23 Aug**

Two weeks ago I told you the new value model was not good enough to ship, and why. That work has now been redone.

Two things changed. Bank sales at the fixed starting rate no longer count as market evidence, so the model now learns only from real trades between managers. And the model has been refit on the corrected rider types. Measured against the most recent trades it now misses a rider's real sale price by around [REFIT-MAE] CZ$, against [LIVE-MAE] for the model running today.

From Sunday, values follow the market per rider based on how much trade evidence exists. A rider with many real trades follows the market closely. A rider with few barely moves. No rider can move more than 25 % in a single week, and most will move far less.

Salaries do not change with this update. That is a separate track and I will write about it separately.

## Besked 2 · Værdierne (DA) — KUN VED GRØN GATE, indsæt målte tal

**Værdier: markedsbaserede værdier kommer søndag 23/8**

For to uger siden fortalte jeg jer at den nye værdimodel ikke var god nok til at sende, og hvorfor. Det arbejde er nu lavet om.

To ting er ændret. Bank-salg til den faste startpris tæller ikke længere som markedsevidens, så modellen lærer nu kun af rigtige handler mellem managere. Og modellen er tilpasset de rettede ryttertyper. Målt mod de nyeste handler rammer den nu en rytters faktiske salgspris cirka [REFIT-MAE] CZ$ forkert, mod [LIVE-MAE] for den model der kører i dag.

Fra søndag følger værdierne markedet pr. rytter efter hvor meget handelsevidens der findes. En rytter med mange rigtige handler følger markedet tæt. En rytter med få flytter sig næsten ikke. Ingen rytter kan flytte sig mere end 25 % på én uge, og de fleste flytter sig langt mindre.

Lønningerne ændrer sig ikke med denne opdatering. Det er et selvstændigt spor, og det skriver jeg om for sig.

---

## Kilder og forbehold

- Race-day-mekanikken: `dailyTraining.js` (applyRaceDevelopmentTick, devMult ~1,15), `trainingSweep.js` (is_ai-filteret fjernes), `aiRecoverySweep.js` (no-op), `raceFatigue.js` (RACE_DAY_ENGINE_RECOVERY_CONFIG). AI-loft-korrektionen: 45,4 % af 3.473 AI-ryttere taber loft, p10-tab 29 point på bedste evne (#3591-målingen 10/8). "Jeres egne ryttere påvirkes ikke": korrektionen rammer kun AI-holdenes ryttere, menneskeholdenes caps alders-tickes allerede.
- [REFIT-MAE]/[LIVE-MAE]: SKAL komme fra spor 9's scorecard (samme metode som auditten 14/8, tidsbaseret holdout). Post ALDRIG med pladsholderne.
- 25 %-loftet: `market_value_weekly_cap` = 0.25 (ejer-besluttet 6/8).
- Løn-linjen er bevidst: #3393 afventer fælles design (ejer 17/8), så beskederne lover intet om løn.

Refs #3645 #3459 #3591 #3750 #3449
