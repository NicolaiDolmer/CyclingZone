# Roadmap-hub: indholdsforslag (udkast til ejer-godkendelse)

Udkast 4/10. Intet er skrevet til prod. Design: `docs/superpowers/specs/2026-10-04-roadmap-hub-design.md` §8. Byggeplan: `docs/superpowers/plans/2026-10-04-roadmap-hub.md`.

**Kilder (del 1-4):** prod-SELECT 4/10 (`roadmap_items`, `roadmap_votes`, `app_config`, spørgeskema `2026-09-features`), `patchNotes.js` til og med 7.337, `FEATURE_STATUS.md`, `MASTERPLAN.md`, `NOW.md`, `OPERATING_PLAN.md`, GitHub-issues. Read-only gennemgang. Del 5 er Discord (fem kanaler + daglige udtræk), del 6 er backlog-gennemgangen.

Forkortelser: S = shipped (Done) · IP = in_progress · P = planned (next/later) · A = active (idé til afstemning) · AR = archived. **LØFTE** = stammer fra et løfte til spillerne. Tal i sidste kolonne: stemmer / god idé / vigtighed.

## 1. De 48 nuværende punkter (42 aktive + 6 arkiverede)

| id | Titel (kort) | I dag | Forslag | Issue | Bevis | Tal |
|---|---|---|---|---|---|---|
| 00000004 | Real training depth: programs per rider | AR | **S · 1/10** (alt. 28/9) | #4850 | v7.308 (træning pr. løbsdag) + v7.330 (plan pr. løbsdag pr. rytter); `training_tick_per_race_day` on | 36/4.64/4.11 |
| 00000016 | U19/U23 squads, promotion paths | AR | **S · 26/9** | #2492 | v7.304; `youth_squad_pages` on 26/9; v7.306 løbene startede. Titlen siger "U19", som nu hedder junior | 37/5.00/4.46 |
| 00000017 | Rider values that follow the market | AR | **S · 26/9** | #5443 | v7.303; `rider_valuation_model` = v6 26/9; v6 har markeds-fit fra handler. Epic #5443 stadig åben (løn) | 35/4.71/3.86 |
| 00000006 | Meaningful choices, never spreadsheet | AR | AR | intet fundet | Designprincip, ikke en funktion | 36/4.61/4.28 |
| 60efa858 | Invite a friend | AR | AR | #1173 | Lagt sammen i 00000022 | 7/4.43/1.86 |
| 8f52bf54 | Living world feed | AR | AR | #1147 | Lagt sammen i 00000022 | 7/3.86/2.71 |
| 00000222 | Club's look: logo, colours, faces | A | P · next/later | #5113 | MASTERPLAN bane 3 "#5113 (først #5115)"; ingen aktiv byg | 9/5.11/3.78 |
| 00000223 | Sponsors: main + side sponsors | A | A | kun epic #1441 | Spørgeskema side_sponsors, veto 9,7 % | 9/5.11/3.89 |
| 00000224 | More facilities | A | A | intet fundet | Ingen plan | 9/5.44/4.56 |
| 00000225 | Upkeep per race day | A | **S · 27/9** | #4385 (lukket) | v7.305; `upkeep_per_race_day` on 27/9 | 9/4.44/3.78 |
| cf4ee514 | Negotiate board goals upward | A | **S · 27/9** | #3514 | Mandatet live for alle (v7.330): Easier/Keep/Stretch | 17/4.82/4.06 |
| 00000019 | Road captains and mentors | A | P · later (alt. next) | #1177 (+#5349) | Roadbook "under S4"; #5349 venter på #5268 | 34/4.71/3.82 |
| 00000226 | New dashboard and inbox | A | P · later | #3513 (+#2223) | Roadbook "under S4"; ikke i MASTERPLAN | 9/4.33/3.00 |
| 00000227 | Smarter assistant, act from inbox | A | A | #4985 (+#4984) | "Act from inbox" svarer til inbox_transfers, veto 30 % | 10/4.40/3.40 |
| 00000018 | Statistics and history | A | A | #1106 | Ingen plan | 34/5.06/4.15 |
| 00000021 | Club museum | A | A | #1148 | Ingen plan | 37/4.51/3.62 |
| 00000022 | Friends and following | A | A | #935 (+#5061) | Post-launch-epic | 35/3.94/3.34 |
| 00000228 | Rider milestones | A | A | #5180 | Ingen plan | 9/4.22/3.56 |
| 00000011 | Deeper negotiation (riders + cash) | A | A | #6024 | Spillerønske; ingen plan | 37/4.11/3.43 |
| 00000012 | Transfer rumours | A | A | #956 | Post-launch-epic | 36/4.14/3.33 |
| 00000219 | Market you can trust: limits + open log | A | A (alt. P) | #5431 | "Open log" er allerede live (v7.288). Forslag: skær titlen ned til grænserne | 9/4.67/3.89 |
| 00000220 | More than one wishlist | A | A | #5621 | Ingen plan | 9/4.67/3.67 |
| 00000221 | Injury on another team's rider | A | A | #5314 | Ejeren positiv; ingen plan | 9/4.33/3.56 |
| 00000201 | Secondary rider type explained | A | P · next (**LØFTE**) | #3813 | Roadbook S3; #3813 28/9: den lovede forklaring mangler | 12/5.17/4.75 |
| 00000202 | Ride for a jersey from day one | A | P · later (**LØFTE** S5) | #5573 | MASTERPLAN "skubbet til S5: #5575 lag 2-4"; spørgeskema nr. 2, veto 0 % | 12/5.75/5.17 |
| 00000203 | Peak where in a stage race, main + backup goal | A | P · next (**LØFTE**, overskredet) | #5074 | Lovet 14/9 "before season 4"; ikke leveret | 12/5.00/4.25 |
| 00000204 | The team meeting | A | P · later (**LØFTE** S5) | #5573 (epic #5575) | MASTERPLAN S5-listen | 12/4.33/2.83 |
| 00000014 | National championships | A | A | #934 | Post-launch, lav prioritet | 40/4.85/3.55 |
| 00000205 | Worlds/Europeans, national coach | A | A | #934 | Samme epic | 11/4.45/3.00 |
| 00000013 | Season planner that warns | A | A | #1146 | Kun "træthed i aften" er live (v7.330) | 40/4.80/3.83 |
| cab2228d | Why a stage went the way it did | A | **S · 2/10** (alt. P later) | #6080 | v7.332 "Split times, and where and why your riders lost time". Indsatskortet (#5101) er skubbet til S5, se N10 | 20/4.10/3.65 |
| ca980fca | Routes like real racing | A | IP | #2768 (+#3864) | v7.336 brosten tæller; v7.332 bjergetaper afgøres på slutstigningen; epic åben | 21/5.05/3.86 |
| 00000206 | Calendar colour-coded by status | A | A | #5200 | Ingen plan | 11/5.18/3.82 |
| 00000207 | 3D replay | A | A | #5120 | Post-launch, lav prioritet | 11/4.64/3.09 |
| 00000208 | Race sharpener | A | P · next (**LØFTE**) | #5238 | Design-go 27/9; meldt offentligt 14/9. Ikke bygget | 10/4.50/3.80 |
| 00000209 | Plan a whole week per rider | A | **S · 1/10** (alt. IP) | #5932 | v7.330 (35 felter, hold eller én rytter); `training_program_cells` on 1/10 | 10/3.70/2.90 |
| 00000210 | Form training for finished riders | A | P · next (**LØFTE** 2/9) | #5238 (+#6110) | #4633 lukket som dublet af #5238. Kan slås sammen med 208 | 10/5.10/5.10 |
| 00000211 | Training camp | A | A | #5063 | Ingen plan | 10/5.50/4.80 |
| 00000015 | Staff you can feel | A | A | #930 (+#2887) | #2887 er med i planlægningssessionen #6148 | 36/4.47/4.14 |
| 00000212 | % a session moved an ability | A | **S · 2/10** (alt. IP) (**LØFTE** S4) | #5539 | v7.305 + v7.331. #5539 genåbnet 29/9 pga. fejl ved evnepoint-skift | 10/5.20/4.10 |
| 00000213 | Auto-rest at a fatigue limit | A | **S · 1/10** | #5620 | v7.330; `training_fatigue_rules` on 1/10 | 10/5.10/4.60 |
| 538c4798 | Ready-made programs, later sharing | A | IP | #4629 | `training_programs` = beta. Delingsdelen svarer til shared_programs, veto 37,9 % | 13/3.69/2.62 |
| 00000214 | Own labels on riders | A | A | #5420 | Ejeren tager snakken senere | 10/5.00/3.80 |
| 00000215 | Youth seasons that count from S5 | A | P · later (**LØFTE** S5) | #4620 (+#4621) | MASTERPLAN "skubbet til S5 (meldt ud)" | 10/5.10/4.50 |
| 00000216 | Prize money in youth races | A | A | #4620 ("ingen præmiepenge i v1") | Ingen plan | 10/4.00/4.20 |
| 00000008 | Your own young stars (country/types) | A | P · next (**LØFTE** roadbook S4) | #5105 | Roadbook "under S4"; ikke i MASTERPLAN | 37/5.41/5.08 |
| 00000217 | Scouts that differ | A | A | #5540 (+#5625) | Lav prioritet | 10/4.40/3.70 |
| 00000218 | Rival abilities as a range | A | A | #4264 (+#5107) | fuzzy_rivals veto 20,6 % | 10/4.50/3.50 |

**Sum:** Done 9 · i gang 2 · planlagt 11 (next 6, later 5) · idé 23 · arkiveret 3.

## 2. Nye Plan-punkter fra MASTERPLAN (kan mærkes af spillerne, findes ikke i dag)

