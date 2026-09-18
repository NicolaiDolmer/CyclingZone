# Udkast til svar til jonasnielsen_05591 om hjælperyttere vs. kaptajnens point (#5179) · skrevet 18/9, ejeren poster selv

> **Kanal:** Discord #dansk-snak, tråden fra 12/9 09:23-09:27 UTC. Postes som svar i den eksisterende
> tråd, ikke et nyt opslag. EN først, DA under, jf. sprogprioritet.
>
> **Tal brugt herunder er hentet direkte fra motorens tuning-konstanter**
> (`backend/lib/engine/v4/tuning.ts`, `TEAM_PLAY_EXTRA_TUNING`, kalibreret 7/9 til v3-paritet, #4914),
> ikke opfundet. De er de faktiske lofter og priser motoren regner med i dag. Ingen sekunder-/watt-tal
> er inkluderet, fordi den omregning afhænger af etape og rytterens egen CP, og er ikke målt i denne
> audit.
>
> **Ikke dækket i dette udkast:** en præcis oversættelse af "5-7 point i den primære evne" til en
> procentdel af CP. Det kræver et opslag i evne-udregningen (`abilityDerivation.js`) som denne audit
> ikke nåede. Svaret herunder holder sig til det motoren faktisk gør med holdarbejdet, som er kernen
> i spillerens spørgsmål.

## EN

Good question, and it's a fair one to ask before you build your squad.

Here's what actually happens today. A helper working for you pays a real price: up to 40.5% of his
own physical capacity over the whole stage on a mountain day (a bit less on a flat stage, for
leadout work). That price buys your captain protection, but only part of it gets through: 60% of
what your helpers spend converts into your captain's benefit, and there's a hard ceiling on top of
that: your captain can never gain more than 21.6% of his own capacity from teamwork in a single
stage, no matter how many helpers you throw at it. One strong domestique already gets you most of
that; four gets you close to the full amount, and a fifth doesn't add more.

So your scenario: Team A's captain is strong but isolated after climb 1, Team B's captain is
slightly weaker but has support until climb 2. The protection only exists while a working teammate
is still in the group with the captain. The moment your last helper gets dropped, the bonus stops
building for the rest of the stage, and your captain rides on his own numbers from there. That's
exactly what you're describing as "isolated already on climb 1": it's not a separate penalty, it's
protection simply running out early because the helpers couldn't hold the pace.

Whether the 21.6% ceiling outweighs a 5-7 point gap in the captain's own ability depends on the route
and how long the helpers can actually stay in the group, and I haven't measured that side by side
yet. What I can tell you for certain is that helper quality matters through exactly this mechanism,
it is capped so eight helpers can't buy an unlimited lead, and a captain never gets a free bonus
beyond what his own team actually paid for.

## DA

Godt spørgsmål, og et fair et at stille før du bygger din trup.

Her er hvad der faktisk sker i dag. En hjælperytter der arbejder for dig betaler en reel pris: op til
40,5% af sin egen fysiske kapacitet over hele etapen på en bjergdag (lidt mindre på en flad etape, for
leadout-arbejde). Den pris køber din kaptajn beskyttelse, men kun en del af den når frem: 60% af det
dine hjælpere bruger, bliver til fordel for din kaptajn, og der er et hårdt loft ovenpå: din kaptajn
kan aldrig få mere end 21,6% af sin egen kapacitet fra holdarbejde på én etape, uanset hvor mange
hjælpere du sætter ind. Én stærk hjælperytter giver dig allerede det meste af det, fire giver dig tæt
på det fulde beløb, og en femte lægger ikke mere til.

Så dit scenarie: hold A's kaptajn er stærk men isoleret efter stigning 1, hold B's kaptajn er lidt
svagere men har støtte til stigning 2. Beskyttelsen findes kun så længe en arbejdende holdkammerat
stadig er i gruppen med kaptajnen. I det øjeblik din sidste hjælper bliver kørt af, stopper bonussen
med at bygge sig op resten af etapen, og din kaptajn kører videre på sine egne tal derfra. Det er
præcis det du beskriver som "isoleret allerede på stigning 1": det er ikke en separat straf, det er
beskyttelse der simpelthen løber tør tidligt, fordi hjælperne ikke kunne holde tempoet.

Om loftet på 21,6% opvejer en forskel på 5-7 point i kaptajnens egen evne afhænger af ruten og hvor
længe hjælperne rent faktisk kan blive i gruppen, og det har jeg ikke målt op mod hinanden endnu. Det
jeg kan sige med sikkerhed er at hjælperkvalitet betyder noget gennem præcis denne mekanisme, at den
er loftet så otte hjælpere ikke kan købe et ubegrænset forspring, og at en kaptajn aldrig får en gratis
bonus ud over det hans eget hold faktisk har betalt for.
