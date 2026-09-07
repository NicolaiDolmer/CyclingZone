# Feature-inventar: hvad ejeren har talt med spillerne om 24/8 til 7/9

> Skrevet 7/9 2026 til #4943 (spørgeskema til alle spillere) og #4820 (indholdsplan).
> Formål: give spørgeskema v2 et faktuelt grundlag, så vi kun spørger om ting ejeren
> rent faktisk har åbnet over for spillerne, og så hver linje har en verificeret status.
>
> **Kilder:** Discord (#general, #q-and-a, #dansk-snak, #dansk-strategi, #patch-notes,
> #the-roadbook, #feedback-from-dolmer), forummet på cyclingzone.org (`forum_posts` +
> `forum_replies` via SELECT, 24/8 til 7/9), GitHub (`gh issue list` / `gh pr list`),
> `docs/MASTERPLAN.md` (7/9) og `git log`.
>
> **Status-definitioner:**
> **Shippet** = merget PR eller lukket issue, verificeret i git-log eller issue-state.
> **Planlagt** = åbent issue findes, arbejdet er defineret.
> **Kun lovet** = ejeren har sagt det til spillerne, men der findes intet issue endnu.

---

## 1. Løbsmotor og løbssiden

| Funktion | Dato | Kilde | Ejer-citat (kort) | Status | Issue / PR |
|---|---|---|---|---|---|
| Race engine v4 til sæson 4 | 25/8 | #feedback-from-dolmer | "race engine v4 til S4" | Planlagt (i gang, bane 1) | #4914 |
| Følg løbet live i appen | 25/8 og frem | MASTERPLAN, efter v4-flip | (flip er ejer-only) | Planlagt | #4916 |
| Løbsdagens indsatsvalg: grupetto, stille og roligt, normal, arbejd, angrib | 2/9 | #dansk-strategi | "Gør ingenting. Træning: aktiv restitution, let, mellem, hård. Løb: Grupetto, kør stille og roligt, mellem, arbejd/angrib/udbrud" | Delvist shippet bag flag (5 trin) | #4632, PR #4878, epic #4850 |
| Løbssiden som faner (hero + tilstand) | 6/9 | #patch-notes | | Shippet 6/9 | #4913, PR #4913 |
| Etapeprofil over Taktik- og Hold-fanen | 7/9 | #q-and-a | | Shippet 7/9 | #4979, PR #4995 |
| Hurtig rolle-redigering midt i et etapeløb | 7/9 | #q-and-a | | Shippet 7/9 | #4980, PR #4995 |
| Rute-match pr. etape som sorterbar kolonne | 7/9 | #q-and-a (egomadsen) | | Shippet 7/9 | #4992, PR #4995 |
| Bjerg- og pointtrøje som eksplicit taktisk mål fra løbsstart | 7/9 | #q-and-a | "should be a clear option to target sprinters/mountain jerseys" | Kun lovet (v4, næste sæson) | intet issue |
| Dobbelt kaptajn | 27/8 | #q-and-a | "will probably make it at some point" | Kun lovet | intet issue |
| Løbene fodrer træningen (brostensløb gør dig bedre til brosten) | 2/9 | #dansk-strategi | "Hvis du kører brostensløb, bliver du bedre til brosten" | Kun lovet | intet issue |
| Team radio: rytterens stemme før og efter etapen | 31/8 | #general (Velo Victory-inspiration) | "tell me features you want CZ inspired by" | Planlagt | #4611 |

## 2. Træning og rytterudvikling

