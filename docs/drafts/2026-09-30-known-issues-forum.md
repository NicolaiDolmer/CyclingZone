# Known issues forum draft

Owner draft only. Re-check the evidence ledger and live PR/deploy state before posting. EN first; DA follows. Dates are owner-stated expectations, not completed delivery. No automatic posting.

## EN: Where things stand after the season start

Hi 🙂

I'd like to put the known problems in one place, along with what I've found and what I'm planning to do about them. You shouldn't need to follow every Discord conversation to work out what's happening.

The new engine has caused some frustrating results. I understand why it feels worse when the previous one had started behaving reasonably well. Calling this a beta doesn't make a strange result any less frustrating, so here's the actual status.

### Races and the engine

**Breakaway flags are mixing different things.** On this evening's Auvergne stage, eight riders were in the morning break, while twenty had a breakaway flag in the result. The flag also picked up some later attacks. I'm separating morning breakaways from later attacks and making the race report explain the difference. A flag currently doesn't prove that your rider deliberately joined the morning break.

**Riders can attempt the morning break without the order you intended.** I'm making the existing roles and orders much clearer in the engine. A captain or helper should not decide to join the morning break without the appropriate order. Free role will retain some autonomy, while saving energy will limit spontaneous attempts. Choosing to attempt a break won't guarantee getting away.

**The engine can force a breakaway to form.** I've reproduced a selection problem where riders are added even when their selection rolls say no. I'm removing that behaviour and adding a real response from rival teams during the attempt. Sometimes an attack should simply fail to establish a break.

**GC threats aren't evaluated using the actual standing properly.** The reaction currently relies on an ability-based assessment instead of the full pre-stage GC situation. A rider close to the leader and a rider well behind should be treated differently. Neutral should be a sensible plan that reacts to the race, without everyone needing to select chase on every stage.

**Some catches can produce artificial time losses.** I've found a group/chase calculation that can place escapees incorrectly when the field has split. This needs a calculation fix, not just nicer wording. Getting caught shouldn't itself come with a mysterious extra time penalty.

**The film and result don't always tell the same story.** Missing catches, later attacks presented as morning breaks, and misleading finish descriptions are being addressed together. Catching a rider and dropping him afterwards need to be separate events you can understand.

**Specialists finishing unexpectedly far back are also on the list.** I have reports about strong sprinters, climbers and cobbled riders finishing behind weaker teammates. Some cases overlap the failures above. I'm checking the remaining cases against terrain, condition, orders and support rather than promising that the best single stat always wins.

**Mountain points on a flat time trial have been reported.** That specific route/points case still needs checking. It isn't covered by saying the intermediate-sprint problem is fixed.

My aim is to start releasing the first engine corrections from Thursday 1 October, once they're tested. That isn't a promise that the entire tactical update lands at once. Calculation and display fixes can apply to the next unrun stage. New tactical and balance rules are intended for newly starting stage races, so your plan doesn't change halfway through a race. That release separation still has to be implemented. I'm not announcing a recalculation of completed results here.

### Training: the five things announced for Thursday

The plan for Thursday 1 October still includes all five:

- **Train when it suits you.** Bring back Train now without an advantage for training at a particular hour. Training uses the available race-day slots; it doesn't create an extra session or allow the same slot to be used for both racing and training.
- **Plan each race day.** Choose hard, normal, recovery or rest for the day's individual slots. Race slots and free training slots need to be clear.
- **See tonight's expected fatigue before choosing.** Adjust the plan with a forecast instead of guessing.
- **Rules that work while you're away.** Rest above your chosen fatigue limit and return to the selected programme afterwards.
- **One clear report per date.** Bring the day's activity together so you're not judging an entire day from the last of several reports.

The consolidated rider receipt is now released in beta, with the date’s saved activity and documented session scores together. This delivers the report part of the announced package. The other four changes still need their own delivery checks.

**Historical missing training is a separate job.** The fatigue/form calculation has been corrected, and the approved historical repair has been applied. Some exceptions still need resolving. The training missed on 28 September has its own recovery case; I won't call that restored until it has actually been repaired and checked.

**Development history has reported discrepancies.** Missing skill changes and confusing totals are being investigated separately from how the daily report is displayed.

**Training speed is being checked.** I've heard the reports that focused talents develop more slowly. I'm comparing actual daily totals and programmes, not treating the number of breakthroughs as proof on its own. I previously mentioned Monday/Tuesday, 5-6 October, as a possible time for that analysis once more data is available. That's an analysis target, not a promised change to the rate.

### Other reported issues

These are registered too. They don't all have a confirmed cause or a release date:

