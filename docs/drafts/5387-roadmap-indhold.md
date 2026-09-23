# /roadmap = roadbooken (#5387): indholdsudkast

Udkast 23/9 til ejer-godkendelse. Kilder: prod `roadmap_items` + `roadmap_votes` (SELECT 23/9), roadbooken (ejerens Discord-opslag 15/9), `docs/MASTERPLAN.md`, `frontend/src/data/patchNotes.js`, `docs/FEATURE_REGISTRY.yml`. Intet skrevet til prod. SQL-forslag: `database/proposals/5387-roadmap-items.sql` (auto-applies ikke).

## Kort fortalt

- I dag: 23 aktive punkter, 6 i "Already built", 809 stemmer fra 40 managers, 0 arkiverede.
- Efter forslaget: **42 aktive, 11 bygget, 1 arkiveret.** Ingen stemmer ændres eller slettes, intet DELETE.
- De 23 aktive rækker: 2 markeres bygget, 1 arkiveres, 9 omskrives (kernen bevaret, så stemmerne stadig passer), 11 beholdes (kun ny rækkefølge).
- Nye rækker: 22 aktive fra roadbooken + 3 roadbook-punkter der allerede er live (går direkte i "Already built").
- 3 af 5 "Today"-tekster er ikke sande i dag (afsnit 4). De bor i locale-filerne, ikke i tabellen.

## Én beslutning: kan spilleren se hvornår?

Siden grupperer kun efter motor (Races, Training, Youth, Market, Club). Tabellen har intet felt for tidshorisont og ingen beskrivelse, så "titel: kort beskrivelse" står i titlen, som i dag. Horisonten ligger i `sort_order`-bånd, så hver motor viser punkterne i tidsrækkefølge:
100 denne sæson · 150 denne sæson, måske · 200 før sæson 4 · 250 før sæson 4, måske · 300 under sæson 4 · 900 ikke besluttet endnu.

- **A · Kun SQL'en.** 👍 Kan gå live uden kodeændring. 👎 Spilleren ser rækkefølgen, men ikke ordene "Before season 4". 42 punkter på én lang scroll-side.
- **B · SQL'en + lille frontend-PR:** kolonnen `horizon` (backfill fra båndene) og faner pr. horisont, med motoren som ikon pr. punkt. 👍 Siden bliver roadbooken, og overblikket kommer først med faner ud (ejer-reglen 2/9). 👎 Én PR mere, og mockup først.
- **Anbefaling: B.** SQL'en er skrevet, så B kun kræver kolonnen og UI'et.

Timing: S4 skifter 27-28/9. Titlerne læser rigtigt både som plan og under "Already built", men horisont-navnene "This season / Before season 4" passer ikke efter skiftet. Går det live efter skiftet, skal båndene lægges om ved apply (afsnit 5).

## 1 · De 23 aktive rækker i dag

