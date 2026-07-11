# Narrative content-batch (EN + DA)

> 2026-07-11. Klar-til-brug copy og skabeloner til [narrativ-systems-designet](../specs/2026-07-11-narrative-systems-design.md).
> Hver blok angiver mål-fil. Alt er skabeloner der KUN interpolerer persisterede/afledte data.

## Regler (gælder hele batchen)

- **EN først, DA under.** EN er primærsproget; DA må aldrig indeholde information EN ikke har.
- **Ingen em-dashes.** Separator er "·", komma eller punktum.
- **Ingen opdigtede fakta.** Skabeloner beskriver kun hvad simulationen persisterede. Ingen
  vejr, ingen publikum, ingen "kilometer igen", ingen citater fra ryttere.
- **Ingen udråbstegn, ingen hype-ord** (amazing, epic, incredible). Tonen er nøgtern og
  konkret, som eksisterende `races.json`/`landing.json`: korte deklarative sætninger.
- **ICU-plural/-ordinal** hvor tal indgår. `{rankText}` er præ-formateret ordinal
  ("2nd" / "nr. 2") leveret af rendering-laget, så DA og EN ordinal-logik ikke dubleres i copy.
- **Variant-valg er deterministisk:** `hash(race_id, stage_number, momentKey) % antalVarianter`.
  Varianter pr. nøgle hedder `v1`, `v2`, ... og skal være indbyrdes udskiftelige (samme params).
- **Tier 2-fænomener (styrt, mekanisk, angreb) har INGEN copy i denne batch** og må ikke
  tilføjes før motoren modellerer dem.

---

## A. Race-rapport v2 (`races.json` → `detail.report.*`)

### A1. Titler og rammer

| key | EN | DA |
|---|---|---|
| `title.stage` | Stage {number} report | Rapport fra {number}. etape |
| `title.race` | Race report | Løbsrapport |
| `numbers.margin` | Winning margin | Sejrsmargin |
| `numbers.field` | Riders at the start | Ryttere til start |
| `numbers.breakaway` | In the breakaway | I udbruddet |
| `numbers.gcLead` | Overall lead | Samlet føring |

### A2. Rubrikker (headline pr. dominerende moment)

**`headline.sprint_win`**
- v1 EN: `{rider} takes the sprint`
  - DA: `{rider} tager spurten`
- v2 EN: `{rider} is fastest in the bunch sprint`
  - DA: `{rider} er hurtigst i massespurten`
- v3 EN: `The sprint goes to {rider}`
  - DA: `Spurten går til {rider}`

**`headline.reduced_sprint_win`**
- v1 EN: `{rider} wins from a reduced group`
  - DA: `{rider} vinder fra en reduceret gruppe`
- v2 EN: `{rider} takes the sprint of the front group`
  - DA: `{rider} tager frontgruppens spurt`

**`headline.solo_win`**
- v1 EN: `{rider} rides away from the field`
  - DA: `{rider} kører fra feltet`
- v2 EN: `Nobody could follow {rider}`
  - DA: `Ingen kunne følge {rider}`
- v3 EN: `A solo win by {marginText} for {rider}`
  - DA: `Solosejr med {marginText} til {rider}`

**`headline.close_win`**
- v1 EN: `{rider} wins by {marginText}`
  - DA: `{rider} vinder med {marginText}`
- v2 EN: `{rider} holds on to win`
  - DA: `{rider} holder hjem og vinder`

**`headline.breakaway_survived`**
- v1 EN: `The breakaway makes it: {rider} wins`
  - DA: `Udbruddet holder hjem: {rider} vinder`
- v2 EN: `{rider} wins from the breakaway`
  - DA: `{rider} vinder fra udbruddet`

**`headline.gc_takeover`** (bruges når føringsskiftet vægter højere end etapesejren)
- v1 EN: `{rider} takes the race lead`
  - DA: `{rider} overtager føringen i løbet`
- v2 EN: `New race leader: {rider}`
  - DA: `Ny løbsfører: {rider}`

**`headline.final_gc`** (sidste etape / endagsløb med klassement)
- v1 EN: `{rider} wins {race}`
  - DA: `{rider} vinder {race}`
