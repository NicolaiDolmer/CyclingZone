# Community fredag, udkast til copy-paste (4/9 2026)

> Ejeren poster selv. Skrevet i founder-stemmen per `docs/TONE_OF_VOICE.md`. (a), (b) og (c) blev droppet af ejeren 4/9; (d) og race-engine-indlaegget finpudser ejeren selv.

---

## (d) Poll: free agent auction minimum time (#4714)

**EN:**
Quick poll for you. Free agent auctions, riders with no team right now, always run at least 12 hours when the game itself starts them, so nobody misses out because they were asleep or at work. But when a manager starts one and sets the end time, it can close in as little as 1 hour, and a lot of auctions use that shortcut. Should 12 hours become the minimum here too?

A) Yes, 12 hours minimum for every free agent auction, no matter who starts it.
B) No, keep it as it is, a manager can still end it in as little as 1 hour.

**DA:**
Hurtig afstemning til jer. Fri agent-auktioner, altså ryttere uden hold lige nu, kører altid mindst 12 timer, når spillet selv starter dem, så ingen går glip af noget fordi de sov eller var på arbejde. Men når en manager selv starter en og vælger sluttiden, kan den lukke på helt ned til 1 time, og en del auktioner bruger den genvej. Skal 12 timer også være minimum her?

A) Ja, 12 timer som minimum for alle fri agent-auktioner, uanset hvem der starter den.
B) Nej, behold det som det er, en manager kan stadig lade den slutte på ned til 1 time.


---

---

## (e) What's coming for the race engine

Where the engine stands today, what has to be in place before the next version, what else is on the list, and what it means for you as a manager.

## EN

Every result in Cycling Zone comes out of a race engine I built myself: a deterministic simulator that takes each rider's abilities and the shape of the stage, flat, hilly, mountain, cobbles, gravel, time trial, and works out who does what. It handles how groups form, how climbs and descents split the field, and how a finale resolves. Same conditions in, same fair result out, every time, for every manager in the race.

What it doesn't do well yet is the reason I'm not touching the next version until three things are fixed.

**The engine doesn't always read a stage the way it's actually built.** On some stages the terrain calculation leans on the wrong detail, like a small early climb pulling weight it shouldn't on a stage that should clearly end in a flat sprint. Before I move on, every stage type needs to behave like what it is: a cobbled classic should ride like a cobbled classic, a pure sprint stage like a pure sprint stage.

**Crashes and mechanicals are all or nothing right now.** If your rider goes down, the result is usually gone completely: no time, nothing. Picture your GC captain crashing on a technical descent in the mountains. What I want instead is for that to cost him real time, maybe drop him out of the front group and into a chase, while he still finishes and you keep him for the rest of the race. A punctured wheel should work the same way: lose time, not the whole day. Only the serious crashes should end someone's race.

**There's no realistic time limit yet.** In real racing, the grupetto forms on purpose: sprinters and riders who can't follow the climbers band together in the mountains to survive inside the cut, sometimes by seconds. I want to build something close to the real UCI time-limit rules, which scale with the stage, roughly a window around the winner's time depending on the profile. Once that exists, the back of the group actually matters, and a bad mountain day can cost you a rider, not just a result.

Further out, and not yet locked to any order: breakaways and proper sprint trains that make tactical roles change how a stage actually plays out, crosswind stages that split the field into echelons the way real classics sometimes fall apart, a tactics card so you can give orders per stage instead of only a season-long role, and more terrain, gravel and cobbled sectors, feeding the engine as their own thing rather than a variant of something else.

For your tactics, this is the direction: terrain, roles, and race situations should matter more than they do now. Picking the right domestique for a cobbled stage, deciding who chases a breakaway, trusting your sprinter can survive a mountain stage in the grupetto instead of it being a coin flip, a crash becoming a setback instead of an instant disaster.

I'm not giving you dates for any of this, and I'm not going to start. I build in the open, and I ship pieces as they're ready and tested against real results, not on a calendar.

## DA

Alle resultater i Cycling Zone kommer fra en løbsmotor, jeg selv har bygget: en deterministisk simulator, der tager hver rytters evner og etapens form, flad, kuperet, bjerge, brosten, grus, enkeltstart, og regner ud, hvem der gør hvad. Den styrer, hvordan grupper dannes, hvordan stigninger og nedkørsler splitter feltet, og hvordan en finale afgøres. Samme forhold ind, samme fair resultat ud, hver gang, for hver manager i løbet.