| Funktion | Dato | Kilde | Ejer-citat (kort) | Status | Issue / PR |
|---|---|---|---|---|---|
| Træningsprogrammer: ugeplan med session pr. ugedag + 10-25 standardprogrammer | 2/9 | #dansk-strategi, #the-roadbook | "man laver et træningsprogram i stedet for at ændre træningen hver eneste dag" | Planlagt (mål ca. en måned) | #4629 |
| Egne programmer + community-workshop (gem, del, kommentér, find andres) | 2/9 | #dansk-strategi | "en form for community workshop, hvor man kan finde andres træningsprogrammer og dele sine egne" | Planlagt | #4630 |
| Formtræning for ryttere der ikke længere jager evner | 2/9 | #dansk-strategi (thelamba foreslog) | "Det tænker jeg kommer for alle" | Planlagt | #4633 |
| Punch og klatring skilles ad i træningen | 2/9 | #dansk-strategi | "snarligt får jeg pillet punch og climbing træning fra hinanden" | Kun lovet (nærmeste issue er evne-bundterne) | #3705 |
| Lofter uden hårde låse (udviklingen bliver langsommere, ikke stoppet) | 2/9 | #dansk-strategi | "Begrænsninger er tiltænkt. Hårde (låste) begrænsninger er ikke" | Planlagt | #3709, #3564 |
| Brosten og aggression kan kun trænes på skill-dag | 5/9 | #general (knud_r_flink) | "100% valid, will prioritize" | Planlagt | #4874 |
| Træning pr. løbsdag (løbsdagen bliver tick-enheden) | 6/9 | ejer-go | live senest 28/9 | Planlagt | #4850, #4846 til #4854 |
| "Modtag forslag fra assistenten"-knap på træningssiden | 31/8 | ejer-direktiv | | Planlagt | #4522 |
| GC-rytterens loft for punch-træning hæves | 2/9 | #dansk-strategi | "det er f.eks planlagt at GC rytterens mulighed for at træne mere i punch, det bliver hævet" | Kun lovet | intet issue |
| Omdøbning af ryttertyper (baroudeur til angriber, punch til bakke) | 2/9 | #dansk-strategi | "baroudeur er simpelthen også bare sådan et ægte irriterende ord" | Kun lovet | intet issue |
| Træning gøres mere forståelig i UI | 25/8 | #feedback-from-dolmer | "træning mere forståelig" | Planlagt | #4192, #3659 |

## 3. Trupper, akademi og verden

| Funktion | Dato | Kilde | Ejer-citat (kort) | Status | Issue / PR |
|---|---|---|---|---|---|
| U23-løb og juniorløb, 2 til 5 ungdomsetaper om ugen, helt valgfrit | 6-7/9 | #q-and-a | "senest S5-start, gerne før. Community polls afgør" | Planlagt | #4620, #4621, #4619 |
| U23-udgaver af de store løb + juniorudgaver | 7/9 | #q-and-a | | Kun lovet (rammen ligger i U23-slicen) | #4620 |
| Navnedatabase 16 gange større + nye lande på vej | 3/9 | #general | | Shippet (navne-pools) | #4178 |
| Nationaliteter skal styre akademi-intake | 5/9 | #general (knud_r_flink, thelamba) | spillerønske, ejeren lyttede | Kun lovet | intet issue |
| Utilsigtet +2 træningsgevinst på nyt akademi-intake | 3/9 | #general (thelamba) | ejer-bekræftet utilsigtet | Planlagt | #4750 |
| Puncheur-potentiale er top-3 for halvdelen af rytterne, opskriften strammes | 7/9 | #q-and-a | "overvejer at stramme opskriften" | Kun lovet | intet issue |

## 4. Klub, økonomi og identitet

| Funktion | Dato | Kilde | Ejer-citat (kort) | Status | Issue / PR |
|---|---|---|---|---|---|
| Bestyrelse og sponsorer adskilt i UI | 25/8 | #feedback-from-dolmer | "bestyrelse og sponsorer adskilles i UI" | Shippet | #4265, PR #4843 |
| Bestyrelses-UI rework ("Mandatet") | 25/8 | #feedback-from-dolmer | "bestyrelses-UI rework" | Planlagt (bane 1, flip mangler) | #3514, #4857, #4859 |
| Sponsorbasen rebases ikke ved oprykning (Div 1-udgifter, Div 3-indtægt) | 31/8 | forummet, tråden "Financial Punishment?" | "The fix is built and it is next in line for me to sign off on ... It will cover the season you are in now as well" | Planlagt | #4376 |
| Flere små sponsorer med egne mål ved siden af hovedsponsoren | 4/9 og 7/9 | forummet (RMF Pro Athletic) | "I like the idea of multiple sponsors. Not sure yet if its something i will commit to" | Kun lovet | nærmest #1441, #3147 |
| Kosmetik: holdfarver, logo, rytterportrætter, følgebil | 4/9 og 7/9 | forummet, tråden "Cosmetics-status?" | "this is an area of the game, that will see improvements ... I expect to make some poll for the community" | Planlagt (portrætter) | #4100 |
| Staff-featurens fremtid: flere roller, rigtige attributter, uddelegering | 7/9 | forummet, tråden "The future of: The staff feature" | "Do you want to help me shape the future of the staff feature?" | Planlagt (epic) | #930, #3854 |
| Pro-abonnementets indhold | 7/9 | forummet, tråden "The future of: Cycling Zone Pro" | "What do you think is a good idea to include in an optional subscription?" | Planlagt (rammen), indhold uafklaret | #2806, #4616 |
| Roller i spillet: admin, moderator, betatester | 25/8 | #feedback-from-dolmer | "roller admin/moderator/betatester" | Planlagt | #4268 |