- v2 EN: `The overall win in {race} goes to {rider}`
  - DA: `Den samlede sejr i {race} går til {rider}`

**`headline.youth_first_win`**
- v1 EN: `A first career win for {rider}, {age}`
  - DA: `Karrierens første sejr til {rider}, {age} år`
- v2 EN: `Breakthrough: {rider} wins for the first time`
  - DA: `Gennembrud: {rider} vinder for første gang`

**`headline.first_win`**
- v1 EN: `At last: a first win for {rider}`
  - DA: `Endelig: første sejr til {rider}`
- v2 EN: `{rider} opens his account`
  - DA: `{rider} åbner sejrskontoen`

### A3. Leder (1-2 sætninger, valgt af finale_type)

**`lede.bunch_sprint`**
- v1 EN: `The stage came down to a bunch sprint, and {rider} timed it best for {team}.`
  - DA: `Etapen endte i massespurt, og {rider} timede den bedst for {team}.`
- v2 EN: `A full field arrived together. In the sprint, {rider} was the fastest man for {team}.`
  - DA: `Et samlet felt kom til mål. I spurten var {rider} den hurtigste for {team}.`

**`lede.reduced_sprint`**
- v1 EN: `A hard finale split the field, and {rider} won the sprint from the front group for {team}.`
  - DA: `En hård finale splittede feltet, og {rider} vandt frontgruppens spurt for {team}.`

**`lede.solo`**
- v1 EN: `{rider} left the field behind and crossed the line alone, {marginText} clear.`
  - DA: `{rider} efterlod feltet og kom alene over stregen, {marginText} foran.`
- v2 EN: `The gap only grew. {rider} took the win for {team} with {marginText} to spare.`
  - DA: `Hullet voksede kun. {rider} tog sejren for {team} med {marginText} til nærmeste forfølger.`

**`lede.breakaway`**
- v1 EN: `The break was never brought back. {rider} finished it off for {team}.`
  - DA: `Udbruddet blev aldrig hentet. {rider} gjorde arbejdet færdigt for {team}.`

**`lede.generic`** (fallback når finale_type mangler)
- v1 EN: `{rider} won for {team}.`
  - DA: `{rider} vandt for {team}.`

### A4. Beats (kronologisk fase-orden: udbrud → selektion → finale → konsekvens)

**`beat.breakaway_formed`**
- v1 EN: `{count, plural, one {A single rider went clear early.} other {A group of # riders went clear early.}}`
  - DA: `{count, plural, one {En enkelt rytter kørte tidligt i udbrud.} other {En gruppe på # ryttere kørte tidligt i udbrud.}}`

**`beat.breakaway_caught`**
- v1 EN: `{count, plural, one {The lone escapee was brought back before the finish.} other {The break of # was brought back before the finish.}}`
  - DA: `{count, plural, one {Den udbrudte rytter blev hentet før mål.} other {Udbruddet på # blev hentet før mål.}}`
- v2 EN: `{count, plural, one {The field closed down the lone leader in time.} other {The field closed down the # leaders in time.}}`
  - DA: `{count, plural, one {Feltet lukkede hullet til den udbrudte i tide.} other {Feltet lukkede hullet til de # udbrudte i tide.}}`

**`beat.breakaway_survived`**
- v1 EN: `{count, plural, one {The lone leader was never caught.} other {The # escapees held the field off all the way to the line.}}`
  - DA: `{count, plural, one {Den udbrudte rytter blev aldrig hentet.} other {De # udbrudte holdt feltet bag sig helt til stregen.}}`

**`beat.helper_shift`** (Tier 1: kaptajn top-5 + hjælpere langt tilbage + højt team-bidrag)
- v1 EN: `{team} committed everything to {captain}. {helpers} did the work and rolled in later.`
  - DA: `{team} satsede alt på {captain}. {helpers} lavede arbejdet og trillede i mål senere.`
- v2 EN: `{helpers} gave up their own chances for {captain} today.`
  - DA: `{helpers} ofrede egne chancer for {captain} i dag.`

