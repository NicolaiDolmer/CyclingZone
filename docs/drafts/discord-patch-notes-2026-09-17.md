# Discord #patch-notes: udsnit siden catch-up 15/9 (v7.276 rest + v7.277 til v7.283)

> Udkast til copy-paste. Ejeren poster selv (TONE §2: udsnit af "What changed" ordret fra `frontend/src/data/patchNotes.js`, ingen nye påstande). Catch-up'en 15/9 kl. 13:42 dækkede alt til og med 7.275 samt seks punkter fra 7.276; de manglende 7.276-punkter er med her. Refs #4521 #428 #4820.

---

Catch-up: v7.276 to v7.283 (15 to 17 Sep)

**Riders**
- Two new mental abilities: Teamwork and Leadership. The rider profile and Help now show Teamwork (how much a helper is worth to his captain) and Leadership (whether the squad rides behind him). For riders already in the game the two fields stay empty until a later update fills them in, and the race engine does not use them yet.
- Tactics and aggression no longer come with a hidden age bonus. From now on both are abilities of their own for new riders. The ceiling for tactics was lowered to match. A ceiling only limits future growth, so no rider loses a single point.
- Your fighters got their potential back. Yesterday's update lowered the ceiling on aggression, and that hit one rider type far harder than the rest. Aggression is back at full height, and your fighters show their old numbers again after their next training session. Nobody lost a single point of ability along the way, only the projection you see.
- The rider card loads faster.

**Training**
- Three new hard sessions: cobbled sectors, echelon drills and attack repeats. Cobbles, flat and aggression could only be trained on light days until now. All three are hard sessions with the same total weight as the other hard packages, so nothing gets cheaper. Your existing programs are untouched.

**Academy**
- Graduation Day comes at 23, not 22. The forced choice for an academy rider (promote, sell or release) now comes the season he turns 23. A 22-year-old stays in your academy one more season.

**Planning and races**
- Withdrawing from a race now shows everywhere. The division start list, the season matrix, the race page and the dashboard all know you have withdrawn. Re-entering now tells you which rider is racing elsewhere instead of failing.
- The right day in tactics. Your tactics tab now marks a stage as today only when it is scheduled for today in Copenhagen time.
- Role names in planning. Your assigned breakaway hunter now shows the correct role name, in English and Danish.

**Scouting**
- Scout from the rider database. You can scout directly from the rider list, including on your phone. Going back now restores the filters from that page. On mobile, salary is one column tap away.

**Inbox, Discord and interface**
- A welcome message that points you to Discord. Once your team has its first eight riders, or a day after you started, you get one message in your inbox from me about Discord. The Discord link also sits in the sidebar footer now.
- Race results in Discord go to your own group channel only.
- A clearer message when the server cannot be reached. If your browser cannot reach the game server, the dashboard now tells you what actually happened, so you know to check your network first.
- Toned-down elements are toned down again, and the survey bar is no longer see-through in dark mode.

Full detail as always at cyclingzone.org/patch-notes.

---

## DA (til tråden under, hvis du vil)

Catch-up: v7.276 til v7.283 (15. til 17. september)

**Ryttere**
- To nye mentale evner: Holdarbejde og Lederskab. Rytterprofilen og Hjælp viser nu Holdarbejde (hvor meget en hjælper er værd for sin kaptajn) og Lederskab (om truppen kører bag ham). For ryttere der allerede er i spillet står felterne tomme, til en senere opdatering fylder dem ud, og løbsmotoren bruger dem ikke endnu.
- Taktik og angrebslyst kommer ikke længere med en skjult aldersbonus. Fra nu af er begge selvstændige evner for nye ryttere. Loftet for taktik er sænket tilsvarende. Et loft begrænser kun fremtidig udvikling, så ingen rytter mister et eneste point.
- Dine baroudeurer fik deres potentiale tilbage. Opdateringen dagen før sænkede loftet for angrebslyst, og det ramte én ryttertype langt hårdere end resten. Angrebslyst er tilbage i fuld højde, og dine baroudeurer viser deres gamle tal igen efter næste træningspas. Ingen mistede et eneste evnepoint, kun den fremskrivning du ser.
- Rytterkortet indlæses hurtigere.

**Træning**
- Tre nye hårde sessioner: brostenssektorer, vifteøvelser og angrebsintervaller. Brosten, fladt og angrebslyst kunne indtil nu kun trænes på lette dage. Alle tre er hårde sessioner med samme samlede vægt som de andre hårde pakker, så intet bliver billigere. Dine eksisterende programmer er urørte.

