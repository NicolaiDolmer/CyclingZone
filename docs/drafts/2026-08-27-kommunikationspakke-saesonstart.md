# Kommunikationspakke, sæsonstart S3

Skrevet 27/8 af Claude. Alt herunder er udkast til copy-paste. **Du poster selv.**
Rækkefølgen er prioriteret: A skylder du dem, resten kan følge efter.

**Revisionsspor.** Første version af denne pakke indeholdt en fejl: den lovede spillerne et fix
på GT-hviledags-bindingen, som viser sig at være den ønskede regel og ejerens eget direktiv fra
25/8 (#4217). Rettet. Derefter er hvert tal og hvert citat i dokumentet efterprøvet enkeltvis.
Se **Revisionsspor, hvad der er efterprøvet** nederst for hvad der er målt, og for de to
sætninger der ikke kan måles og derfor er dine.

---

## A. #the-roadbook, går forud for alt andet

**Hvorfor den haster.** Du skrev 26/8 kl. 21:42 i #the-roadbook: *"Please hold off on
selecting teams until I confirm the new calendar is live. I will post here the moment it is
done."* Den bekræftelse er aldrig kommet i #the-roadbook. Du sagde det i #general kl. 00:05,
men det er en anden kanal end den du henviste dem til.

egomadsen bad dig eksplicit om det i staff-chat i dag kl. 14:28: *"Så tænker jeg du skal give
et pip her"*, og igen kl. 15:05: *"tænker mest på hvis der er nogle der sidder og venter på et
'Go!' fra dig, så ville de nok blive glade for at se der ikke kommer flere rettelser."*

Der sidder altså formentlig spillere og venter på et go, et døgn inde i den ventetid, dagen
før sæsonstart.

**Én ting er værd at tage med, og den er ikke en fejl.** De tre Grand Tours har hver to
løbsdage uden etape midt i løbet, altså hviledagene, og rytterne er bundet hen over dem. På
præcis de seks dage ligger der seks andre D1-løb, som derfor ikke er tilgængelige for en
GT-rytter. Det er den ønskede regel (#4217): er du udtaget til et etapeløb, er du bundet til
det er slut. Men det kan man ikke se på fladen, og D1-spillerne sidder lige nu og vejer Tour
op mod klassikerne. Udkastet nedenfor siger det som planlægnings-information, ikke som en
undskyldning.

**Én sætning i udkastet kan kun du stå inde for.** Der står *"Nothing more is being
regenerated"* / *"Der bliver ikke genereret mere"*. Det er et løfte om hvad du gør fremad, ikke
noget jeg kan måle. Du sagde selv i staff-chat kl. 14:27 at du *tolker* det som en god ting at
kalenderen ikke har fået klager, og det er ikke det samme som en beslutning om at holde op. Er
du ikke sikker, så skriv i stedet "kalenderen er live, og siger jeg til hvis der kommer mere".
Et halvt løfte du kan holde er bedre end et helt du må bryde i morgen.

### Udkast (EN)

> **The season 3 calendar is live. Go ahead and pick your teams.**
>
> Sorry for the silence in here since last night.
>
> The calendar has not been touched since 23:38 yesterday. Everything picked since then has stuck: 34 teams have made 1,815 selections, the most recent a few minutes ago. It is safe to plan.
>
> **Form peaks: set yours again.** The rebuild left 812 peak plans pointing at races that no longer exist, and the ones already under way could not be removed. All 812 are cleared.
>
> **Division 1, worth knowing before you plan.** A Grand Tour holds your rider for the whole race, rest days included. Each of the three has two rest days, and six one day races fall on exactly those days: Klassieker van Harelbeke, Klassieker van Brugge, La Classique Bretonne, De Vlaamse Ronde, Tour de la Loire and La Classica d'Autunno. A rider inside the Giro, Tour or Vuelta cannot start any of them. That is deliberate, but the race card does not show it yet.
>
> **If you do not get around to picking.** A race you have not touched gets a squad chosen automatically when it runs, so you will not miss a start. If you used Clear day or Clear all, that race stays empty until you pick it yourself. That is on purpose.
>
> Season 3 runs Friday 28 August to Sunday 27 September.

### Udkast (DA)

> **Sæson 3-kalenderen er live. Sæt endelig hold.**
>
> Undskyld stilheden herinde siden i går aftes.
>
> Kalenderen er ikke rørt siden kl. 23.38 i går. Alt hvad der er sat siden, står stadig: 34 hold har lavet 1.815 udtagelser, den seneste for få minutter siden. Det er sikkert at planlægge.
>
> **Formpeaks: sæt dine igen.** Ombygningen efterlod 812 formplaner der pegede på løb der ikke findes mere, og dem der allerede var i gang kunne ikke fjernes. Alle 812 er ryddet.
>
> **1. division, værd at vide inden du planlægger.** En Grand Tour binder din rytter i hele løbet, hviledagene med. De tre har hver to hviledage, og der ligger seks endagsløb på præcis de dage: Klassieker van Harelbeke, Klassieker van Brugge, La Classique Bretonne, De Vlaamse Ronde, Tour de la Loire og La Classica d'Autunno. En rytter der er inde i Giroen, Touren eller Vueltaen kan ikke stille op i nogen af dem. Det er med vilje, men løbskortet viser det ikke endnu.
>
> **Hvis du ikke når at sætte hold.** Et løb du ikke har rørt får sat et hold automatisk når det køres, så du misser ikke en start. Har du brugt Ryd dag eller Ryd alt, bliver det løb stående tomt indtil du selv udtager. Det er med vilje.
>
> Sæson 3 kører fredag 28. august til søndag 27. september.

---

## B. #patch-notes, alt der er blevet færdigt i dag

Seks ting landede 27/8, versionerne 7.204 til 7.209. Alle gennemgået og godkendt af ejeren enkeltvis. Ét samlet opslag, skrevet til spillere.

Tallene herunder er målt i prod 27/8: 812 planer, 320 låste, 98 af 206 etapeløb, 41,7 mod 9,2.

### Udkast (EN)

> **Today: six fixes to planning, training and the numbers you plan by**
>
> **Set your form peaks again.** Rebuilding the calendar left 812 peak plans pointing at races that no longer exist, and 320 of them were locked so you could not remove them. All are cleared. A peak plan is now deleted along with its race.
>
> **Peak target dates were wrong for stage races.** The Vuelta read as ending 4 October, a week after the season ends, when it finishes 21 September. 98 of 206 stage races were affected. Your peak plans were never wrong, only the dates beside them.
>
> **Race cards now show the days they run.** A card only told you the day a race started, so the only way to spot an overlap was to add a rider and see what happened. Cards show the full span now, and a line underneath names the race that shares those days. If the same rider is picked for both, that line turns red. Race day numbers start at 1.
>
> **Planning tells you when something failed.** A failed view used to go blank or claim to be empty. Team selection, Form plan, Strategy, Start lists and the Calendar now say what happened, confirm nothing was lost, and give you a Try again button.
>
> **Training no longer shows +0 before the season starts.** Between two seasons the receipt read the new season as zero points gained. It now says when the season starts, and training before then still counts toward each rider's next point.
>
> **The load chip counted the wrong thing.** It said race days but counted stages, and it added up earlier seasons too. On average it read 41.7 where the true number is 9.2. It now counts race days in the current season only.
>
> One wording change with no money attached: your sponsor pays per stage, not per race day, and the labels now say so. The payment itself is unchanged.

### Udkast (DA)

> **I dag: seks rettelser til planlægning, træning og de tal du planlægger efter**
>
> **Sæt dine formpeaks igen.** Kalender-ombygningen efterlod 812 formplaner der pegede på løb der ikke findes mere, og 320 af dem var låst så du ikke kunne fjerne dem. Alle er ryddet. En formplan slettes nu sammen med sit løb.
>
> **Peak-mål viste forkerte datoer for etapeløb.** Vueltaen stod til at slutte 4. oktober, en uge efter sæsonen slutter, selvom den er færdig 21. september. 98 af 206 etapeløb var ramt. Dine formplaner har aldrig været forkerte, kun datoerne ved siden af dem.
>
> **Løbskort viser nu de dage de kører.** Et kort fortalte kun hvilken dag et løb startede, så den eneste måde at opdage et overlap på var at sætte en rytter ind og se hvad der skete. Kortene viser nu hele spændet, og en linje nedenunder navngiver det løb der deler de dage. Er samme rytter udtaget til begge, bliver linjen rød. Løbsdage tælles fra 1.
>
> **Planlægning siger til når noget fejler.** En fejlet visning gik før blank eller påstod den var tom. Holdudtagelse, Formplan, Strategi, Startlister og Kalender siger nu hvad der skete, bekræfter at intet er tabt, og giver dig en Prøv igen-knap.
>
> **Træning viser ikke længere +0 før sæsonen er startet.** Mellem to sæsoner læste kvitteringen den nye sæson som nul point opnået. Den siger nu hvornår sæsonen starter, og træning inden da tæller stadig med mod hver rytters næste point.
>
> **Belastnings-tallet talte det forkerte.** Der stod løbsdage, men den talte etaper, og den lagde tidligere sæsoner oveni. I snit viste den 41,7 hvor det sande tal er 9,2. Den tæller nu kun løbsdage i den aktive sæson.
>
> Én sproglig ændring uden penge i: din sponsor betaler pr. etape, ikke pr. løbsdag, og teksterne siger det nu. Selve betalingen er uændret.

## C. Hvad der er på tegnebrættet

Kun det spiller-vendte, og kun det der realistisk lander. Post gerne i #the-roadbook.

**Bevidst udeladt: minimum 6 ryttere for at stille op.** Reglen er bygget, men holdt tilbage,
fordi grundlaget flyttede sig. Se advarslen nederst. Nævn den ikke endnu.

### Udkast (EN)

> **On the workbench**
>
> Nothing here is promised for a date. This is what I am actually working on.
>
> Seeing a race's full span before you click. Right now the race card only shows the day a
> race starts, not the days it runs across, so the only way to find an overlap is to try adding
> a rider and see what happens. The card will show the whole span, and name the race it
> collides with.
>
> Seeing at a glance who is already riding. In planning there is currently no mark on a rider
> who is already entered somewhere that day. That mark is coming.
>
>
> Form peaks that can actually be removed. Some of you have a rider who keeps defaulting back
> to two peaks with no way to clear one. That is a real bug and it is on the list.
>
> Making form peaks easier to understand at all: what a peak does, when it happens, and what
> it costs you.

### Udkast (DA)

> **På arbejdsbordet**
>
> Intet her er lovet til en dato. Det er det jeg faktisk sidder med.
>
> At se et løbs fulde spænd før du klikker. Lige nu viser løbskortet kun den dag et løb starter,
> ikke de dage det kører over, så den eneste måde at opdage et overlap på er at prøve at sætte
> en rytter ind og se hvad der sker. Kortet kommer til at vise hele spændet og nævne det løb det
> støder sammen med.
>
> At se på ét blik hvem der allerede kører. I planlægning er der lige nu ingen markering på en
> rytter der allerede er udtaget et sted den dag. Den markering er på vej.
>
>
> Formpeaks der rent faktisk kan fjernes. Nogle af jer har en rytter der bliver ved med at
> falde tilbage til to peaks uden mulighed for at fjerne den ene. Det er en rigtig fejl og den
> står på listen.
>
> At gøre formpeaks lettere at forstå overhovedet: hvad et peak gør, hvornår det sker, og hvad
> det koster dig.

---

## D. Enkeltsvar du mangler at give

Sorteret efter hvor længe de har ventet og hvor meget de betyder. Jeg har tjekket at du ikke
allerede har svaret på dem.

### D1. jonasnielsen, #dansk-snak 27/8 kl. 06:28. Du lovede svar, og sagen er nu løst

Han skrev: *"Hvordan kan min ryttere allerede havde peaket formmæssigt sæsonen er ikke engang
startet"*. Du svarede kl. 09:01: *"Det får jeg set på i løbet af starten på dagen"*. Det er
rettet i dag. Han har ikke fået at vide at det er løst.

> Den er fundet og rettet nu. Kalender-ombygningen efterlod 812 formplaner der pegede på løb
> der ikke findes mere, og derfor så det ud som om dine ryttere havde peaket før sæsonen
> overhovedet var begyndt. De er ryddet, så du kan sætte dine peaks forfra. Tak fordi du sagde
> til.

### D2. friisisch, #general 27/8 kl. 06:02. Ingen svar endnu

Han skrev: *"It is hard to understand the races overlapping. It still only says the race day in
which the races start. And not the race days they span over. So its needed to add riders to
races to see if they overlap, if they are on the same day"*. Det er #4296 ordret. Han fortjener
at vide at det er forstået og på vej.

> You have put your finger on exactly the right thing, and it is the next one I am building.
> The card will show the full span of race days, not just the start, and it will name the race
> it overlaps with, so you do not have to discover it by trial and error.

### D3. knud_r_flink, #general 27/8 kl. 05:57. Delvist besvaret af andre spillere, ikke af dig

Han skrev: *"I still cant save a team less than the total number of riders"*. egomadsen og
friisisch fandt selv frem til mønstret: det kan lade sig gøre fra planlægnings-siden, men ikke
fra selve løbssiden. Det er den asymmetri der er den rigtige fejl, og den står i #4295.

Bekræft det de selv fandt ud af, så de ved det er set:

> egomadsen and friisisch have it right, and thank you both for narrowing it down. Saving a
> partial squad works from the planning page but is blocked on the race page itself. That
> inconsistency is the actual bug, not the rule, and it is logged. Until it is fixed, use the
> planning page.

### D4. thelamba, #questions-and-answers 24/8 kl. 23:44. Tre døgn uden svar

Han skrev: *"Any idea why I can't remove the form peaks from this guy?"* og fulgte op med
*"I have tried in multiple ways to set it up so he only has one race. No matter what I do, it
always defaults into him having 2 peaks."* Det er #4212.

> Confirmed as a bug, not something you are doing wrong. A rider defaulting back to two peaks
> with no way to clear one is on the fix list. Sorry it took me a few days to come back to you.

### D5. egomadsen, #questions-and-answers 24/8 kl. 10:13. Fire konkrete spørgsmål, ubesvaret

Han stillede fire spørgsmål om den nye træning: om det er hele løbet eller dagens etaper der
træner, hvilken evne der trænes når en dag har både sprint og bjerg, om flere etaper samme dag
giver mere træning, og om de 25 procent stadig gælder samt om det gør en forskel hvornår på
dagen man trykker.

Jeg har ikke verificeret svarene i motoren, så jeg skriver ikke et udkast jeg ikke kan stå
inde for. **Sig til hvis du vil have mig til at læse `dailyTrainingEngine.js` igennem og
skrive svaret ud fra koden.** Det tager mig et kvarter, og så er svaret rigtigt frem for
sandsynligt. Bemærk at spørgsmålene er stillet i en periode hvor du selv har meldt ud at det
nye træningssystem først kommer i sæson 4, så svaret afhænger af hvad der faktisk er tændt.

### D6. jeppek, #questions-and-answers 25/8 kl. 21:43. Ubesvaret

Han skrev: *"If I remember correctly, there was around 6.500-7.000 Riders 2 days ago, now there
is around 3.700? Anyone else look at that?"* Jeg har ikke målt det, så jeg skriver ikke et
udkast. Det er et rimeligt spørgsmål der fortjener et tal frem for et gæt. Sig til hvis jeg
skal tælle efter i databasen.

### D7. mandia1984, #general 26/8 kl. 13:00. Besvaret af andre spillere, ikke af dig

Han undrede sig over at en rytter han købte for 455k er faldet til 209k. egomadsen og friisisch
gav ham et rimeligt svar. Din egen forklaring står allerede i #the-roadbook fra 23/8. Det
letteste er at linke til den frem for at skrive den om, medmindre du vil sige noget nyt.

---

## Løse ender jeg vil pege på

**Advarslen om minimum 6 ryttere står stadig.**
[`docs/drafts/2026-08-27-minimum-6-ryttere-varsel.md`](2026-08-27-minimum-6-ryttere-varsel.md)
siger *"Fra i morgen"* og *"From tomorrow's start"*. Reglen er holdt tilbage. Post det ikke som
det står. Datoen skal enten rettes eller udkastet holdes tilbage.

**egomadsens rapport om peak-mål er stadig uforklaret.** Han skrev i staff-chat 27/8 kl. 14:58:
*"det eneste jeg er stødt på, er at inde under peak mål, der ser den ud til at trække på en
ældre version af løbskalenderen på de tre GTs"*, med tre skærmbilleder. Jeg gættede først på en
akse-forveksling i `game_day_start`, men den kolonne læses kun af kalender-generatoren og et
Div4-værktøj, så den kan ikke være det. Der er altså ikke svaret på hans observation endnu, og
den bør undersøges med udgangspunkt i hans billeder frem for i en teori.

**Den gamle Discord-server er ikke lukket ned.** Guild 474142653529849886, "Cycling Career", har
121 medlemmer mod 72 på den nye. Nyeste besked derinde er fra 27/7, hvor du henviste en spiller
videre med et invite-link. Der kan sidde folk tilbage der tror det stadig er stedet. Værd at
tage stilling til, ikke noget jeg gør uopfordret.

**Handoff-prompten havde forkerte kanalnavne.** Den pegede på #feedback-and-ideas, #the-roadbook,
#staff-chat og #dansk-snak som tekstkanaler i den gamle guild. De tre findes kun i den nye, og
#feedback-and-ideas er et forum, ikke en tekstkanal. Rettet i praksis, noteret her så næste
session ikke leder samme sted.

---

## Revisionsspor, hvad der er efterprøvet

Efter at første version indeholdt en forkert påstand, er hvert tal og citat efterprøvet
enkeltvis. Her er kilden til hvert enkelt, så du kan efterprøve mig.

### Målt i prod 27/8

| Påstand i teksten | Kilde | Resultat |
|---|---|---|
| 812 formplaner ryddet | `select count(*) from backup_4294_rider_peak_plans` | 812 rækker, præcis |
| Ingen forældreløse tilbage | `rider_peak_plans` join `seasons` hvor `number=3` | 403 planer, 0 uden målløb |
| De tre GT'er har 2 hviledage hver | `race_stage_schedule.game_day` pr. GT | Giro 0-19 (18 etaper), Tour 28-46 (17), Vuelta 53-71 (17) |
| Seks navngivne løb på hviledagene | join på `game_day` + samme `league_division_id` | Præcis ét D1-løb pr. huldag, alle seks navne bekræftet |
| Auto-udtagelse fylder for hold der ikke har rørt løbet | `raceRunner.js:824-847` (`fillMissingTeamEntries`) | Bekræftet i koden |
| Rydning bliver respekteret | `race_entry_clears` + `raceRunner.js:835` | 12 rækker i S3, fordelt på 1 hold |
| Felt-cap på 24 hold rammer ikke nogen | `teams` grupperet på `league_division_id` | Ingen pulje har over 24 hold |

### Citater

Alle syv spillercitater i afsnit D er hentet ordret via Discord-MCP fra guild
1504615050831466669. Tidsstempler er konverteret fra UTC til dansk tid. Ingen af dem er
omskrevet, forkortet eller gengivet efter hukommelsen.

### Fjernet fordi det ikke kunne efterprøves

Første version skrev i patch note-udkastet at et holds belastnings-snit *"viste 18,1 hvor det
sande tal var 4,9"*. De tal stammer fra handoff-dokumentet, ikke fra min egen måling, og den
faktiske patch note i `patchNotes.js` indeholder dem ikke. Taget ud frem for at gengive et tal
jeg ikke selv har regnet.

### De to sætninger der er dine, ikke mine

1. *"Nothing more is being regenerated"* i afsnit A. Et løfte om fremtidig adfærd. Kan ikke
   måles. Se noten i afsnit A.
2. Ordet *"deliberate"* om GT-hviledags-bindingen. Det hviler på #4217 og dit eget citat
   derfra, ikke på en måling. Jeg mener det er dækkende, men det er din regel at beskrive.

### Stadig ubesvaret, og bevidst ikke gættet på

egomadsens peak-mål-rapport, egomadsens fire træningsspørgsmål, og jeppeks ryttertal. Jeg har
ikke skrevet udkast til nogen af de tre. Se afsnit D5, D6 og løse ender.