- U23/junior racing needs a clear opt-out. I previously said this week; it isn't a confirmed Thursday delivery.
- A junior squad below the starting minimum can be shown as participating even though it doesn't start.
- Squad changes can leave confusing entries or race bindings. Some cleanup already exists; the remaining cases need checking.
- A participation problem after a rider changes teams is being investigated and corrected. Any decisions about already calculated results are handled separately.
- Some board history was affected by youth races. The historical cleanup is separate from preventing new incorrect updates.
- A renegotiated board target may still display the old target.
- Deleted squad-selection reminders can return, and the reminder switch can be difficult to see when turned off in dark mode.
- Rider search can return names that don't match what you typed.
- Some prize estimates are much too broad to be useful.
- A sponsor report shows a mismatch between the displayed agreement and the amount per race day. I'm checking payment, display and units before claiming anyone was underpaid.
- Some mobile pages have had loading/cache problems. A workaround helped a reported case; that doesn't mean the entire problem is solved.

Clearer planning-column labels and current form are released. The transfer correction also protects race days already used for the previous team; future race days remain available.

### Already corrected

Intermediate sprint and mountain passage ordering has been corrected and checked in actual stages after release. Team-classification tie handling has also been delivered, with the approved recalculation completed. Those aren't the same problems as the remaining flags, chase behaviour or time-trial mountain-point report.

Thanks for the examples, including the ones where the game is doing something completely ridiculous 🙂 A race link, stage number, rider name and the order you selected help much more than a screenshot on its own. I'll update this list as things actually go live. Planned, built and released need to mean different things.

## DA: Status på kendte fejl efter sæsonstarten

Hejsa 🙂

Jeg vil gerne samle de kendte problemer ét sted, sammen med hvad jeg har fundet, og hvad planen er. Det skal ikke kræve, at du læser hver eneste samtale på Discord for at finde ud af, hvad der sker.

Den nye motor har givet nogle frustrerende resultater. Jeg kan godt forstå, at det føles ekstra træls, når den gamle efterhånden var begyndt at køre nogenlunde. At det er beta gør jo ikke et mærkeligt resultat mindre irriterende, så her er den faktiske status.

### Løbene og motoren

**Udbrudsflagene blander forskellige ting sammen.** På aftenens Auvergne-etape var otte ryttere i morgenudbruddet, mens tyve fik et udbrudsflag i resultatet. Flaget fangede også nogle senere angreb. Jeg skiller morgenudbrud og senere angreb ad, og løbsrapporten skal forklare forskellen. Et flag er lige nu ikke bevis for, at din rytter bevidst gik i morgenudbruddet.

**Ryttere kan forsøge morgenudbrud uden den ordre, du havde tænkt.** Roller og ordrer får en tydeligere betydning i motoren. En kaptajn eller hjælper skal ikke selv vælge morgenudbrud uden den relevante ordre. Fri rolle beholder noget selvstændighed, mens spar kræfter begrænser spontane forsøg. Forsøg udbrud bliver stadig et forsøg, ikke en garanti for at komme afsted.

**Motoren kan tvinge et udbrud til at blive dannet.** Jeg har reproduceret, at udvælgelsen tilføjer ryttere, selv når deres lodtrækninger siger nej. Den adfærd skal væk, og rivalhold skal kunne reagere under selve forsøget. Nogle angreb skal ganske enkelt ikke lykkes med at etablere et udbrud.

**Klassementstrusler bliver ikke vurderet ordentligt ud fra den faktiske stilling.** Reaktionen bruger lige nu en vurdering af evner frem for hele situationen inden etapen. En rytter tæt på føreren og en rytter langt tilbage skal vurderes forskelligt. Neutral skal være et fornuftigt valg, der reagerer på løbet, uden at alle skal vælge jagt på hver etape.

**Nogle indhentninger kan give kunstige tidstab.** Jeg har fundet en gruppe-/jagtberegning, som kan placere udbryderne forkert, når feltet er splittet. Det kræver en rettelse af beregningen, ikke kun pænere tekst. At blive indhentet skal ikke i sig selv udløse en mystisk ekstra tidsstraf.

**Løbsfilm og resultat fortæller ikke altid samme historie.** Manglende indhentninger, senere angreb vist som morgenudbrud og misvisende beskrivelser af afslutningen bliver taget samlet. At blive hentet og bagefter blive sat af skal være to forskellige hændelser, man kan forstå.

**Specialister, der slutter overraskende langt tilbage, er også på listen.** Der er meldinger om stærke sprintere, klatrere og brostensryttere bag svagere holdkammerater. Nogle tilfælde hænger sammen med fejlene ovenfor. Resten skal undersøges ud fra terræn, tilstand, ordrer og hjælp, frem for at love, at det højeste enkeltstående tal altid vinder.

**Bjergpoint på en flad enkeltstart er meldt ind.** Den konkrete rute og pointtildeling mangler stadig kontrol. Den sag er ikke løst, bare fordi fejlen ved mellemspurterne er rettet.

