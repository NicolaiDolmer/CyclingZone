# Udkast til svar til spilleren bag #5179 om hjælperyttere vs. kaptajnens point · skrevet 18/9, ejeren poster selv

> **Kanal:** Discord #dansk-snak, tråden fra 12/9 09:23-09:27 UTC. Postes som svar i den eksisterende
> tråd, ikke et nyt opslag. EN først, DA under, jf. sprogprioritet.
>
> **Beskrivelserne herunder er kvalitative, ikke eksakte tal fra motorens tuning-konstanter**
> (hard rule 17 — balance-tal skal ikke stå på GitHub, repoet er offentligt læsbart). De afspejler
> retningen af det motoren faktisk gør i dag (hvem betaler, hvem får gavn, at der findes et loft),
> men ikke de præcise lofter/priser/rater — ejeren indsætter selv konkrete tal uden for repoet, hvis
> han vil give dem til spilleren. Ingen sekunder-/watt-tal er inkluderet, fordi den omregning afhænger
> af etape og rytterens egen CP, og er ikke målt i denne audit.
>
> **Ikke dækket i dette udkast:** en præcis oversættelse af "5-7 point i den primære evne" til en
> procentdel af CP. Det kræver et opslag i evne-udregningen (`abilityDerivation.js`) som denne audit
> ikke nåede. Svaret herunder holder sig til det motoren faktisk gør med holdarbejdet, som er kernen
> i spillerens spørgsmål.

## EN

Good question, and it's a fair one to ask before you build your squad.

Here's what actually happens today. A helper working for you on a mountain stage pays a real price:
a substantial share of his own physical capacity over the whole stage, at normal effort (a bit less
on a flat stage, for leadout work). That price buys your captain protection, but only part of it
gets through: a helper's effort converts to captain benefit at well under a one-to-one rate. On top
of that there's a hard ceiling on how much of his own capacity the captain can gain from teamwork in
a single stage. One working helper already gets you a meaningful chunk of that ceiling. Two working
helpers reach the full ceiling on their own on a mountain stage, so a third or fourth domestique in
the same group doesn't add anything more to the captain's number, even though each of them still
pays their own price for being there.

So your scenario: Team A's captain is strong but isolated after climb 1, Team B's captain is
slightly weaker but has support until climb 2. The protection only exists while a working teammate
is still in the group with the captain, and it builds up gradually as the stage goes on. The moment
your last helper gets dropped, the bonus stops growing for the rest of the stage, but your captain
keeps what he already banked up to that point, he doesn't lose it. That's what you're describing as
"isolated already on climb 1": it's not a separate penalty, it's protection that simply stops
accumulating early because the helpers couldn't hold the pace, leaving less of the ceiling filled by
the finish.

Whether that outweighs a 5-7 point gap in the captain's own ability depends on the route and how
long the helpers can actually stay in the group, and I haven't measured that side by side yet. What
I can tell you for certain is that helper quality matters through exactly this mechanism, that two
good helpers already max it out, and that a captain never gets a bonus beyond what his own team
actually paid for.

## DA

Godt spørgsmål, og et fair et at stille før du bygger din trup.

Her er hvad der faktisk sker i dag. En hjælperytter der arbejder for dig på en bjergetape betaler en
reel pris: en stor del af sin egen fysiske kapacitet over hele etapen, ved normal indsats (lidt mindre
på en flad etape, for leadout-arbejde). Den pris køber din kaptajn beskyttelse, men kun en del af den
når frem: en hjælpers indsats omsættes til kaptajn-fordel med en rate der er langt under én-til-én.
Ovenpå det er der et hårdt loft på hvor meget af sin egen kapacitet kaptajnen kan få fra holdarbejde
på én etape. Én arbejdende hjælper giver dig allerede en mærkbar del af det loft. To arbejdende
hjælpere når det fulde loft helt af sig selv på en bjergetape, så en tredje eller fjerde hjælperytter
i samme gruppe lægger ikke mere til kaptajnens tal, selvom hver af dem stadig betaler deres egen pris
for at være der.

Så dit scenarie: hold A's kaptajn er stærk men isoleret efter stigning 1, hold B's kaptajn er lidt
svagere men har støtte til stigning 2. Beskyttelsen findes kun så længe en arbejdende holdkammerat
stadig er i gruppen med kaptajnen, og den bygges gradvist op i takt med at etapen skrider frem. I det
øjeblik din sidste hjælper bliver kørt af, stopper bonussen med at vokse resten af etapen, men din
kaptajn beholder det han allerede har optjent indtil da, han mister det ikke. Det er det du beskriver
som "isoleret allerede på stigning 1": det er ikke en separat straf, det er beskyttelse der simpelthen
stopper med at samle sig tidligt, fordi hjælperne ikke kunne holde tempoet, så mindre af loftet når at
blive fyldt inden mål.

Om det opvejer en forskel på 5-7 point i kaptajnens egen evne afhænger af ruten og hvor længe
hjælperne rent faktisk kan blive i gruppen, og det har jeg ikke målt op mod hinanden endnu. Det jeg
kan sige med sikkerhed er at hjælperkvalitet betyder noget gennem præcis denne mekanisme, at to gode
hjælpere allerede fylder loftet, og at en kaptajn aldrig får en bonus ud over det hans eget hold
faktisk har betalt for.