| # | Omr. | Status | Issue | EN / DA | Kilde |
|---|---|---|---|---|---|
| N1 | club | P · next | #5831 | Send a message to another manager straight from his team page. / Send en besked til en anden manager direkte fra hans holdside. | **LØFTE** 27/9 |
| N2 | youth | P · next | #5917 | Move a rider from the transfer list to your U23 squad. / Flyt en rytter fra transferlisten til dit U23-hold. | **LØFTE** 28/9 |
| N3 | training | P · next | #6060 | Copy one day's training plan to the next days. / Kopiér én dags træningsplan til de næste dage. | **LØFTE** 2/10 |
| N4 | training | IP | #6035 | On the Program tab, pick the rider first and then his program. / På Program-fanen vælger du rytteren først og derefter hans program. | **LØFTE** 1/10 |
| N5 | training | IP | #4847 | Train now: run today's training when it suits you, with the same result as the evening run. / Træn nu: kør dagens træning, når det passer dig, med samme resultat som aftenkørslen. | **LØFTE**; beta |
| N6 | training | IP | #6000 | Training groups: one plan for several riders, and each rider keeps his own copy. / Træningsgrupper: én plan for flere ryttere, og hver rytter beholder sin egen kopi. | Flip-liste; beta |
| N7 | races | IP | #5124 | The season matrix in Planning fits your phone screen. / Sæsonmatricen i Planlægning passer til din telefonskærm. | Flip-liste; beta |
| N8 | training | IP | #5485 | A training page without scrolling: tabs, and what you use most at the top. / En træningsside uden scroll: faner, og det du bruger mest, øverst. | Træningspakken |
| N9 | training | P · next | #6110 | Development 2.0: one clear development curve, racing that pays off by role, and a decline in older riders you can slow down. / Udvikling 2.0: én tydelig udviklingskurve, løb der betaler sig efter rolle, og en tilbagegang hos ældre ryttere, du kan bremse. | Bane 1, byg uge 41 |
| N10 | races | P · later | #5101 | After each race, a card per rider: his order, what happened and the verdict. / Efter hvert løb et kort pr. rytter: hans ordre, hvad der skete og dommen. | **LØFTE** S5 |
| N11 | races | P · later | #5574 | Conditional orders: tell a rider what to do if something happens, for example chase only if other teams help. / Betingede ordrer: sig til en rytter, hvad han skal gøre, hvis noget sker, for eksempel kun jagte, hvis andre hold hjælper. | **LØFTE** S5; veto 8,6 % |
| N12 | races | P · later | #3463 | Team time trials: your riders ride together against the clock and get the team's time. / Holdtidskørsel: dine ryttere kører sammen mod uret og får holdets tid. | **LØFTE** S5 |
| N13 | club | P · later | #4957 | Reputation for clubs and nations, like riders have now, built from results. / Omdømme for klubber og nationer, ligesom rytterne har nu, bygget på resultater. | **LØFTE** S5 |
| N14 | club | P · later | #5106 | Reputation for races and staff: a race's prestige can change, and staff earn a name too. / Omdømme for løb og personale: et løbs prestige kan ændre sig, og personalet får også et navn. | **LØFTE** S5 |
| N15 | races | P · next | #5268 | Teamwork and Leadership values for the riders already in the game, not only new ones. / Holdarbejde og Lederskab for de ryttere, der allerede er i spillet, ikke kun nye. | Ejer-beslutning 4-5/10 |
| N16 | club | P · next | #5131 | A faster game: pages that open quickly, also on your phone. / Et hurtigere spil: sider der åbner hurtigt, også på din telefon. | Release-gate 6 |
| N17 | club | P · next | #4512 | CZ Pro renews with an automatic payment, and you get a message if Pro stops. / CZ Pro fornyes med automatisk betaling, og du får besked, hvis Pro stopper. | Release-gate 7 |
| N18 | races | P · later | #3374 | Keep a rider out of the assistant's picks, and set the order it picks your riders in. / Hold en rytter ude af assistentens udtagelse, og bestem rækkefølgen, den udtager dine ryttere i. | Ejer-direktiv 31/8 |
| N19 | races | P · later | #3049 | Roles and tactics per rider in one-day races, like in stage races. / Roller og taktik pr. rytter i endagsløb, som i etapeløb. | Ejer-beslutning 21/8 |
| N20 | market | P · later | #2885 | Sell a rider to the AI when nobody bids on him after several auctions, for less than his value. / Sælg en rytter til AI'en, når ingen byder på ham efter flere auktioner, til mindre end hans værdi. | OPERATING_PLAN spor 4 |

**Nye Done-rækker** (live for alle, står ikke i `roadmap_items`):

- #5685 · 1/10 · One tap for Rest, Recovery or Program on your phone. / Ét tryk for Hvile, Restitution eller Program på telefonen. (v7.330)
- #5933 · 1/10 · See how tired each rider will be tonight before you choose. / Se hvor træt hver rytter bliver i aften, før du vælger. (v7.330)
- #5267 · 28/9 · Racing trains your riders: a rider develops from the race itself. / Løb træner dine ryttere: en rytter udvikler sig af selve løbet. (v7.308; spørgeskemaets nr. 1)
- #3514 · 27/9 · The new board: one confidence score, one mandate, an annual meeting. / Den nye bestyrelse: én tillid, ét mandat, et årsmøde. (v7.330)
- #4956 · 1/10 · See each rider's reputation. / Se hver rytters omdømme. (v7.330)

## 3. Kendte fejl

Trin: inv = Investigating · fix = Fix in progress · done = Fixed. NY = ny siden udkastet 30/9.