Det, den ikke gør godt nok endnu, er grunden til, at jeg ikke rører den næste version, før tre ting er på plads.

**Motoren læser ikke altid en etape, som den faktisk er bygget.** På nogle etaper hælder terrænberegningen mod den forkerte detalje, som en lille tidlig stigning, der trækker for meget vægt på en etape, der klart burde ende i en massespurt. Før jeg går videre, skal hver etapetype opføre sig som det, den er: en brostensklassiker skal køre som en brostensklassiker, en ren spurtetape som en ren spurtetape.

**Styrt og mekaniske uheld er lige nu alt eller intet.** Går din rytter ned, er resultatet som regel helt væk: ingen tid, ingenting. Forestil dig din GC-kaptajn, der styrter på en teknisk nedkørsel i bjergene. Det jeg vil have i stedet er, at det koster ham reel tid, måske skubber ham ud af frontgruppen og ned i en jagtgruppe, mens han stadig fuldfører, og du beholder ham resten af løbet. En punktering skal virke på samme måde: mistet tid, ikke mistet dag. Kun de alvorlige styrt skal afslutte en rytters løb.

**Der er ingen realistisk tidsgrænse endnu.** I virkelighedens cykling dannes grupetto med vilje: sprintere og ryttere, der ikke kan følge klatrerne, samler sig i bjergene for at overleve inden for grænsen, nogle gange med sekunder. Jeg vil bygge noget tæt på de rigtige UCI-tidsgrænseregler, som skalerer med etapen, groft sagt et vindue omkring vinderens tid afhængig af profilen. Findes det først, betyder bagenden af feltet faktisk noget, og en dårlig bjergdag kan koste dig en rytter, ikke bare et resultat.

Længere ude, og endnu ikke låst til en rækkefølge: udbrud og rigtige sprinttog, der gør, at taktiske roller ændrer, hvordan en etape reelt udspiller sig, sidevindsetaper der splitter feltet i vifter, sådan som rigtige klassikere nogle gange falder fra hinanden, et taktikkort så du kan give ordrer pr. etape i stedet for kun en rolle for hele sæsonen, og mere terræn, grus- og brostenssektorer, der fodrer motoren som deres eget i stedet for en variant af noget andet.

For din taktik er det retningen: terræn, roller og løbssituationer skal betyde mere, end de gør nu. At vælge den rigtige domestique til en brostensetape, at beslutte hvem der jagter et udbrud, at stole på, at din sprinter kan overleve en bjergetape i grupetto i stedet for at det er et lodkast, at et styrt bliver et tilbageslag i stedet for en øjeblikkelig katastrofe.

Jeg giver dig ingen datoer på noget af det her, og jeg begynder ikke nu. Jeg bygger i det åbne, og jeg shipper stykker, når de er klar og testet mod rigtige resultater, ikke efter en kalender.

---

---

## (f) Discord note (peger på forum + Community fredag)

**EN:**
It's Community Friday. New posts are up on the forum: this week's fixes, where Season 3 stands, a poll on free agent auctions, and what's coming next. Come read along and vote if you haven't already.

**DA:**
Det er community fredag. Der er nye opslag på forummet: denne uges rettelser, hvor sæson 3 står, en afstemning om fri agent-auktioner, og hvad der er på vej. Kig forbi, læs med og stem hvis du ikke allerede har.


---

## Bonus: svar til tråden "Test - Is it working?" (lukker den med et glimt i øjet)

**EN:**
> Yes, yes, and also yes, confirmed working since day one. Closing this one out three for three.

**DA:**
> Ja, ja og også ja, bekræftet virkende siden dag ét. Lukker denne på tre ud af tre.

---

## Fakta-tjek (kun til ejeren, ikke til forummet)