**`beat.form_peak`** (Tier 1: vinder-form ≥ tærskel i entrant-snapshot)
- v1 EN: `{rider} came in with top form, and it showed.`
  - DA: `{rider} stillede til start i topform, og det kunne ses.`
- v2 EN: `Form made the difference for {rider} today.`
  - DA: `Formen gjorde forskellen for {rider} i dag.`

**`beat.favorite_off_day`** (Tier 1: højeste terræn-score, slutter uden for top 15)
- v1 EN: `On paper the strongest rider in this field, {rider} finished {rankText}.`
  - DA: `På papiret feltets stærkeste, men {rider} sluttede som {rankText}.`

**`beat.terrain_selection`** (Tier 1: bjergetape, top 5 = klatrer/GC-typer)
- v1 EN: `The climb did the selecting. The top five were all climbers.`
  - DA: `Bjerget lavede udskilningen. Top 5 var alle klatrere.`

**`beat.fatigue_toll`** (Tier 1: flere ryttere med tung fatigue-komponent slutter bagest)
- v1 EN: `{count, plural, one {For # rider, a heavy race programme caught up today.} other {For # riders, a heavy race programme caught up today.}}`
  - DA: `{count, plural, one {For # rytter indhentede et hårdt løbsprogram dagen i dag.} other {For # ryttere indhentede et hårdt løbsprogram dagen i dag.}}`

**`beat.gc_takeover`**
- v1 EN: `{rider} takes the overall lead from {previousLeader}.`
  - DA: `{rider} overtager den samlede føring fra {previousLeader}.`
- v2 EN: `The overall lead changes hands. {rider} now leads by {gapText}.`
  - DA: `Den samlede føring skifter hænder. {rider} fører nu med {gapText}.`

**`beat.gc_hold`** (fører forsvarer på bjergetape)
- v1 EN: `{rider} defended the lead on a hard day and still leads by {gapText}.`
  - DA: `{rider} forsvarede føringen på en hård dag og fører stadig med {gapText}.`

**`beat.jersey_change`**
- v1 EN: `{rider} takes over the lead in the {classification}.`
  - DA: `{rider} overtager føringen i {classification}.`

**`beat.rival_clash`** (kun når aktiv rivalisering + begge i top 5)
- v1 EN: `Another chapter in {riderA} against {riderB}. Both finished in the top five.`
  - DA: `Endnu et kapitel i {riderA} mod {riderB}. Begge sluttede i top 5.`
- v2 EN: `{riderA} got the better of {riderB} this time.`
  - DA: `{riderA} trak det længste strå mod {riderB} denne gang.`

**`beat.team_day`** (supplerer eksisterende `recap.teamDay`/`recap.teamWon`)
- v1 EN: `It was a day for {team}: {count} riders in the top 10.`
  - DA: `Det var en dag for {team}: {count} ryttere i top 10.`

**`beat.final_gc`**
- v1 EN: `{rider} wins the general classification, {gapText} ahead of {second}.`
  - DA: `{rider} vinder den samlede stilling, {gapText} foran {second}.`

### A5. Dit hold (klient-side personalisering)

| key | EN | DA |
|---|---|---|
| `yourTeam.title` | Your team | Dit hold |
| `yourTeam.win` | The winner rides for you. | Vinderen kører for dig. |
| `yourTeam.bestResult` | Best placed: {rider}, {rankText}. | Bedst placeret: {rider} som {rankText}. |
| `yourTeam.inBreak` | {rider} spent the day in the breakaway. | {rider} brugte dagen i udbruddet. |
| `yourTeam.helperWork` | {helpers} rode in service of {captain}. | {helpers} kørte i tjeneste for {captain}. |
| `yourTeam.gcUp` | {rider} moved up to {rankText} overall. | {rider} rykkede op som {rankText} samlet. |
| `yourTeam.gcDown` | {rider} dropped to {rankText} overall. | {rider} faldt til {rankText} samlet. |
| `yourTeam.none` | No riders from your team started this race. | Ingen af dine ryttere stillede til start i dette løb. |

---

## B. Rytterpersonligheder og karrieremål