Jeg sigter mod at begynde at sende de første motorrettelser ud fra torsdag 1. oktober, når de er testet. Det er ikke et løfte om, at hele taktikpakken lander på én gang. Beregnings- og visningsfejl kan rettes fra næste etape, der ikke er kørt. Nye taktik- og balanceregler er tiltænkt nye etapeløb, så din plan ikke ændrer betydning midt i et startet løb. Den opdeling skal stadig bygges. Jeg annoncerer ikke en genberegning af afsluttede resultater her.

### Træning: de fem ting, jeg har meldt ud til torsdag

Planen for torsdag 1. oktober omfatter stadig alle fem:

- **Træn når det passer dig.** Træn nu kommer tilbage uden en fordel ved et bestemt klokkeslæt. Det bruger de ledige løbsdage, ikke en ekstra træning eller samme løbsdag til både træning og løb.
- **Planlæg hver løbsdag.** Vælg hård, normal, restitution eller hvile på de enkelte felter. Det skal være tydeligt, hvilke felter der bruges af løb, og hvilke du selv kan styre.
- **Se forventet træthed i aften, før du vælger.** Justér med en prognose frem for at gætte.
- **Regler, der virker mens du er væk.** Hvil over din valgte træthedsgrænse, og vend derefter tilbage til programmet.
- **Én samlet rapport pr. dato.** Dagens aktivitet bliver samlet, så sidste rapport ikke ligner hele dagens træning.

Den samlede rytterkvittering er nu udgivet i beta med datoens gemte aktiviteter og dokumenterede passcorer samlet. Det leverer rapportdelen af den annoncerede pakke. De fire øvrige ændringer skal stadig have deres egne leverancekontroller.

**Historisk manglende træning er en særskilt opgave.** Beregningen af træthed og form er rettet, og den godkendte efterregulering er gennemført. Der er enkelte undtagelser tilbage. Den tabte træning fra 28. september har sin egen genopretningssag; den bliver ikke meldt gendannet, før den faktisk er rettet og kontrolleret.

**Udviklingshistorikken har indmeldte afvigelser.** Manglende evnestigninger og forvirrende totaler undersøges særskilt fra den daglige rapportvisning.

**Træningshastigheden bliver undersøgt.** Jeg har hørt meldingerne om langsommere udvikling af målrettede talenter. Jeg sammenligner faktisk dagsudbytte og programmer, frem for at bruge antal gennembrud som eneste bevis. Jeg har tidligere nævnt mandag/tirsdag, 5.-6. oktober, som et muligt tidspunkt for analysen, når der er mere data. Det er et sigte for analysen, ikke et løfte om at ændre raten.

### Andre indmeldte problemer

De her er også registreret. Ikke alle har en bekræftet årsag eller dato endnu:

- U23-/juniorløb skal kunne fravælges tydeligt. Jeg har sagt i løbet af ugen; det er ikke en bekræftet torsdagsleverance.
- Juniorhold under minimum kan stå som deltagende, selvom de ikke starter.
- Trupskift kan efterlade forvirrende udtagelser eller bindinger. Noget oprydning findes allerede; de resterende tilfælde skal kontrolleres.
- En deltagelsesfejl efter holdskifte undersøges og rettes. Allerede beregnede resultater behandles særskilt.
- Noget bestyrelseshistorik blev påvirket af ungdomsløb. Historisk oprydning er en anden opgave end at forhindre nye forkerte opdateringer.
- Et genforhandlet bestyrelsesmål kan stadig blive vist med det gamle mål.
- Slettede udtagelsespåmindelser kan komme igen, og kontakten kan være svær at se, når den er slået fra i mørkt tema.
- Ryttersøgningen kan finde navne, der ikke matcher det, du skrev.
- Nogle præmieestimater er så brede, at de ikke er særligt brugbare.
- Der er en melding om forskel mellem sponsoraftalens visning og beløbet pr. løbsdag. Betaling, visning og enheder kontrolleres, før jeg påstår, at nogen har fået for lidt.
- Nogle mobilsider har haft problemer med indlæsning og cache. En løsning hjalp i en konkret sag; det gør ikke automatisk hele problemet færdigt.

Tydeligere kolonner, ordre og aktuel form i planlægningen er udgivet. Transferrettelsen beskytter også løbsdage brugt på det tidligere hold; fremtidige løbsdage er fortsat tilgængelige.

### Allerede rettet

Rækkefølgen ved mellemspurter og bjergpassager er rettet og kontrolleret i faktiske etaper efter release. Holdklassementets afgørelse ved lige tid er også leveret, og den godkendte genberegning er gennemført. Det er andre sager end de resterende flag, jagtproblemer og bjergpoint på enkeltstarten.

Tak for eksemplerne, også dem hvor spillet gør noget komplet åndsvagt 🙂 Et løbslink, etapenummer, rytternavn og den valgte ordre hjælper meget mere end et billede alene. Jeg opdaterer listen, når tingene faktisk bliver live. Planlagt, bygget og udgivet skal betyde tre forskellige ting.