**Spillernes svar i Pro-tråden (7/9), som spørgeskemaet skal krydse mod:**
Tre svar afviste "improved scouting" i Pro med samme begrundelse, at man ikke skal kunne
købe sig til succes. Extended history, avanceret statistik og kosmetik nævnes af alle tre
som acceptable. Én foreslår omdøbning af ryttere fra en godkendt navneliste. Én skriver at
han ikke behøver noget tilbage overhovedet.

## 5. Dashboard, indbakke og kommunikation

| Funktion | Dato | Kilde | Ejer-citat (kort) | Status | Issue / PR |
|---|---|---|---|---|---|
| Dashboard-rework | 25/8 | #feedback-from-dolmer | "dashboard rework" | Planlagt | #3513, #4070 |
| Handlinger direkte i indbakken (besvar transfertilbud uden at forlade siden) | 7/9 | #dansk-snak | indbakken er "ALT for spammy" | Planlagt | #4984, #2223 |
| Gruppering af enslydende beskeder i indbakken | 7/9 | #dansk-snak | | Planlagt | #4985 |
| Påmindelse før udtagelses-deadline + brugerstyret indstilling | 7/9 | #dansk-snak (egomadsen, thelamba) | | Planlagt | #4983 |
| Flere muligheder for selv at bestemme over sin assistent | 7/9 | #dansk-snak | "flere muligheder for selv at bestemme over sin assistent" | Planlagt | #4522, #4201 (lukket) |
| Beskeder mellem managere (DM) | 25/8 | #feedback-from-dolmer | "DM mellem managers senest S3" | Planlagt, deadline overskredet | #3200, #4523, #4751 |
| Connect med Discord på normal vis | 25/8 | #general | "more normal way to connect Discord", i september | Planlagt | #2161 |
| Forummet forbedres: roadmap-kategori, billeder i indlæg, flyt tråd | 25/8 og 4/9 | #feedback-from-dolmer, #the-roadbook | "forum forbedres" | Planlagt | #4818, #4819, #4821, #3517 |
| Holdudtagelse fejlfri | 25/8 | #feedback-from-dolmer | "holdudtagelse fejlfri" | Delvist shippet, rest åben | #4200 (lukket), #3410 |
| Formpeaks mere forståelige | 25/8 | #feedback-from-dolmer | "formpeaks mere forståelige" | Delvist shippet | #4212 (lukket), #4530 |
| Sæsonmatrix + tildel formpeak direkte i gitteret, drag and drop senere | 31/8 | #patch-notes | "assigning a form peak straight from the grid, drag and drop planned for later" | Matrix shippet, resten planlagt | #4530, #4531 |
| Kalender-overlap skal kunne ses | 25/8 og frem | spillerønsker | | Planlagt | #4535, #4259 |
| Ny bestyrelses-retning (4 inspirationsbilleder) | 1/9 | #the-roadbook | "could be where we are going" | Planlagt (samme spor som Mandatet) | #3514 |
| UI-retning for træningslayout (billede med numre) | 5/9 | #general | "Is there something here you like? Press a number" | Kun lovet (retningsvalg, ikke bygget) | #4613 |

---

## 6. Optælling

| Status | Antal |
|---|---|
| Shippet (verificeret merget eller lukket) | 6 |
| Delvist shippet (kerne live, rest åben) | 4 |
| Planlagt (åbent issue findes) | 29 |
| Kun lovet (intet issue endnu) | 11 |
| **I alt** | **50** |

De 11 "kun lovet" er dem der er mest værd at få prioriteret eller afvist i spørgeskemaet,
fordi de i dag kun lever i en Discord-tråd eller en forumtråd: trøje-mål fra løbsstart,
dobbelt kaptajn, løb der fodrer træningen, punch/climb-opdelingen, GC-punch-loftet,
omdøbning af ryttertyper, U23-udgaver af de store løb, nationalitetsstyret akademi-intake,
puncheur-opskriften, flere små sponsorer og UI-retningen for træningssiden.

## 7. Spillerønsker i samme periode (ikke ejer-løfter)

Ønsker der er stillet af spillere 24/8 til 7/9 og som ejeren har forholdt sig til, men
ikke lovet: transfermarked med liga-udbudte ryttere og daglige vinduer (forummet 1/9),
skades- og styrthistorik for eget hold (#4942), skjul andre holds evner så scouting
afslører gradvist (#4264), auktioner med anti-snipe (#2884), træningstype låst til
belastning skal løsnes (#4852), og blødt loft hvor træningen bare tager længere tid.
