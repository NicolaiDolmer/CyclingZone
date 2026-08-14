# Discord-udkast · catch-up v7.112 til v7.122 (14/8)

> **Klar til copy-paste. Ejeren poster selv.**
>
> Skrevet i det låste format ([#3680](https://github.com/NicolaiDolmer/CyclingZone/issues/3680), `docs/TONE_OF_VOICE.md` §Patch notes): Discord får **titel plus feltet "What changed"**. De ni versioner blev skrevet før formatet blev låst, så deres in-app-tekster er prosa uden felter. Hver tekst herunder er derfor komprimeret fra den in-app-note der allerede er live, ikke skrevet på ny. Intet indhold er tilføjet.
>
> **Erstatter** `2026-08-12-patch-notes-catchup.md` og `2026-08-13-patch-notes-7118-7120.md`, som begge er i det gamle format. Post ikke dem.
>
> **v7.121 er allerede postet** 13/8 22:17. **v7.123** ligger i `2026-08-14-patch-notes-7123.md` og postes efter blok 4.
>
> Fire blokke, fordi Discord kapper ved 2.000 tegn. Rækkefølgen er efter emne, ikke versionsnummer: en spiller der har været væk i fire dage, leder efter et emne, ikke et nummer.

---

## Blok 1 · EN · Riders and training

**Catch-up: what changed while you were racing, part 1 of 4**

**Riders 22 and older now have the same corrected identity as your younger riders**

Every rider in the game now has a fixed primary and secondary type, drawn from what he was born with, so the nightly drift that kept relabelling him is over. About 7 in 10 of your riders show a new type. That is the correction, not a new bug.

**Climbing ceilings caught up for your older riders too**

Your riders over 22 got new ability ceilings to match their corrected type. Climbing went up for about a third of them, and the room that unlocks shows from your next training run rather than immediately.

**Training now tells you when an ability has reached its ceiling**

Climbing that would not rise no matter how much you trained it was real: an ability that has reached its lifetime ceiling never moves again, and the progress bar was hiding it behind whichever ability was closest to its next point. Training now names the ability that has topped out, and marks a focus that has nothing left to give before you pick it.

**516 riders had their development ceilings corrected**

Riders created between 25 July and 12 August never got their second type written into their record, so their ceilings were calculated as though they had none. The ceilings have been rebuilt with both types, and nobody lost an ability he already had.

---

## Blok 1 · DA · Ryttere og træning

**Catch-up: hvad der skete mens I kørte løb, del 1 af 4**

**Ryttere på 22 år og opefter har nu samme rettede identitet som dine yngre ryttere**

Hver rytter i spillet har nu en fast hovedtype og bitype, sat ud fra det anlæg han blev født med, så den natlige drift der blev ved med at omdøbe ham er slut. Cirka 7 ud af 10 af dine ryttere viser en ny type. Det er rettelsen, ikke en ny fejl.

**Klatre-lofterne fulgte med for dine ældre ryttere også**

Dine ryttere over 22 fik nye evne-lofter, der matcher deres rettede type. Klatring gik op for cirka en tredjedel af dem, og den plads det låser op, viser sig ved din næste træningskørsel frem for med det samme.

**Træningen siger nu til når en evne har nået sit loft**

Klatring der ikke ville stige, uanset hvor meget du trænede den, var virkelig nok: en evne der har nået sit livstidsloft, flytter sig aldrig igen, og progress-baren skjulte det bag den evne der var tættest på sit næste point. Træningen navngiver nu den evne der er toppet, og markerer et fokus der intet har tilbage at give, før du vælger det.

**516 ryttere har fået rettet deres udviklingslofter**

Ryttere skabt mellem 25. juli og 12. august fik aldrig deres bitype skrevet ind i stamdata, så deres lofter blev regnet som om de ingen havde. Lofterne er bygget om med begge typer, og ingen mistede en evne han allerede havde.

---

## Blok 2 · EN · Scouting

**Catch-up, part 2 of 4**

**The scout button no longer promises precision it cannot deliver**

The tooltip said that scouting a rider narrows his potential estimate, but your chief scout's own rating sets a floor on how narrow that estimate can get, and with the default scout paying for the last level buys nothing at all. 149 of the 202 manager teams have not hired a chief scout and are in exactly that position.

**The scouting report said 'High confidence' about a band 10 points wide**

The chip next to your scout's verdict was never measuring confidence. It measured how completely you had scouted the rider, so every fully scouted rider read High confidence no matter who your scout was. It now says Fully scouted, Partly scouted or Barely scouted, and the verdict itself says that it is your scout's read rather than a fact.

**Two help answers said things that were not true**

The scouting help said potential is never shown as a number, though the Scouting tab on every rider profile has shown numbers per rider type for a while. The rating FAQ separately promised that a rider's number stays put unless his own abilities change, which the old scale could not guarantee. Both now say what the game actually does.

---

## Blok 2 · DA · Scouting

**Catch-up, del 2 af 4**

**Scout-knappen lover ikke længere en præcision den ikke kan levere**

Tooltippet sagde at det at scoute en rytter indsnævrer hans potentiale-estimat, men din chefspejders egen rating sætter et gulv for hvor smalt estimatet kan blive, og med standard-spejderen køber sidste niveau ingenting. 149 af spillets 202 managerhold har ikke ansat en chefspejder og står præcis der.

**Scouting-rapporten sagde 'Høj tillid' om et bånd der var 10 point bredt**

Chippen ved siden af din spejders vurdering målte aldrig tillid. Den målte hvor fuldstændigt du havde scoutet rytteren, så enhver fuldt scoutet rytter viste Høj tillid, uanset hvem din spejder var. Den siger nu Fuldt scoutet, Delvist scoutet eller Knap nok scoutet, og selve vurderingen siger nu at den er din spejders aflæsning frem for en kendsgerning.

**To hjælpe-svar sagde noget der ikke var sandt**

Scouting-hjælpen sagde at potentiale aldrig vises som et tal, selvom Scouting-fanen på hver rytterprofil har vist tal pr. ryttertype i et stykke tid. FAQ'en om rating lovede desuden at en rytters tal ligger fast medmindre hans egne evner ændrer sig, hvilket den gamle skala ikke kunne garantere. Begge siger nu hvad spillet faktisk gør.

---

## Blok 3 · EN · The academy

**Catch-up, part 3 of 4**

**Your missing intake has been delivered, plus two extra**

Every academy has received the two candidates Sunday's withdrawn intake should have given you, plus two extra as an apology. If you were one of the three teams that did receive a cohort on Sunday, you have the two extra.

**Academy prospects were being born a year older every season**

The generator read a prospect's age from the calendar year while the rest of the game reads it from the season number, so the two drifted a year apart every season. In season 3 roughly one prospect in six would have been born outside the academy age range entirely. The generator now reads the same age the rest of the game does.

**Fourteen prospects that were born too strong have been brought back into range**

Fourteen candidates still sitting in academies were generated under an older calibration and came out well above what a young rider is meant to be. They keep their name, age, potential and rider type, so it is the same rider on the same card; only the current ability level changed.

**The academy email now waits until the prospects actually exist**

The message telling you new academy talent had arrived was sent while the candidates were still being built, so it could point at riders that were not ready or not there at all. It now sends only after every candidate in the batch is complete.

**New academy prospects are now born with both of their rider types**

Until now only about one prospect in seven was born with his second type decided; for the rest the game read it off his abilities and could read it differently next time. Every new prospect now keeps both types from day one.

---

## Blok 3 · DA · Akademiet

**Catch-up, del 3 af 4**

**Jeres manglende kuld er leveret, plus to ekstra**

Alle akademier har fået de to kandidater søndagens tilbagetrukne kuld skulle have givet, plus to ekstra som undskyldning. Var du et af de tre hold der faktisk fik et kuld i søndags, har du de to ekstra.

**Akademi-emner blev født et år ældre for hver sæson**

Generatoren aflæste emnets alder ud fra kalenderåret, mens resten af spillet aflæser den ud fra sæsonnummeret, så de to drev et år fra hinanden hver sæson. I sæson 3 ville cirka hvert sjette emne være født helt uden for akademi-alderen. Generatoren aflæser nu samme alder som resten af spillet.

**Fjorten emner der blev født for stærke er sat tilbage i niveau**

Fjorten kandidater der stadig lå i akademier, var lavet under en ældre kalibrering og kom ud langt over hvad en ung rytter skal være. De beholder navn, alder, potentiale og ryttertype, så det er den samme rytter på det samme kort; kun det nuværende evneniveau er ændret.

**Akademi-mailen venter nu til emnerne rent faktisk findes**

Beskeden om at nyt akademi-talent var ankommet, blev sendt mens kandidaterne stadig blev bygget, så den kunne pege på ryttere der ikke var klar eller slet ikke var der. Den sendes nu først når hver eneste kandidat i kuldet er færdig.

**Nye akademi-emner fødes nu med begge deres ryttertyper**

Indtil nu blev kun cirka hvert syvende emne født med sin bitype fastlagt; for resten aflæste spillet den ud fra evnerne og kunne aflæse den anderledes næste gang. Hvert nyt emne beholder nu begge typer fra dag ét.

---

## Blok 4 · EN · Offers, promotions and auctions

**Catch-up, part 4 of 4**

**Unanswered academy offers no longer pile up for weeks before they expire**

An offer you never answer is meant to expire after seven days and send the prospect to a youth auction everyone can bid in, but the daily expiry limit was far below the number arriving, so the queue kept growing. The limit now lifts itself while there is a backlog, so offers you ignore leave your inbox close to the seven days they were always supposed to take.

**The promotion dialog described a wage change that does not happen**

Promoting an academy rider who already has a contract keeps that contract, wage and all. The dialog said his academy salary would be replaced by a senior wage and showed a projected number; it now shows the wage he actually has.

**A bid placed on a dropped connection now tells you it failed**

If your connection dropped in the moment you confirmed a bid or saved an auto-bid limit, the button stayed on its loading state with no error and no confirmation. Both actions now stop, say the server could not be reached, and reset so you can try again.

Full detail as always at cyclingzone.org/patch-notes.

---

## Blok 4 · DA · Tilbud, oprykninger og auktioner

**Catch-up, del 4 af 4**

**Ubesvarede akademi-tilbud hober sig ikke længere op i ugevis før de udløber**

Et tilbud du aldrig svarer på, skal udløbe efter syv dage og sende emnet på en ungdomsauktion alle kan byde i, men dagsgrænsen for udløb lå langt under antallet der kom ind, så køen blev ved med at vokse. Grænsen hæver nu sig selv så længe der er et efterslæb, så tilbud du lader ligge, forlader din indbakke tæt på de syv dage de hele tiden skulle tage.

**Oprykningsdialogen beskrev en lønændring der ikke sker**

Rykker du en akademirytter op, og har han allerede en kontrakt, fortsætter den uændret med sin løn. Dialogen sagde at akademilønnen blev erstattet af en senior-løn og viste et beregnet tal; nu viser den den løn han faktisk har.

**Et bud afgivet på en tabt forbindelse siger nu selv at det fejlede**

Faldt din forbindelse væk i det sekund du bekræftede et bud eller gemte et autobud-loft, blev knappen stående i sin loading-tilstand uden fejl og uden bekræftelse. Begge handlinger stopper nu, siger at serveren ikke kunne nås, og stiller sig tilbage, så du kan prøve igen.

Alle detaljer som altid på cyclingzone.org/patch-notes.

---

## Status: blok 1 til 4 er POSTET 14/8 kl. 10:43-10:45

Verificeret i kanalen: fire beskeder, én gang hver, rigtig rækkefølge, ingen dubletter mod noget der stod der i forvejen (krydset mod alle posts tilbage til 25/7). **v7.123 mangler stadig.**

Tre ting fra den kontrol:

1. **Linjeskiftene mellem overskrift og brødtekst faldt ud ved indsættelsen**, sammen med fed-markeringerne, så hvert punkt står som én lang linje. De tomme linjer mellem punkterne overlevede. Filen her er derfor rettet til at bruge en **tom linje** mellem overskrift og tekst i stedet for et enkelt linjeskift — så kan et tabt enkelt-linjeskift ikke gøre skade. Samme rettelse er lavet i `2026-08-14-patch-notes-7123.md`.
2. **Halvt lukket løfte.** 10/8 blev der lovet: *"I will say here when a new squad genuinely keeps what it was drawn with."* Blok 3 lukker den for akademi-emner, ikke for nye holds startertrupper. Den del er [#3512](https://github.com/NicolaiDolmer/CyclingZone/pull/3512), stadig draft, planlagt efter cutover.
3. **Tre mod fire.** Blok 3 siger "the three teams that did receive a cohort on Sunday"; posten 10/8 sagde "the four managers who had signed or won one were refunded". De måler to forskellige ting og kan begge være rigtige, men de står tæt på hinanden.

## Bemærk før du poster

- **Rækkefølge:** blok 1 til 4, derefter `2026-08-14-patch-notes-7123.md`. Blok 1 først, fordi over-22-korrektionen er den eneste du har lovet at følge op på ordret ("I will post before that correction runs", 10/8), og fordi træningsloftet er det flest har spurgt til.
- **v7.121 skal ikke postes igen.** Den gik ud 13/8 22:17.
- **Tallene er hentet fra de in-app-noter der allerede er live**, ikke genmålt i dag. `149 af 202` og `516 ryttere` var korrekte da noterne blev skrevet 13/8. Spørger nogen ind til dem, verificér mod prod før du svarer.
