# Spillersvar 10/10 (ejeren poster selv)

Skrevet i ejerens stemme efter docs/TONE_OF_VOICE.md. Kun fakta pr. 10/10 aften. Hvert svar er klar til copy-paste.

## 1. knud_r_flink, #dansk-snak: ingen overbudt-notifikation (#6385)

```
Du er ikke den eneste, og det er ikke dig. Jeg kan se det samme mønster: overbud skal give en notifikation, og det gjorde det ikke i dit tilfælde to gange. Jeg har det på listen som en fejl og vender tilbage, når jeg har fundet årsagen. Tak for at sige det to gange, det hjalp mig med at se, at det ikke var en enkeltstående.
```

## 2. Q&A: hvor kom skaden fra, løb eller træning? (#6302)

```
Good question, and right now the game doesn't show it. You can't see whether an injury came from a race or from training. I've added it to my list: the rider page should tell you where and why it happened. It's not built yet, the race engine comes first, but it's noted.
```

## 3. Forslag: vælg ryttere med afkrydsning i truplisten (#6303)

```
I like this one. Picking riders for the fatigue limit and training groups from a name list is clumsy, ticking them off in the squad list is better. It's on my list. It waits until the race engine update is out, because that has all my building time right now.
```

## 4. Forum: bedste træningskombination pr. ryttertype (#6242)

```
Fair question, and the help page doesn't answer it well enough yet. I'm writing a proper help section on how the 5 race days in a plan add up for each rider type, including your example of 3x VO2 + endurance + TT against 5x VO2 for a GC rider, so you don't have to guess.
```

## 5. friisisch + jaxx: tidsforskel i ungdoms- og holdklassement (#6384)

```
Still on my list, and I haven't forgotten it. The team classification gets reworked in the big race engine update, so I want to show the time gaps after that change, not before it. I'll say it in the patch notes when it's there.
```

## 6. thelamba: dobbelt nationalitet + amerikanere med franske efternavne (#6422)

```
You spotted a real one. American riders can get French-sounding surnames because of how the name generator mixes name pools, so Brandon Gauthier isn't just your eyes. I've logged it. Double nationality is a bigger question I haven't decided on yet, I'll come back to it.
```

## 7. Rutematch: 56 i sæsonmatrix, 51 i Planlæg dag (#6207)

```
Thanks, that's a bug. The same rider in the same race should show the same route match on both pages. I've logged it and will fix it so the two numbers agree.
```

## 8. EXP-ikon mangler på U23 og junior (#6206)

```
Confirmed, the expiring-contract icon only shows on the senior squad right now. It should be on U23 and junior too. Logged as a bug.
```

## 9. Train now træner kun 4 af 5 dage

EN:
```
This one is by design, and I should explain it better in the game. Train now trains the race days that have happened so far. The last race day of the date is always settled in the evening training at 20:00, because that's where form and fatigue for the day are written. After 20:00 your riders have all 5 of 5.
One real bug I found while checking: a rider who changed team during the day could end up with only 4. That's fixed now.
```

DA:
```
Den her er med vilje, og jeg skal forklare den bedre i spillet. Train now træner de løbsdage, der er kørt indtil nu. Datoens sidste løbsdag afregnes altid ved aftentræningen kl. 20, fordi det er dér, dagens form og træthed skrives. Efter kl. 20 har dine ryttere alle 5 af 5.
Én rigtig fejl fandt jeg undervejs: en rytter, der skiftede hold i løbet af dagen, kunne ende med kun 4. Den er rettet nu.
```

## 10. Train now-knappen gør intet omkring kl. 20

EN:
```
I checked, and there are no errors behind it. From 20:00 the evening training owns the date: the day is being settled or is already settled, so Train now has nothing left to train and nothing visible changes. I'll make the button say that instead of looking like it did nothing.
```

DA:
```
Jeg har tjekket det, og der er ingen fejl bag. Fra kl. 20 ejer aftentræningen datoen: dagen bliver afregnet eller er allerede afregnet, så Train now har ikke mere at træne, og intet ændrer sig synligt. Jeg får knappen til at sige det, i stedet for at det ser ud som om den ikke virkede.
```

## Staff-udmelding om form (#staff-chat)

```
Kort om form: form kommer med i den store motoropdatering, uden formtoppe. Formtoppe kommer i S5.
```

## Noter til ejeren
- Svar 9 nævner rettelsen af holdskifte. Post først, når #6446 er merget og migrationen er verificeret i prod.
- Svar 10 lover en knaptekst. Den er ikke bygget; sig til, hvis det løfte skal ud.
- Svar 6: navne-observationen er verificeret i koden (#6422). Rettelsen er ikke bygget.
