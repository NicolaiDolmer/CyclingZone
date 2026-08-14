# Svarudkast 14/8: ubesvarede spillerspørgsmål fra de sidste 24 timer

Kilde: `scripts/discord/.sweep-daily-2026-08-14.md` (Discord 13/8 08:10 til 14/8 07:49 UTC) plus `forum_replies` i prod.
Alt herunder er klar til copy-paste. **Ikke postet.** Tallene er målt mod prod 14/8, ikke skønnet.

Rækkefølge er prioriteret: 1 og 2 er de spørgsmål der står åbne lige nu.

---

## 1. Scout-båndet: er det en garanti? (#dansk-snak, DA)

**Til:** @thelamba (07:35) og @egomadsen (07:44). Egomadsens besked er den sidste i kanalen, så den står ubesvaret lige nu.

**Verificeret:** ja. `backend/lib/scoutingReport.js:84-96`, `CEIL_BIAS_FACTOR = 0.5` og halvbredde mindst 3. Forskydningen af båndets centrum kan aldrig blive så stor at sandheden falder udenfor. Målt i prod: 0 af 3.574 spillerejede ryttere ligger i det ene hjørne hvor det kunne bryde.

> Kort svar: ja. Det rigtige tal ligger altid inde i det interval scouten viser dig. Han rammer aldrig helt ved siden af.
>
> Det scout-niveauet gør, er at gøre intervallet smallere. Det flytter det ikke. En dårlig scout siger 40-58, en god siger 48-54, og det rigtige tal er inde i begge. Derfor kan du roligt handle på det du får: det du er i tvivl om, er hvor i intervallet han lander, ikke om han overhovedet er i det.
>
> Én ting mere, for det har jeg ikke sagt tydeligt nok: tallet er en rating for rytterens rolle, ikke et loft for en enkelt evne. Står der 56-65 på en bjergrytter, er det hvor god en bjergrytter han kan blive. Det er ikke et løfte om at hver enkelt evne kan nå 56.

---

## 2. Long Chen og Sven De Jong (#bugs, forum-tråden om loft-beskeden, EN)

**Til:** @snorkalot og @mandia1984_65299. Du skrev 13/8 22:22 "Ill look into it tomorrow" og bad om navnene. Du fik dem. I dag er i morgen.

**Verificeret i prod 14/8:** begge spillere har ret i fakta.

| Rytter | Evne | Nu | Loft |
|---|---|---:|---:|
| Long Chen (16, gc/tt) | punch | 19 | **19** |
| Long Chen | climbing | 35 | 84 |
| Sven De Jong (18, puncheur/rouleur) | climbing | 48 | **48** |
| Sven De Jong | time_trial | 26 | **26** |
| Sven De Jong | sprint | 18 | **18** |
| Sven De Jong | punch | 51 | 88 |

> I checked both riders. You are both right, and the game is telling you two things that cannot both be true.
>
> Long Chen: punch sits at 19 and his ceiling for punch is 19. He will never gain punch. The training warning is correct.
>
> Sven de Jong: climbing 48 with a ceiling of 48, time trial 26 with a ceiling of 26, sprint 18 with a ceiling of 18. Those three are finished. Punch and endurance still have a long way to go, 51 out of 88 and 30 out of 88.
>
> So the training tab is right, and the scouting view is the one lying to you. The number in scouting is a rating for the rider's role, not a ceiling for each single ability. It says how good a GC rider Long Chen can become. It does not say that every ability underneath can keep climbing. Right now nothing on the page tells you that, and you are left with two screens contradicting each other.
>
> That is the thing I am fixing. Not by moving the ceilings, but by showing you per ability what is finished and what is not, so you can pick a training focus knowing where the progress actually goes.

**Bemærk før du poster:** sidste afsnit er et løfte om leverance. Det matcher #3709 trin 1, men afgør selv om du vil binde dig til det i den formulering.

---

## 3. Ratingen måles i rollen, ikke i rytterens bedste rolle (#dansk-snak, DA)

**Til:** @valverde4ever_37726 (05:10) og @knud_r_flink (05:04). Ubesvaret.

**Verificeret:** valverde har ret. Rollen kommer fra `archetype_draw` og lofterne, ikke fra dagens evner (`backend/lib/riderTypes.js:203-218`), og ratingen regnes kun på rollens egne evner (`frontend/src/lib/riderRating.js:65-73`). Målt: 2.266 af 3.574 spillerejede ryttere (63,4 %) viser en rating der er lavere end den rolle de scorer højest i. Gennemsnit 4,1 point, 86 ryttere over 10 point, største forskel 31.

