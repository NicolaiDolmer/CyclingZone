# Discord-udkast: tilbagerulning af loftændringen (15/8)

**Kanal:** #general (EN) + #dansk-snak (DA)
**Post når:** PR #3791 er merget og første tick har kørt.
**Status:** UDKAST. Ejeren poster selv.

Baggrund: spillerne opdagede selv ændringen 14/8 kl. 22:04 (`thelamba`: "Der er sket noget med potentialerne igen!"), og du svarede kl. 22:10 at det ikke var meningen. Der er også åbne spørgsmål om +2 og +3 spring i #dansk-snak fra i morges. Beskeden svarer på begge.

---

## EN (#general)

Yesterday's ceiling update went too far, and I have rolled it back.

The update raised every ability ceiling much more than intended. 748 riders ended up able to reach above 95, when what I told you was that very few would ever get there. That was my mistake, not a surprise in the data.

Ceilings are now exactly where they were yesterday morning. Nobody can reach above 95 from their ceiling alone any more.

**Nobody loses anything.** If a rider already sits above his ceiling he keeps every single point. He just will not grow further on that one ability. Your riders' shown potential goes back to its earlier value over the next day, as each rider trains.

On the +2 and +3 jumps some of you saw this morning: those came from the same cause. The inflated ceilings made the gap to the ceiling huge, and daily growth scales with that gap. They should settle back down now.

I have also added a check that runs before any future change to this system. It measures the numbers you actually read on a rider's profile, not just my simulations, and it blocks the change if they move outside agreed limits. The reason yesterday slipped through is that the problem was measured but only written down as a note, not as something that could stop the release.

The real fix is next. Right now potential does two jobs at once: it sets how high a rider can reach and how fast he gets there. Splitting those two is what I am building, and it is what makes "only a very few reach the top" true by design instead of by me picking the right numbers.

---

## DA (#dansk-snak)

Gårsdagens loftopdatering gik for vidt, og jeg har rullet den tilbage.

Opdateringen hævede alle evne-lofter meget mere end tilsigtet. 748 ryttere endte med at kunne nå over 95, hvor jeg havde sagt at meget få nogensinde ville komme derop. Det var min fejl, ikke en overraskelse i data.

Lofterne er nu præcis der hvor de var i går morges. Ingen kan længere nå over 95 alene på grund af sit loft.

**Ingen mister noget.** Ligger en rytter allerede over sit loft, beholder han hvert eneste point. Han vokser bare ikke videre på den ene evne. Dine rytteres viste potentiale går tilbage til sin tidligere værdi over det næste døgn, efterhånden som de trænes.

Om de +2 og +3 spring nogle af jer så i morges: de kom fra samme årsag. De oppustede lofter gjorde afstanden op til loftet enorm, og den daglige vækst følger netop den afstand. De burde falde til ro nu.

Jeg har samtidig lagt en kontrol ind som kører før enhver fremtidig ændring i det her system. Den måler de tal I faktisk aflæser på en rytters profil, ikke bare mine simuleringer, og den stopper ændringen hvis de flytter sig uden for aftalte grænser. Grunden til at det slap igennem i går er at problemet blev målt, men kun skrevet ned som en note, ikke som noget der kunne stoppe udgivelsen.

Den rigtige løsning kommer nu. Lige nu gør potentiale to ting på én gang: det sætter både hvor højt en rytter kan nå og hvor hurtigt han kommer derhen. At skille de to ad er det jeg er i gang med, og det er dét der gør "kun meget få når toppen" sandt af sig selv i stedet for at afhænge af at jeg rammer de rigtige tal.

---

## Noter til dig inden du poster

- Beskeden erkender fejlen direkte. Det er bevidst: spillerne så det før vi meldte det, så en neutral formulering ville læses som at vi ikke havde opdaget det.
- Den lover ikke en dato for den rigtige løsning. Der er 8 dage til cutover 23/8, og trin 7 rører scouting, økonomi og #3679.
- Hvis nogen spørger hvorfor potentialet er ændret tre gange på en uge, er det ærlige svar at de to første var reelle rettelser (typerne var forkerte) og den tredje var en fejl fra min side.