**Akademi**
- Graduation Day kommer ved 23, ikke 22. Det tvungne valg for en akademirytter (ryk op, sælg eller frigiv) kommer nu i den sæson han fylder 23. En 22-årig bliver i dit akademi en sæson mere.

**Planlægning og løb**
- Afmelding fra et løb vises nu alle steder. Divisionens startliste, sæsonmatrixen, løbssiden og dashboardet ved alle, at du har meldt fra. Melder du til igen, får du nu at vide, hvilken rytter der kører andetsteds, i stedet for en fejl.
- Den rigtige dag i taktik. Din taktikfane markerer nu kun en etape som i dag, når den er planlagt til i dag i dansk tid.
- Rollenavne i planlægningen. Din udbrudsjæger vises nu med det rigtige rollenavn på både engelsk og dansk.

**Scouting**
- Scout direkte fra rytterdatabasen. Du kan scoute direkte fra rytterlisten, også på din telefon. Tilbage-navigation gendanner nu filtrene fra den side. På mobil er løn ét kolonnevalg væk.

**Indbakke, Discord og flader**
- En velkomstbesked der peger dig mod Discord. Når dit hold har sine første otte ryttere, eller en dag efter du startede, får du én besked i indbakken fra mig om Discord. Discord-linket sidder nu også i sidebjælkens fod.
- Løbsresultater i Discord lander kun i din egen gruppekanal.
- Tydeligere besked når serveren ikke kan nås. Kan din browser ikke få forbindelse til spillets server, siger dashboardet nu, hvad der faktisk skete, så du ved, at du skal tjekke dit netværk først.
- Dæmpede elementer er dæmpede igen, og spørgeskemaets bjælke er ikke længere gennemsigtig i mørkt tema.

Alle detaljer som altid på cyclingzone.org/patch-notes.


---

## Tilføjelse aften 17/9 (v7.286)

> Udsnit af "What changed" ordret fra patchNotes.js v7.286. Ejeren poster selv.

Update: v7.286 (17 Sep, evening)

**Ratings**
- One rating per rider, everywhere. Your squad list, the rider profile and the scouting tab showed different ratings for the same rider since Tuesday. The two new abilities, Teamwork and Leadership, were counted as zero on some pages before any rider actually has them. I have taken them out of the rating again until they are really in the game, and a missing value can never count as zero. Ratings are back to the numbers you knew. No rider got better or worse.

**Team**
- Manager status shows minutes, hours and days again. On another team's page, the manager's status jumped from Online now straight to Never. You now see the real time since they were last online.

**Finances**
- The season start sponsor line names your contract. It was labelled as an intro payment for every team with a contract. It now says it is your contract payment and names the sponsor.

**Stability**
- Clearer messages when the server cannot be reached. When the game cannot reach the server at all, you now get a message that says so. The race board on the planning page tells you plainly if it could not load. And the stage card says Tomorrow correctly around the change to winter time.

All details as always at cyclingzone.org/patch-notes.

---

Opdatering: v7.286 (17. september, aften)

**Ratings**
- Én rating pr. rytter, overalt. Din trup, rytterprofilen og scouting-fanen viste forskellige ratings for samme rytter siden tirsdag. De to nye evner, Holdarbejde og Lederskab, blev talt som nul på nogle sider, før nogen rytter reelt har dem. Jeg har taget dem ud af ratingen igen, indtil de rigtigt er i spillet, og en manglende værdi kan aldrig tælle som nul. Ratings er tilbage på de tal du kendte. Ingen rytter er blevet bedre eller dårligere.

**Hold**
- Manager-status viser igen minutter, timer og dage. På et andet holds side sprang managerens status fra Online nu direkte til Aldrig. Nu ser du den rigtige tid siden vedkommende sidst var online.

**Økonomi**
- Sæsonstart-linjen fra sponsoren hedder nu din kontrakt. Den stod som en intro-udbetaling for alle hold med kontrakt. Nu står der, at det er din kontraktudbetaling, og sponsoren nævnes ved navn.

**Stabilitet**
- Klarere beskeder når serveren ikke kan nås. Når spillet slet ikke kan nå serveren, får du nu en besked der siger det. Løbstavlen på planlægningssiden siger tydeligt, hvis den ikke kunne hentes. Og etapekortet siger I morgen korrekt omkring skiftet til vintertid.

Alle detaljer som altid på cyclingzone.org/patch-notes.