> Du har ret, og det er ikke en fejl i din rytter. Det er en ting jeg ikke har vist tydeligt nok.
>
> Rollen bliver ikke valgt ud fra hvad rytteren er bedst til i dag. Den bliver valgt ud fra hvad han er bygget til at blive. Ratingen bliver derefter regnet på præcis de evner den rolle bruger. Så en rytter der er stærk i bjergene men er en rouleur, får sin rating målt på flad, udholdenhed og tempo, ikke på bjerg.
>
> Jeg har talt det op: to ud af tre ryttere på jeres hold viser et tal der er lavere end det samme rytter ville få i den rolle han scorer højest i. For de fleste er forskellen et par point. For nogle er den over ti.
>
> Det betyder ikke at rytteren er dårligere end I troede. Det betyder at I læser ham i den forkerte enhed. Radaren på hans profil viser hans tal i alle otte roller, og der kan I se hvad han faktisk er stærkest som.
>
> Om ratingen fremover skal følge hans bedste rolle i stedet for hans tildelte rolle, er et rigtigt spørgsmål. Det svarer jeg på når jeg er færdig med resten af omlægningen, ikke nu.

---

## 4. "Det er meget enten eller" (#dansk-snak, DA)

**Til:** @knud_r_flink (06:43). Ubesvaret.

**Verificeret:** hans præmis er delvist forkert, og det er nemt at rette. Opskrifterne bruger 5 til 7 evner med vægte, ikke kun rollens egne (`frontend/src/lib/generated/displayRecipes.js`). Bjergrytter: climbing 5, tempo 2, endurance 2, recovery 1, durability 1, descending 1, punch 1.

> Godt spørgsmål, og der er en detalje jeg ikke har fået sagt: det er ikke enten eller.
>
> En rolles rating er et vægtet snit af fem til syv evner, ikke af én. En bjergrytter regnes på bjerg med vægt 5, tempo 2, udholdenhed 2, og så restitution, sejhed, nedkørsel og punch med vægt 1 hver. Din Cipollini på Champs-Élysées er der altså allerede: en sprinter der også kan lidt i bakkerne får en højere sprinter-rating end en der ikke kan, fordi acceleration, positionering og flad tæller med.
>
> Det du peger på med 75/25 er en anden ting, nemlig om rollen selv skal vælges lidt mere på hvad rytteren kan i dag og lidt mindre på hvad han er bygget til. Den tager jeg med.

---

## 5. Farverne (#dansk-snak, DA)

**Til:** @friisisch (04:57 og 05:27), @smukkethomsen (04:02), @thelamba (18:15 13/8). Ubesvaret.

> Du kan ikke skifte farverne endnu, så du leder efter en knap der ikke findes. Undskyld.
>
> Og du har fat i noget: efter ratingomlægningen ligger de fleste ryttere lavt på skalaen, så en farvegradient der er lagt ud over hele spændet fra 0 til 99 giver næsten samme farve til hele din trup. Det er ikke smag, det er opløsning. Jeg tager en runde til på det, og valgbare farveskalaer står på listen.

---

## 6. In-game forum: "Is Development dead now?" (EN)

**Til:** EvoPro, 13/8 22:34, ubesvaret. Tråden har 5 svar og er startet af Metro-L3 12/8.

> "Don't start know if it's just me, but all my young talents have declined a lot in potential"

> It is not just you, and nothing was taken from your riders.
>
> Before yesterday, potential was shown as your rider's rank against everyone else with his type. Almost every rider is created around the same starting abilities, so almost every rider looked like he could reach the top ten percent. That was never true for all of them at once.
>
> Now the number is absolute. It is on the same scale as the rating, so "can reach 40-48" sits next to "he is 29 today" and the distance between them is real. The abilities, the ceilings and the types under the hood are exactly what they were the day before.
>
> The honest part: the old display flattered your squad, and this one does not. I would rather you can trust the number than enjoy it.

---

## Uafklaret, jeg kan ikke svare for dig

- **@friisisch, 14/8 05:57-05:58:** "Jeg har også fået ting serveret i sæson 2? Det kunne jeg godt tænke mig at høre nærmere om". Jeg kan ikke se hvad han refererer til, og der er intet i kanalen lige før der forklarer det. Spørg ham.
- **@thelamba, 14/8 04:55:** "Den sorterer ikke så godt", om en rytterliste sorteret på potentiale. For vagt til at fejlsøge, og det kan være det samme som #3706 (sortering på Status i daglig træning) eller noget andet. Bed om et skærmbillede med kolonnen han sorterede på.
- **Din egen 05:14:** "Forstår simpelthen ikke hvordan sådan noget her kan se helt fint og flot ud i mockups, så når det er på live, så ligner det amatørbræk". Jeg kan ikke se hvilken flade du så på. Er det træningssiden, er den dækket af #3643 og #3644.
