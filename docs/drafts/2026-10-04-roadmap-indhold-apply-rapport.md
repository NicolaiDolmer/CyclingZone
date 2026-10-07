# Roadmap-hub: apply-rapport for startindholdet (4/10)

SQL: `database/manual/2026-10-04-roadmap-hub-indhold.sql` (manual-only, intet er kørt). Kilde: `docs/drafts/2026-10-04-roadmap-indhold.md`, afsnit 8 vinder. Prod aflæst read-only 4/10 (én SELECT): 60 rækker, alle id'er fra udkastet findes.

## 1. Tal

**roadmap_items: 45 eksisterende ændres, 48 nye oprettes (60 → 108).**

| Kategori | Ændrede | Nye |
|---|---|---|
| Done (shipped) | 10 (9 fra liste 5 + rute-delen af ca980fca) | 5 (afsnit 2 nederst) |
| Planned · Next | 5 | 7 synlige + N15 skjult |
| Planned · Later | 6 | 11 (inkl. dalvej-resten med kopierede stemmer) |
| In progress | 0 | 2 (N4, N9) |
| Beta (in_progress + flag_key) | 1 (538c4798) | 4 |
| Vote (active, synlig) | 10 (sortering, 6 nye titler) | 18 |
| Idé-puljen (active, approved=false) | 13 | 0 |

**Forventet slutfordeling:** active 41 (28 synlige på Vote, 13 i puljen) · planned 30 (29 synlige: Next 12, Later 17; N15 skjult) · in_progress 7 (Plan: N4, N9; Beta: 5) · shipped 27 · archived 3 (00000006, 60efa858, 8f52bf54). I alt 108.

**roadmap_votes:** 1.121 + kopien af ca980fca's stemmer (udkastet siger 21, altså 1.142). Ingen andre stemmer røres.

**known_issues: 53 nye** (fixing 7 · confirmed 6 · checking 26 · fixed 14), alle `published=true`. **known_issue_updates: 34** (de rækker, der har en opdatering i afsnit 3). De 17 fra 5.3, #6168 og den rettede del af #5951 får ingen.

## 2. Spillervendte titler

"Kilde" siger, hvor teksten kommer fra. **GO** = ny tekst fra mig, kræver ejer-go.

### Ændrede eksisterende punkter (før → efter)