### B1. Trait-etiketter (`rider.json` → `traits.*`)

**Ambition** (`traits.ambition.1..5`, etiket + one-liner)

| niveau | EN | DA |
|---|---|---|
| 1 | Content · Happy where he is. Results are a bonus. | Tilfreds · Glad hvor han er. Resultater er en bonus. |
| 2 | Steady · Does the job without chasing headlines. | Stabil · Passer sit arbejde uden at jage overskrifter. |
| 3 | Motivated · Wants results and works for them. | Motiveret · Vil have resultater og arbejder for dem. |
| 4 | Driven · Sets high targets and expects a role to match. | Målrettet · Sætter høje mål og forventer en rolle der matcher. |
| 5 | Relentless · Nothing less than winning counts. | Kompromisløs · Kun sejre tæller. |

**Loyalty** (`traits.loyalty.1..5`)

| niveau | EN | DA |
|---|---|---|
| 1 | Restless · Always listening for the next offer. | Rastløs · Lytter altid efter det næste tilbud. |
| 2 | Open · Loyal today, but open to a move. | Åben · Loyal i dag, men åben for et skifte. |
| 3 | Settled · Comfortable where he is. | Afklaret · Tilpas hvor han er. |
| 4 | Committed · Sees himself in the club's plans. | Engageret · Ser sig selv i klubbens planer. |
| 5 | Club man · Would rather retire here than ride anywhere else. | Klubmand · Vil hellere slutte karrieren her end køre andre steder. |

### B2. Karrieremål-katalog (`rider.json` → `goals.catalog.*`, 18 mål)

Alle mål er objektivt detekterbare i persisterede data (palmarès, race_entries, profiler).
Format: nøgle · EN titel · EN beskrivelse · DA titel · DA beskrivelse.

1. `first_win` · A first win · Take the first win of his career. · Den første sejr · Tag karrierens første sejr.
2. `win_mountains` · Win in the mountains · Win a mountain stage or a hilly one-day race. · Vind i bjergene · Vind en bjergetape eller et kuperet endagsløb.
3. `win_sprint` · Win a bunch sprint · Take a win in a bunch sprint finish. · Vind en massespurt · Tag en sejr i en massespurtsfinale.
4. `win_tt` · Win against the clock · Win a time trial. · Vind mod uret · Vind en enkeltstart.
5. `win_cobbles` · Win on the cobbles · Win a cobbled race. · Vind på brostenene · Vind et brostensløb.
6. `gc_top10` · A top 10 overall · Finish top 10 in the general classification of a stage race. · Top 10 samlet · Slut i top 10 i den samlede stilling i et etapeløb.
7. `gc_podium` · An overall podium · Finish on the podium of a stage race. · På podiet samlet · Slut på podiet i et etapeløb.
8. `gc_win` · Win a stage race · Win the general classification of a stage race. · Vind et etapeløb · Vind den samlede stilling i et etapeløb.
9. `jersey_points` · The points classification · Win a points classification. · Pointkonkurrencen · Vind en pointkonkurrence.
10. `jersey_mountain` · The mountains classification · Win a mountains classification. · Bjergkonkurrencen · Vind en bjergkonkurrence.
11. `jersey_young` · The youth classification · Win a young rider classification before turning 25. · Ungdomskonkurrencen · Vind en ungdomskonkurrence inden han fylder 25.
12. `captaincy` · A captain's role · Start {count} races as team captain. · En kaptajnrolle · Start {count} løb som holdkaptajn.
13. `race_days` · A full season · Complete {count} race days this season. · En hel sæson · Gennemfør {count} løbsdage i denne sæson.
14. `breakaway_finish` · A day in the break · Reach the finish as part of a breakaway that stays away. · En dag i udbrud · Nå målstregen som del af et udbrud der holder hjem.
15. `beat_rival` · Settle the score · Finish ahead of {rival} in a race they both start. · Gør regnskabet op · Slut foran {rival} i et løb hvor begge stiller til start.
16. `club_servant` · A club man · Reach {count} race days for the same club. · En klubmand · Nå {count} løbsdage for den samme klub.
17. `career_wins_10` · Ten career wins · Reach 10 wins across his career. · Ti karrieresejre · Nå 10 sejre i karrieren.
18. `career_wins_25` · Twenty-five career wins · Reach 25 wins across his career. · 25 karrieresejre · Nå 25 sejre i karrieren.

