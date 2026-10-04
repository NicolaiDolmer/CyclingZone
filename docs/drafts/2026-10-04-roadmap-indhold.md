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

## 6. Backlog-gennemgang (spillerønsker i GitHub-issues)

Tilføjes, når gennemgangen er færdig.

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