| Punkt | Før (EN / DA) | Efter (EN / DA) | Kilde |
|---|---|---|---|
| 00000016 Done | U19 and U23 squads with real promotion paths from academy to the top. / U19- og U23-hold med ægte oprykningsveje fra akademi til toppen. | U23 and junior squads with real promotion paths from academy to the top. / U23- og juniorhold med ægte oprykningsveje fra akademi til toppen. | **GO** (kun U19 → junior) |
| 00000017 Done | Rider values that follow the market: prices shaped by real auctions and transfers. / Rytterværdier der følger markedet: priser formet af rigtige auktioner og transfers. | Rider values that follow the market. / Rytterværdier der følger markedet. | Afsnit 8 |
| cab2228d Done | Why a stage went the way it did: what climbing, sprint and form did today, in plain words and without the exact numbers. / Hvorfor etapen gik, som den gik: ... | Split times, and where and why your riders lost time. / Mellemtider, og hvor og hvorfor dine ryttere tabte tid. | Patch-titel v7.332, ordret |
| 00000209 Done | Plan a whole week per rider in one go: a session for every race day, for one rider or the whole squad. / Planlæg en hel uge pr. rytter på én gang: ... | A plan for each race day: hard, normal, recovery or rest, for the whole squad or one rider. / En plan for hver løbsdag: hård, normal, restitution eller hvile, for hele truppen eller én rytter. | **GO** (bygget på v7.330) |
| 00000212 Done | See how many percent a session moved an ability, not just the progress bar. / Se hvor mange procent et pas flyttede en evne, ikke kun fremdriftsbjælken. | See how far a session moved each ability, on the rider's profile and in the training report. / Se hvor langt et pas flyttede hver evne, på rytterprofilen og i træningsrapporten. | **GO** (bygget på v7.305 + v7.331) |
| ca980fca Done | Routes that look like real racing: cobbles, a real summit finish, a long valley before the last climb. ... / Ruter der ligner rigtig cykling: ... | Cobbles that count, and mountain stages decided on the final climb. / Brosten der tæller, og bjergetaper der afgøres på slutstigningen. | 6b, ejer |
| 00000201 Next | Secondary rider type explained: see what a rider's second type means and where it helps him. / Sekundær ryttertype forklaret: ... | See on a rider's profile what his second type means for him, and why another ability can still reach higher. / Se på rytterens profil, hvad hans anden type betyder for ham, og hvorfor en anden evne stadig kan nå højere. | 6b |
| 00000203 Next | Pick where in a stage race a rider peaks, with a main goal and a backup goal. / Vælg hvor i et etapeløb en rytter topper, ... | Pick which part of a stage race a rider peaks in, with a main goal and a backup goal. / Vælg hvilken del af et etapeløb en rytter topper i, med et hovedmål og et reservemål. | 6b |
| 00000215 Later | Youth seasons that count: promotion, relegation and rankings for U23 and junior from season 5. / Ungdomssæsoner der tæller: ... | Promotion and relegation for U23 and junior groups, from season 5. / Op- og nedrykning for U23- og juniorpuljer fra sæson 5. | 6b |
| 538c4798 Beta | Ready-made training programs, and later a place to share your own. / Færdige træningsprogrammer, og senere et sted at dele dine egne. | Ready-made training programs per race day. / Færdige træningsprogrammer pr. løbsdag. | EN 6c · DA **GO** |
| 00000206 Vote | Your calendar colour-coded by your own status: entered, withdrawn, squad set. / Din kalender farvet efter din egen status: ... | The calendar page shows your own status on each race: entered, withdrawn or squad set. / Kalendersiden viser din egen status på hvert løb: tilmeldt, udmeldt eller hold sat. | 6b |
| 00000216 Vote | Prize money in youth races: a smaller pot than the senior races, ... / Præmiepenge i ungdomsløb: en mindre pulje end seniorløbene, ... | Prize money in youth races. / Præmiepenge i ungdomsløb. | EN 6c · DA = starten af den gamle titel |
| 00000217 Vote | Scouts that differ: a better scout finds more, sees more of a rider, and charges less per report. / Spejdere der er forskellige: ... | A better scout charges less per report, so two scouts are never the same. / En bedre spejder tager mindre pr. rapport, så to spejdere aldrig er ens. | 6b |
| 00000219 Vote | A transfer market you can trust: limits on deals between friends, and every trade in an open log. / Et transfermarked du kan stole på: ... | Limits on deals between friends: a floor and a ceiling on what a rider can be traded for. / Grænser for handler mellem venner: et gulv og et loft for, hvad en rytter kan handles for. | 6b |
| 00000221 Vote | See an injury on another team's rider, and how long he is out. / Se en skade på et andet holds rytter, og hvor længe han er ude. | See an injury on another team's rider on his profile, and how long he is out. / Se en skade på en rytter fra et andet hold på hans profil, og hvor længe han er ude. | 6b/6c (ikke i opgavens liste, men 6c-ordlyden afviger fra prod) |
| 00000224 Vote | More facilities: more of your club to build than training and scouting. / Flere faciliteter: ... | Medical, academy and commercial facilities that work: faster recovery, more academy places and more sponsor money. / Medicinsk afdeling, akademi og kommerciel afdeling, der virker: hurtigere restitution, flere akademipladser og flere sponsorpenge. | 6b |

Uændrede titler: 00000004, 00000225, cf4ee514, 00000213 (Done) · 00000208, 00000210, 00000008 (Next) · 00000019, 00000226, 00000202, 00000204, 00000222 (Later) · 00000211, 00000214, 00000220, 00000223 (Vote, matcher 6c) · de 13 i puljen.

### Nye roadmap-punkter