| Omr. | Trin | Issue | EN-titel / DA-titel | Første opdatering EN / DA |
|---|---|---|---|---|
| races | done | #5955 | Riders went for the morning break without the order you gave them. / Ryttere gik efter morgenudbruddet uden den ordre, du havde givet dem. | In races on the new race rules, captains, sprint captains and helpers only go for the morning break with Try the break selected, and an attempt can fail. The Tactics tab shows which rules a race uses. / I løb med de nye løbsregler går kaptajner, spurt-kaptajner og hjælpere kun efter morgenudbruddet med Forsøg udbrud valgt, og et forsøg kan mislykkes. Taktik-fanen viser, hvilke regler et løb bruger. |
| races | fix | #5978 | A dangerous GC rider can get into the break without the GC teams reacting. / En farlig klassementsrytter kan komme med i udbruddet, uden at klassementsholdene reagerer. | On the new race rules, GC teams react with their free helpers when a threat is up the road. I still get reports of GC riders getting away, and I'm checking them against the standings before the stage. / Med de nye løbsregler reagerer klassementsholdene med deres ledige hjælpere, når en trussel er kørt væk. Jeg får stadig meldinger om klassementsryttere, der slipper afsted, og tjekker dem op mod stillingen før etapen. |
| races | inv | #5951 | Caught breakaway riders can lose far more time than the race shows. / Indhentede udbrydere kan tabe langt mere tid, end løbet viser. | A fix is live: the chasing group now closes the gap, and caught riders are no longer pushed back. I have new reports of odd gaps and I'm checking whether they have the same cause. / En rettelse er live: jagtgruppen lukker nu hullet, og indhentede ryttere skubbes ikke længere bagud. Jeg har nye meldinger om mærkelige tidsforskelle og undersøger, om de har samme årsag. |
| races | done | #5953 | Breakaway flags and the race film mixed up morning escapees and later attacks. / Udbrudsflag og løbsfilmen blandede morgenudbrydere og senere angreb sammen. | The results now separate the morning break from later attacks, and the film shows regroupings and descent attacks. Older stages without full history keep their markers. / Resultaterne skelner nu mellem morgenudbruddet og senere angreb, og filmen viser samlinger og angreb på nedkørsler. Ældre etaper uden fuld historik beholder deres markeringer. |
| races | done | #5957 | Top sprinters and puncheurs finished behind weaker teammates. / De bedste sprintere og puncheurs sluttede bag svagere holdkammerater. | Form and fresh legs in the finale now follow ability, and AI teams no longer empty their leader before the sprint. It applies from the next stage that has not been raced. / Form og friske ben i finalen følger nu evnerne, og AI-holdene kører ikke længere deres kaptajn tom før spurten. Det gælder fra næste etape, der ikke er kørt. |
| races | done | #5956 | A flat time trial paid a mountain prize although nobody scored mountain points. / En flad enkeltstart udbetalte bjergpræmie, selvom ingen havde taget bjergpoint. | A mountain prize now needs mountain points. It applies to upcoming stages. / En bjergpræmie kræver nu bjergpoint. Det gælder kommende etaper. |
| races | done | #5914 | Riders behind the breakaway won intermediate sprints and mountain tops. / Ryttere bag udbruddet vandt mellemspurter og bjergtoppe. | Riders in the breakaway now cross sprints and summits first, and in a bigger group only point hunters contest what is left. Points already awarded stay as they are. / Ryttere i udbruddet krydser nu spurter og bjergtoppe først, og i en større gruppe kæmper kun pointjægere om resten. Point, der allerede er givet, står ved magt. |
| races | done | #5952 | Teams on equal time could appear in the wrong order in the team classification. / Hold på samme tid kunne stå i forkert rækkefølge i holdklassementet. | Equal time now follows the UCI tie-break, and this season's team classifications have been recalculated. / Lige tid afgøres nu efter UCI's regel, og sæsonens holdklassementer er regnet om. |
| races | done | #5860 (rest #6132) | A rider could ride two races on the same race day after a transfer. / En rytter kunne køre to løb på samme løbsdag efter en transfer. | Selection now checks every race a rider has ridden that day, also finished races, and the assistant follows the same rule. / Udtagelsen tjekker nu alle løb, rytteren har kørt den dag, også afsluttede løb, og assistenten følger samme regel. |
| races | done | #6095 NY | Saving tactics for one stage changed the roles you had set on other stages. / Når du gemte taktik for én etape, ændrede det rollerne på andre etaper. | Saving now only stores the stages you changed, and a stage that has started can no longer be changed. / Når du gemmer, gemmes nu kun de etaper, du har ændret, og en etape, der er startet, kan ikke længere ændres. |
| training | fix | #5928 | Fatigue and form moved far more in a day than they should. / Træthed og form flyttede sig langt mere på en dag, end de skulle. | Fatigue and form were recalculated with the fixed model, and earlier training was restored for affected riders. A few cases are still being reviewed. / Træthed og form er regnet om med den rettede model, og tidligere træning er genoprettet for de berørte ryttere. Nogle få tilfælde gennemgås stadig. |
| training | done | #5912 | Training on the first race day of season 4 was lost for many riders. / Træningen på sæson 4's første løbsdag gik tabt for mange ryttere. | The lost training has been restored for managers' riders and checked rider by rider. / Den tabte træning er genoprettet for managernes ryttere og kontrolleret rytter for rytter. |
| training | fix | #6129 NY | Some riders missed evening training on several days. / Nogle ryttere fik ikke aftentræning på flere dage. | New riders now get their starting condition and train from their first day. The missed days will be made up with your current plans once I have approved the calculation. / Nye ryttere får nu deres starttilstand og træner fra første dag. De tabte dage bliver erstattet med dine nuværende planer, når jeg har godkendt beregningen. |
| training | done | #5947 | Development history missed gains or showed them on the wrong date. / Udviklingshistorikken manglede stigninger eller viste dem på den forkerte dato. | Each date now shows how the rider ended that date. / Hver dato viser nu, hvordan rytteren sluttede den dato. |
| training | fix | #5915 | The race day numbers in the training report are hard to understand. / Løbsdagenes numre i træningsrapporten er svære at forstå. | The report now shows one receipt per rider for each date. Next is a plain explanation of the race day numbers on the page itself. / Rapporten viser nu én kvittering pr. rytter for hver dato. Næste skridt er en klar forklaring af løbsdagenes numre på selve siden. |
| training | inv | #5965 (LØFTE: analyse) | Riders seem to develop more slowly with the new training. / Rytterne virker til at udvikle sig langsommere med den nye træning. | I'm comparing actual daily gains and programs, not just the number of breakthroughs. It is part of the development work I'm designing now. / Jeg sammenligner det faktiske dagsudbytte og programmerne, ikke kun antallet af gennembrud. Det indgår i det udviklingsarbejde, jeg designer nu. |
| training | inv | #6123 NY | You can't remove a rider's own plan or put him back on the team program. / Du kan ikke fjerne en rytters egen plan eller sætte ham tilbage på holdets program. | Reported by players. I'm checking the training page and adding a way back to the team program if it's missing. / Meldt ind af spillere. Jeg tjekker træningssiden og tilføjer en vej tilbage til holdets program, hvis den mangler. |
| training | inv | #5911 NY | Evening training can take a long time to finish after the last stage. / Aftentræningen kan tage lang tid om at blive færdig efter sidste etape. | The cause is found: teams are trained one at a time, and the run waits before it starts. The goal is a run that starts right away and finishes within minutes. / Årsagen er fundet: holdene trænes ét ad gangen, og kørslen venter, før den starter. Målet er en kørsel, der starter med det samme og er færdig på få minutter. |
| youth | done | #5944 (LØFTE) | You couldn't keep a U23 or junior squad out of racing. / Du kunne ikke holde et U23- eller juniorhold ude af løb. | On the U23 or Junior team page, set Races to Train only. The assistant stops entering that squad, and its riders train on days without a race. / På siden for U23-holdet eller juniorholdet sætter du Løb til Kun træning. Assistenten stopper med at tilmelde holdet, og rytterne træner på dage uden løb. |
| youth | inv | #5945 | A junior squad below the starting minimum shows as taking part, but can't start. / Et juniorhold under minimum står som deltager, men kan ikke starte. | The page doesn't show the minimum either. No cause is confirmed yet. / Siden viser heller ikke minimum. Der er ingen bekræftet årsag endnu. |
| youth | inv | #5903 | Moving riders between squads can leave them on the wrong start list. / Når du flytter ryttere mellem trupper, kan de blive stående på den forkerte startliste. | Some cleanup already runs when you move a rider. I'm checking the cases that remain. / Noget oprydning kører allerede, når du flytter en rytter. Jeg tjekker de tilfælde, der er tilbage. |
| youth | inv | #6124 NY | The assistant may fill a U23 squad you picked yourself when the race starts. / Assistenten fylder måske et U23-hold op, som du selv har udtaget, når løbet starter. | Reported by a player. I'm checking whether your own selection is overwritten at the start. / Meldt ind af en spiller. Jeg tjekker, om din egen udtagelse bliver overskrevet ved start. |
| club | fix | #5897 | Youth race results moved some senior boards. / Ungdomsløbenes resultater flyttede nogle seniorbestyrelser. | Youth results no longer move your senior board. Cleaning the old youth entries out of board history is the next step. / Ungdomsresultater flytter ikke længere din seniorbestyrelse. Næste skridt er at rydde de gamle ungdomsposter ud af bestyrelseshistorikken. |
| club | inv | #5946 | The board can show your old target after you renegotiated it. / Bestyrelsen kan vise dit gamle mål, efter du har genforhandlet det. | Reported, not reproduced yet. / Meldt ind, ikke genskabt endnu. |
| club | inv | #6122 NY | Board messages repeat after you negotiate, and the 3-year plan prompt leads nowhere. / Bestyrelsesbeskeder gentager sig, efter du har forhandlet, og 3-års-planen fører ingen steder hen. | Your board's goals are under Mandate. I'm checking what makes the messages repeat. / Bestyrelsens mål ligger under Mandat. Jeg tjekker, hvad der får beskederne til at gentage sig. |
| club | inv | #5916 | The sponsor amount per race day looks lower than the deal you signed. / Sponsorbeløbet pr. løbsdag ser lavere ud end den aftale, du skrev under på. | I'm checking payment, display and units before I say anyone was paid too little. / Jeg tjekker betaling, visning og enheder, før jeg siger, at nogen har fået for lidt. |
| club | inv | #5940 | Next season's prize money estimate shows a range too wide to be useful. / Præmieestimatet for næste sæson viser et spænd, der er for bredt til at bruge. | Reported and registered. No cause confirmed yet. / Meldt ind og registreret. Ingen bekræftet årsag endnu. |
| market | inv | #5842 NY | Rider values changed at the season switch, which they should not. / Rytterværdierne ændrede sig ved sæsonskiftet, hvilket de ikke må. | Values update on Sundays only. I'm finding what changed them at the switch. / Værdierne opdateres kun om søndagen. Jeg finder ud af, hvad der ændrede dem ved skiftet. |
| market | inv | #5941 | Rider search finds names that don't match what you typed. / Ryttersøgningen finder navne, der ikke passer til det, du skrev. | Reported and registered. No cause confirmed yet. / Meldt ind og registreret. Ingen bekræftet årsag endnu. |
| other | fix | #5878 (+#5893) NY | The game was unreachable for a while on some evenings. / Spillet kunne ikke nås i et stykke tid på nogle aftener. | The database went down more than once. I'm working on automatic restarts, the root cause and more capacity. / Databasen gik ned mere end én gang. Jeg arbejder på automatisk genstart, rodårsagen og mere kapacitet. |
| other | inv | #6047 NY | Malwarebytes Browser Guard blocks cyclingzone.org. / Malwarebytes Browser Guard blokerer cyclingzone.org. | It is a false alarm, and I'm reporting it to Malwarebytes. / Det er en falsk alarm, og jeg indberetter det til Malwarebytes. |
| other | inv | #5979 (**LØFTE** 30/9) | A squad selection reminder you deleted comes back. / En påmindelse om holdudtagelse, som du har slettet, kommer igen. | Reported. No cause confirmed yet. / Meldt ind. Ingen bekræftet årsag endnu. |
| other | inv | #5980 | The reminder switch is hard to see in dark mode once it's turned off. / Kontakten for påmindelser er svær at se i mørkt tema, når den er slået fra. | Reported, not checked on screen yet. / Meldt ind, ikke tjekket på skærmen endnu. |
| other | inv | #5162 | Some pages stop loading on mobile after an update. / Nogle sider holder op med at indlæse på mobilen efter en opdatering. | Clearing the browser cache helped in one reported case. That doesn't mean the whole problem is solved. / At rydde browserens cache hjalp i én meldt sag. Det betyder ikke, at hele problemet er løst. |

**Sum:** 34 fejl · 13 rettet · 6 rettes · 15 undersøges.

Ikke med som kendte fejl: de fem træningsfunktioner fra udkastet 30/9 (funktioner, ikke fejl; fire er live, Train now står som N5) · #6115 (intet spillersymptom beskrevet) · intern motor-kalibrering (#4914, "v2-etaper mod testen") · #4964 (forretningstal).

## 4. Nye idéer til Vote-fanen (fra spørgeskema, backlog og masterplan)

Ingen af dem findes i `roadmap_items`. Alle har veto under 20 % i spørgeskemaet, hvor de er målt.

| Omr. | EN / DA | Kilde | Issue |
|---|---|---|---|
| races | Follow a stage live: watch the race unfold in the game while it is being ridden. / Følg en etape live: se løbet udvikle sig i spillet, mens det bliver kørt. | Spørgeskema live_race, veto 13,9 % | #4916 |
| races | Calendar tracks with their own identity: a Grand Tour track, a WorldTour track and a classics track. / Kalenderspor med egen identitet: et Grand Tour-spor, et WorldTour-spor og et klassikerspor. | Spillerønske | #3471 |
| races | Friendly races: set up your own race against managers from other divisions, outside the league. / Venskabsløb: lav dit eget løb mod managers fra andre divisioner, uden for ligaen. | Spillerønske | #3050 |
| races | Take a rider out of a race in progress, and he is locked out of overlapping races. / Tag en rytter ud af et igangværende løb, og han låses ude af overlappende løb. | Spillerønske | #4540 |
| training | Injuries reset at the season switch, the same way fatigue does. / Skader nulstilles ved sæsonskiftet, ligesom trætheden. | Spillerønske; ejeren: "fin idé" | #5865 |
| training | Your team's injury and crash history: see how many injuries and crashes your riders have had. / Dit holds skade- og styrthistorik: se hvor mange skader og styrt dine ryttere har haft. | Spillerønske; ejeren positiv | #4942 |
| training | See on the training page if a rider is picked for a race, and how many days until his next start. / Se på træningssiden, om en rytter er udtaget til et løb, og hvor mange dage der er til hans næste start. | Forum, to spillere | #4342 |
| youth | Lower age limits for the youth classification and juniors. / Lavere aldersgrænser for ungdomsklassementet og juniorer. | Spillerønske | #6126 |
| market | A market value that does not give away a young rider's hidden potential. / En markedsværdi, der ikke afslører en ung rytters skjulte potentiale. | Spørgeskema value_no_leak, veto 17,6 % | #2798 |
| market | Longer auctions, and extra time when someone bids in the last minutes. / Længere auktioner, og ekstra tid når nogen byder i de sidste minutter. | Spillerønske, 5 spillere | #2884 |
| club | Switch division in the off-season by taking the place of an AI team or a folded team. / Skift division i sæsonpausen ved at overtage pladsen fra et AI-hold eller et nedlagt hold. | Spillerønske | #5062 |
| club | A break between seasons, with the season end and start moved. / En pause mellem sæsonerne, hvor sæsonens slut og start flyttes. | Spillerønske; ejer-beslutning til S5 | #5833 |
| club | See what upkeep costs in other divisions before you move up. / Se hvad driften koster i andre divisioner, før du rykker op. | Spillerønske | #4125 |

Udeladt pga. veto over 20 %: flere løb i lave divisioner (24,1 %), én stor trup (28,1 %), træner-feedback (22,2 %), AI-bud (32,4 %).

## 5. Discord (fem kanaler + de daglige udtræk 20/9-4/10)

**Dækning:** Discord-værktøjet henter kun de 100 nyeste beskeder pr. kanal. #feedback-from-dolmer (15/8-28/9), #løse-informationer (2/9-4/10), #the-roadbook (hele kanalen) og #patch-notes (17/7-3/10) er læst direkte. #staff-chat kun 2-3/10 direkte; resten og alle spillerkanaler og forummer er dækket af de daglige udtræk `scripts/discord/.sweep-daily-2026-09-20.md` til `-10-04.md`, som er læst helt. Ældre forumtråde (3/8-19/9) er ikke læst her; de dækkes af auditten 10/9 og af backlog-gennemgangen (afsnit 6). Intet i det læste lignede en instruktion til en AI. Spillernavne er udeladt, fordi repoet er offentligt.