| Række (id-slut) | Nuværende titel (EN, forkortet) | Motor | Stemmer | Handling | Bånd | Bevis / begrundelse |
|---|---|---|---|---|---|---|
| 96553692 | Direct messages and mentions between managers | club | 7 | **Markér bygget** (8/9) | | PR #5019 + v7.264 "Messages between managers" og "Tag a manager with @" (#5011). Registry `manager-dm-v1` live, intet flag |
| …009 | Generational renewal | youth | 34 | **Omskriv → Graduation Day + markér bygget** (21/9) | | v7.293 "Graduation Day has its own page" (#2491 lukket 22/9). Kun gatet af `academy_enabled` (live). Roadbook: før S4 |
| …006 | Meaningful choices, never spreadsheet homework | training | 36 | **Arkivér** | | Et designprincip, ikke noget der bygges eller kan markeres færdigt. Stemmerne bliver liggende |
| …017 | Rider values that follow the market | market | 35 | Omskriv | 110 | Roadbook S3: værdi-stilstanden. #5443 (type, formel, marked, løn) + #5497 i gang, første del i v7.290. Kernen "markedet former prisen" er bevaret |
| …005 | Long-term development you can see and steer | training | 36 | Omskriv | 110 | Roadbook S3: træningsscoren for alle. #4851, flag `training_score_visible` = beta, mangler ejer-flip |
| …004 | Real training depth: programs for individual riders | training | 36 | Omskriv | 210 | Roadbook før S4: træning pr. løbsdag + træningssiden bygget om én gang. Epic #4850, #5485 |
| …016 | U19 and U23 squads with real promotion paths | youth | 37 | Omskriv | 210 | Roadbook før S4: U23 og junior bliver rigtige trupper. #2492, #5517, #5519 i gang. U19 bliver til junior |
| …008 | Young riders you discovered, developed, made stars | youth | 36 | Omskriv | 310 | Roadbook under S4: klubidentitet (land for unge ryttere, påvirk akademiets ryttertyper). #5105 |
| df446f41 | Default training programs, and a workshop | training | 7 | Omskriv | 310 | Roadbook under S4: standardprogrammer, senere del dine egne |
| …019 | Road captains and mentors | club | 33 | Omskriv | 320 | Roadbook under S4: holdarbejde som evne + vejkaptajner og mentorer. #1177. Evnerne findes kun som data (v7.277) |
| …014 | National championships and national teams | races | 38 | Omskriv | 910 | Roadbook ikke besluttet: NM, VM, EM, landstrænere |
| …018 | Earn renown: wins, records and history | club | 33 | Omskriv | 930 | Roadbook ikke besluttet: bedre statistik og historik |
| …021 | A club museum | club | 35 | Behold | 940 | Roadbook ikke besluttet (historik). Hall of Fame er pensioneret (v6.94), museet findes ikke |
| …015 | Coaches as a real resource: load and burnout | training | 35 | Behold | 910 | Roadbook ikke besluttet: stab-funktioner. Staben er live, belastning og nedslidning er ikke |
| …013 | A smarter season planner | races | 38 | Behold | 920 | Roadbook ikke besluttet |
| 9a14a23b | The racing math explained | races | 16 | Behold | 930 | Roadbook ikke besluttet |
| …022 | Friends and following | club | 34 | Behold | 960 | Roadbook ikke besluttet. "Følg forum-kategori" (v7.264) er noget andet |
| aa3283fe | Invite a friend | club | 7 | Behold | 970 | Roadbook ikke besluttet |
| 2f84b3a4 | A living world feed | club | 7 | Behold | 980 | Roadbook ikke besluttet |
| cae1e719 | Negotiate your board's goals upward | club | 14 | Behold | 990 | Roadbook ikke besluttet |
| …011 | Deeper negotiation between managers | market | 36 | Behold* | 910 | Ikke i roadbooken. Kun delvist: beskeder med handlen citeret (v7.264). Ikke 100 % |
| …012 | A market that tells stories | market | 35 | Behold* | 920 | Ikke i roadbooken. Rygte-varsler findes (v4.45), historie-laget gør ikke |
| 5bb11a13 | Realistic race routes | races | 17 | Behold* | 940 | Ikke i roadbooken. Kun delvist: monumenterne er bygget om efter de rigtige løb (v7.171), profilerne er tegnet om (v7.178). Ikke bevis for 100 % |

\* Ikke i roadbooken, står under "Not decided yet". Alternativet er at arkivere dem (stemmerne bevares). Anbefaling: behold dem, for de har 17-36 stemmer og er ægte idéer. Tilføj dem til roadbookens ikke-besluttet-liste.

De 6 rækker der allerede er i "Already built", er uændrede.

## 2 · Den nye roadmap (EN først, DA under)

N = ny række · O = omskrevet · B = beholdt uændret

### This season (bånd 100)

| Motor | Tekst | Type | Kilde / i gang |
|---|---|---|---|
| races | **EN:** The season 4 calendar: the same number of race days in every division, plus separate U23 and junior calendars.<br>**DA:** Sæson 4-kalenderen: lige mange løbsdage i alle divisioner, plus egne U23- og juniorkalendere. | N | Roadbook S3, to punkter slået sammen. #5405 (#5469 merget) |
| races | **EN:** Mental abilities: Teamwork and Leadership for every rider, and tactics and aggression that no longer come with age.<br>**DA:** Mentale evner: Holdarbejde og Lederskab for alle ryttere, og taktik og angrebslyst der ikke længere følger med alderen. | N | v7.277 (kun data, nye ryttere) + #5268 åben |
| races | **EN:** Secondary rider types explained: see what a rider's second type means and where it helps him.<br>**DA:** Sekundære ryttertyper forklaret: se hvad en rytters anden type betyder, og hvor den hjælper ham. | N | #5435 (PR #5501 bag flag), #5327, #3813 |
| training | **EN:** The training score for everyone: see how good each training day was, and steer your riders' development season over season.<br>**DA:** Træningsscoren for alle: se hvor god hver træningsdag var, og styr dine rytteres udvikling sæson efter sæson. | O (…005) | #4851, beta |
| training | **EN:** A race sharpener: a short session the day before a race, so your riders start sharp.<br>**DA:** Åbnere: en kort session dagen før et løb, så dine ryttere starter skarpe. | N | #5238 (bølge 5) |
| training | **EN:** The game on your phone: daily training, transfers, auctions and the season matrix built for a small screen, then the rest of the game.<br>**DA:** Spillet på din telefon: daglig træning, transfers, auktioner og sæsonmatrixen bygget til en lille skærm, og derefter resten af spillet. | N | v7.285 (transferliste), v7.289 (træning i beta), #3643, #1602 |
| market | **EN:** Rider values that make sense: values follow your rider's abilities and what the market really pays, and I explain how they are set.<br>**DA:** Rytterværdier der giver mening: værdien følger rytterens evner og det, markedet reelt betaler, og jeg forklarer, hvordan den bliver sat. | O (…017) | #5443, #5497, v7.290 |

### This season, måske (bånd 150)

| Motor | Tekst | Type | Kilde |
|---|---|---|---|
| market | **EN:** More fair play tools: a transfer market you can trust.<br>**DA:** Flere fair play-værktøjer: et transfermarked, du kan stole på. | N | Roadbook S3 "måske" |
| club | **EN:** More facilities: more of your club to build than training and scouting.<br>**DA:** Flere faciliteter: mere af din klub at bygge ud end træning og scouting. | N | Roadbook S3 "måske". Registry: kun træning og scouting er live |
| club | **EN:** A faster game: pages that open quickly, also on your phone.<br>**DA:** Et hurtigere spil: sider der åbner hurtigt, også på din telefon. | N | Roadbook S3 "måske". #5177, #5131 |

### Before season 4 (bånd 200)

| Motor | Tekst | Type | Kilde / i gang |
|---|---|---|---|
| races | **EN:** Race engine v4: every stage is raced as it unfolds. It switches on when it races better than the current engine.<br>**DA:** Løbsmotor v4: hver etape køres, mens den udfolder sig. Den slås til, når den kører bedre løb end den nuværende motor. | N | #3855. Registry: dormant, flip kun ved ejeren |
| training | **EN:** Training per race day: one rebuilt training page where you plan each rider around his races.<br>**DA:** Træning pr. løbsdag: én ny træningsside, hvor du planlægger hver rytter omkring hans løb. | O (…004) | #4850, #5485 |
| training | **EN:** Racing trains your riders again: on any day a rider either trains or races, and both count.<br>**DA:** Løb træner dine ryttere igen: på en given dag træner en rytter eller kører løb, og begge dele tæller. | N | Registry `race-day-development` dormant |
| training | **EN:** Training runs itself every evening: the bonus button goes away, and you can still run a day early if you want.<br>**DA:** Træningen kører af sig selv hver aften: bonusknappen forsvinder, og du kan stadig køre en dag tidligt, hvis du vil. | N | #5281 (flip-dag 28/9) |
| training | **EN:** Injuries counted in race days: you see exactly how many race days an injured rider will miss.<br>**DA:** Skader tælles i løbsdage: du kan se præcis, hvor mange løbsdage en skadet rytter går glip af. | N | PR #5465 merget, men bag `training_tick_per_race_day` (off). Ikke live |
| youth | **EN:** U23 and junior squads: two real squads under your first team, with a path from the academy to the top.<br>**DA:** U23- og juniortrupper: to rigtige trupper under dit førstehold, med en vej fra akademiet til toppen. | O (…016) | #2492, #5517, #5519 |
| youth | **EN:** Youth racing: U23 and junior races with their own calendars and leagues.<br>**DA:** Ungdomsløb: U23- og juniorløb med egne kalendere og ligaer. | N | #2492, bølge 4 |
| club | **EN:** A new board: one mandate you agree on together, and a real board meeting.<br>**DA:** En ny bestyrelse: ét mandat, du og bestyrelsen bliver enige om, og et rigtigt bestyrelsesmøde. | N | #3514, flag `board_mandate_model_enabled` = beta, #4859 |
| club | **EN:** A clear sign-up for every new season, and inactive clubs parked at the switch, so you race against managers who play.<br>**DA:** En tydelig tilmelding til hver ny sæson, og inaktive klubber parkeres ved sæsonskiftet, så du kører mod managers, der spiller. | N | #4592, #452 (`season_signup_enabled` dormant) |

### Before season 4, måske (bånd 250)

| Motor | Tekst | Type | Kilde |
|---|---|---|---|
| club | **EN:** Upkeep reworked: travel and staff costs paid per race day, instead of one big bill at season start.<br>**DA:** Drift og vedligehold lavet om: rejse- og personaleudgifter betales pr. løbsdag i stedet for én stor regning ved sæsonstart. | N | Roadbook "måske". #4385 |

### During season 4 (bånd 300)

| Motor | Tekst | Type | Kilde |
|---|---|---|---|
| training | **EN:** Ready-made training programs, and later a way to share your own.<br>**DA:** Færdige træningsprogrammer, og senere en måde at dele dine egne på. | O (df446f41) | Roadbook under S4 |
| youth | **EN:** Your own young stars: choose the country your young riders come from, and steer which rider types your academy produces.<br>**DA:** Dine egne unge stjerner: vælg hvilket land dine unge ryttere kommer fra, og styr hvilke ryttertyper dit akademi får frem. | O (…008) | Roadbook under S4. #5105 |
| youth | **EN:** Youth seasons that count: promotion, relegation, rankings and prize money for U23 and junior.<br>**DA:** Ungdomssæsoner der tæller: oprykning, nedrykning, ranglister og præmiepenge for U23 og junior. | N | Roadbook under S4, to punkter slået sammen |
| club | **EN:** A new dashboard and inbox: what needs you today comes first, and messages you can scan in seconds.<br>**DA:** Et nyt dashboard og en ny indbakke: det, der kræver dig i dag, står først, og beskeder, du kan overskue på få sekunder. | N | Roadbook under S4, to punkter slået sammen. #4985, #4984 |
| club | **EN:** Road captains, mentors and teamwork: riders who lift the team around them.<br>**DA:** Vejkaptajner, mentorer og holdarbejde: ryttere der løfter holdet omkring sig. | O (…019) | #1177 |

### Before season 5

Ingen punkter. Det besluttes sammen med spillerne i forum-trådene og står i intro-teksten (afsnit 4).

### Not decided yet (bånd 900)

| Motor | Tekst | Type |
|---|---|---|
| races | **EN:** National championships, worlds and europeans: ride for your country, win the jersey, and coach a national team.<br>**DA:** Nationale mesterskaber, VM og EM: kør for dit land, vind trøjen, og bliv landstræner. | O (…014) |
| races | A smarter season planner: overlapping races, fatigue and qualification rules you can plan a whole season around. / En klogere sæsonplanlægger: overlappende løb, træthed og kvalifikationsregler du kan planlægge en hel sæson omkring. | B |
| races | The racing math explained in plain words, without revealing exact numbers. / Løbs-matematikken forklaret i klare ord, uden at afsløre de præcise tal. | B |
| races | Realistic race routes modeled on real racing. / Realistiske løbsruter modelleret efter rigtig cykling. | B* |
| training | Coaches as a real resource: balance training load and risk burnout if you push too hard. / Trænere som en ægte ressource: balancér træningsbelastningen og risikér nedslidning hvis du presser for hårdt. | B |
| youth | **EN:** Better scouting: more ways to find and judge the next big talent.<br>**DA:** Bedre scouting: flere måder at finde og vurdere det næste store talent på. | N |
| market | Deeper negotiation between managers. / Dybere forhandling mellem managers. | B* |
| market | A market that tells stories: rumors, rivalries and big moves the whole world talks about. / Et marked der fortæller historier: rygter, rivaliseringer og store handler hele verden taler om. | B* |
| club | **EN:** Your club's look: logo, team colours and rider faces.<br>**DA:** Din klubs udseende: logo, holdfarver og rytteransigter. | N (#5113) |
| club | **EN:** Sponsors reworked: sign more than one sponsor at a time.<br>**DA:** Sponsorer lavet om: hav mere end én sponsor ad gangen. | N |
| club | **EN:** Earn renown: statistics, records and history that build your club's reputation in the world.<br>**DA:** Optjen renommé: statistik, rekorder og historie der bygger din klubs omdømme i verden. | O (…018) |
| club | A club museum: champions, legendary riders and the races people still talk about. / Et klubmuseum: mestre, legendariske ryttere og løbene folk stadig taler om. | B |
| club | **EN:** A smarter assistant: more help with the daily jobs, whenever you want it.<br>**DA:** En klogere assistent: mere hjælp til de daglige opgaver, når du vil have den. | N |
| club | Friends and following: follow managers and riders across the world. / Venner og følg-funktion: følg managers og ryttere på tværs af verden. | B |
| club | Invite a friend and build your rivalry together. / Inviter en ven og byg jeres rivalisering sammen. | B |
| club | A living world feed of results, transfers and rivalries. / Et levende verdensfeed med resultater, transfers og rivaliseringer. | B |
| club | Negotiate your board's goals upward, for a bigger reward. / Forhandl bestyrelsens mål op, for en større belønning. | B |

### Already built (nye og flyttede)

| Motor | Tekst | Bevis | shipped_at |
|---|---|---|---|
| club | Direct messages and mentions between managers. / Direkte beskeder og @-omtaler mellem managers. (uændret titel) | PR #5019, v7.264 | 8/9 |
| youth | **EN:** Graduation Day: once a season you decide who moves up, who is sold and who leaves, so your club always has a next generation.<br>**DA:** Graduation Day: én gang pr. sæson bestemmer du, hvem der rykker op, hvem der sælges, og hvem der forlader klubben, så din klub altid har en ny generation på vej. | v7.293, #2491 lukket | 21/9 |
| market | **EN:** All trades in one list: every rider move in the game, newest first.<br>**DA:** Alle handler i én liste: hvert rytterskifte i spillet, nyeste først. | PR #5374, v7.288 (#5257) | 18/9 |
| club | **EN:** The beta group: ask to join and try new features before everyone else.<br>**DA:** Beta-gruppen: bed om at komme med, og prøv nye funktioner før alle andre. | v7.288 (#5259 lukket) | 18/9 |
| races | **EN:** Your assistant tells you when it picked a squad you left empty.<br>**DA:** Din assistent giver besked, når den har udtaget et hold, du havde ladet stå tomt. | PR #5466, v7.293 (#4759) | 21/9 |

"Alle handler" antages at være roadbookens "a global transfer feed" (under S4): #5257 blev oprettet af ejeren 15/9, samme dag som roadbooken. Mente du noget større, skal punktet i stedet ind som nyt punkt under S4.

## 3 · Roadbook-dækning (hvert punkt → hvor det står)

- **S3, nu:**
  - Værdi-stilstand → market 110. De rapporterede fejl er udeladt: det er fejlrettelser, ikke noget at stemme på.
  - Sekundær type → races 130.
  - Åbnere → training 120.
  - Mentale evner → races 120.
  - Mobil → training 130.
  - S4-kalender inkl. U23 og junior → races 110.
  - Lige mange løbsdage → races 110.
  - Beta-programmet → **bygget**.
  - Træningsscoren → training 110.
- **S3, måske:**
  - Faciliteter → club 150.
  - Mobil ud over træning og transfers → training 130.
  - Hastighed → club 160.
  - Fair play → market 150.
  - Pro-rettelser → udeladt (vedligehold af CZ Pro, ikke en plan at stemme på).
- **Før S4:**
  - v4 → races 210.
  - Bestyrelsen → club 210.
  - U23- og juniortrupper → youth 210.
  - U23- og juniorløb → youth 220.
  - Graduation Day → **bygget**.
  - Træning fra løb → training 220.
  - Træning pr. løbsdag → training 210.
  - Aftenkørsel og bonusknappen → training 230.
  - Skader i løbsdage → training 240.
  - Træningssiden én gang → training 210.
  - Sponsor-rettelser → udeladt (fejlrettelser).
  - Én samlet rytter-opdateringsbesked → udeladt (en besked, ikke en funktion).
  - Inaktive managers og tilmelding → club 220.
  - Assistenten giver besked → **bygget**.
  - Måske upkeep → club 250.
- **Under S4:**
  - Klubidentitet → youth 310.
  - Dashboard og indbakke → club 310.
  - Holdarbejde, vejkaptajner og mentorer → club 320.
  - Op- og nedrykning, ranglister og præmiepenge for ungdom → youth 320.
  - Global transfer-feed → **bygget** (se note ovenfor).
  - Standardprogrammer → training 310.
- **Før S5:** intro-teksten.
- **Ikke besluttet:**
  - Logoer, ansigter og farver → club 910.
  - Stab → training 910.
  - Sponsor-rework → club 920.
  - NM, VM, EM og landstrænere → races 910.
  - Scouting → youth 910.
  - Statistik og historik → club 930 + 940.
  - Assistent → club 950.
  - Venner, følg, inviter og verdensfeed → club 960-980.
  - Bestyrelsesmål op → club 990.
  - Sæsonplanlægger og løbsmatematik → races 920 + 930.

## 4 · "Today"-tekster og intro (locale-filer, ikke SQL)

Filer: `frontend/public/locales/{en,da}/roadmap.json` → `engines.*.today` og `voting.intro`.

| Motor | Problem i dag | Ny EN | Ny DA |
|---|---|---|---|
| races | Sand, men løbsfilmen mangler | A full season calendar with scheduled races, results, standings, prize money and history, plus a race film of every finished stage. | En fuld sæsonkalender med planlagte løb, resultater, stillinger, præmiepenge og historik, plus en løbsfilm af hver afsluttet etape. |
| training | **Ikke sand:** "season-long focus" er afløst af daglig træning (v7.130 dag først, så session; v7.224 assistentforslag) | Daily training: pick a session for each rider every day, plan form peaks, and let the assistant suggest a plan. | Daglig træning: vælg en session til hver rytter hver dag, planlæg formtoppe, og lad assistenten foreslå en plan. |
| youth | **Ikke sand:** "limited scout slots" blev fjernet i v6.73 | Your own academy and a talent scout: find young riders, develop them, and decide on Graduation Day who moves up. | Dit eget akademi og en talentspejder: find unge ryttere, udvikl dem, og bestem på Graduation Day, hvem der rykker op. |
| market | **Ikke sand:** rytterlån blev fjernet i v6.95 (#1994) | The strongest part of the game right now: live auctions, auto-bids, transfers, swaps and negotiations between managers. | Den stærkeste del af spillet lige nu: live-auktioner, autobud, transfers, byttehandler og forhandlinger mellem managers. |
| club | Sand, men stab, forum og beskeder mangler | A demanding board with real goals, club finances with real consequences, your own staff, and a forum and messages to talk with other managers. | En krævende bestyrelse med ægte mål, klubøkonomi med ægte konsekvenser, din egen stab, og et forum og beskeder til at tale med andre managers. |

`voting.intro`:
- **EN:** Rate the plans below. Your votes help decide what gets built next. What comes after season 4, I decide with you in the Roadmap threads on the forum.
- **DA:** Bedøm planerne herunder. Dine stemmer er med til at afgøre, hvad der bliver bygget som det næste. Hvad der kommer efter sæson 4, beslutter jeg sammen med dig i Roadmap-trådene på forummet.

`engines.*.next` (den statiske fallback) vises, hvis hentningen fejler, og styrer antallet af skeletons. Den indeholder stadig de gamle punkter, så den skal opdateres til de nye titler i samme PR.

## 5 · Ved apply (Claude, efter ejer-go)

1. Kør pre-check-SELECT'erne øverst i SQL-filen og notér stemmetallet. En række hvis titel er ændret i admin siden 23/9, springes over af vagten.
2. Er noget gået live siden 23/9 (S4-kalender, trupper, træning pr. løbsdag, skader, bestyrelse, v4), markeres det bygget før apply. Ligger apply efter S4-skiftet, skal båndene lægges om.
3. Post-verify: 42 aktive, 11 bygget, 1 arkiveret. Stemmetallet skal være det samme som i pre-check.
4. Patch note (brugerrettet):
   - **EN:** "The roadmap follows the roadbook". What changed: The roadmap now shows what I am building this season, what comes before and during season 4, and ideas that are not decided yet. Finished things moved to Already built. What it means for you: Rate the plans. Your votes help me decide the order.
   - **DA:** "Roadmappet følger roadbooken". Hvad er ændret: Roadmappet viser nu, hvad jeg bygger i denne sæson, hvad der kommer før og under sæson 4, og idéer der ikke er besluttet endnu. Det færdige er flyttet til Allerede bygget. Hvad det betyder for dig: Bedøm planerne. Dine stemmer hjælper mig med at vælge rækkefølgen.
5. Ejeren poster selv i #the-roadbook på Discord.