### B3. Mål-UI (`rider.json` → `goals.*`)

| key | EN | DA |
|---|---|---|
| `goals.label` | Career goal | Karrieremål |
| `goals.achieved` | Achieved in season {season} | Nået i sæson {season} |
| `goals.expired` | Not reached, season {season} | Ikke nået, sæson {season} |
| `goals.lineupHint` | Goal: {goal} | Mål: {goal} |
| `goals.none` | No active career goal | Intet aktivt karrieremål |

### B4. Rivaliserings-copy (`headtohead.json` + `rider.json` → `rivalry.*`)

| key | EN | DA |
|---|---|---|
| `rivalry.label` | Rivalry | Rivalisering |
| `rivalry.level.1` | Simmering | Ulmende |
| `rivalry.level.2` | Open | Åben |
| `rivalry.level.3` | Heated | Ophedet |
| `rivalry.originFinishes` | Built on {count} close finishes this season. | Bygget på {count} tætte opgør i denne sæson. |
| `rivalry.originClassifications` | They keep meeting at the top of the same classifications. | De bliver ved med at mødes i toppen af de samme klassementer. |
| `rivalry.originAuctions` | Two managers who keep bidding on the same riders. | To managere der bliver ved med at byde på de samme ryttere. |
| `rivalry.headToHead` | Head-to-head this season: {aWins} to {bWins}. | Indbyrdes i denne sæson: {aWins} mod {bWins}. |

---

## C. Verdenshistorik + klubmuseum

### C1. Verdenshistorik-fladen (`history.json`, ny fil, afløser `halloffame.json`)