- **UCI-tidsgrænse-procentsatsen (5-20% af vindertid afhængig af etapetype)** er nævnt i issue #2582 som ejerens eget udgangspunkt for designet. Jeg har holdt det bevidst upræcist i teksten ("roughly a window... depending on the profile" / "groft sagt et vindue... afhængig af profilen") fremfor at citere det præcise interval, fordi `RACE_ENGINE_RULES.md`s offentlighedspolitik (#3436) forbyder præcise tærskler i offentligt indhold. Vurdér om selv den vage formulering er for tæt på en tærskel, eller om den er OK som ren cykel-fluency (det er en reference til en reel, offentlig UCI-regel, ikke et internt balance-tal).
- **"Rute-huller" (#2789)-eksemplet er en fri, forsimplet oversættelse** af de tekniske fund (isTechnicalFinale-gaten, routeBreakawayFactor-clampen m.fl.) til ét letforståeligt billede (lille bakke der fejlagtigt gør en flad etape "teknisk"). Det er repræsentativt for fund #1 i issuet, men dækker ikke alle 6 fund. Tjek at eksemplet ikke opleves som for teknisk eller for søgt af en spiller uden indblik i koden.
- **Rækkefølgen af de tre krav** (rute-huller → styrt → tidsgrænse) følger rækkefølgen i `docs/NOW.md`s "Krav til v4"-linje, ikke en bekræftet prioritering fra ejeren. Der findes ingen ejer-udtalt rækkefølge mellem de tre ud over "alle tre skal være på plads" (#2944-kommentar 4/9).
- **"Sprinttog"/leadout-ordet i "andre planlagte ting"** refererer til M6 (leadout-roller), som ifølge `RACE_ENGINE_RULES.md` allerede er "wiret" internt (3/9) men ikke player-facing/live endnu (v3 er stadig den aktive motor). Formuleringen "further out, not yet locked to any order" bør dække dette, men tjek at det ikke lyder som noget der allerede er tilgængeligt i spillet.
- **Jeg har ikke fundet en eksisterende issue-reference for "crosswind/echelons" ud over #2476** (medium prioritet, ikke del af de tre v4-krav) og har beskrevet det som "further out" sammen med taktikkort (#3855-scope) og grus/brosten-sektorer (allerede delvist i motoren, jf. `RACE_ENGINE_RULES.md` §2b, men beskrevet her som "mere terræn der fodrer motoren" fordi grus/brosten kun er delvist implementeret på tværs af etapetyper). Vurdér om denne "andre ting"-liste rammer rigtigt, eller om du hellere vil pege på noget andet fra MASTERPLAN-området.
- **Ingen tal fra selve spillets balance/kalibrering er brugt** (alle procenttal fra RACE_ENGINE_RULES.md/issues er udeladt per offentlighedspolitikken), så teksten har bevidst ingen konkrete spiller-rammende tal ud over UCI-referencen ovenfor. Bekræft at det er den rigtige afvejning, eller om du vil have ét konkret tal ind alligevel.

---

# Forum post: "Youth classification: fixed and recalculated"

## EN

I found a bug in the youth classification. It was letting in riders who are actually too old for it, because I calculated a rider's age wrong for that classification. That mistake affected prize money and points from finished stage races this season.

Today I fixed the age calculation and recalculated every finished stage race it touched. Where a team had been overpaid, I've pulled back the difference. Where a team had been underpaid, I've paid it out. Points have been corrected both ways too. 40 teams are affected in total.

You'll see this on your team's finance page, listed as a correction. No team's balance went below zero, the money only moved between the teams that should and shouldn't have had it.

This one was my mistake. Sorry for the mess, and thanks for catching it.

## DA

Jeg fandt en fejl i ungdomsklassementet. Den lukkede ryttere ind, som reelt er for gamle til den, fordi jeg beregnede en rytters alder forkert i klassementet. Fejlen ramte præmiepenge og point fra afsluttede etapeløb i denne sæson.

I dag har jeg rettet aldersberegningen og genberegnet hvert afsluttet etapeløb, den ramte. Hvor et hold havde fået for meget udbetalt, har jeg trukket differencen tilbage. Hvor et hold havde fået for lidt, har jeg betalt differencen. Point i ungdomsklassementet er også rettet begge veje. 40 hold er berørt i alt.

Du kan se det på dit holds økonomiside, som en korrektion. Ingen holds saldo endte under nul, pengene er kun flyttet mellem de hold, der skulle og ikke skulle have haft dem.

Den her fejl er min. Undskyld rodet, og tak fordi I fangede den.

---

# Discord (2 lines, points to forum post)

## EN

Youth classification had a bug that let in riders too old for it. I've fixed it and corrected money and points both ways for 40 teams, no one went negative.
Full explanation and what you'll see on your finance page here: [link to forum post]

## DA

Ungdomsklassementet havde en fejl, der lukkede for gamle ryttere ind. Jeg har rettet den og rettet penge og point begge veje for 40 hold, ingen er gået i minus.
Fuld forklaring og hvad du ser på din økonomiside her: [link til forumindlæg]