| NN | Fane | EN / DA | Kilde |
|---|---|---|---|
| 01 | Next | Send a message to another manager straight from his team page. / Send en besked til en anden manager direkte fra hans holdside. | N1 |
| 02 | Next | Move a rider from the transfer list to your U23 squad. / Flyt en rytter fra transferlisten til dit U23-hold. | N2 |
| 03 | Next | Copy one day's training plan to the next days. / Kopiér én dags træningsplan til de næste dage. | N3 |
| 21 | Next | Injuries reset at the season switch, the same way fatigue does. / Skader nulstilles ved sæsonskiftet, ligesom trætheden. | Afsnit 4 (#5865) |
| 22 | Next | A shared captain: a second rider with his own GC chance, without a free role's breakaway or a helper's sacrifice. / Delt kaptajn: en anden rytter med egen klassementschance, uden en fri rolles udbrud eller en hjælpers ofring. | Afsnit 6 (#5981) |
| 23 | Next | Rider values without potential: the training score takes its place in a rider's value. / Rytterværdier uden potentiale: træningsscoren tager dens plads i rytterens værdi. | **GO** (EN + DA; udkastet har kun 5.2-noten) |
| 16 | Next | A faster game: pages that open quickly, also on your phone. / Et hurtigere spil: sider der åbner hurtigt, også på din telefon. | N16 |
| 15 | Next (skjult) | Teamwork and Leadership values for the riders already in the game, not only new ones. / Holdarbejde og Lederskab for de ryttere, der allerede er i spillet, ikke kun nye. | N15, approved=false |
| 10 | Later | After each race, a card per rider with the order you gave him and a verdict on how he carried it out. / Efter hvert løb et kort pr. rytter med den ordre, du gav ham, og en dom over, hvordan han løste den. | N10 (6b) |
| 11 | Later | Conditional orders: tell a rider what to do if something happens, for example chase only if other teams help. / Betingede ordrer: ... | N11 |
| 12 | Later | Team time trials: your riders ride together against the clock and get the team's time. / Holdtidskørsel: ... | N12 |
| 13 | Later | Reputation for clubs and nations, like riders have now, built from results. / Omdømme for klubber og nationer, ... | N13 |
| 14 | Later | Reputation for races and staff: a race's prestige can change, and staff earn a name too. / Omdømme for løb og personale: ... | N14 |
| 18 | Later | Keep a rider out of the assistant's picks, and let your rider ranking count in every race, not only target races. / Hold en rytter ude af assistentens udtagelse, og lad din rangering af rytterne gælde i alle løb, ikke kun i målløb. | N18 (6b) |
| 20 | Later | Sell a rider to the AI when nobody bids on him after several auctions, for less than his value. / Sælg en rytter til AI'en, ... | N20 |
| 27 | Later | Mountain stages with a long valley road before the last climb. / Bjergetaper med en lang dalvej før sidste stigning. | 6b, ejer (stemmer kopieret) |
| 24 | Later | Its own icon for hilly stages in the calendar. / Eget ikon for kuperede etaper i kalenderen. | EN **GO** · DA 5.2 |
| 25 | Later | Set an auto-accept price on a listed rider: when someone hits it, a short public auction starts at once. / Sæt en auto-accept-pris på en listet rytter: ... | Afsnit 6 (#2176) |
| 26 | Later | Log in with Discord in one click. / Log ind med Discord med ét klik. | Afsnit 6 (#2161) |
| 04 | In progress (Coming to beta) | On the Program tab, pick the rider first and then his program. / På Program-fanen vælger du rytteren først og derefter hans program. | N4 |
| 09 | In progress | Development 2.0: one clear development curve, racing that pays off by role, and a decline in older riders you can slow down. / Udvikling 2.0: ... | N9 |
| 05 | Beta | Train now: run today's training when it suits you, with the same result as the evening run. / Træn nu: ... | N5 |
| 06 | Beta | Training groups: one plan for several riders, and each rider keeps his own copy. / Træningsgrupper: ... | N6 |
| 07 | Beta | The season matrix in Planning fits your phone screen. / Sæsonmatricen i Planlægning passer til din telefonskærm. | N7 |
| 28 | Beta | Choose whether a role applies from this stage to the end, or to this stage only. / Vælg, om en rolle gælder fra denne etape og løbet ud, eller kun for denne etape. | EN 6c · DA **GO** |
| 31-48 | Vote | De 18 nye idéer i 6c (nr. 1-5, 7, 9, 10, 13, 14, 17-19, 24-28) med 6c's EN og DA fra afsnit 4/5.4/6/6b, ordret. | 6c |
| 44 | Vote | A longer break between seasons, with time to plan the new one. / En længere pause mellem sæsonerne, med tid til at planlægge den nye. | EN 6c · DA **GO** (afsnit 4 har en anden ordlyd) |
| 51-55 | Done | De 5 nye Done-rækker fra afsnit 2, ordret. | Afsnit 2 |

### Kendte fejl

Alle 51 titler og 34 opdateringer er ordret fra afsnit 3 og 5.3, plus to:
- #6168 (Fixed): The site stopped on a blank page when the browser blocked site data. / Siden stoppede på en tom side, når browseren blokerede site-data. (opgavens tekst)
- #5951 rettet del (Fixed): The chasing group pushed caught breakaway riders backwards. / Jagtgruppen skubbede indhentede udbrydere baglæns. **GO**

#5951's checking-række bruger afsnit 3's titel og opdatering (den nævner både rettelsen og de nye meldinger).

## 3. Tvivl og valg

1. **N8 (træningsside uden scroll) oprettes ikke.** 6b siger "til Done", men ejeren tog alle live-punkter ud af listerne, og liste 5 tæller kun 5 nye Done-rækker.
2. **Later har 17 punkter, ikke 16.** N13 og N14 er to rækker (to issues, to titler i afsnit 2). Skal de være ét punkt, skal én af dem slås sammen.
3. **ca980fca shipped_at = 4/10** (brosten v7.336 4/10; bjergetaper v7.332 2/10). Dalvej-resten har `issue_ref` 2768 (rute-epic'en).
4. **00000209:** udkastet nævner "35 felter", men patch note v7.330 siger "each of the day's race days". Titlen følger patch noten.
5. **issue_ref:** sat fra afsnit 1/2/6 på alle punkter, der røres (første nummer). Ikke sat: potentiale-punktet (intet issue; 5.2 siger "del af #5443", men det er værdi-epic'en), 00000216 (#4620 er ungdomsepic'en, ikke idéen), egne talenter og løn pr. løbsdag (intet issue). Delte numre: 00000208 og 00000210 begge #5238; N9 og fejlen "scouted projection" begge #6110; 00000202 #5573, 00000204 #5575. `roadmap-flip.mjs` er dry-run først, så delte numre giver kun et ekstra punkt i forslaget.
6. **#6125** bruges i udkastet om tre ting (ikon for kuperede etaper, nykøbt rytter, sprinttog). Ikon-punktet har fået 6125 som 5.2 angiver; tjek issuet.
7. **Vote-sortering:** alle 28 idéer får `sort_order` = 10 × nr. i 6c, også de 10 gamle.
8. **Next 10-120, N15 130, Later 140-300**; In progress/Beta 10-70; nye Done 800 (som de eksisterende).
9. **Tidspunkter:** shipped_at, beta_since og closed_at kl. 12:00 UTC. Rettelsesdatoer fra patch notes: #5914 29/9 (v7.320), #5912 29/9 (v7.319), #5952 30/9 (v7.322), #5953 og #5951 1/10 (v7.327), #5956, #5947, #5944 1/10 (v7.330), #5955 og #5957 2/10 (v7.331), #6061 3/10 (v7.334), #6095 og #5860 4/10 (v7.335/7.336), #6168 4/10 (v7.339).
10. **created_at på kendte fejl:** udkastet har ingen åbningsdatoer. Åbne fejl: NOW(). Rettede: = closed_at, så "dage åben" bliver 0 i stedet for negativ.
11. **engine:** "See each rider's reputation" = club; sæsonmatricen = races (som afsnit 2). `engine` kan ikke være `other`.
12. **Idé-puljen:** de 13 skjulte beholder deres gamle titler, også dem 6b vil omskrive (00000011, 012, 013, 015, 018, 021, 022, 227). Omskrivningen giver først mening, når de kommer tilbage på Vote.
13. **Beta:** hvis en kontakt står `on` ved apply, flytter triggeren punktet til Done med NOW(). Post-verify 1 og 4 fanger det.

## 4. Kunne ikke afgøres fra udkastet

- **Kendte fejl uden issue:** udkastet siger fem, men otte mangler et nummer (også tidshuller på kuperede afslutninger, to point i én evne på én dag, træning kan ikke ændres på telefon). `issue_ref` skal sættes, når issues oprettes.
- **Idéer, der venter i puljen (ikke oprettet):** ca. 47 efter min optælling (afsnit 6: ca. 41, afsnit 4: 3, 5.4: 3), efter at live, udgåede, Vote- og Plan-punkter er trukket fra. Udkastet har ikke et tal.
- **Om alle fem beta-kontakter stadig står `beta`** ved apply (aflæst 4/10, ikke tjekket af mig).
- **Om 00000016's "real promotion paths"** er live for alle; titlen er kun ændret på U19.

Syntaks er tjekket uden database: 45 statements, alle anførselstegn i par, antal værdier pr. række passer med kolonnerne, ingen dublet-id'er, ingen em-dash.