### 5.1 De vigtigste temaer, 20/9-4/10 (antal forskellige spillere)

| # | Tema | Spillere | Dækket på roadmappet af |
|---|---|---|---|
| 1 | Ungdomsholdene: løb ikke synlige, udløbne U23-kontrakter, låste ryttere, forkert alder, ingen gevinst ved at vinde | 15 | Idé "Prize money in youth races" · fejl #5945, #6124 · idé #6126 · **nye fejl 5.3** |
| 2 | v4-motoren: favoritter i udbrud, kunstige tidstab, resultater der virker tilfældige | 14 | Fejl #5978, #5951 · **nye fejl 5.3** (løbsfilm, tidshuller) |
| 3 | Træningen efter sæsonskiftet er svær at forstå (rapporter, tidspunkt, løbsdage) | 13 | N5 Train now · N8 træningssiden · fejl #5915 |
| 4 | Bestyrelsen: gentagne beskeder, 3-års-plan man ikke kan svare på, mål der ikke passer | 12 | Fejl #6122, #5946 |
| 5 | Marked: frie ryttere på auktion i kun 1 time, bytte med flere ryttere, penge der "kommer tilbage" | 10 | Idé #2884/#4714 · punktet "Deeper negotiation" · **ny fejl 5.3** |
| 6 | Træthed og form talt 5 gange, træning tabt 28-29/9 | 9 | Fejl #5928, #5912, #6129 |
| 7 | Udviklingen føles langsommere, og løb giver for lidt i forhold til træning | 9 | N9 Udvikling 2.0 · fejl #5965 |
| 8 | Økonomi: drift pr. løbsdag mod indtægt, lønkrav, sponsorbeløb, frygt for at blive "feeder-hold" | 6 | Fejl #5916 · **nye idéer 5.4** |
| 9 | Kommunikation og stabilitet, ønske om ét sted med kendte problemer | 5 | Selve roadmap-hubben |
| 10 | Rytterværdier ændrede sig ved skiftet | 5 | Fejl #5842 |
| 11 | For kort pause mellem sæsoner | 5 | Idé #5833 |
| 12 | Scouting er for tyndt | 5 | Punktet "Scouts that differ" · fejl #6138 |
| 13 | Scouted projection og alder | 5 | N9 · **ny fejl 5.3** |
| 14 | Træningsskader føles hyppige, advarslen kommer for sent | 5 | **Ny fejl 5.3** (#5418) |
| 15 | Siden hænger (28/9 og 1/10) | 3 | Fejl #5878/#5893, #5162 · N16 |

### 5.2 Åbne løfter, der ikke står i afsnit 1-3

| Dato | Løfte | Status | Issue | Forslag |
|---|---|---|---|---|
| 22/9 | Eget ikon for kuperede etaper i kalenderen | Ikke startet | #6125 | Plan · later |
| 25/9 | Potentiale forlader værdimodellen og erstattes af træningsscore | Ikke startet | intet fundet | Plan · next (del af #5443) |
| 26/9 | Topryttere: den ekstra præmie i prisen trappes ned hver søndag fra 4/10 | Ikke verificeret, om det kørte 4/10 | #5443 | Verificér først |
| 26/9 | Drift pr. ungdomsplads vender tilbage med en sats, der meldes ud først | Ikke meldt ud | intet fundet | Plan · later |
| 27/9 | Træthedsadvarslen flyttes fra 78 til 70 | Ikke leveret | #5418 | Known issue (5.3) |
| 27/9 | Afstemning om pause mellem sæsoner | Ikke set | #5833 | Idé (afsnit 4) |
| 27/9 | Sprinttog med fra start i den nye motor | Uverificeret | #6125 | Verificér først |
| 28/9 | Skader nulstilles ved sæsonskiftet fremover | Ikke startet | #5865 | Idé (afsnit 4) eller Plan |
| 1/10 | Vicekaptajn / delt kaptajn | Ikke startet | #5981 | Plan · next (med i #6148) |
| 3/10 | Sortering på omdømme rettes | Ukendt | intet fundet | Known issue (5.3) |
| 30/9 | "Jeg opdaterer status, når ting faktisk er live" | Indfries af Known issues-fanen | #5387 | |

### 5.3 Kendte fejl, der mangler i afsnit 3

| Omr. | Trin | Issue | Spillere | EN / DA |
|---|---|---|---|---|
| races | inv | #6137 | 1 | The race film repeats the same event many times in a row. / Løbsfilmen gentager den samme hændelse mange gange i træk. |
| races | inv | intet fundet | 3 | Rolling and punchy uphill finishes can still give too big time gaps. / Kuperede etaper og punch-afslutninger opad kan stadig give for store tidsforskelle. |
| training | inv | #5418 | 5 | Training injuries feel too frequent, and the fatigue warning comes too late. / Træningsskader føles for hyppige, og træthedsadvarslen kommer for sent. |
| training | inv | #6110 | 5 | Scouted projection is too low for the biggest young talents. / Scouted projection viser for lavt for de største unge talenter. |
| training | inv | #6059 | 2 | Some riders jumped or dropped in abilities at the season switch. / Nogle ryttere sprang op eller ned i evner ved sæsonskiftet. |
| training | fix | #6006 (+#6027) | 4 | Train now (beta) does not show the result right away. / Train now (beta) viser ikke resultatet med det samme. |
| training | fix | #5949 | 1 | A rider who left a race could block training for the whole team. / En rytter, der udgik af et løb, kunne blokere træningen for hele holdet. |
| training | inv | intet fundet | 1 | A rider can still gain two points in one ability on the same day. / En rytter kan stadig stige to point i samme evne på én dag. |
| training | inv | intet fundet | 1 | On a phone, training cannot be changed after a rider has trained. / På telefonen kan træningen ikke ændres, når rytteren har trænet. |
| training | done | #6061 | 1 | Some riders did not train in the evening. / Nogle ryttere trænede ikke om aftenen. (v7.334) |
| youth | inv | intet fundet | 3 | Some U23 riders with an expired contract stayed on the U23 team. / Nogle U23-ryttere med udløbet kontrakt blev på U23-holdet. |
| youth | inv | intet fundet | 1 | Riders moving from junior to U23 can show the wrong age. / Ryttere, der går fra junior til U23, kan vise forkert alder. |
| market | inv | intet fundet | 2-3 | Money from a sale can look like it came back to your account. / Penge fra et salg kan se ud, som om de kom tilbage på kontoen. |
| market | inv | #6138 | 1 | A 24-hour scout mission can return 4 riders instead of 5. / En 24-timers scoutmission kan give 4 ryttere i stedet for 5. |
| market | inv | intet fundet | 1 | Sorting riders by reputation is not fully correct. / Sortering af ryttere efter omdømme er ikke helt korrekt. |
| market | fix | #5919 | 1 | You get an outbid mail when your own team bids. / Du får en overbudt-mail, når dit eget hold byder. |
| club | inv | intet fundet | 1 | The left menu disappears in the board meeting. / Venstremenuen forsvinder i bestyrelsesmødet. |

Fem af dem mangler et GitHub-issue (udløbne U23-kontrakter, penge der "kommer tilbage", sortering på omdømme, forkert alder ved junior til U23, menuen i bestyrelsesmødet). De oprettes i næste triage.

Uenighed mellem gennemgangene, som skal afgøres ved apply: #5951 (indhentede udbrydere) står som "undersøges" i afsnit 3, men rettelsen er live i v7.327, og nye meldinger kan have en anden årsag. #5928, #6095, #5860, #5947 og #6061 er rettet ifølge patch notes, men står stadig åbne i GitHub.

### 5.4 Nye idéer fra Discord (ikke i afsnit 4)

| Omr. | EN / DA | Kilde | Issue |
|---|---|---|---|
| races | Crashes that depend on a rider's technique, not only on luck. / Styrt der afhænger af rytterens teknik, ikke kun af held. | 1 spiller, 24/9 | intet fundet |
| races | Gravel races, where cobble riders feel at home. / Grusvejsløb, hvor brostensryttere føler sig hjemme. | Ejeren 3/9 (staff-kanal) | intet fundet |
| races | Time trials of different lengths, flat and hilly, so different riders win them. / Enkeltstarter i forskellige længder, flade og bakkede, så forskellige ryttere vinder dem. | 1 spiller, 2/9 (staff-kanal) | intet fundet |
| races | African, Asian and Pan American Games next to the Europeans. / Afrikanske, asiatiske og panamerikanske lege ved siden af EM. | 1 spiller, 28/7 | intet fundet |
| races | The race film groups repeated events into one line. / Løbsfilmen samler gentagne hændelser i én linje. | 1 spiller, 3/10 | #6137 |
| training | Balanced training pays off: a rider far ahead in one ability trains it slower. / Alsidig træning betaler sig: en rytter langt foran i én evne træner den langsommere. | 1 spiller, 3/10 (staff-kanal) | intet fundet |
| training | Punch and climbing as separate training sessions. / Punch og klatring som to forskellige træningspas. | Ejeren 2/9 (roadbook) | intet fundet |
| training | Pick riders for a training rule or group by ticking them on your squad list. / Vælg ryttere til en træningsregel eller -gruppe ved at sætte flueben på truplisten. | 1 spiller, 3/10 | intet fundet |
| training | The daily report opens every rider at once and sorts by age, score or name. / Den daglige rapport folder alle ryttere ud på én gang og sorterer efter alder, score eller navn. | 2 spillere, 1/10 | intet fundet |
| youth | Homegrown riders: follow every rider from your academy, also after he leaves. / Egne talenter: følg hver rytter fra dit akademi, også når han forlader holdet. | Ejeren 10/9 (staff-kanal) | intet fundet |
| market | Watchlist icons for riders on auction or the transfer list. / Ikoner på ønskelisten for ryttere på auktion eller transferlisten. | 1 spiller, 20/8 | intet fundet |
| club | A way back for small clubs: cheaper ways to develop when you start late or fall behind. / En vej tilbage for små klubber: billigere udvikling, når du starter sent eller er bagud. | 2 spillere, 1/10; ejeren: "senere" | #1981 |
| club | Wages paid per race day, like upkeep, instead of in one go. / Løn betalt pr. løbsdag ligesom drift, i stedet for i én omgang. | Ejeren + 1 spiller, 1/10 | intet fundet |

Ikke foreslået: "75 % træning som standard og 25 % ekstra til aktive managers" (2 spillere, 3/10), fordi det strider mod løftet i v7.308 om, at alle hold træner ens.

### 5.5 Spørgsmål fra Discord-gennemgangen

- Må idéer fra de lukkede staff-kanaler stå som offentlige Vote-punkter?
- Grusvejsløb: Plan eller Vote?
- "Udviklingen føles langsom" (9 spillere): kendt fejl, eller kun Udvikling 2.0 på Plan?
- 12-timers auktioner på frie ryttere: forum-afstemningen (#4714) eller Vote-fanen, ikke begge.
- Skader i løbsdage (#5462) er lukket, men der er ikke fundet en patch note. Er det live?
- Kørte nedtrapningen af topryttere-præmien søndag 4/10?
- Et hold ved navn "Dolmer Racing" udgav sig 3/10 for at være ejeren (ikke roadmap, men bør håndteres).

### 5.6 Kendte fejl fordelt efter ejerens regel (4/10)

Ejer 4/10: noget er først en kendt fejl, når det er identificeret som et problem. Det, spillerne har meldt ind, men som ikke er bekræftet, står i sit eget felt uden løfte om ændring (billede: `pr-screens/roadmap-4-10/known-issues-to-grupper.png`). Trinene "inv" i afsnit 3 og 5.3 afløses af denne fordeling. Ejeren bekræfter fordelingen ved apply.

| Felt | Trin | Fejl (issue) |
|---|---|---|
| **Confirmed** | Fix in progress | Træthed og form flyttede sig for meget (#5928) · tabte aftentræninger, kompensation (#6129) · ungdomsløb flyttede seniorbestyrelser (#5897) · spillet kunne ikke nås nogle aftener (#5878/#5893) · Train now (beta) viser ikke resultatet (#6006) · udgået rytter blokerede træningen (#5949) · løbsdagenes numre i rapporten (#5915) |
| **Confirmed** | Confirmed | Farlig klassementsrytter i udbrud uden reaktion (#5978) · aftentræningen tager lang tid (#5911, årsag fundet) · rytterværdier ændrede sig ved skiftet (#5842) · scouted projection for lav for toptalenter (#6110, meldt ud 2/10) · kan ikke sætte rytter tilbage på holdprogram (#6123) · Malwarebytes blokerer siden (#6047) |
| **Reported, being checked** | Being checked | Udviklingen føles langsommere (#5965) · bestyrelsesbeskeder gentager sig (#6122, 12 spillere) · gammelt bestyrelsesmål efter genforhandling (#5946) · sponsorbeløb pr. løbsdag (#5916) · præmieestimat (#5940) · ryttersøgning (#5941) · slettede påmindelser kommer igen (#5979) · kontakt svær at se i mørkt tema (#5980) · mobilsider indlæser ikke (#5162) · juniorhold under minimum (#5945) · rytter på forkert startliste efter trupskift (#5903) · assistenten fylder U23-hold op (#6124) · løbsfilmen gentager sig (#6137) · tidshuller på kuperede afslutninger · træningsskader og sen advarsel (#5418) · evner sprang ved skiftet (#6059) · to point i samme evne på én dag · træning kan ikke ændres på telefon · udløbne U23-kontrakter · forkert alder junior til U23 · penge der "kommer tilbage" · scoutmission giver 4 ryttere (#6138) · sortering på omdømme · overbudt-mail ved eget bud (#5919) · menuen i bestyrelsesmødet · nye meldinger om tidstab for indhentede udbrydere (#5951) |
| **Fixed** | Fixed | #5955 · #5953 · #5957 · #5956 · #5914 · #5952 · #5860 · #6095 · #5912 · #5947 · #5944 · #6061 · jagten skubbede udbrydere baglæns (#5951, v7.327) |

Bestyrelsesbeskederne (#6122) er meldt af 12 spillere og står kun som "being checked", fordi årsagen ikke er fundet. Ejeren kan flytte den til Confirmed med det samme.

## 6. Backlog-gennemgang (spillerønsker i GitHub-issues)

693 åbne issues listet, ca. 286 gennemgået på titel, ca. 150 læst helt. Kun ønsker, der ikke står i afsnit 1, 2 eller 4. "Spillere" er et minimum talt i issuet. "Tjek" = kan være helt eller delvist live og skal verificeres, før punktet kommer på Vote.

### Races

| Issue | EN / DA | Spillere | Note |
|---|---|---|---|
| #2009 | See a rider's stats and age on hover, or in a pop-up, while you pick a squad or plan training. / Se en rytters evner og alder ved hover eller i et pop-up, mens du udtager hold eller planlægger træning. | 6+ | Ejeren positiv. Tjek |
| #4122 | Iconic races are written by hand, so a classic stays the same classic every season. / Ikoniske løb er skrevet i hånden, så en klassiker er den samme klassiker hver sæson. | 5+ | Ejeren positiv. Kan slås sammen med #3471 |
| #2457 | AI teams field riders that fit their division, so Division 4 is no walkover. / AI-holdene stiller ryttere, der passer til deres division, så Division 4 ikke er en walkover. | 3+ | Ejer-ønske |
| #2794 | A race page in tabs, so you never scroll past a locked squad to reach the result. / En løbsside i faner, så du aldrig scroller forbi en låst udtagelse for at nå resultatet. | 3 | Tjek |
| #2030 | After today's last race, Planning jumps to the next race day. / Når dagens sidste løb er kørt, hopper Planlægning videre til næste løbsdag. | 2 | Ejeren positiv |
| #3982 | Under each stage: the top 5 and your own team's top 5 once it is ridden, favourites and GC before it. / Under hver etape: top 5 og dit holds top 5, når den er kørt, og favoritter og klassement før. | 1 | Ejeren positiv |
| #5981 | A shared captain: a second rider with his own GC chance, without a free role's breakaway or a helper's sacrifice. / Delt kaptajn: en anden rytter med egen klassementschance, uden en fri rolles udbrud eller en hjælpers ofring. | 1 | Lovet (staff-kanal 1/10); med i #6148. Plan |
| #5982 | Choose which helper works in which phase of the race: save your best helper for the mountain or the finale. / Vælg hvilken hjælper der arbejder i hvilken fase: gem din bedste hjælper til bjerget eller finalen. | 1 | Afventer beslutning |
| #3529 | See which races each rider has ridden, and which he will ride, in one view. / Se hvilke løb hver rytter har kørt og skal køre, i ét overblik. | 1 | |
| #3955 | See stage profiles right in Planning, so you can plan without opening every race. / Se etapeprofiler direkte i Planlægning, så du kan planlægge uden at åbne hvert løb. | 1 | |
| #4259 | Planning shows an icon when a rider is already picked for a race that day. / Planlægning viser et ikon, når en rytter allerede er udtaget til et løb den dag. | 1 | Tjek |
| #3900 | See next season's races and routes in one overview, and only the races your team can enter. / Se næste sæsons løb og ruter i ét overblik, og kun de løb dit hold kan stille op i. | 1 + ejer | Delvist leveret |
| #1900 | See the standings of all divisions in one view, with a filter for your own. / Se stillingen for alle divisioner i ét overblik, med et filter til din egen. | ejer | Tjek |
| #4611 | Your riders talk to you before and after a stage, and you act with one click, for example by giving him a free role. / Dine ryttere taler til dig før og efter en etape, og du handler med ét klik, for eksempel ved at give ham fri rolle. | ikke angivet | Trin 1 er live |
| #939 | Weather and wind on stages, and crosswinds that split the peloton into echelons. / Vejr og vind på etaper, og sidevind der splitter feltet i vifter. | ikke angivet | |
| #3444 | Division 1 is the endgame: named AI teams with a philosophy, a history and press coverage. / Division 1 er endgame: navngivne AI-hold med filosofi, historie og pressedækning. | ejer | |
| #2477 | The world ranking decides who gets into big races, with wildcards and invitations from organisers. / Verdensranglisten afgør, hvem der kommer med i de store løb, med wildcards og invitationer fra arrangører. | ikke angivet | Meget stor |

### Training

| Issue | EN / DA | Spillere | Note |
|---|---|---|---|
| #1833 | Rider abilities and power intervals explained on hover, in plain words. / Rytterens evner og effektintervaller forklaret ved hover, i klart sprog. | 3+ | Tjek |
| #5076 | The form dip after a peak is explained where you see it. / Formdykket efter et peak bliver forklaret, der hvor du ser det. | 2+ | Tjek |
| #3705 | Hard cobbled training and combined sessions, so a cobbled rider can be built. / Hård brostenstræning og kombinerede pas, så en brostensrytter kan bygges op. | 5 | Fra Discord 2-14/9 |
| #5882 | Racing at your rider's level develops him most, and new experiences such as cobbles, a bigger field or a long stage race give extra. / Løb på din rytters niveau udvikler ham mest, og nye erfaringer som brosten, større felt eller et langt etapeløb giver ekstra. | ejer | Kan være del af N9 |
| #3763 | See a rider's form rise and fall from training, not only where it stands. / Se en rytters form stige og falde af træning, ikke kun hvor den står. | 1 + ejer | Tjek |
| #2488 | Name up to three project riders with a development plan over several seasons. / Udpeg op til tre projekt-ryttere med en udviklingsplan over flere sæsoner. | ejer-spec | |
| #2487 | Breakthrough windows and plateaus come with a visible reason, not only luck. / Gennembrud og stilstand har en synlig årsag, ikke kun held. | ejer-spec | |
| #2489 | A season map: races on top, training blocks (base, build, peak, recovery) underneath. / Et sæsonkort: løb øverst, træningsblokke (base, opbygning, peak, restitution) nedenunder. | ejer-spec | Tæt på sæsonplanlæggeren |
| #1679 | See other teams' training score and training facility, and no more than that. / Se andre holds træningsscore og træningsanlæg, og ikke mere end det. | ejer | |

### Youth

| Issue | EN / DA | Spillere | Note |
|---|---|---|---|
| #3657 | Targeted scouting: send your scout after a nation, a rider type or a budget. / Målrettet scouting: send din scout efter en nation, en ryttertype eller et budget. | 3 | Issue lukket; overlapper "Scouts that differ" |
| #5876 | New riders come mostly from the nations that are big in real cycling. / Nye ryttere kommer mest fra de nationer, der er store i rigtig cykelsport. | ejer | |
| #3964 | Swap an academy rider and a senior rider in one step when your squad is full. / Byt en akademirytter og en seniorrytter i ét trin, når truppen er fuld. | 1 | |
| #4703 | Show academy riders in squad selection behind a tick box, so you can compare route fit. / Vis akademiryttere i holdudtagelsen bag et hak, så du kan sammenligne rutematch. | 1 | Lav prioritet |
| #5920 | See the age limit for U23 and Junior on the squad overview. / Se aldersgrænsen for U23 og Junior på trup-oversigten. | 1 | Ejeren enig. Tjek |
| #5895 | An optional board goal for your academy work. / Et valgfrit bestyrelsesmål for dit akademiarbejde. | ejer | |
| #4381 | The academy list looks and sorts like My Team. / Akademilisten ser ud og sorterer som Mit hold. | 1 | |
| #3970 | Contracts counted in days, with short intro contracts for academy riders. / Kontrakter i dage, med korte intro-kontrakter for akademiryttere. | forum-debat | |
| #2493 | Each academy intake is a named class with a leaderboard across clubs. / Hvert akademi-kuld er en navngivet årgang med et leaderboard på tværs af klubber. | ejer-spec | |
| #2494 | A scout window before a youth auction, so you bid with what you have learned. / Et spejder-vindue før en ungdomsauktion, så du byder med det, du har fundet ud af. | ejer-spec | |
| #2495 | Choose an academy school that shapes the types of your intakes. / Vælg en akademi-skole, der farver typerne i dine kuld. | ejer-spec | Tæt på "Your own young stars" |

### Market

| Issue | EN / DA | Spillere | Note |
|---|---|---|---|
| #3967 | See a rider's potential as a word or a band, not an exact number. / Se en rytters potentiale som et ord eller et bånd, ikke et præcist tal. | 6+ | Ejeren positiv. Tjek |
| #2399 | Filter the rider list by division, and show only riders owned by managers. / Filtrér rytterlisten på division, og vis kun ryttere ejet af managers. | 4+ | Ikke live |
| #2176 | Set an auto-accept price on a listed rider: when someone hits it, a short public auction starts at once. / Sæt en auto-accept-pris på en listet rytter: rammer nogen den, starter en kort offentlig auktion med det samme. | 1 + ejer | Ejeren: "kommer". Plan |
| #450 | Set a minimum price on your own riders, so offers below it are turned down automatically. / Sæt en minimumspris på dine egne ryttere, så bud under den automatisk afvises. | 1 + ejer | Ejer-prioritet |
| #26 | A transfer room: shortlist, compare two riders and see the budget effect before you buy. / Et transferrum: shortlist, sammenlign to ryttere og se budgeteffekten, før du køber. | ejer | Delvist live |
| #4825 | Cancel a bid within a short window on your own sales. / Træk et bud tilbage inden for et kort vindue på dine egne salg. | 1 | |
| #5918 | Ask the other side for cash in a swap. / Bed den anden side om et pengetillæg i en byttehandel. | 1 | Tæt på "Deeper negotiation" |
| #5683 | The potential band stays steady between seasons, with its midpoint shown. / Potentialebåndet er stabilt mellem sæsoner, og midtpunktet vises. | 3+ | Ejeren positiv |
| #6125 | A rider you just bought shows "joins you after race X" instead of nothing. / En rytter, du lige har købt, viser "starter hos dig efter løb X" i stedet for ingenting. | 1+ | |
| #5293 | An auction page where the live bids block does not push the important parts down. / En auktionsside, hvor live-budblokken ikke skubber det vigtige ned. | 1 | Lav prioritet |

### Club

| Issue | EN / DA | Spillere | Note |
|---|---|---|---|
| #1928 | See which of your riders are your team's stars, and what makes one. / Se hvilke af dine ryttere der er holdets stjerner, og hvad der gør en. | 4 | Tjek |
| #3948 | The board's goals say exactly what counts, and what you get for taking the harder option. / Bestyrelsens mål siger præcis, hvad der tæller, og hvad du får ved at tage den sværere mulighed. | 3+ | Mest tekst |
| #3147 | See sponsor money arrive race day by race day, base amount included. / Se sponsorpengene komme løbsdag for løbsdag, også basisbeløbet. | 3 | Delvist leveret |
| #3987 | Your sponsor pays more the more famous your team is. / Din sponsor betaler mere, jo mere berømt dit hold er. | 2 | Overlapper sponsor-punktet |
| #2398 | Click a coach to see his attributes, and pay a fee to hire or fire him. / Klik på en træner og se hans egenskaber, og betal et gebyr for at hyre eller fyre ham. | 2 | Overlapper "Staff you can feel" |
| #4032 | Retirement that follows the career: riders with good results keep racing longer. / Pension der følger karrieren: ryttere med gode resultater kører længere. | 2 | Ejeren: S4+ |
| #986 | A finance page that opens with an overview and a real forecast for next season. / En økonomiside, der åbner med et overblik og en rigtig prognose for næste sæson. | 2 | Delvist leveret |
| #2161 | Log in with Discord in one click. / Log ind med Discord med ét klik. | ejer | Besluttet. Plan |
| #5385 | Click the online counter to see who is online now and who was online recently. / Klik på online-tælleren og se, hvem der er online nu og senest. | ejer | Mockup klar |
| #3451 | Search the forum, and see unread threads. / Søg i forummet, og se ulæste tråde. | 1 + ejer | Ulæst er live, søgning mangler |
| #3517 | Quote a post when you reply, and the person quoted gets a message. / Citér et indlæg, når du svarer, og den citerede får besked. | ejer | Delvist live |
| #1108 | Pick the nationality of your manager and your club, and find your settings in one place. / Vælg din managers og din klubs nationalitet, og find dine indstillinger ét sted. | ejer | |
| #1154 | Riders with a personality: role wishes, ambition and loyalty. / Ryttere med personlighed: rolleønsker, ambition og loyalitet. | 1 + ejer | |
| #1113 | Your results build a fan base, and fans buy merchandise that pays you. / Dine resultater bygger en fanbase, og fans køber merchandise, der betaler dig. | ikke angivet | |
| #1110 | The board asks for a balanced squad, for example a sprinter, climbers and a captain. / Bestyrelsen vil have en afbalanceret trup, for eksempel en sprinter, klatrere og en kaptajn. | ikke angivet | |
| #2218 | Retired riders become coaches or scouts. / Pensionerede ryttere bliver trænere eller spejdere. | ejer-vision | Frosset (MASTERPLAN) |
| #4110 | The game in more languages, starting with Spanish. / Spillet på flere sprog, først spansk. | 1 | Issue lukket (analyse) |
| #938 | One search for riders, teams, races and managers. / Én søgning efter ryttere, hold, løb og managers. | ikke angivet | |

**Sum:** 65 nye kandidater (races 17, training 9, youth 11, market 10, club 18). Sammen med afsnit 4 (13) og 5.4 (13) er der ca. 90 nye idéer at vælge imellem, oven i de 23 nuværende.

Omstridt og ikke foreslået: lås og bonus til aktive managers i Train now (#6139; 2 for, 1 imod; strider mod "alle hold træner ens").

## 6b. Verificering mod det, der er live (4/10)

Ejeren fandt 4/10, at "grusvejsløb" stod som ny idé, selvom grusetaper er live (v7.336, #4105 lukket, motoren har grus). Derfor er hvert punkt tjekket mod patch notes (til og med 7.337), koden, kontakterne i prod og issuet. **Dommen her går forud for afsnit 1-6.** Løb og træning tilføjes, når den del er færdig.

### Ungdom, marked og klub

**Ud af listerne (live):**

| Punkt | Bevis |
|---|---|
| Ikoner på ønskelisten for auktion/transferliste (5.4) | v7.165 (#4036) |
| Potentiale som ord eller bånd (#3967) | Vises altid som interval + ord; aldrig ét tal |
| Citér et indlæg, og den citerede får besked (#3517) | v7.192 |
| Økonomiside med overblik og prognose (#986) | v5.41 + v7.146/v7.162 |
| Sponsor betaler mere for berømt hold (#3987) | v7.302: tilbud følger omdømme, division og placering (ejer bekræfter) |
| Driftsudgift i andre divisioner (#4125) | Satserne står i Hjælp (ejer bekræfter, om det er nok) |
| Grusvejsløb (5.4) | v7.336, #4105 |

**Delvist live: titlen skrives om til det, der mangler** (del-reglen; stemmerne følger med):

| Punkt | Live i dag | Ny titel EN / DA |
|---|---|---|
| 00000215 ungdomssæsoner | Stilling for egen pulje (v7.304) | Promotion and relegation for U23 and junior groups, from season 5. / Op- og nedrykning for U23- og juniorpuljer fra sæson 5. |
| 00000217 spejdere | Bedre spejder ser mere og kører to opgaver (v7.85, v7.287) | A better scout charges less per report, so two scouts are never the same. / En bedre spejder tager mindre pr. rapport, så to spejdere aldrig er ens. |
| #3657 målrettet scouting | Land, type, U23, division (v7.137) | Send your scout after riders within your budget. / Send din spejder efter ryttere inden for dit budget. |
| #5920 aldersgrænse | Står på U23- og Junior-siderne (v7.304) | See the age limit for U23 and Junior in the squad filter on My Team. / Se aldersgrænsen for U23 og Junior i trupfilteret på Mit hold. |
| 00000011 forhandling | Modbud uden grænse, 1-mod-1-bytte med penge (v7.221) | Trade several riders in one deal, ask the other manager for cash, and set a deadline on an offer. / Byt flere ryttere i én handel, bed den anden manager om penge, og sæt en frist på et tilbud. (dækker også #5918 og #6024) |
| 00000012 rygter | Anonym "en manager kigger på X" (v4.45) | Market rumours: news about which clubs are looking for which riders. / Markedsrygter: nyheder om, hvilke klubber der leder efter hvilke ryttere. |
| 00000219 marked du kan stole på | Åben log + rapportér handel (v7.288, v7.275). Grænserne findes i koden, men er slået fra i prod | Limits on deals between friends: a floor and a ceiling on what a rider can be traded for. / Grænser for handler mellem venner: et gulv og et loft for, hvad en rytter kan handles for. |
| 00000221 skade på andres rytter | Skadesmærke på andre holds trup | See an injury on another team's rider on his profile, and how long he is out. / Se en skade på en rytter fra et andet hold på hans profil, og hvor længe han er ude. |
| #2884 auktioner | 10 min. forlængelse ved sent bud; sælger vælger 1-48 t | A longer minimum time on auctions for free riders. / Længere minimumstid på auktioner over frie ryttere. (kun ét sted: forum-afstemningen #4714 eller Vote) |
| #2399 filter | AI-hold skjult som standard | Filter the rider database by division. / Filtrér rytterdatabasen på division. |
| #26 transferrum | Ønskeliste + sammenligning | See what a rider does to your budget before you buy him. / Se hvad en rytter gør ved dit budget, før du køber ham. |
| #6125 nykøbt rytter | "Joining once his current stage race finishes" | A rider you just bought shows which race he joins you after. / En rytter, du lige har købt, viser hvilket løb han kommer til dig efter. |
| 00000224 faciliteter | Alle fem kan bygges; kun træning og scouting har effekt | Medical, academy and commercial facilities that work: faster recovery, more academy places and more sponsor money. / Medicinsk afdeling, akademi og kommerciel afdeling, der virker: hurtigere restitution, flere akademipladser og flere sponsorpenge. |
| 00000227 assistent/indbakke | Én linje pr. løb, bud samlet pr. auktion (v7.288-7.289) | Similar inbox messages grouped into one. / Ens beskeder i indbakken samlet i én. (delen "svar fra indbakken" udgår: veto 30 %) |
| 00000018 statistik | Palmarès, sæsonsider, resultatvælger | Your league and division across all seasons in one view: champions, records and standings. / Din liga og division på tværs af alle sæsoner i ét overblik: vindere, rekorder og stillinger. |
| 00000021 museum | Æresliste og karrieretotaler | A club museum: your legends and the races your club is remembered for. / Et klubmuseum: dine legender og de løb, klubben huskes for. |
| 00000022 venner | Følg rytter, handels-feed, beskeder | Follow a manager, invite a friend, and see a feed of results from the whole game. / Følg en manager, invitér en ven, og se et feed med resultater fra hele spillet. |
| #1928 stjerner | Rytterens omdømme er synligt (v7.330) | See which riders the board counts as your stars. / Se hvilke ryttere bestyrelsen regner som dine stjerner. |
| #3948 bestyrelsesmål | Kvittering "Counted: …" pr. mål | Board goals that say in the title what counts, for example stage races only. / Bestyrelsesmål, der i selve titlen siger, hvad der tæller, for eksempel kun etapeløb. |
| #3147 sponsorpenge | Løbsdagsbetalinger er løbende | Your sponsor's base amount paid race day by race day, like the rest. / Sponsorens basisbeløb udbetalt løbsdag for løbsdag ligesom resten. |
| #2398 trænere | Egenskaber vises; fyring koster 4 ugers løn | A fee when you hire staff, not only when you release them. / Et gebyr, når du ansætter personale, ikke kun når du afskediger. |
| #3451 forum | Ulæste tråde er live | Search the forum. / Søg i forummet. |
| N17 Pro-betaling | Pro falder ikke længere ved fornyelse (v7.236) | If a CZ Pro payment fails, Pro stops and you get one message about it. / Fejler en betaling for CZ Pro, stopper Pro, og du får én besked om det. |

**Ikke live (bliver stående som foreslået):** 00000216, 00000008, 00000218, 00000220, 00000222, 00000223, 00000019, 00000226, 00000228, N1, N2, N13, N14, N20, #6126, #5876, #3964, #5895, #3970, #2493, #2494, #2495, #2798, #2176, #450, #4825, #5683, #5293, #5062, #5833, #1981, #4032, #2161, #5385, #1108, #1154, #1113, #1110, #2218, #4110, #938, egne akademi-talenter, løn pr. løbsdag (koden er klar, men slået fra i prod).

**Uklart (ejeren afgør):** #4703 akademiryttere i holdudtagelsen (hvert løb bruger nu kun sin egen trup, v7.307) · #4381 akademilisten som Mit hold (U23- og Junior-siderne matcher allerede).

### Løb og træning

**Ud af listerne (live):**

| Punkt | Bevis |
|---|---|
| N19 roller og taktik pr. rytter i endagsløb (#3049) | v7.259; rolle, intention og ordre pr. rytter i endagsløb. Issuet står stadig åbent |
| Grusvejsløb (5.4) | v7.336; S4 har 2 grusetaper (Strade Bianche del Nord, Terre di Toscana) |
| Enkeltstarter i forskellige længder, flade og bakkede (5.4) | S4 har enkeltstarter på 6-40 km (107 etaper) og 3 bakkede; v7.296 |
| Styrt afhænger af teknik (5.4) | v6.97 + v4-motoren: positionering dæmper styrtrisiko |
| Løbsside i faner (#2794) | v7.239 + v7.259 |
| Punch og klatring som to træningspas (5.4) | v7.239 (#4631) |
| Hård brostenstræning (#3705) | v7.276 Cobbled Sectors |
| Se form stige og falde af træning (#3763) | v7.330: rapporten viser form før og efter pr. dato |
| N8 træningsside uden scroll (#5485) | v7.296: overblik øverst og fire faner. Til Done; kun kvalitetsrester tilbage |

Bekræftet som Done-forslag i afsnit 1: cab2228d (mellemtider, hvor og hvorfor), 00000209 (hel uge pr. rytter), 00000212 (% pr. pas), 00000213 (auto-hvile).

**I beta (Beta-fanen):** N5 Train now (`training_train_now`) · N6 træningsgrupper (`training_groups`) · N7 sæsonmatrix på telefon (`season_matrix_mobile`) · 538c4798 færdige programmer (`training_programs`; delingsdelen udgår, veto 37,9 %) · rollevælger med etape-valg (`race_role_scope_choice`).

**Delvist live: titlen skrives om til det, der mangler:**

| Punkt | Live i dag | Ny titel EN / DA |
|---|---|---|
| 00000201 sekundær type | Forklaret generelt i Hjælp | See on a rider's profile what his second type means for him, and why another ability can still reach higher. / Se på rytterens profil, hvad hans anden type betyder for ham, og hvorfor en anden evne stadig kan nå højere. |
| 00000203 peak i etapeløb | Peak pr. løb, op til 2 (v7.39) | Pick which part of a stage race a rider peaks in, with a main goal and a backup goal. / Vælg hvilken del af et etapeløb en rytter topper i, med et hovedmål og et reservemål. |
| 00000013 sæsonplanlægger | Træthed i aften (v7.330) | A season planner that warns you about fatigue two weeks ahead. / En sæsonplanlægger, der advarer dig om træthed to uger frem. (kvalifikation findes ikke i spillet og udgår af titlen) |
| 00000206 kalender | Guldtone ved gemt udtagelse i Planning | The calendar page shows your own status on each race: entered, withdrawn or squad set. / Kalendersiden viser din egen status på hvert løb: tilmeldt, udmeldt eller hold sat. |
| 00000015 personale | Sportsdirektør og chefspejder | Hire a team doctor and more staff roles, with skills that change how your season goes. / Ansæt en holdlæge og flere personaleroller med evner, der ændrer, hvordan din sæson går. |
| N10 kort pr. rytter | "Hvad skete" pr. rytter (v7.332) | After each race, a card per rider with the order you gave him and a verdict on how he carried it out. / Efter hvert løb et kort pr. rytter med den ordre, du gav ham, og en dom over, hvordan han løste den. |
| N18 assistenten | Rækkefølge i målløb | Keep a rider out of the assistant's picks, and let your rider ranking count in every race, not only target races. / Hold en rytter ude af assistentens udtagelse, og lad din rangering af rytterne gælde i alle løb, ikke kun i målløb. |
| #4916 følg etape live | Live-kort i Race Centre + løbsfilm | Watch a stage play out on the race page while it is being ridden, with the field moving along the profile. / Se en etape udspille sig på løbssiden, mens den køres, med feltet der bevæger sig hen over profilen. |
| #4342 træningssiden | Viser dagens løb pr. rytter | See on the training page how many days until each rider's next race. / Se på træningssiden, hvor mange dage der er til hver rytters næste løb. |
| Flueben (5.4) | Gruppedialog med flueben (beta) | Put the riders you tick on your squad list on a fatigue rule or in a training group. / Sæt de ryttere, du sætter flueben ved på truplisten, på en træthedsregel eller i en træningsgruppe. |
| #2009 rytter-pop-up | Pop-up i holdudtagelsen (v7.107) | See a rider's age and abilities in a pop-up while you plan training or use the Planning board. / Se en rytters alder og evner i et pop-up, mens du planlægger træning eller bruger planlægningsbrættet. |
| #3955 profiler i Planning | Terrænglyf pr. løb | See each stage's profile right on the Planning board. / Se hver etapes profil direkte på planlægningsbrættet. |
| #3900 næste sæson | Kalender for næste sæson kan ses | The calendar page shows a route profile for every race and stage, with filters for race type and terrain. / Kalendersiden viser en ruteprofil for hvert løb og hver etape, med filtre for løbstype og terræn. |
| #1900 stillinger | Faner pr. division | See the standings of all four divisions on one page. / Se stillingen for alle fire divisioner på én side. |
| #4611 ryttere taler | Linje efter etapen (v7.233) | Your riders talk to you before a stage, and you answer with one click, for example by giving him a free role. / Dine ryttere taler til dig før en etape, og du svarer med ét klik, for eksempel ved at give ham fri rolle. |
| #939 vejr | Vejr på alle etaper (v7.310) | Crosswinds that split the peloton into echelons. / Sidevind, der splitter feltet i vifter. |
| #1833 evner forklaret | Koder ved hover, korte undertekster | Each ability and power number explained in plain words when you hover over it or tap it. / Hver evne og hvert effekttal forklaret i klart sprog, når du holder musen over det eller trykker på det. |
| #5076 formdyk | Forklaret i Hjælp og på peak-kortet | The form dip after a peak is explained on the rider's form, where you see it drop. / Formdykket efter et peak forklares ved rytterens form, der hvor du ser den falde. |
| #5882 løb på niveau | Løb udvikler ryttere (v7.308) | Racing at your rider's level develops him most, and new experiences like cobbles or a long stage race give extra. / Løb på din rytters niveau udvikler ham mest, og nye erfaringer som brosten eller et langt etapeløb giver ekstra. |
| #2489 sæsonkort | Peak-planlæggeren foreslår opbygning | A season map with training blocks (base, build, peak, recovery) under your races. / Et sæsonkort med træningsblokke (base, opbygning, peak, restitution) under dine løb. |
| #1679 andre hold | Andre holds personale og anlæg (v7.19) | See other teams' training score. / Se andre holds træningsscore. |

"Sortér den daglige rapport efter alder" (5.4) er for lille til roadmappet og går direkte i backloggen.

**Ikke live (bliver stående):** 00000202, 00000204, 00000014, 00000205, 00000207, N11, N12 (motoren kan køre holdtidskørsel, men S4 har ingen), N15, #3471, #3050, #4540 (bevidst fjernet i v7.225, bør udgå), afrikanske/asiatiske lege, #6137, #4122, #2457, #2030, #3982, #5981, #5982, #3444, #2477, 00000208, 00000210, 00000211, 00000214, N3, N4, N9, #5865, #4942, alsidig træning, #2488, #2487.

**Uklart (ejeren afgør):** ca980fca ruter (brosten, slutstigninger og profiler er live; mangler "lang dal før sidste stigning"?) · #4259 ikon for udtaget rytter (Planning viser allerede lås + løbets navn) · #3529 løbslog pr. rytter (sæsonmatricen viser rytter × løbsdag).

**Samlet efter verificering:** 16 punkter ud (live) · 44 omskrevet til det, der mangler · 5 i beta · 5 uklare · resten uændret.

Sidefund (ikke roadmap, bør undersøges for sig): formplanlæggerens peaks sendes muligvis ikke med ind i v4-motoren (`raceEngineV4Bridge.js` sender evner, rolle, indsats og træthed; peak-vinduerne lægges kun på under v3 i `raceRunner.js`). Ikke verificeret til bunds.

Sidefund: Hjælp lover mindst 12 aktive timer på auktioner over frie ryttere, men en spillervalgt sluttid kan omgå det. Det forklarer klagerne over "1 time". Hjælp henviser til en liste over profilryttere, som kun findes på den gamle bestyrelsesside.

### Ejerens afgørelser efter verificeringen (4/10)

- **Alle 15 live-punkter ud af listerne** (de to tabeller ovenfor, inkl. sponsor efter berømmelse og driftsudgift i andre divisioner).
- **Akademiryttere i holdudtagelsen (#4703) udgår:** seniorryttere kører seniorløb, U23 kører U23, junior kører junior.
- **Akademilisten som Mit hold (#4381) udgår:** rytterlisten på akademisiden skal ikke findes fremover, nu hvor U23- og Junior-siderne findes. Forslag til akademisiden ligger i #6155.
- **Ruter (ca980fca) deles:** Done: "Cobbles that count, and mountain stages decided on the final climb." / "Brosten der tæller, og bjergetaper der afgøres på slutstigningen." Nyt planlagt punkt: "Mountain stages with a long valley road before the last climb." / "Bjergetaper med en lang dalvej før sidste stigning." Stemmerne står på begge.
- **Ikon for udtaget rytter (#4259) og løbslog pr. rytter (#3529):** ejeren tog ikke stilling. Begge tages ud som dækket (lås + løbsnavn i Planlægning; sæsonmatricen), medmindre ejeren siger andet.
- **Idéer fra de lukkede kanaler må stå på Vote** uden kilde (grusvejsløb udgår som live).
- **Udviklingstempoet (#5965)** står under "Reported, being checked", ikke som bekræftet fejl.
- **Ca. 30 idéer ad gangen** på Vote; resten i idé-puljen.

## 6c. Indhold ved start (forslag til ejer-godkendelse)

Bygger kun på verificerede punkter (6b). DA-titler og beviser står i de afsnit, der henvises til. Rettelse 4/10: af de 23 tilbageværende gamle idéer har 8 mange stemmer (34-40) og 15 få (9-12); ejeren fik tallene oplyst omvendt (12/8), men valget "mest nyt" er uændret.

### Vote: 30 synlige idéer (20 nye + de 10 gamle med få stemmer og højest vigtighed)

| # | Omr. | Idé (EN) | Kilde | Ref |
|---|---|---|---|---|
| 1 | races | See a rider's age and abilities in a pop-up while you plan training or use the Planning board. | 6+ spillere | #2009 (6b) |
| 2 | races | Iconic races are written by hand, so a classic stays the same classic every season. | 5+ spillere | #4122 + #3471 (6) |
| 3 | races | AI teams field riders that fit their division, so Division 4 is no walkover. | 3+ spillere | #2457 (6) |
| 4 | races | Watch a stage play out on the race page while it is being ridden, with the field moving along the profile. | Spørgeskema | #4916 (6b) |
| 5 | races | After today's last race, Planning jumps to the next race day. | 2 spillere | #2030 (6) |
| 6 | races | The calendar page shows your own status on each race: entered, withdrawn or squad set. | Gammel, 11 stemmer | 00000206 (6b) |
| 7 | training | Each ability and power number explained in plain words when you hover over it or tap it. | 3+ spillere | #1833 (6b) |
| 8 | training | Injuries reset at the season switch, the same way fatigue does. | 2 spillere, lovet "fremadrettet" 28/9 | #5865 (4) |
| 9 | training | See on the training page how many days until each rider's next race. | 2 spillere | #4342 (6b) |
| 10 | training | Your team's injury and crash history: see how many injuries and crashes your riders have had. | 1 spiller, ejeren positiv | #4942 (4) |
| 11 | training | A training camp: pay to focus one ability hard for a while, and lose race days while you do it. | Gammel, 10 stemmer | 00000211 |
| 12 | training | Your own labels on riders, so you can find them on the training page. | Gammel, 10 stemmer | 00000214 |
| 13 | youth | Lower age limits for the youth classification and juniors. | 3 spillere | #6126 (4) |
| 14 | youth | Homegrown riders: follow every rider from your academy, also after he leaves. | Ejerens idé | 5.4 |
| 15 | youth | Prize money in youth races. | Gammel, 10 stemmer; 2 spillere 1/10 | 00000216 |
| 16 | youth | A better scout charges less per report, so two scouts are never the same. | Gammel, 10 stemmer | 00000217 (6b) |
| 17 | market | Filter the rider database by division. | 4+ spillere | #2399 (6b) |
| 18 | market | The potential band stays steady between seasons, with its midpoint shown. | 3+ spillere | #5683 (6) |
| 19 | market | A market value that does not give away a young rider's hidden potential. | Spørgeskema | #2798 (4) |
| 20 | market | Set a minimum price on your own riders, so offers below it are turned down automatically. | 1 spiller, ejer-prioritet | #450 (6) |
| 21 | market | Limits on deals between friends: a floor and a ceiling on what a rider can be traded for. | Gammel, 9 stemmer | 00000219 (6b) |
| 22 | market | More than one wishlist, so you can sort the riders you follow. | Gammel, 9 stemmer | 00000220 |
| 23 | market | See an injury on another team's rider on his profile, and how long he is out. | Gammel, 9 stemmer | 00000221 (6b) |
| 24 | club | A longer break between seasons, with time to plan the new one. | 5 spillere; afstemning lovet 27/9 | #5833 (4) |
| 25 | club | See which riders the board counts as your stars. | 4 spillere | #1928 (6b) |
| 26 | club | Your sponsor's base amount paid race day by race day, like the rest. | 3 spillere | #3147 (6b) |
| 27 | club | A way back for small clubs: cheaper ways to develop when you start late or fall behind. | 2 spillere | #1981 (5.4) |
| 28 | club | Wages paid per race day, like upkeep, instead of in one go. | Ejeren + 1 spiller | 5.4 |
| 29 | club | Medical, academy and commercial facilities that work: faster recovery, more academy places and more sponsor money. | Gammel, 9 stemmer | 00000224 (6b) |
| 30 | club | Sponsors reworked: a main sponsor plus smaller side sponsors with their own goals. | Gammel, 9 stemmer | 00000223 |

**Hviler i idé-puljen (stemmerne bevares og ses i analysen):** de 8 gamle med 34-40 stemmer (00000018 statistik, 00000021 museum, 00000022 venner, 00000011 forhandling, 00000012 rygter, 00000014 nationale mesterskaber, 00000013 sæsonplanlægger, 00000015 personale) · 5 gamle med få stemmer (00000228, 00000227, 00000205, 00000207, 00000218) · alle øvrige nye idéer fra afsnit 4, 5.4 og 6.

Ikke på Vote: længere auktioner på frie ryttere (afgøres i forum-afstemningen #4714) · løbsfilmen samler gentagelser (står under "Reported, being checked").

### Beta: 5 punkter (koblet til kontakten)

| Punkt | Kontakt |
|---|---|
| Train now: run today's training when it suits you, with the same result as the evening run. (N5) | `training_train_now` |
| Training groups: one plan for several riders, and each rider keeps his own copy. (N6) | `training_groups` |
| Ready-made training programs per race day. (538c4798, uden delingsdelen) | `training_programs` |
| The season matrix in Planning fits your phone screen. (N7) | `season_matrix_mobile` |
| Choose whether a role applies from this stage to the end, or to this stage only. (ny) | `race_role_scope_choice` |

### Plan

- **In progress:** N4 vælg rytter først på Program-fanen (#6035) · N9 Udvikling 2.0 (#6110).
- **Planned · Next:** 00000201 sekundær type på rytterens profil (LØFTE) · 00000203 vælg del af etapeløb at toppe i (LØFTE) · 00000208 åbnere (LØFTE) · 00000210 formtræning for færdige ryttere (LØFTE) · 00000008 egne unge stjerner (LØFTE) · N1 besked fra holdsiden (LØFTE) · N2 transferliste til U23 (LØFTE) · N3 kopiér dagsplan (LØFTE) · N15 Holdarbejde og Lederskab for eksisterende ryttere · N16 hurtigere spil · N17 Pro-betaling · delt kaptajn (#5981, lovet 1/10) · potentiale ud af værdimodellen (lovet 25/9).
- **Planned · Later:** 00000019 vejkaptajner og mentorer · 00000226 dashboard og indbakke · 00000202 kør for en trøje (S5) · 00000204 holdmødet (S5) · 00000215 op- og nedrykning for ungdom (S5) · N10 kort pr. rytter (S5) · N11 betingede ordrer (S5) · N12 holdtidskørsel (S5) · N13 + N14 omdømme (S5) · N18 hold rytter ude af assistenten · N20 sælg til AI · 00000222 klubbens udseende · lang dalvej før sidste stigning (rest af ca980fca) · eget ikon for kuperede etaper (#6125, lovet 22/9) · auto-accept-pris (#2176) · log ind med Discord (#2161).

Rækkefølgen inden for Next og Later lægges i planlægningssessionen (#6148).

## 7. Åbne spørgsmål til ejeren

1. **Rytterværdier (00000017):** titlen lover "prices shaped by real auctions and transfers". Modellen bruger handler, men patch note 7.303 nævner det ikke. Done med nuværende titel, eller omskriv først?
2. **Delvist leveret (cab2228d, 00000209, 00000212):** live for alle, men dækker kun en del af titlen. Done eller i gang?
3. **Next/Later:** skal S5-løfterne stå som Later, og roadbookens "under S4"-punkter som Next? Afgøres bedst i planlægningssessionen (#6148).
4. **Veto-konflikter i nuværende titler:** deling af programmer (37,9 %), "act from inbox" (30 %), rivalers evner som interval (20,6 %). Skær delen væk, eller behold?
5. **Marked du kan stole på (00000219):** den åbne log er live. Skær titlen ned til grænser for handler mellem venner?
6. **Åbnere og formtræning (00000208 + 00000210):** begge peger på #5238. Slå sammen?
7. **Tre Done-rækker uden dato:** akademier (forslag 13/6), "race engine built for stories" (kandidat 4/6), livligere referater (kandidat 5/8).
8. **Dobbeltbooking (#5860):** MASTERPLAN siger "stadig", v7.336 og verifikationen 3/10 siger rettet. Fixed eller Fix in progress?
9. **Holdarbejde og Lederskab (N15):** ordlyden afhænger af A/B-valget på #5268.
10. **Pro-betaling (N17):** hører det hjemme på roadmappet?

## Sidefund (ikke indhold)

- `FEATURE_REGISTRY.yml` står på `rider-valuation-v5 dormant` og `race-engine-v4 dormant`, mens prod har v6 og v4 on.
- MASTERPLANs flip-liste nævner stadig auto-hvile, prognose og felterne, som har været live for alle siden 1/10 (v7.330).