| key | EN | DA |
|---|---|---|
| `title` | World history | Verdenshistorie |
| `subtitle` | Champions, records and the moments that made them | Mestre, rekorder og øjeblikkene der skabte dem |
| `tabs.seasons` | Seasons | Sæsoner |
| `tabs.records` | Records | Rekorder |
| `tabs.legends` | Legends | Legender |
| `tabs.moments` | Moments | Øjeblikke |
| `seasons.champion` | Division {division} champion | Mester i Division {division} |
| `seasons.promoted` | Promoted | Oprykket |
| `seasons.relegated` | Relegated | Nedrykket |
| `seasons.topRider` | Rider of the season | Sæsonens rytter |
| `seasons.biggestTransfer` | Biggest transfer | Største handel |
| `legends.subtitle` | Ranked by career wins, weighted by race class | Rangeret efter karrieresejre, vægtet efter løbsklasse |
| `legends.retired` | Retired | Kørt hjem |
| `legends.active` | Still racing | Kører stadig |
| `legends.winsFor` | {count, plural, one {# win} other {# wins}} for {team} | {count, plural, one {# sejr} other {# sejre}} for {team} |
| `moments.empty` | The biggest moments of this world are collected here as they happen. | Denne verdens største øjeblikke samles her, efterhånden som de sker. |
| `records.empty` | No records yet. Someone has to set the first one. | Ingen rekorder endnu. Nogen skal sætte den første. |

**Rekord-kategorier** (`records.category.*`; de tre første findes i dag i `halloffame.json`)

| key | EN | DA |
|---|---|---|
| `most_points_season` | Most points in a season | Flest point i en sæson |
| `most_stage_wins_season` | Most stage wins in a season | Flest etapesejre i en sæson |
| `most_div1_titles` | Most Division 1 titles | Flest Division 1-titler |
| `biggest_winning_margin` | Biggest winning margin | Største sejrsmargin |
| `most_wins_season_rider` | Most wins in a season by one rider | Flest sejre i en sæson af én rytter |
| `youngest_winner` | Youngest race winner | Yngste løbsvinder |
| `most_seasons_div1` | Most seasons in Division 1 | Flest sæsoner i Division 1 |
| `longest_break_survived` | Largest breakaway to stay away | Største udbrud der holdt hjem |

### C2. Klubmuseum (`museum.json`, ny fil)

| key | EN | DA |
|---|---|---|
| `title` | Club museum | Klubmuseum |
| `subtitle` | {team} through the seasons | {team} gennem sæsonerne |
| `trophies.title` | Trophy room | Trofæsalen |
| `trophies.empty` | No trophies yet. The first one changes everything. | Ingen trofæer endnu. Det første ændrer alt. |
| `stories.title` | Season stories | Sæsonhistorier |
| `stories.empty` | Your first season story is written when the season ends. | Din første sæsonhistorie skrives når sæsonen slutter. |
| `legends.title` | Club legends | Klublegender |
| `legends.empty` | Legends take seasons to make. | Legender tager sæsoner at skabe. |
| `milestones.title` | Milestones | Milepæle |
| `milestones.empty` | First win, first promotion, first title. They all land here. | Første sejr, første oprykning, første titel. De lander alle her. |
| `moments.title` | Great moments | Store øjeblikke |
| `moments.empty` | When something unforgettable happens to this club, it is kept here. | Når noget uforglemmeligt sker for klubben, gemmes det her. |

**Trofæ-etiketter** (`trophies.label.*`)

| key | EN | DA |
|---|---|---|
| `division_title` | Division {division} champion · Season {season} | Mester i Division {division} · Sæson {season} |
| `promotion` | Promoted to Division {division} · Season {season} | Oprykning til Division {division} · Sæson {season} |
| `race_win` | {race} · Season {season} | {race} · Sæson {season} |
| `team_classification` | Team classification · {race} | Holdkonkurrencen · {race} |
| `jersey` | {classification} · {race} | {classification} · {race} |

**Milepæls-etiketter** (`milestones.label.*`)

| key | EN | DA |
|---|---|---|
| `first_win` | First win in club history | Klubbens første sejr |
| `wins_50` | 50 club wins | 50 klubsejre |
| `wins_100` | 100 club wins | 100 klubsejre |
| `first_promotion` | First promotion | Første oprykning |
| `first_div1` | First season in Division 1 | Første sæson i Division 1 |
| `record_transfer` | Club record transfer: {rider}, {amount} CZ$ | Klubrekord-handel: {rider}, {amount} CZ$ |
| `first_academy_debut` | First academy rider promoted to the senior squad | Første akademirytter rykket op på seniorholdet |

### C3. Sæsonhistorie-skabeloner (`stories.template.*`, én pr. sæson-facit)

Params: `{season}`, `{team}`, `{division}` (slut-division for sæsonen; ved nedrykning = den NYE
division), `{rankText}`, `{points}`, `{stageWins}`.

**`champion`**
- EN: `Season {season} ended at the very top. {team} won Division {division} with {points} points and {stageWins, plural, one {# stage win} other {# stage wins}}. Seasons like this are what the museum was built for.`
- DA: `Sæson {season} sluttede helt i toppen. {team} vandt Division {division} med {points} point og {stageWins, plural, one {# etapesejr} other {# etapesejre}}. Det er sæsoner som denne, museet er bygget til.`

**`promoted`**
- EN: `Season {season} ended in promotion. {team} finished {rankText} in Division {division} and earned the step up. Bigger races are waiting.`
- DA: `Sæson {season} sluttede med oprykning. {team} sluttede som {rankText} i Division {division} og tog skridtet op. Større løb venter.`

**`midtable`**
- EN: `Season {season} was a season of work. {team} finished {rankText} in Division {division} with {points} points, and the foundation got a little stronger.`
- DA: `Sæson {season} var en arbejdssæson. {team} sluttede som {rankText} i Division {division} med {points} point, og fundamentet blev lidt stærkere.`

**`relegated`**
- EN: `Season {season} hurt. {team} finished {rankText} and goes down to Division {division}. Clubs are shaped by how they answer seasons like this.`
- DA: `Sæson {season} gjorde ondt. {team} sluttede som {rankText} og rykker ned i Division {division}. Klubber formes af hvordan de svarer på sæsoner som denne.`

**`rebuild`** (første sæson efter nedrykning med fremgang)
- EN: `Season {season} was the answer. After relegation, {team} finished {rankText} in Division {division} and started climbing again.`
- DA: `Sæson {season} var svaret. Efter nedrykningen sluttede {team} som {rankText} i Division {division} og begyndte klatringen igen.`

**`debut`**
- EN: `Season {season} is where it all started. {team} raced its first season in Division {division} and finished {rankText}.`
- DA: `Sæson {season} var der hvor det hele begyndte. {team} kørte sin første sæson i Division {division} og sluttede som {rankText}.`

---

## D. Living-world-feed (`notifications.json` → `feed.*` + dashboard-modul)

### D1. Feed-linjer (korte, én linje, som eksisterende `feed.*`)

| key | EN | DA |
|---|---|---|
| `feed.stageWinner` | {rider} wins stage {stage} of {race} | {rider} vinder {stage}. etape af {race} |
| `feed.raceWinner` | {rider} wins {race} | {rider} vinder {race} |
| `feed.gcWinner` | {rider} wins {race} overall | {rider} vinder {race} samlet |
| `feed.breakthrough` | First career win: {rider} | Karrierens første sejr: {rider} |
| `feed.youthBreakthrough` | Breakthrough win for {rider}, {age} | Gennembrudssejr til {rider}, {age} år |
| `feed.recordBroken` | New record · {category}: {holder} | Ny rekord · {category}: {holder} |
| `feed.rivalryFlare` | The rivalry between {a} and {b} is heating up | Rivaliseringen mellem {a} og {b} spidser til |
| `feed.clubMilestone` | {team} · {milestone} | {team} · {milestone} |
| `feed.transferRecord` | Season record: {rider} sold for {amount} CZ$ | Sæsonrekord: {rider} solgt for {amount} CZ$ |
| `feed.seasonChampion` | {team} win Division {division} | {team} vinder Division {division} |
| `feed.goalAchieved` | {rider} reached a career goal: {goal} | {rider} nåede et karrieremål: {goal} |
| `feed.jerseyFinal` | {rider} wins the {classification} in {race} | {rider} vinder {classification} i {race} |

`{milestone}` og `{category}` interpolerer de lokaliserede etiketter fra C1/C2. Ingen feed-linje
indeholder saldi, bud, planer eller board-tilstand.

### D2. Dashboard-modul (`dashboard.json` → `world.*`)

| key | EN | DA |
|---|---|---|
| `world.title` | The world right now | Verden lige nu |
| `world.seeAll` | Open the league feed → | Åbn liga-feedet → |
| `world.empty` | Nothing new in the league right now. | Intet nyt i ligaen lige nu. |

### D3. Discord-broadcast-skabeloner (kræver ejer-godkendelse FØR brug, postes ordret)

Kanal-sproget er EN (spillerbase er international). Skabeloner:

- Kørt løb (significance ≥ 60):
  `🏁 {race} is done. {rider} ({team}) takes the win. Full report in the game.`
- Etapeløb afgjort:
  `🏆 {rider} ({team}) wins {race} overall.`
- Rekord:
  `📜 New record: {category}. {holder} now holds it.`
- Divisionsmester:
  `🏆 {team} are Division {division} champions of season {season}.`
- Gennembrud:
  `⭐ First career win: {rider}, {age} years old.`

---

## E. Dækning og udvidelse

- Batchen dækker: 21 rubrik-varianter, 8 leder, 20 beat-varianter, 8 dit-hold-linjer,
  10 trait-etiketter, 18 karrieremål, 8 rivaliserings-nøgler, ~45 historik/museums-nøgler,
  12 feed-linjer, 3 dashboard-nøgler, 5 Discord-skabeloner. Alt EN+DA.
- Nye varianter er rene i18n-tilføjelser (`v5`, `v6`, ...) uden kodeændring; variant-vælgeren
  læser antallet dynamisk.
- Før integration i en PR: kør i18n-key-paritetstjekket (EN/DA skal matche) + frontend
  `node --test` jf. CLAUDE.md pre-flight.
