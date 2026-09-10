# GDD · Beslutninger, spørgsmål og evidens

Status: discovery. [Til GDD](../../GAME_DESIGN_DOCUMENT.md) · [Dækning](COVERAGE.md) · [Journal](SESSION_LOG.md).

## Q-001 · Spillerens oplevelse efter tre måneder

**Status:** besvaret 10/9 2026; ejerens vision registreret som V-001.

**Spørgsmål:** Forestil dig den spiller, Cycling Zone først og fremmest skal være
fantastisk for, efter tre måneder i spillet. Hvad skal vedkommende fortælle en ven
om det, der gør deres klub og oplevelse så betydningsfuld, at de har lyst til at
fortsætte? Beskriv gerne et konkret øjeblik; jeg vil forstå din personlige vision
bag den eksisterende doktrin.

**Hvorfor nu:** Den historiske doktrin prioriterer dynasti, socialt marked og
cykelmanager. Vi skal kende ejerens ønskede oplevelse og målspiller, før vi bruger
den rangorden til at anbefale tradeoffs i de enkelte systemer.

**Svar:** se det fulde udsagn i [journalen](SESSION_LOG.md), Q-001. V-001 nedenfor
opsummerer intentionen; Q-002 undersøger en afgørende konsekvens.

## V-001 · Klubbens egen rejse i en levende multiplayerverden

**Status:** ejerudtrykt produktvision 10/9, ikke samlet GDD- eller build-godkendelse.

Ejerens intention: unik klubidentitet gennem ungdom, resultater eller nationalitet;
ægte managerfølelse og meningsfulde valg; enkel UI med stor spildybde; realisme
kun når den gavner spillet; bærende træning, akademi, ungdom, transfers og auktioner;
hyppig mærkbar fremgang mod egne mål; glæde uden konstant sejr; en verden som
udvikler sig offline og formes af summen af spillernes handlinger.

**Designerens fortolkning:** ejerskab over en klubhistorie i en fælles verden.
**Designprøve, ikke konstateret fejl:** Hvis kun løbssejre giver synlig anerkendelse
og meningsfuld fremgang, kan belønningssystemet undergrave de øvrige klubidentiteter.
Faktisk dækning af anerkendelse og økonomisk bæredygtighed er endnu ikke undersøgt.

Kilder: ejerens Q-001-svar; eksisterende Living World-doktrin (Identity, Youth,
History and recognition). Q-002 afklarer om talentudvikling kan være et slutmål.

## Q-002 · Talentfabrikken som selvstændig succesvej

**Status:** besvaret 10/9; A valgt. Retningen er D-001; ingen konkret mekanik besluttet.

**Situation:** En anerkendt talentfabrik udvikler ryttere og sælger dem til andre
hold. Klubben er sund og dens ryttere præger cykelverdenen, men den vinder sjældent
selv store løb. Er dette en fuldgyldig langsigtet succes eller primært en vej til
senere selv at vinde?

**A, anbefalet:** Talentfabrikken kan være slutmålet. Gør forskellige identiteter
reelle; kræver synligt bidrag og meningsfulde mål uden ens sportslige resultater.
**B:** Sportslige sejre er slutmålet; talentfabrikken er en vej dertil. Samler
progressionen om sportslig konkurrence, men begrænser hvilke identiteter der kan
være tilfredsstillende på lang sigt.

Berørte regelkilder til efterfølgende undersøgelse: YOUTH_RULES, ECONOMY_RULES,
BOARD_RULES, SPONSOR_RULES og SOCIAL_RULES. Et valg af A godkender ikke nye
tilskud, ranglister, bonusser eller tekniske løsninger; de skal designes særskilt.

## D-001 · Flere selvstændige veje til succes

**Status:** ejer-godkendt designretning, 10/9 2026, svar på Q-002.
**Ejerens valg, ordret:** "Selvstændig succes: talentfabrikken kan være slutmålet (anbefalet)".

En klub der udvikler ryttere til andre hold kan være en langsigtet succes uden
selv at blive en hyppig vinder af store løb. Talentudvikling er ikke kun en
midlertidig vej til sportslig dominans.

**Begrundelse:** V-001 lover egne klubidentiteter, momentum mod egne mål og glæde
uden konstant sejr. D-001 præciserer at mindst denne alternative rejse er legitim.
**Fravalgt:** sportslige sejre som nødvendigt slutmål for alle klubber.
**Ikke besluttet:** hvordan talentfabrikkens bidrag synliggøres, belønnes eller
måles; andre identiteters præcise succesvilkår; balancekrav eller nye pengestrømme.

**Designerens accepterede arbejdsopgave:** undersøg historik, omdømme, marked,
bestyrelse og økonomi samlet. En vej behøver ikke samme sejrschancer for at være
meningsfuld. Den må heller ikke automatisk udløse kompensation for manglende sejre.
**Foreslået verifikation:** følg en talentfabrik gennem flere sæsoner, inkl. salg
af sine bedste ryttere; undersøg bæredygtighed, synlig fremgang og bestyrelsens
reaktioner. Endelige succeskriterier skal aftales før implementation.

Kilder: V-001, Q-002; Living World-doktrinens Youth/History; berørte SSOT'er:
YOUTH_RULES, ECONOMY_RULES, BOARD_RULES, SPONSOR_RULES, SOCIAL_RULES.
Ingen af deres konkrete regler er ændret i dette checkpoint. Integration af
eventuelle regelændringer sker med det godkendte systemdesign, ikke ved antagelse.

## Q-003 · Erklæret klubidentitet og optjent omdømme

**Status:** besvaret 10/9; A+C med hovedvægt på A, se D-002.
**Grundlag, kodekontrolleret:** `backend/lib/boardClubDna.js`, `DNA_KEYS` og
`BOARD_CLUB_DNA`, ved `3759ab2e639ffcb3f4888e105338a97aad63484e`. Fem navngivne
pakker kombinerer bl.a. geografisk og sportslig profil. `boardMembers.js` håndterer
DNA-valg; BOARD_RULES og Mandat-spec'en beskriver DNA's rolle i mål og bestyrelse.
Kaldsteder kontrolleret: `boardMembers.js:79` anvender DNA ved medlemsmatch;
`boardGoals.js:606` bygger tradition-mål for den flerårige plan ud fra DNA.

**Designerens kritik:** færdige kombinationer er forståelige, men kan begrænse
identiteter såsom en colombiansk sprinterfabrik eller et dansk Grand Tour-hold.
Det er en designvurdering, ikke en observeret spillerklage eller målt brugsbarriere.

**A, anbefalet:** manageren kombinerer ambitioner frit; omdømme optjenes gennem
handlinger over tid. Kræver forståelige kombinationer og adskillelse af erklæret
retning fra faktisk historie; et fokusvalg omskriver ikke fortiden.
**B:** færdige klubidentiteter med tydelige forventninger og mulighed for retningsskift.
**C:** identitet opstår kun af handlinger; ingen erklæret profil vælges.

Regelkilder: [BOARD_RULES](../../BOARD_RULES.md),
[Mandat-spec](../../superpowers/specs/2026-08-07-board-mandate-rework-design.md) §2-3,
Living World-doktrinens Club development. Retningen ændres ved D-002; konkret
ny DNA-mekanik er ikke designet eller godkendt til build.

## D-002 · Friere ambitioner med identitet gennem handlinger

**Status:** ejer-valgt retning 10/9, Q-003: blanding af A og C, hovedvægt på A.
**Ejerens ord:** "Dit punkt 1, skal fylde mest i identiten fremadrettet."
Hele svaret, inklusive ønsket om bestyrelsesafklaring, står i journalen.

Manageren skal primært kunne kombinere klubbens ambitioner frit. Handlingerne
skal også forme identiteten og omdømmet. Der er ikke valgt præcise akser, vægte,
en profil-editor, skiftefrister, nye bonusser eller en migrationsmodel.

**Begrundelse:** V-001 lover klubben sin egen rejse; D-001 giver talentfabrikken
legitimitet som slutmål. Faste kombinationer af nationalitet og sportslig filosofi
er ikke tilstrækkelige som eneste fremtidige identitetsmodel.
**Fravalgt som eneste model:** identitet begrænset til færdige DNA-pakker;
identitet alene udledt af handlinger uden managerens erklærede ambitioner.

**Vigtig afklaring:** Det igangværende Mandat-rework bevarer eksisterende DNA-valg,
og den nye Boardroom har det faktisk implementeret. D-002 er derfor en ny retning
for videre design, ikke en beskrivelse af hvad reworket allerede leverer.
SSOT: BOARD_RULES, især det nye overblik fra 10/9; kode: BoardroomPage.jsx og
boardClubDna.js. Dokumentation skal afstemmes før et konkret redesign bygges.

**Foreslået designprøve:** En colombiansk sprinterfabrik og et dansk Grand Tour-hold
skal kunne udtrykke deres ambition og få forståelige forventninger. En ny ambition
må ikke i sig selv tælle som bevis på opnået omdømme. Præcise kriterier afventer.

## Q-004 · Bestyrelsens mandat over managerens retning

**Status:** besvaret 10/9; A valgt, se D-003.

**A, anbefalet:** Bestyrelsen udfordrer planens kvalitet og kræver troværdig fremgang
inden for managerens valgte klubidentitet. En talentfabrik kan kritiseres for dårlig
talentudvikling uden automatisk at blive presset til at blive et titelhold.
**B:** Bestyrelsen har egen klubvision og kan kræve, at manageren skifter retning,
med økonomiske konsekvenser ved uenighed.

**Tradeoff:** A prioriterer V-001's ejerskab over klubhistorien; B giver mere
institutionel modstand i managerrollen. Begge kræver reelle, forståelige krav og
respekterer den eksisterende regel om ingen fyring. Graden af modstand er ikke
afgjort alene ved D-002. SSOT-kilder: BOARD_RULES §1, §4-6 og Mandat-spec'en.

## D-003 · Bestyrelsen udfordrer planen inden for managerens retning

**Status:** ejer-godkendt designretning 10/9, svar på Q-004.
**Ejerens svar, ordret:** "Bestyrelsen udfordrer planen inden for managerens valgte retning (anbefalet)".

Bestyrelsen må kræve kvalitet, ansvarlighed og troværdig fremgang inden for den
klubidentitet manageren har valgt. Den skal ikke automatisk omdefinere en
talentfabrik til et titelhold. Retningen er afstemt i BOARD_RULES §0.4.

**Begrundelse:** sammenhæng mellem V-001's handlefrihed, D-001's alternative succes
og D-002's managerstyrede ambitioner. **Fravalgt:** selvstændig bestyrelsesvision som
kan kræve en anden klubretning end managerens. **Åbent:** præcis måldannelse,
sværhedsgrad, frister, konsekvenser og genforhandling; meningsfuld modstand består.

**Designhypotese til undersøgelse:** En talentfabriks salg af veludviklede ryttere
skal ikke automatisk få talentarbejdet til at se mislykket ud. Målingen skal
undersøges før dette bliver et bugfund. `boardGoalContext.js` og `boardGoals.js`
er identificerede indgange; endnu ingen gennemført salgsscenarie-test.

## Q-005 / D-004 · Konkurrencedygtighed med få ugentlige besøg

**Status:** ejer-godkendt 10/9.
**Spørgsmål:** Fastholdes doktrinens konkurrencedygtige kadence på 2-3 besøg om
ugen, eller må daglige beslutninger være nødvendige? Konkurrencedygtighed gælder
klubbens valgte niveau og vej; den lover ikke sejr over dygtigere managers.
**Ejerens svar, ordret:** "2-3 besøg om ugen skal kunne bære en konkurrencedygtig klub (anbefalet)".

God planlægning skal kunne bære klubben. Hyppigere besøg kan give mere indblik og
muligheder; den præcise tilladte fordel ved meraktivitet er endnu ikke afklaret.
**Fravalgt:** nødvendige daglige beslutninger som grundkrav for konkurrencedygtighed.
**Ikke vedtaget:** bestemt sessionslængde, permanent automatisk optimering, nye
auktionsfrister eller ens udfald for spillere med forskellig dygtighed.

Kilder: Living World-doktrinens Product Identity; TRAINING_RULES §13 (fjernelse
af klikbonus allerede ejer-besluttet 6/9); ASSISTANT_RULES (eksisterende assistance).
**Foreslået verifikation:** en konkret uge med planlægning, overlap, træning,
marked, kontrakter og bestyrelsesfrister; registrér hvilke valg der faktisk kræver
fremmøde. D-004 er en tværgående aftale, ikke en påstand om at spillet opfylder den.

## Q-006 · Den primære målspillers forkundskaber

**Status:** besvaret 10/9; A og B kombineres, se D-005.
**A, anbefalet:** cykelinteresserede, også uden erfaring med managerspil.
**B:** erfarne managerspillere, som gerne vil lære cykelsporten.
**C:** erfarne cykelmanagers, der allerede kender begge dele.

**Hvorfor det betyder noget:** afgør hvilke begreber vi må forudsætte, hvor
forklaringerne starter, og hvor hurtigt kompleksitet introduceres. A anbefales
ud fra V-001's cykeltroværdighed, enkel UI og dybde der kan læres. Der er ikke
foretaget en markedsmåling eller valgt en eksklusiv demografisk målgruppe.

## D-005 · To indgange; nemt at komme ind i, svært at mestre

**Status:** ejer-valgt designretning 10/9, svar på Q-006.
**Ejerens svar, ordret:** "1 og 2 kombineret. Vil rigtigt gerne have begge grupper ind i spillet. Jeg tror jeg går efter \"nemt at komme ind i, svært at mestre\" sværhedsgraden. Spillet må gerne tilbyde dybde, men først skal det være rigtigt nemt at betjene alle spillets kernefunktioner."

Cykelinteresserede uden managererfaring og managerspillere, der skal lære cykelsporten,
er begge ønskede indgange. Ingen intern rangordning er valgt. Ejerens prioritet er,
at kernefunktionerne er nemme at betjene, samtidig med at spillet tilbyder dybde.
**Afvigelse fra anbefalingen:** Codex anbefalede A som primær; ejeren ønsker A+B.
Det bevares som et reelt valg, ikke som accept af den oprindelige anbefaling.

**Designerens fortolkning:** Sværhedsgrad bør ligge i prioriteringer og konsekvenser,
mens betjening og nødvendige begreber skal være tilgængelige. **Designrisiko:**
To forskellige sæt forkundskaber kræver, at læringsforløbet prøves på begge grupper.
Denne risiko er en vurdering; ingen brugerundersøgelse er udført i sessionen.

**Foreslået designprøve:** En ny spiller fra hver indgang gennemfører udtagelse,
træningsvalg og en transferhandling og forklarer formålet og den vigtigste
konsekvens med egne ord. Testopgaver, hjælp, succeskrav og tidsmål afventer design.
**Åbent:** progressiv introduktion, standardvalg, forklaringsniveau og assistance.
Ingen separat sværhedsgrad, UI-ændring eller nyt onboardingflow er godkendt.
Kilder: V-001, D-004, Living World-doktrinen og [TASTE](../TASTE.md) P1/P5/P9.

## Q-007 · Nødvendig tid pr. besøg

**Status:** besvaret 10/9; A valgt, se D-006.
Ved normal klubdrift: hvor lang tid må hvert af de 2-3 nødvendige ugentlige besøg
kræve? Frivillig fordybelse i ryttere, løb og marked ligger uden for tidsbudgettet.
**A, anbefalet:** cirka 15-20 minutter til overblik, vigtigste valg og klargøring.
**B:** cirka 30-45 minutter; flere individuelle valg må være nødvendige.
**C:** cirka 5-10 minutter; næsten al rutinedrift skal kunne planlægges eller delegeres.

**Tradeoff:** Det korte tidsbudget kræver samlet rutinearbejde og gode overblik;
systemerne kan ikke samtidig kræve manuel gennemgang af hver rytter og hvert løb.
Alternativerne var forslag til oplevelsesmål, ikke målte sessionstider; A er nu valgt.
SSOT-kontekst: ASSISTANT_RULES §0-2 og D-004. Spørgsmålet ændrer ikke de eksisterende
grænser for assistentens handlinger på spillerens vegne.

## D-006 · Normal drift på cirka 15-20 minutter pr. besøg

**Status:** ejer-valgt 10/9, svar på Q-007.
**Ejerens svar, ordret:** "Cirka 15–20 minutter; ekstra fordybelse er frivillig (anbefalet)".

Sammen med D-004 giver det et oplevelsesmål for normal drift: 2-3 nødvendige besøg
om ugen, hvert på cirka 15-20 minutter til overblik, centrale valg og klargøring.
Målet er ikke et stopur for al spilglæde; frivillig fordybelse kan vare længere.
Første besøg, sæsonskifte og ekstraordinære hændelser er endnu ikke tidsfastsat.

**Konsekvens til design:** Rutinearbejdet skal kunne håndteres inden for budgettet.
Enkel betjening skal samtidig bevare meningsfulde valg (D-005). Der er ikke valgt
nye automatiseringer eller givet assistenten flere rettigheder.
**Fravalgt:** længere normaldrift med flere nødvendige individuelle valg samt et
meget kort besøg, der forudsætter næsten fuld planlægning/delegering af rutinen.
**Foreslået verifikation:** gennemspil en normal uge med tre besøg og registrér
nødvendige handlinger og tid, også når der opstår et almindeligt problem.
Kontrollér både den sportslige klub og talentfabrikken. Kilder: D-004/D-005,
ASSISTANT_RULES §0-2 og GDD's tværgående uge-scenarie. Ingen tidsmåling udført endnu.

## Q-008 · Ekstra tilstedeværelses fordel på markedet

**Status:** besvaret 10/9; A valgt, se D-007.
To lige dygtige managers har samme udgangspunkt; én besøger spillet tre gange om
ugen, den anden følger markedet flere gange dagligt.
**A, anbefalet:** Den aktive får flere chancer for gode handler; begge kan stadig
konkurrere på markedet, også som talentfabrik. Enkelte mistede ryttere accepteres,
men reelle alternativer skal jævnligt være tilgængelige.
**B:** En stor handelsfordel er rimelig; aktiv handel må kræve hyppigere besøg.
**C:** Næsten ingen fordel ved hyppighed; markedsadgang skal i høj grad kunne planlægges.

**Hvorfor:** D-001 og D-004 skal hænge sammen med markedets bærende rolle i V-001.
Autobud hjælper efter opdagelse af en auktion, men er ikke i sig selv adgang til
at opdage den. A accepterer ulige muligheder uden at gøre den langsommere kadence
til en praktisk udelukkelse fra handelsvejen. Ingen effektstørrelse er målt.
Dette er et principvalg, ikke en beslutning om auktionstider eller automatisk køb.
Kilde: TRANSFER_MARKET_RULES §2/§4; kodekontrol i E-002 nedenfor.

## D-007 · Flere markedschancer uden at udelukke den sjældnere gæst

**Status:** ejer-valgt 10/9, svar på Q-008.
**Ejerens svar, ordret:** "Flere chancer for gode handler, men begge kan konkurrere på markedet (anbefalet)".

Ekstra tilstedeværelse må give flere gode handelsmuligheder. En lige dygtig
manager med D-004's kadence skal fortsat kunne handle konkurrencedygtigt og
drive en talentfabrik. Begge skal ikke se eller vinde de samme auktioner.
**Accepteret tradeoff i A:** enkelte ryttere kan mistes under fravær; reelle
alternativer skal jævnligt være tilgængelige. **Fravalgt:** en stor handelsfordel,
som gør hyppig tilstedeværelse nødvendig for handelsvejen, og næsten fuld
udligning af fordelen ved hyppighed.

**Foreslået verifikation:** sammenlign relevante, økonomisk tilgængelige tilbud
ved de to besøgsmønstre over en repræsentativ periode, for flere klubbehov.
Vurdér samlet forsyning, pris og mulighed for at udføre klubbens plan; antal
sete auktioner alene er utilstrækkeligt. Effektgrænse og periode skal fastlægges.
Ingen ny auktionsvarighed eller købsautomatik er besluttet. TRANSFER_MARKET_RULES
har samme retning i sin GDD-note; #4714's eksisterende beslutningsforløb består.

## Q-009 · Er ungdomsudvikling valgfri for den enkelte klub?

**Status:** besvaret 10/9; A valgt og uddybet, se D-008. Interviewet pauser derefter.
En manager køber færdige ryttere og overlader næsten al ungdomsudvikling til andre.
**A, anbefalet:** en fuldgyldig langsigtet strategi med minimal egen ungdomsudvikling.
**B:** alle klubber skal have en mindre, men meningsfuld ungdomsindsats.
**C:** egen ungdomsudvikling skal være nødvendig for langsigtet succes.

**Begrundelse for A:** et dybt akademi kan være vigtigt for den fælles verden,
mens specialisering skaber kunder til talentfabrikkerne. Købeklubben må til gengæld
leve med markedets priser og udbud. **Tradeoff:** spilleren kan legitimt fravælge
en stor del af ungdomssystemet, som V-001 fremhæver. D-001 afgør ikke automatisk
det omvendte tilfælde. Kilder: V-001, D-001/D-002; YOUTH_RULES og TRANSFER_MARKET_RULES.
Spørgsmålet vælger retning, ikke nye priser, bonusser eller en akademi-lukkeknap.

## D-008 · Købeklubben er legitim; vid frihed til egen vej

**Status:** ejer-valgt 10/9, svar på Q-009.
**Designsvaret, ordret:** "1 - Ja jeg ønsker total valgfrihed hvor alle spillere kan spille for deres egen måde og finde deres egen vej i spillet. Jeg ønsker i meget store træk, at spillere kan gøre præcist som de ønsker i spillet."
Den samlede besked med pauseønsket er bevaret i SESSION_LOG.

En manager skal kunne købe færdige ryttere og næsten helt overlade ungdomsudvikling
til andre klubber som en fuldgyldig langsigtet strategi. Akademiet kan være dybt
og vigtigt for verdenen uden at være et nødvendigt individuelt succeskrav.
Ejeren gør friheden bredere end dette eksempel: spillerne skal i meget store
træk selv kunne finde deres vej. D-001 og D-008 etablerer begge retninger af
specialiseringen: udvikle til andre eller købe andres udviklede ryttere.

**Fravalgt:** et pålagt minimum af meningsfuld ungdomsindsats for alle klubber
eller egen ungdomsudvikling som nødvendig vej til langsigtet succes.
**Tradeoff forelagt i A:** et stort system kan vælges fra; købeklubben må leve
med markedets priser og udbud. Ingen særskilt kompensation er vedtaget.
**Åbent til kritisk design:** hvor friheden møder ressourcer, irreversible valg,
specialisering og fælles konkurrence. "Total valgfrihed" er ejerens formulering;
der er ikke dermed besluttet at fjerne konkrete økonomiske eller strukturelle regler.

**Foreslået verifikation:** gennemspil en talentfabrik, en købeklub og en blandet
klub over et karriere-/sæsonforløb. Find tvungne sideaktiviteter, mål der
misforstår ambitionen, og eventuelle strategier som dominerer uden reel ulempe.
Perioder og godkendte succeskriterier fastlægges under systemgennemgangen.
Kilder: V-001, D-001/D-002/D-003/D-007; [YOUTH_RULES](../../YOUTH_RULES.md),
BOARD_RULES og TRANSFER_MARKET_RULES. Ungdommens SSOT har samme principnote.

## Q-010 · Hvor kommer modstanden ved kursskifte fra?

**Status:** besvaret ved genoptagelsen 10/9; A valgt, se D-009.
En talentfabrik vil midt i sæsonen begynde at bygge et hold til store løbssejre.
**A, anbefalet:** fri omlægning; eksisterende trup, kontrakter, investeringer,
omdømme og aftalte forpligtelser gør, at den nye retning tager tid at realisere.
**B:** også en særskilt skiftepris eller ventetid for at gøre identiteten bindende.
**C:** let omlægning; spillet hjælper aktivt med at omstille klubbens ressourcer.

**Designspænding:** D-008's frihed skal kunne rumme læring og ændrede ambitioner,
mens V-001's meningsfulde valg skal have vedvarende konsekvenser. Hvis styrker
omfordeles straks ved et profilvalg, risikerer identitet at blive overfladisk;
ekstra skiftehindringer kan omvendt gøre afprøvning unødigt dyr. Det er en
designervurdering, ikke en måling af spilleradfærd. A lader valgte investeringer
skabe omstillingen uden automatisk at slette forpligtelser.

**Kilder:** D-002/D-003/D-008; BOARD_RULES §0; `boardMembers.js::chooseDnaForTeamCore`
(E-003). Det eksisterende rework bevarer DNA-valget. Spørgsmålet er et principvalg
for den fremtidige friere identitet; ingen eksisterende gate er ændret.

## D-009 · Fri omlægning med konsekvenser af eksisterende valg

**Status:** ejer-valgt 10/9, svar på Q-010.
**Ejerens svar, ordret:** "Fri omlægning; eksisterende investeringer og forpligtelser giver modstanden (anbefalet)".

Manageren må frit begynde at ændre klubbens retning. Trup, kontrakter,
investeringer og optjent omdømme giver vedvarende konsekvenser, så en ny retning
tager tid at realisere. Erklæringen sletter ikke aftalte forpligtelser og giver
ikke straks en ny klubs styrker. **Fravalgt:** en særskilt skiftepris/ventetid
alene for at gøre identiteten bindende, samt aktiv hjælp til at omstille ressourcer
som den grundlæggende model for kursskifte.

**Begrundelse:** kombinerer D-008's frihed med V-001's meningsfulde valg.
**Åbent:** hvordan konkrete mandater genforhandles, omdømme ændres og eksisterende
DNA migreres. Det er ikke tilladelse til at slette genvalgsgaten nu eller gøre
enhver kontrakt/forpligtelse uopsigelig. SSOT: BOARD_RULES §0.4, afstemt her.
**Foreslået verifikation:** en talentfabrik begynder midt i sæsonen et titelprojekt;
den kan handle på retningen, bærer sine forpligtelser og beholder sin historie,
mens nye mål bliver forståelige. Test også gentagne erklæringer for mål-nulstilling.

## Q-011 · Hvor sikkert er et talentprojekt?

**Status:** besvaret 10/9; A valgt, se D-010.
En lovende ung rytter udvikles fornuftigt over flere sæsoner og bliver en god
hjælper, men aldrig den håbede stjerne.
**A, anbefalet:** almindeligt acceptabelt udfald; god management forbedrer en
karriere uden nødvendigvis at indfri stjernedrømmen. Kræver troværdige tegn
undervejs og brugbare muligheder, så indsatsen ikke opleves som spildt på en
skjult, uforanderlig dom.
**B:** kun sjældent; et velvalgt talent bør blive stjerne med god management.
**C:** udfaldet skal næsten helt afgøres af managerens udviklingsvalg.

**Tradeoff:** større udfaldsusikkerhed giver vurdering og behold/sælg-valg vægt,
men kan undergrave V-001's løfte om momentum, hvis spilleren ikke kan forstå
eller bruge udviklingen. Det er et spørgsmål om talentprojektets sikkerhed,
ikke forslag om skjulte stop, mere vilkårlig tilfældighed eller uærlige data.
Kilder læst: PROGRESSION_RULES §0-10, TRAINING_RULES §12-13; ejerbeslutningen
6/9 om ærlig score for egen manager genåbnes ikke. Potentiale er udviklingsfart,
ikke det tidligere direkte potentialeloft. Sammenhængen mellem talenter,
individuelle forskelle, udviklingsvalg og karriere skal undersøges videre.

## D-010 · En god karriere kan lykkes uden stjernestatus

**Status:** ejer-valgt 10/9, svar på Q-011.
**Ejerens svar, ordret:** "Ja; en god karriere kan lykkes, selv om stjernedrømmen ikke gør (anbefalet)".

Det er almindeligt acceptabelt, at en lovende ung rytter efter flere sæsoners
fornuftig udvikling bliver en god hjælper frem for den håbede stjerne. God
management skal forbedre karrieren, men behøver ikke indfri stjernedrømmen.
Troværdige udviklingstegn og brugbare muligheder undervejs er en del af A's
forelagte tradeoff. **Fravalgt:** næsten sikker stjernestatus for velvalgte
talenter under god management og udfald næsten helt bestemt af managerens valg.

**Åbent:** hvor forskellene og usikkerheden kommer fra, og hvordan hjælperens
bidrag og karriere mærkes. Ingen ny tilfældighed, skjult dom, loft eller rate
er valgt. Potentiale som udviklingsfart og den ærlige score genåbnes ikke.
**Designerens kritik til videre prøve:** en hjælperkarriere må have oplevet og
praktisk værdi, hvis udfaldet skal være andet end en pæn beskrivelse af fiasko.
**Foreslået verifikation:** følg projektet gennem udviklingssignaler, løbsbidrag,
behold/sælg-valg og historik; undersøg om manageren kan begrunde karrierens værdi.
Kilder: V-001, D-001, PROGRESSION_RULES (principnote afstemt), TRAINING_RULES §13.

## Q-012 · Stoltheden ved den hjemmeudviklede hjælper

**Status:** ejerønske modtaget 10/9, se R-001; intet konkret karriereøjeblik valgt.
En hjemmeudviklet hjælper har kørt fem sæsoner, vinder sjældent og kan måske
erstattes af en lidt stærkere rytter. Hvilket konkret øjeblik gør manageren stolt
af at have udviklet ham og opleve ham som vigtig for klubbens historie?
**Anbefaling:** forankr stoltheden i faktiske bidrag og spillerens relation til
rytteren. Spørgsmålet vælger ikke en bonus for loyalitet eller en bestemt UI-flade.
**Hvorfor frit svar:** Vi har valgt strategiske principper; nu behøves ejerens
konkrete ønskede oplevelse for at designe synlig værdi og tilknytning.
Kilder læst: RACE_ENGINE_RULES §0-1b, §2e og §9; D-010. E-004 afgrænser kodebevis.

## R-001 · Følg ryttere "af egen avl"

**Status:** ejerudtrykt ønske 10/9, svar på Q-012; konkret design afventer.
**Ejerens svar, ordret:** "Jeg vil gerne have nogle fede måder i spillet at kunne følge ryttere \"af egen avl\", som i football manager. Kan du stille flere konkrete spørgsmål angående dette, og give nogle anbefalinger med, så er det nemmere at svare på?".

Ejeren peger på muligheden for at følge egne udviklede ryttere og beder om
konkrete anbefalede valg. Det er ikke en godkendelse af en bestemt trackingflade,
notifikationsstrøm, statistik eller økonomisk belønning. Football Manager er
ejerens reference; ingen specifik funktion derfra er undersøgt eller kopieret.
**Arbejdsform:** konkrete beslutningskort, ét ad gangen. Først målgruppen af
ryttere (Q-013), derefter følgeflade og betydningsfulde begivenheder. Det frie
spørgsmål om et stolt øjeblik stilles ikke igen i samme form.
Kilder: V-001, D-001/D-010, YOUTH_RULES §1/§4 og E-005.

## Q-013 · Hvilke udviklede ryttere følges automatisk?

**Status:** besvaret 10/9; A valgt, se D-011.
**A, anbefalet:** både ryttere fra eget akademi og unge købt og udviklet en
væsentlig del af karrieren hos klubben; tydelig forskel mellem "fra vores
akademi" og "udviklet hos os". En købt 17-årig udviklet gennem fem sæsoner er
et eksempel, ikke et vedtaget adgangskrav.
**B:** kun eget akademi kommer automatisk med.
**C:** ingen automatisk liste; manageren vælger selv sine særlige ryttere.

**Begrundelse:** D-001's talentfabrik kan skabe værdi på flere måder. A anerkender
udviklingsarbejde uden at overtage en anden klubs akademioprindelse. Det kræver
efterfølgende en tydelig definition af bidraget og behandling af flere klubber,
gentagne handler og historiske data. Alder, varighed og præcise mærker er åbne.
Dette spørgsmål afgør automatisk afgrænsning; manuel supplering, favoritter,
offentlig visning og notifikationer er endnu ikke afgjort.

## D-011 · Akademioprindelse og udviklingsklub følges særskilt

**Status:** ejer-valgt 10/9, svar på Q-013.
**Ejerens svar, ordret:** "Eget akademi og unge udviklet hos os, med tydelig forskel (anbefalet)".

Den automatiske kreds af ryttere, som klubben kan følge videre efter salg, skal
omfatte eget akademi samt unge, som klubben har købt og udviklet en væsentlig
del af karrieren. "Fra vores akademi" og "udviklet hos os" adskilles tydeligt.
**Begrundelse:** anerkend faktisk klubhistorie og talentfabrikkens arbejde uden
at tilskrive akademioprindelsen til en senere køber. **Fravalgt:** kun eget
akademi automatisk og en rent manuelt udvalgt kreds som eneste model.

**Åbent:** alders-/opholdskriterier, flere udviklingsklubber, manuel supplering,
offentlig visning, privat information efter salg, liste/nyheder og notifikationer.
Ingen konkret mærkeplacering eller bonus valgt. Kilder: R-001, D-001/D-010,
YOUTH_RULES (principnote afstemt) og E-005. **Foreslået verifikation:** følg både
egen kandidat og indkøbt ung rytter gennem salg; begge historier bevares, og
deres forskellige ophav fremgår uden udokumenterede tilskrivninger.

## Q-014 · Kriteriet for "udviklet hos os"

**Status:** besvaret 10/9; A valgt med ejerændring fra to til tre sæsoner, se D-012.
**A, anbefalet:** mindst to sæsoners samlet ungdomstid hos klubben, frem til og
med U23-perioden. Eksempel: købt som 17-årig og hos klubben frem til 19.
**B:** mindst én sæsons ungdomstid; tilknytningen skal opstå hurtigere.
**C:** faktisk evnefremgang afgør mærket i stedet for opholdstid.

**Tradeoff:** opholdstid er forståelig og favoriserer ikke hurtige talenter over
langsomme hjælpere, men beviser ikke i sig selv godt trænerarbejde. En vækstregel
kan tilskrive mere af den målte udvikling, men påvirkes af talentets medfødte fart
og bliver vanskeligere at gennemskue. Antal sæsoner er et åbent forslag, ikke en
låst balancekonstant. U23's aldersbegreb følger YOUTH_RULES §1 (sæsonalder).
Ved valg af tidsregel skal målingen præciseres: delvise sæsoner, flere ophold,
aldersgrænse og om alder eller truptilhørsforhold tæller. Ingen data-backfill valgt.

## D-012 · Tre sæsoners samlet ungdomstid giver udviklingstilknytning

**Status:** ejer-valgt 10/9, svar på Q-014.
**Ejerens svar, ordret:** "1 - Det skal være 3 sæsoner i stedet for 2 sæsoner.".

"Udviklet hos os" bygger på mindst **tre sæsoners samlet ungdomstid hos klubben**,
frem til og med rytterens U23-periode. Ejeren vælger A's opholdstidsmodel og ændrer
forslagets to sæsoner til tre. Den oprindelige 17-til-19-års illustration er derfor
ikke længere et kvalificerende eksempel; under samme antagelse ville 17 til 20
opfylde tre sæsoner. **Fravalgt:** én sæson, to sæsoner og evnefremgang som kriterium.

**Forelagt tradeoff:** forståelig tilknytning, også for langsomme talenter/hjælpere,
men ophold er ikke bevis for godt trænerarbejde. Mærket må ikke beskrives som en
objektiv rangering af uddannelseskvalitet. **Åbent:** delvise sæsoners måling,
aldersgrænsens skæringspunkt, truptilhørsforhold kontra alder, flere ophold og
historisk datadækning. En optælling af passerede sæsonskifter er ikke i sig selv
afklaret som tilsvarende tre sæsoners faktisk ophold.
Kilder: D-011, YOUTH_RULES §1 (U23/sæsonalder) og topnote afstemt her.
**Foreslået verifikation:** tre fulde sæsoners ungdomsophold kvalificerer;
kort gennemhandel gør ikke; langsom vækst alene må ikke diskvalificere.

## Q-015 · Offentlig eller privat udviklingshistorik?

**Status:** besvaret 10/9; A valgt, se D-013.
**A, anbefalet:** offentlig sektion på klubprofilen og eget praktisk overblik
til manageren. Eksempelindhold: akademi/udviklingsklub adskilt, navn, nuværende
klub og udvalgte karrierebedrifter, med link til rytterprofil.
**B:** kun privat personlig historik.
**C:** manageren vælger offentlig eller privat udviklingshistorik.

**Begrundelse:** D-001's talentfabrik kan få synlig multiplayeridentitet gennem
ryttere, som siden vinder for andre hold. Dette afgør synlighed, ikke præcise
kolonner, rangliste, belønninger eller notifikationskadence. Andre klubbers private
træningsoplysninger er ikke del af forslaget (TRAINING_RULES §13).
Kilder: V-001, R-001, D-011/D-012 og YOUTH_RULES.

## D-013 · Offentlig klubhistorik og eget manageroverblik

**Status:** ejer-valgt 10/9, svar på Q-015.
**Ejerens svar, ordret:** "Ja; offentlig klubhistorik og et eget overblik til manageren (anbefalet)".

Udviklingshistorikken skal være offentlig på klubprofilen; manageren får
desuden eget praktisk overblik. Det gør talentfabrikkens bidrag synligt for andre
managers og støtter V-001's multiplayeridentitet. Akademi og udvikling hos klubben
vises adskilt. **Fravalgt:** udelukkende privat historik og valgfri offentlighed
som grundmodel. Private træningsoplysninger fra andre klubber er ikke inkluderet.
**Åbent:** præcise kolonner/milepæle, layout, sortering, personlige favoritter,
opfølgningsform og notifikationer. Navn/nuværende klub/bedrifter var et illustreret
forslag; beslutningen her låser synlighed og de to formål, ikke en færdig skærm.
Kilder: R-001/D-011/D-012; SOCIAL_RULES (principnote afstemt), YOUTH_RULES,
TRAINING_RULES §13. **Foreslået verifikation:** en besøgende forstår klubbens
bidrag, mens manageren kan følge videre; adgangen afslører ikke fremmed træning.

## Q-016 · Opfølgning siden sidste besøg

**Status:** besvaret 10/9 efter genvisning; A valgt, se D-014.
**A, anbefalet:** én samlet "Siden sidst" med udvalgte milepæle og mulighed for
at åbne rytteren. Første sejr, stort karriereresultat, klubskifte og pension er
eksempler; en præcis milepælsliste vælges senere.
**B:** løbende strøm med alle løbsresultater og klubskifter.
**C:** kun rytterlisten; manageren åbner selv dem, der skal undersøges.

**Tradeoff:** udvalgte hændelser gør historikken overskuelig med mange tidligere
ryttere og D-004's besøgskadence; de kræver kriterier for, hvad der er væsentligt.
Alle hændelser giver detalje, men kan skjule de vigtige historier. Spørgsmålet
handler om eget overblik, ikke om push-, mail- eller Discord-beskeder.
Kilder: D-004/D-006/D-013, SOCIAL_RULES §0/§6 og Living World-doktrinens returflade.

## D-014 · Samlet "Siden sidst" med udvalgte milepæle

**Status:** ejer-valgt 10/9, svar på Q-016.
**Ejerens svar, ordret:** "Samlet »Siden sidst« med udvalgte milepæle (anbefalet)".

Managerens eget overblik skal samle væsentlige hændelser for tidligere udviklede
ryttere siden sidste besøg, med adgang til den enkelte rytters detaljer.
**Fravalgt som grundmodel:** strøm med alle resultater og klubskifter; ren
rytterliste uden opsummering. **Åbent:** konkret milepælsliste, prioritering,
længde, hvad "sidste besøg" betyder, og eventuelle personlige valg.
Første sejr, store resultater, klubskifte og pension var eksempler, ikke en
endeligt godkendt hændelsesliste. Ingen mail-/Discord-/push-kadence er valgt.
Kilder: D-004/D-006/D-013, SOCIAL_RULES (principnote afstemt).
**Foreslået verifikation:** overblikket skal være nyttigt efter flere dages fravær
og efter mange sæsoners udviklingsarbejde uden at væsentlige historier drukner.

## Q-017 · Flere udviklingsklubber for samme rytter

**Status:** besvaret 10/9; A valgt, se D-015.
Eksempel: klub A fra 16 til 19 år, klub B fra 19 til 22. Begge opfylder tre
sæsoners ungdomstid; spørgsmålet forudsætter kvalificerende ophold, ikke en ny
opgørelsesregel for delvise sæsoner.
**A, anbefalet:** begge vises som udviklingsklubber med opholdsperioder og følger
rytteren automatisk. Akademioprindelsen bliver hos den oprindelige akademiklub.
**B:** kun klubben med længst ungdomsophold får tilknytningen.
**C:** kun første klub, der kvalificerer, får tilknytningen.
**Tradeoff:** A anerkender flere bidrag uden at udpege én som vigtigst; den
kræver tydelig visning, så oprindelse og flere udviklingsophold ikke forveksles.
Kilder: D-011/D-012, YOUTH_RULES og E-005. Ingen fordeling af penge eller point foreslået.

## D-015 · Flere udviklingsklubber med synlige ophold

**Status:** ejer-valgt 10/9, svar på Q-017.
**Ejerens svar, ordret:** "Ja; begge udviklingsklubber vises med opholdsperioder (anbefalet)".

Alle klubber, der opfylder D-012's kriterium, kan få udviklingstilknytningen
og følge rytteren automatisk. Opholdsperioder vises, og akademioprindelsen
bliver hos den oprindelige akademiklub. **Fravalgt:** tilknytning kun til
længste ungdomsophold eller kun til første kvalificerende klub.
**Begrundelse:** anerkend flere bidrag uden at rangere uddannelsens ejerskab.
**Åbent:** delvise/gentagne ophold og historisk bevis som i D-012; ingen
penge-, point- eller bonusfordeling er valgt. Kilder: D-011/D-012 og YOUTH_RULES,
opdateret her. **Foreslået verifikation:** A og B kvalificerer i eksemplet,
en tredje kortvarig køber gør ikke, og kun faktisk akademioprindelse vises.

## Q-018 · Personligt gennembrud eller sportslig prestige?

**Status:** besvaret 10/9; A valgt, se D-016.
En hjemmeudviklet hjælper tager sin første sejr i et mindre løb; en tidligere
akademistjerne vinder endnu en almindelig WorldTour-etape.
**A, anbefalet:** hjælperens personlige gennembrud først i dette eksempel;
helt store bedrifter som en Tour-sejr kan stadig få særlig prioritet.
**B:** primært sportslig prestige; WorldTour-sejren først.
**C:** ingen prioritering, kronologisk visning.
**Tradeoff:** A gør almindelige karrierer værd at følge og støtter D-010,
men kræver en forståelig skelnen mellem personligt gennembrud og rutineresultat.
Det er ikke forslag om en generel rangering af alle mindre løb over større.
Kilder: D-010/D-014, SOCIAL_RULES' historikprincip og R-001.

## D-016 · Personlige gennembrud har høj fortællingsværdi

**Status:** ejer-valgt 10/9, svar på Q-018.
**Ejerens svar, ordret:** "Personlige gennembrud først i dette eksempel (anbefalet)".
Hjælperens første sejr i et mindre løb står som udgangspunkt over den tidligere
akademistjernes endnu en almindelig WorldTour-etape. Store hovedbedrifter kan
fortsat få særlig prioritet. **Fravalgt:** prestige som primært kriterium i
eksemplet og ren kronologisk visning uden prioritering.
**Åbent:** en fuld prioriteringsregel, lighedstilfælde og hvilke personlige
gennembrud der kan dokumenteres. Ingen universel regel om at alle første-gange
slår alle store sejre. Kilder: D-010/D-014, SOCIAL_RULES (afstemt).
**Foreslået verifikation:** det forelagte par rangeres som valgt; kontrollér
også et stort hovedresultat, så almindelige førstegange ikke skjuler det.

## Q-019 / D-017 · Manuel karriereopfølgning uden udviklingsmærke

**Status:** ejer-valgt 10/9.
**Spørgsmål:** En veteran solgt efter én sæson er ikke "udviklet hos os". Kan
manageren alligevel vælge "Følg karrieren" og få milepælene i eget overblik?
**A, anbefalet:** ja, manuel opfølgning ved siden af den automatiske.
**B:** nej, overblikket er kun for akademi-/udviklede ryttere.
**Ejerens svar, ordret:** "Ja; manuel »Følg karrieren« ved siden af automatisk opfølgning (anbefalet)".

Personlige favoritter kan følges uden at opfylde D-012. At følge giver ikke
klubben et offentligt akademi-/udviklingsmærke og åbner ikke fremmed privat
træning. **Fravalgt:** kun automatisk kvalificerede ryttere i eget overblik.
**Åbent:** afmelding/muting, om andre end egne tidligere ryttere kan vælges,
lofter og placering af handlingen. Kilder: D-011–014 og SOCIAL_RULES (afstemt).
**Foreslået verifikation:** veteranen kan følges; hans milepæle kommer med;
klubbens offentlige udviklingshistorik får ikke en ufortjent tilskrivning.

## Q-020 · Kan målrettet træning slå passende løb på udvikling?

**Status:** ejeren har svaret med afklaringsspørgsmål om det igangværende rework.
Ingen A/B-beslutning modtaget. Efter kildekontrol genstillet i kortere form;
ejeren udvidede derefter emnet med forslag og researchønske R-002. Q-021 er
det næste beslutningskort. Q-020 har fortsat ikke et valgt A/B-udfald.
En frisk 19-årig klatrer kan køre et passende bjergløb eller blive hjemme til en
målrettet træningsblok. Skal blokken kunne være bedst for langsigtet evneudvikling?
**A, anbefalet:** ja; målrettede træningsperioder skal kunne være udviklingsvalget,
også når rytteren kunne klare løbet.
**B:** passende løb skal normalt udvikle bedst; træning supplerer løbsprogrammet.

**Eksplicit genåbnet tradeoff:** retningen fra 6/8 giver løb mere udvikling i
relevante evner. Anbefalingen udfordrer denne retning for at give talentmanageren
et reelt valg mellem udvikling og resultater. Løbets træthed/profil kan allerede
gøre træning nyttig; det er ikke målt at løb altid dominerer. A spørger om
træningens egen styrke, ikke kun om restitution eller mangel på passende løb.
Enten løb eller træning på en løbsdag, besluttet 6/9, fastholdes. Ingen ny rate
eller ændring af S4-leveranceplan valgt ved at stille spørgsmålet.
Kilder: TRAINING_RULES §6/§13, spec 6/8 og E-006.
**Ejerens afklaringsspørgsmål, ordret:** "Er du klar over, at vi er ved at forsøge at få ind i spillet, at løb kan give træning? Jeg har været ved at arbejde på at skabe et system, hvor man enten kan træne eller køre løb i løbet af en dag.".
Codex bekræftede kendskab, genlæste hele 6/9-designet og #4850 og præciserede:
begge aktiviteter giver udvikling; spørgsmålet handler kun om deres relative
udbytte. Dette må ikke registreres som en ny idé om løbsudvikling eller et valg af A.

## R-002 · Løbskategori, debuter og realistisk udviklingsdybde

**Status:** ejerens idéer og researchopgave 10/9, ikke balancegodkendelse.
**Ejerens svar, ordret:** "Det synes jeg er svært at sige. Måske jo bedre løbets kategori er, jo bedre udvikling skal det give - Derudover jo yngre en rytter er jo mere skal de få ud af \"debuter\" og første gange de kører store typer af løb. Kan du forslå hvad der vil være realistisk og virkelighedstro her? Måske kan du kigge på hvad football manager gør og forslå en måde det kan passe ind i vores spil? Tænk dig grundigt om og kom med gode forslag til dybde.".

"Måske" bevares som usikkerhed og undersøgelsesforslag. Ejeren ønsker begrundet
inspiration fra Football Manager og cykelvirkeligheden, før der vælges en model.
Resultatet står i [researchforslaget](TRAINING_RACE_DEVELOPMENT_RESEARCH.md):
officielle FM24-/FM26-kilder, original forskning og UCI-praksis, med kildebegrænsninger.
**Anbefalet til videre design:** fysisk stimulus og erfaring som forskellige
årsager til udvikling; passende udfordring; meningsfuld deltagelse; aftagende
læring ved nye situationer; ingen automatisk stor bonus blot for at stå på
startlisten i en høj kategori. Ingen nye erfaringstal er nødvendigvis påkrævet.
**Ikke besluttet:** kategori-/debutbonus, aldersvirkning, erfaringstyper, nye
stats, løbsrating som proxy, mentor-/selvtillidssystem, balance eller release-scope.

## Q-021 · Grundmodel efter researchen

**Status:** besvaret 10/9; A valgt, se D-018 (svarer til model B i researchrapporten).
**A, anbefalet:** passende udfordring og aftagende læring ved nye erfaringer.
Træning giver præcision; løb giver fysisk stimulus og konkurrencesituationens
erfaring. Højere kategori er ikke automatisk bedre for enhver rytter.
**B:** enklere model, hvor højere kategori og debut generelt giver mere evneudvikling.
**C:** ændr eller afklar forslaget før valg.

Kortet vælger kun retning til videre design, ikke hele researchforslaget eller
en komplet ny mekanik. Næste konkrete valg er erfaringstyper, aldersvirkning og
udbytte. Ingen ny D-beslutning må udledes af R-002 alene. Kilder: R-002,
TRAINING_RULES §6/§13, PROGRESSION_RULES og researchforslagets S1-S6.

## D-018 · Passende udfordring og aftagende læring

**Status:** ejer-valgt retning til videre design 10/9, svar på Q-021.
**Ejerens svar, ordret:** "Passende udfordring og aftagende læring ved nye erfaringer (anbefalet)".

Begge dagsaktiviteter udvikler rytteren. Målrettet træning har præcision;
passende løb giver fysisk stimulus og erfaring. Nye, meningsfulde erfaringer
kan give ekstra læring, som aftager ved gentagelse. Højere kategori er ikke
automatisk bedre for enhver rytter. Kortets A svarer til rapportens model B.
**Fravalgt som grundmodel:** generel ekstra evneudvikling alene fra højere
kategori og debut. **Åbent:** konkrete erfaringstyper, aldersvirkning, måling
af deltagelse, forholdet til eksisterende evner, udbytte og feedback.

Dette godkender ikke rapportens samtlige forslag, nye stats, bestemte
aldersregler eller kalibrering. Den ældre løbsfordel og det nye mål skal afstemmes
konkret; der er ikke vedtaget et nyt tal eller ændret release-scope.
Kilder: R-002, research S1-S6, TRAINING_RULES/PROGRESSION_RULES (principnoter afstemt).
**Foreslået verifikation:** komplette forløb for træningsfokus, passende løb og
for svær konkurrence, med rollehensyn og gentagen eksponering; ingen universel
optimal kategori eller ubegrænset debutgevinst. Først fastlægges konkrete kriterier.

## Q-022 · Erfaring i eksisterende evner eller selvstændig løbsrutine?

**Status:** besvaret 10/9; A valgt, se D-019.
**A, anbefalet:** erfaring udvikler relevante eksisterende evner, eksempelvis
taktik/positionering ved større felter og brostensevne ved brostensløb.
Erfaringen huskes til aftagende læring, men giver ikke en separat skjult
præstationsbonus oveni evnerne.
**B:** særskilt løbsrutine påvirker præstation ved siden af evnerne, så to
ellers ens ryttere kan præstere forskelligt pga. kendskab til løbstypen.
**C:** kombination, som skal afgrænses nærmere.
**Tradeoff:** A bruger det eksisterende evnesprog; B giver selvstændig
specialiseret rutine, men kræver mere forklaring og balance. Eksemplerne på
evner er ikke en låst udviklingsfordeling. Kilder: D-018, PROGRESSION_RULES,
RACE_ENGINE_RULES og researchforslagets afsnit B1.

## D-019 · Erfaring udvikler eksisterende evner

**Status:** ejer-valgt 10/9, svar på Q-022.
**Ejerens svar, ordret:** "Erfaring udvikler relevante eksisterende evner (anbefalet)".
Erfaringens udbytte mærkes i relevante eksisterende evner. Spillet husker
erfaringer for at styre aftagende læring; historikken giver ikke også en separat
skjult præstationsbonus oveni. **Fravalgt:** særskilt løbsrutine som ekstra
præstationsdimension samt en uafklaret kombination som grundmodel.
**Åbent:** erfaringstyper, relevante evner og fordeling, historikkens form og
kalibrering. Taktik/positionering/brostensevne var eksempler, ikke en komplet liste.
Kilder: D-018, PROGRESSION_RULES (regel afstemt), TRAINING_RULES/RACE_ENGINE_RULES
(pointers afstemt). **Foreslået verifikation:** erfaring kan ændre evner gennem
udvikling; samme erfaringshistorik giver ikke en skjult ekstra motorfordel.

## Q-023 · Erfaringsområder kontra navngivne debuter

**Status:** besvaret 10/9; A valgt samt R-003, se D-020.
En ung rytter har kørt flere krævende brostensløb og debuterer i Paris–Roubaix.
**A, anbefalet:** relevant erfaring overføres mellem løb i fælles områder som
brosten, større felt og etapeløb. Navnet alene giver ikke udviklingsbonus;
markant hårdere udfordring kan stadig give ny læring, debut kan fejres i historik.
**B:** hvert stort navngivet løb har egen debutgevinst.
**C:** kategorien alene bestemmer, om erfaringen er ny.
**Tradeoff:** A belønner et sammenhængende udviklingsforløb og modvirker jagt
på løbsnavne; den kræver forståelige områder og passende sværhedsgrad.
Eksemplerne er ikke et endeligt katalog. Kilder: D-018/D-019, R-002,
PROGRESSION_RULES og RACE_ENGINE_RULES' profil-/rollebegreber.

## D-020 · Fælles erfaringsområder på tværs af løb

**Status:** ejer-valgt 10/9, svar på Q-023.
**Ejerens svar, ordret:** "1 + Hvis du samme omgang, at vi arbejder på dette kan forslå nye stats/evner til spillet, som kunne give mening, må du meget gerne forslå det. Kig gerne imod football manager, for at se om der er noget derfra, som kan passe ind i vores spil.".
Valg 1 accepterer fælles erfaringsområder: relevant erfaring overføres mellem
løb; navnet alene giver ikke ny evneudvikling. En hårdere relevant udfordring
kan stadig give læring, og en debut kan fejres i historikken. **Fravalgt:**
gevinst pr. stort løbsnavn og kategori alene som definition af nyhed.
**Åbent:** katalog, sværhedsgrad og overførsel mellem områder. Kilder:
D-018/D-019, PROGRESSION_RULES (afstemt), TRAINING_RULES (pointer).
**Foreslået verifikation:** tidligere brostensløb tæller ved Roubaix; omdøbning
af samme løb giver ikke mere udvikling.

## R-003 · Nye evner med FM-inspiration

**Status:** ejerønske 10/9, fra Q-023-svaret ovenfor; uddybet ved Q-024.
Forslag og kildeafgrænsning: [RIDER_ATTRIBUTES_RESEARCH](RIDER_ATTRIBUTES_RESEARCH.md).
Codex' prioritering var Holdarbejde først, Ro under pres som betinget næste,
Lederskab senere med mentorsystem og Træningsdisciplin afventende pga. overlap.
Ejeren ønsker at tale om **alle fire**; afventning er ikke et ejerfravalg.
Tre allerede planlagte stats (stabilitet, vejrteknik, højdetolerance) tælles
ikke som nye idéer. Ingen ny konkret stat-effekt er godkendt til build.

## Q-024 / D-021 · Holdarbejde først, interesse i alle fire kandidater

**Status:** ejer-valgt designprioritet 10/9.
**A, anbefalet:** konkretisér Holdarbejde først. **B:** Ro under pres først.
**C:** Lederskab/veteranernes rolle først.
**Ejerens svar, ordret:** "1 - Men det lyder som om, at jeg gerne vil have alle dine forslag med i spillet. DEt kan vi godt tale om.".
Holdarbejde konkretiseres først. Ejeren udtrykker samtidig interesse i de fire
kandidater fra den forelagte liste: Holdarbejde, Ro under pres, Lederskab og
Træningsdisciplin. Det er ikke en beslutning om at indføre alle forslag inklusive
de eksplicit frarådede dubletter. **Åbent:** hver kandidats domæne, effekt,
udvikling, visning og balance. Ingen release-, scope- eller build-godkendelse.
Kilder: R-003, PROGRESSION_RULES (prioritetsnote), RACE_ENGINE_RULES og registry.
**Næste designprøve:** to ellers ens hjælpere, forskellig Holdarbejde; hvad
skal ændres, og hvad skal forblive ens? Q-025 forelægger den virkning.

## Q-025 · Mere hjælp eller mindre egen belastning?

**Status:** besvaret 10/9; A valgt med kaptajntilføjelse, se D-022.
To lige stærke hjælpere med samme rolle/indsats, forskelligt Holdarbejde.
**A, anbefalet:** mere brugbar hjælp til kaptajnen for samme egen indsats.
**B:** samme hjælp, mindre belastning for hjælperen.
**C:** begge effekter, balanceret samlet.
**Tradeoff:** A gør evnen tydeligt rettet mod holdets præstation, mens hjælperen
stadig betaler for arbejdet. B kan lade ham holde længere. C giver større
samlet værdi og risiko for en dominerende evne. Kilder: R-003/D-021,
RACE_ENGINE_RULES §2e; ingen ændret energi-/effektformel er valgt.

## D-022 · Holdarbejde hjælper både med at give og modtage støtte

**Status:** ejer-valgt retning 10/9, svar på Q-025.
**Ejerens svar, ordret:** "1 - Men når kaptajnen har høj \"teamwork\", så skal hjælperne være mere villige til at arbejde for ham, fordi han altid har støttet dem godt, så \"dygtige\" kaptajner på den måde, kan modtage lidt ekstra hjælp. Fordi han kan få mere ud af holdet omkring sig.".

**Valg A:** Bedre Holdarbejde hos hjælperen giver mere brugbar hjælp til
kaptajnen for samme egen indsats. Primært at reducere hjælperens pris eller
både reducere pris og øge hjælp er fravalgt som svaret på sammenligningen.
**Ejerens tilføjelse:** høj Holdarbejde hos kaptajnen skal også kunne få mere
ud af hjælperne. Han begrunder deres villighed med kaptajnens tidligere støtte.
Den tilføjelse må ikke forsvinde i en registrering af kun "A valgt".

**Åbent:** er statten en tilstrækkelig repræsentation, eller skal fælles historie
også tælle? Hvordan afgrænses det fra Lederskab? Betyder mere villighed øget
faktisk indsats eller bedre udnyttelse, og hvem bærer prisen? De spørgsmål er
ikke afgjort af D-022. En ny kaptajn har ikke automatisk faktisk fælles historie.
Kilder: R-003/D-021, RACE_ENGINE_RULES §2e (principnote afstemt).
**Foreslået verifikation:** samme hjælperindsats, forskellig Holdarbejde; mål
nytten for kaptajnen. Afprøv derefter kaptajnens tilføjelse særskilt, så effekter
ikke tælles dobbelt eller bryder de eksisterende begrænsninger.

## Q-026 · Ny kaptajn: personlig egenskab eller fælles historie?

**Status:** besvaret 10/9; A valgt, se D-023.
En nyindkøbt kaptajn har høj Holdarbejde, men intet fælles løbsforløb med hjælperne.
**A, anbefalet:** mindre startvirkning fra egenskaben; faktisk godt samarbejde
kan styrke den. **B:** hele virkningen følger statten med det samme.
**C:** ekstra hjælp skal først optjenes gennem fælles historie.
**Tradeoff:** A lader både profil og fælles forløb have betydning; B er enklere
og mere forudsigelig. A/C kræver en særskilt definition af godt samarbejde og
kontrol for forholdet til Lederskab. Ingen relationstabel, ny skala eller
konkret bonus er forelagt. Kilder: D-022, RACE_ENGINE_RULES §2e og R-003.

## D-023 · Kaptajnens startvirkning og fælles samarbejde

**Status:** ejer-valgt 10/9, svar på Q-026.
**Ejerens svar, ordret:** "Egenskaben giver en startvirkning; godt samarbejde kan styrke den (anbefalet)".
En ny kaptajns personlige Holdarbejde giver en startvirkning; godt samarbejde
med holdet kan styrke den. **Fravalgt:** hele effekten følger statten straks,
eller ekstra hjælp først efter optjent fælles historie. **Åbent:** hvad godt
samarbejde består i, hvem relationen knytter sig til, udvikling/tab over tid,
grænser, feedback og pris. Der er ikke valgt et bestemt forholdstal mellem
egenskab og historie eller en ny datamodel. Kilder: D-022 og RACE_ENGINE_RULES
(afstemt). **Foreslået verifikation:** ny og velintegreret kaptajn med samme
evne kan have forskellig støtte; en ny kaptajn må ikke få fiktiv fælles historie.

## Q-027 · Kaptajnens ekstra hjælp og hjælpernes kræfter

**Status:** besvaret 10/9; A valgt, se D-024.
**A, anbefalet:** bedre samarbejde inden for managerens roller og indsatsordrer;
en bedre kaptajn udløser ikke automatisk ekstra træthed hos hjælperne.
**B:** mere faktisk arbejde pga. villighed, med ekstra træthed til planlægningen.
Begge modeller skal have reel pris på holdarbejdet og begrænset effekt.
Dette afklarer kaptajnens tilføjede kanal i D-022, ikke den allerede valgte
hjælpervirkning for samme egen indsats. Kilder: D-022/D-023, RACE_ENGINE_RULES §2e
og managerens handlefrihed i V-001/D-008. Ingen ny belastningsformel er valgt.

## D-024 · Bedre koordinering uden automatisk ekstra træthed

**Status:** ejer-valgt 10/9, svar på Q-027.
**Ejerens svar, ordret:** "Bedre samarbejde inden for de valgte ordrer, uden automatisk ekstra træthed (anbefalet)".
Kaptajnens egenskab og samarbejde skal give bedre koordinering inden for
managerens valgte roller og indsatsordrer. En bedre kaptajn udløser ikke
automatisk ekstra træthed hos hjælperne. **Fravalgt:** villighed som ekstra
faktisk arbejde og ekstra træthed i denne kanal. Holdarbejdet har stadig
reel pris og begrænset effekt; valget er ikke gratis eller ubegrænset kraft.
**Åbent:** effektgrænser, samspillets historie og afgrænsning fra Lederskab.
Kilder: D-022/D-023, RACE_ENGINE_RULES §2e (afstemt).
**Foreslået verifikation:** ændret kaptajnkvalitet kan forbedre støtten uden
at ændre hjælpernes indsatsordre eller automatisk øge deres belastning.

## Q-028 · Hvem ejer det opbyggede samspil?

**Status:** besvaret 10/9; A valgt, se D-025.
Kaptajn og fast hjælper med flere sæsoners godt samarbejde købes samlet.
**A, anbefalet:** deres indbyrdes samspil følger rytterne til den nye klub;
samarbejde med øvrige ryttere skal opbygges. **B:** samspil tilhører klubben
og skal genopbygges efter klubskiftet.
**Tradeoff:** A giver kontinuitet og makkerpar værdi ved transfer, men kræver
historik mellem konkrete ryttere. Det foreslår ikke en ny købsprisformel eller
en bonus til alle i den nye klub. Kilder: D-023/D-024, RACE_ENGINE_RULES §2e.

## D-025 · Samspillet følger de konkrete ryttere

**Status:** ejer-valgt 10/9, svar på Q-028.
**Ejerens svar, ordret:** "Samspillet følger rytterne og bevares mellem makkerparret (anbefalet)".
Et etableret makkerpar bevarer sit indbyrdes samspil ved klubskifte. Relationer
til nye holdkammerater skal stadig opbygges. **Fravalgt:** klub-ejet samspil,
der starter forfra alene pga. transfer. **Åbent:** retning/symmetri, hvilke
hændelser bygger samspil, adskillelse over tid, datadækning og synlighed.
Ingen ny købsprisformel eller bonus til alle nye holdkammerater er vedtaget.
Kilder: D-023/D-024, RACE_ENGINE_RULES (afstemt), TRANSFER_MARKET_RULES (pointer).
**Foreslået verifikation:** makkerparret bevarer samspil efter transfer; deres
forhold til en tredje ny holdkammerat er ikke opfundet ud fra klubskiftet.

## Q-029 · Lederskabs hovedformål

**Status:** besvaret 10/9; A valgt, se D-026.
En erfaren veteran er ikke længere blandt de bedste til løb, men er dygtig leder.
**A, anbefalet:** hovedformål som udpeget mentor og påvirkning af truppens
udvikling over tid. Holdarbejde dækker samarbejdet i løbet. Veteranen bruger
stadig trupplads og løn. **B:** primært organisering under løb.
**C:** begge, med tydeligt adskilte effekter.
**Tradeoff:** A giver langsigtet trupvalg og mentorværdi; B/C kræver en skarp
afgrænsning fra den allerede valgte Holdarbejde-/kaptajneffekt. Gode vaner og
læring er eksempler, ikke en valgt liste over statpåvirkninger. Kilder: R-003,
D-021–025, PROGRESSION_RULES/TRAINING_RULES og evnekandidatrapporten.

## D-026 · Lederskab som mentor og udvikling af truppen

**Status:** ejer-valgt hovedformål 10/9, svar på Q-029.
**Ejerens svar, ordret:** "Lederskab har sit hovedformål i mentorrollen og truppens udvikling (anbefalet)".
En erfaren rytter kan være værdifuld som udpeget mentor og påvirke andre over
tid, selv uden plads på det bedste løbshold. Han optager stadig trupplads og
koster løn. Holdarbejde dækker den allerede valgte løbssamarbejdsvirkning.
**Fravalgt som hovedmodel:** primært organisering i løb eller begge områder
uden denne hovedprioritering. Det er ikke valgt som en generel anden racebonus.
**Åbent:** læringsområder, egnethed, mentor/mentee-relation, kapacitet, tid,
effekt, feedback og påvirkning af eksisterende træning. Kilder: R-003,
D-021–025, PROGRESSION_RULES/TRAINING_RULES (afstemt).
**Foreslået verifikation:** en egnet veteran får konkret udviklingsrolle med
en reel trupomkostning; effekten er afgrænset fra Holdarbejde og almindelig trænerbonus.

## Q-030 · Mentorens læringsområder

**Status:** besvaret 10/9; A valgt, se D-027.
**A, anbefalet:** mentale færdigheder og vaner som hovedområde, fx Holdarbejde,
taktik, ro under pres og træningsdisciplin; ikke direkte fysisk bonus.
Mentoren skal selv have relevant kunnen; Lederskab alene er ikke nok til at lære alt.
**B:** også fysiske/tekniske evner inden for mentorens styrker.
**C:** generel udviklingsbonus til de vejledte unge.
**Tradeoff:** A adskiller menneskelig påvirkning fra faglig træner/program;
B/C kræver afgrænsning fra det eksisterende udviklingsudbytte. Eksemplerne er
ikke en endelig evneliste. Kilder: D-026, TRAINING_RULES §7/§13 og R-003.

## D-027 · Mentale færdigheder og vaner som mentorens hovedområde

**Status:** ejer-valgt 10/9, svar på Q-030.
**Ejerens svar, ordret:** "Mentale færdigheder og vaner som mentorens hovedområde (anbefalet)".
Mentoren påvirker især mentale færdigheder og vaner. Relevant egen kunnen er
nødvendig; Lederskab alene gør ikke mentoren til universel underviser.
**Fravalgt som model:** en generel bonus eller generel direkte fysisk/teknisk
udvikling. Holdarbejde, taktik, ro under pres og træningsdisciplin var eksempler,
ikke en endelig låst liste. **Åbent:** læringshastighed, match, kapacitet,
mulig dårlig påvirkning og samspil med eksisterende træning. Kilder: D-026,
PROGRESSION_RULES/TRAINING_RULES (afstemt). **Foreslået verifikation:** mentor
med relevant kunnen hjælper på sit område, men giver ikke uforklaret fysisk
bonus eller samme universelle udbytte til enhver ung rytter.

## Q-031 · Dårligt mentor-match og negativ påvirkning

**Status:** besvaret 10/9; A valgt, se D-028. Ejeren bad derefter om Claude-handoff.
En leder med dårlige vaner på et område vejleder en ung, der allerede er bedre.
**A, anbefalet:** kun positiv påvirkning på områder med relevant kunnen;
dårligt match giver begrænset udbytte og koster tid/mentorplads.
**B:** dårlige vaner kan smitte, med tydelig information før valget og mulighed
for at stoppe. **Tradeoff:** A bruger mulighedsomkostning frem for negativ
statpåvirkning; B giver mere relationsrisiko og kræver forståelig varsling.
Mentorkapacitet og varighed er ikke valgt alene ved at nævne en mentorplads.
Kilder: D-026/D-027 og TRAINING_RULES §7's eksisterende positive/neutral trænerregel;
en mentor er en anden rolle, så analogien er et forslag, ikke en allerede gældende regel.

## D-028 · Mentorindflydelse er kun positiv

**Status:** ejer-valgt 10/9, svar på Q-031.
**Ejerens valg:** "1" (den anbefalede positive/neutral model); fuld besked med
handoff- og GitHub-mandat står i SESSION_LOG.
Mentoren bidrager positivt på områder, hvor han har relevant kunnen. Et dårligt
match giver begrænset udbytte og mulighedsomkostning i tid/mentorplads, ikke
negativ påvirkning af den unges vaner eller evner. **Fravalgt:** dårlige vaner
som smittende negativ statpåvirkning, selv med advarsel. **Åbent:** kapacitet,
varighed, matchkriterier, konkrete evner og størrelse. Kilder: D-026/D-027,
PROGRESSION_RULES/TRAINING_RULES (afstemt).
**Foreslået verifikation:** mentor med lavere kunnen sænker ikke den unges
evne; relevant mentor kan hjælpe; et dårligt match giver ikke universel bonus.

## Q-032 · Hvordan tildeles en mentor?

**Status:** stillet og besvaret 10/9 (Claude Code); A valgt, se D-029.
Scenarie: en 33-årig tidligere kaptajn med høj taktik og højt Holdarbejde, men
svag ro under pres, skal hjælpe et 19-årigt U23-talent, der er nervøst i finaler.
**A, anbefalet:** manageren udpeger mentor og 1-2 mentees i samme klub (alle
trupper). Effekten bygges op pr. løbsdag de begge er i klubben, kun på evner
hvor mentoren er tydeligt bedre end den unge; aftagende udbytte når den unge
nærmer sig mentoren. Feedback: "lærer af X: taktik" på rytterkortet og milepæl
i "Siden sidst". **B:** enhver veteran med højt Lederskab løfter passivt alle
unge i truppen; intet valg, ingen kapacitet. **C:** som A, men kun én mentee.
**Tradeoff:** A skaber et reelt valg (hvem, og hvem ikke) uden nye tal-lag;
B giver ingen managerbeslutning, og flere ledere lægger sig sammen til gratis
holdstyrke (frarådet i RIDER_ATTRIBUTES_RESEARCH); C gør valget skarpere, men
en dygtig veteran bliver mindre værd. Spillerbevis: roadmap-punktet
"Road captains and mentors" har 31 stemmer, idé 4,77 og vigtighed 3,97 (målt 10/9).
Kilder: D-026–028, TRAINING_RULES §7 (træneren straffer aldrig), YOUTH_RULES
(Junior 16-18, U23 19-22, Senior 23+).

## D-029 · Navngivet mentorpar med højst to mentees

**Status:** ejer-valgt 10/9, svar på Q-032.
**Ejerens svar, ordret:** "A · Navngivet par, max 2 mentees (anbefalet)".
Manageren udpeger selv en mentor og højst to mentees i samme klub; mentees kan
stå i enhver trup (Junior, U23 eller Senior). Relationen er navngivet og synlig
for egen manager. Udbyttet bygges op over løbsdage, hvor begge er i klubben,
og gælder kun de mentale evner/vaner (D-027), hvor mentoren er tydeligt bedre
end den unge. Udbyttet aftager, når den unge nærmer sig mentorens niveau.
**Fravalgt:** passiv, automatisk virkning på hele truppen (B) og streng
én-til-én-model (C). **Åbent:** hvem der kan være mentor (Lederskabs synlighed,
alders-/niveaukrav), hvor hurtigt udbyttet bygges op, hvad "tydeligt bedre"
er i tal (privat kalibrering), om et par kan skiftes frit eller har bindingstid,
hvordan feedback vises præcist, og hvad der sker ved transfer af den ene part
(D-025's princip om at samspil følger rytterne er nærmeste analogi, ikke en
allerede gældende regel). Ingen formel, skala eller UI er godkendt til build.
**Foreslået verifikation:** to identiske unge, én med relevant mentor og én
uden, adskiller sig kun på mentorens stærke mentale evner; en tredje ung med
en mentor, der er svagere end ham selv, får intet udbytte og ingen straf.

## Q-033 · Skal Lederskab være en ny evne, og hvad gør en rytter til mentor?

**Status:** stillet 10/9 (Claude Code); første udgave koblede spørgsmålet med
synlighed/fog of war, og ejeren bad om at skille de to områder ad. Anden udgave
blev vist visuelt (tre kolonner, samme scenarie) på ejerens ønske. A valgt, se D-030.
Scenarie: to 31-årige hjælpere med samme fysik og samme taktik 78; en 19-årig
U23-rytter med taktik 45 skal have en mentor.
**A, anbefalet:** Lederskab bliver en evne på alle ryttere; vokser med alder og
tid som kaptajn/mentor, topper sent. Mentor-krav: Lederskab over en tærskel OG
tydeligt bedre på den konkrete mentale evne. Ingen virkning i selve løbet.
**B:** ingen ny evne; mentor = sæsonalder 28+ og tydeligt bedre på evnen.
**C:** som A, men højt Lederskab giver også en lille kaptajnsvirkning i løbet.
**Tradeoff:** A gør de to veteraner forskellige og lader en ung naturlig leder
være mentor; B giver nul nye tal, men alle veteraner er lige gode mentorer;
C lader to evner forklare samme løbsresultat (overlap med D-023/D-024).
Kilder: D-026–029, RIDER_ATTRIBUTES_RESEARCH ("Før nogen bygger en ny evne").

## D-030 · Lederskab er en ny evne med mentor og trup som eneste formål

**Status:** ejer-valgt 10/9, svar på Q-033.
**Ejerens svar, ordret:** "A · Ny evne Lederskab, kun mentor/trup (anbefalet)".
Lederskab bliver en evne i samme evnesystem som de øvrige (jf. D-019: ingen
skjult sidelag). Den vokser med alder og med tid som kaptajn eller mentor og
topper sent i karrieren. Mentor-egnethed kræver Lederskab over en tærskel og
tydelig overlegenhed på den mentale evne, der læres fra. Lederskab påvirker
intet i løbsmotoren; Holdarbejde ejer fortsat samarbejdet i løbet (D-022–024).
**Fravalgt:** ingen ny evne (alder + relevant evne), og løbsvirkning oveni.
**Åbent (holdes adskilt efter ejerens ønske):** synlighed og fog of war
(hvem ser tallet), tærskelværdi, vækstkurve og skala (privat kalibrering),
behandling af eksisterende ryttere uden historik (jf. researchens punkt 6),
og hvordan evnen vises på rytterkortet. Ingen registry-post, generation,
scouting- eller værdikontrakt er ændret ved dette valg.
**Foreslået verifikation:** to ellers identiske veteraner adskiller sig kun i
mentor-egnethed og mentee-udbytte; ingen løbssimulation ændrer udfald ved
ændret Lederskab; en ung rytter med højt Lederskab kan være mentor.

## Q-034 · Kan mentorparret skiftes frit, eller er der bindingstid?

**Status:** stillet 10/9 (Claude Code) med tre kurver over samme scenarie; A valgt, se D-031.
Scenarie: 40 løbsdage; mentor X udpeges på løbsdag 1; på løbsdag 15 købes en
bedre mentor Y, og manageren skifter. **A, anbefalet:** frit skift, men det nye
par bygger udbyttet op forfra over nogle løbsdage; det lærte beholdes.
**B:** parret låses for sæsonen og ændres kun i sæsonpausen. **C:** frit skift,
fuld virkning fra dag ét. **Tradeoff:** A straffer rotation uden at låse; B er
forudsigelig, men gør en midt-sæson-købt veteran ubrugelig som mentor til S+1;
C belønner daglig rotation og rammer D-004/D-006 (den sjældne gæst taber).
Kilder: D-029/D-030, D-004/D-006, D-025 (samspil følger rytterne).

## D-031 · Frit mentorskift med opbygning forfra

**Status:** ejer-valgt 10/9, svar på Q-034.
**Ejerens svar, ordret:** "A · Frit skift, opbygning forfra (anbefalet)".
Manageren kan altid ændre et mentorpar. Et nyt par starter med lav virkning og
bygger den op over løbsdage; det, den unge allerede har lært, beholdes. Sælges
eller frigives den ene part, ophører parret, og det lærte beholdes; en ny
relation begynder forfra. **Fravalgt:** sæsonlås og omkostningsfrit skift.
**Åbent:** opbygningens længde i løbsdage og kurvens form (privat kalibrering),
om et tidligere par genoptages hurtigere end et helt nyt, og hvordan skiftet
vises (rytterkort, "Siden sidst"). Ingen UI eller formel er godkendt til build.
**Foreslået verifikation:** to identiske mentees, hvor den ene skifter mentor
på løbsdag 15 til en bedre, ender højere end den, der bliver, kun hvis den nye
mentor er tydeligt bedre; ugentlig rotation mellem ligeværdige mentorer ender
lavere end at blive i ét par.

## Q-035 · Hvad bestemmer ungdomstruppernes kapacitet?

**Status:** stillet 10/9 (Claude Code) efter at ejeren samme dag løftede
"trupper U23/junior" fra nr. 8 til nr. 3 på MASTERPLANs venteliste (parret med
træning) på spillerdata: roadmap nr. 2 (35 stemmer), skema nr. 3, forumtråden
med flest visninger. Vist som tre kolonner (rig D1-klub mod D4-talentfabrik).
A valgt, se D-032. **A, anbefalet:** samme grundloft pr. trup for alle;
akademifaciliteten udbygges i trin med anlægspris og stigende drift pr. plads.
**B:** samme faste loft for alle, ingen udvidelse. **C:** loftet følger divisionen.
**Tradeoff:** A giver talentfabrikken (D-001) en vækstvej og købeklubben (D-008)
et frit valg, og penge får et sink; B er ren struktur uden identitetsvækst;
C belønner sportslig styrke med ungdomskapacitet og rammer "balance = struktur".
Spillerbevis: forum 7-9/9 bad selv om udvidelse med stigende pris; "én stor
trup" fik veto 23 % i skemaet. Kilder: YOUTH_RULES §2.1/§6 (loft afgøres af
økonomi-sim + ejer-go), doktrinen "styrke straffes aldrig".

## D-032 · Fast grundloft pr. ungdomstrup plus købte udvidelser

**Status:** ejer-valgt 10/9, svar på Q-035.
**Ejerens svar, ordret:** "A · Fast grundloft + køb af udvidelser (anbefalet)".
Alle klubber får samme grundloft pr. trup (Junior og U23). Kapacitet ud over
grundloftet købes som trin på akademifaciliteten med anlægspris og stigende
drift pr. plads; den kan ikke optjenes af division eller resultater.
**Fravalgt:** ét fælles loft uden udvidelse (B) og divisionsafhængigt loft (C);
"én stor trup på 50 uden tiers" er fortsat fravalgt (YOUTH_RULES §2.1 + skema-veto).
**Åbent (YOUTH_RULES §6, økonomi-sim + ejer-go):** grundloftets størrelse pr.
trup, antal trin, anlægspris og driftskurve, om trin kan sælges/nedgraderes,
og om udvidelsen deles mellem Junior og U23 eller købes pr. trup. Tallene 12/10
og +4/+2 i kortet var illustration, ikke valg. Ingen build-go.
**Foreslået verifikation:** en D4-klub kan med samme grundloft som en D1-klub
drive en talentfabrik; en udvidelse betaler sig kun ved reel brug (drift pr.
plads), så tomme pladser er et tab; ingen klub får kapacitet af sin division.

## Q-036 · Skal udlån af ryttere findes, og for hvem?

**Status:** stillet 10/9 (Claude Code) med tre kolonner (en 20-årig "nr. 13" og
en D3-klub uden ryttere). B valgt, se D-033. **A, anbefalet af designeren:**
udlån kun af Junior/U23 (sæsonalder ≤ 22) for resten af sæsonen; ejer beholder
ejerskab, låner betaler løn, udvikling tæller hos begge (D-015). **B:** ingen
udlån; behold, sælg eller byt. **C:** udlån for alle aldre og perioder.
**Tradeoff:** A giver talentfabrikken en udvej for overskydende unge og fylder
lavere divisioner med menneskers ryttere, men indfører en ny aftaletype og en
fair play-flade; B er enklest uden misbrugsflade, men "nr. 13" er et rent tab;
C skaber lån af en stjerne til ét løb og rammer fair play (#3131, #3818).
Spillerbevis: "Deeper negotiation between managers" 34 stemmer (idé 4,0).
Kilder: D-015, D-032, TRANSFER_MARKET_RULES, YOUTH_RULES §2.2.

## D-033 · Ingen udlån af ryttere

**Status:** ejer-valgt 10/9, svar på Q-036. Ejeren fravalgte designerens anbefaling.
**Ejerens svar, ordret:** "B · Ingen udlån".
Ryttere kan ikke udlånes mellem klubber, hverken unge eller seniorer. En klub
med flere unge end pladser må beholde (købt kapacitet, D-032), sælge eller
bytte som i dag. Lavere divisioners felter fyldes fortsat med AI-ryttere.
**Fravalgt:** udlån af unge (A) og udlån for alle (C).
**Konsekvens for andre beslutninger:** D-015's "flere udviklingsklubber" opstår
kun gennem salg/bytte af unge, ikke gennem lån; D-032's købte udvidelser er den
eneste indenlandske udvej for overskydende talent. **Designerens forbehold,
registreret:** salg af en ung med potentiale er et permanent tab, så trykket
på at købe kapacitet stiger; det bør indgå i økonomi-simulationen (YOUTH_RULES §6).
**Genåbnes kun** med en konkret grund, fx målt AI-andel i ungdomsfelter eller
gentagne spillerønsker efter slice 2. Ingen build-go.

## Q-038 · Hvad sker der, når en manager glemmer at udtage til et løb?

**Status:** stillet 10/9 (Claude Code) som første kort i kapitlet "holdudtagelse
og løbsdagen" (ejerens valg af kapitel samme dag); tre tidslinjer over samme
scenarie (Touren starter mandag kl. 11, besøg onsdag og fredag, næste besøg
tirsdag). Første option valgt, se D-034.
**Første option, anbefalet:** påmindelse i navigationen når en trup mangler
(#4983); står truppen stadig helt tom 24 timer før start, sætter assistenten en
trup, som manageren kan rette (`late_fill`, horisont 24 t, spillernes eget forslag
24/8, #4201). **Anden option:** som i dag (kun sen redning ved etape 1) plus
påmindelse. **Tredje option:** kontakt på profilen (`opt_in`), standard til.
**Tradeoff:** første option passer til 2-3 besøg om ugen (D-004/D-006) og lader
den der kigger ind dagen før rette truppen; anden option lader den glemsomme
køre med assistentens trup uden at have set den; tredje giver mest frihed men
én indstilling mere at forstå (D-005). Ingen af de tre skriver oven i noget
spilleren selv har valgt eller ryddet (ejer 25/8, "pull, ikke push").
Kilder: ASSISTANT_RULES §1, §1b, §12 pkt. 0; PLANNING_CENTER_RULES §4; #4201;
#4983; skema 10/9 (holdudtagelse "fungerer dårligst" 14 af 36); ejerens egen
oplevelse 7/9 ("Jeg glemte at udtage min trup til Touren").

## D-034 · Sen udfyldning 24 timer før start plus synlig påmindelse

**Status:** ejer-valgt 10/9, svar på Q-038.
**Ejerens svar, ordret:** "1" (den anbefalede første option).
Assistentens udtagelsestilstand skal være **sen udfyldning**: en helt tom trup
fyldes af assistenten, når første etape starter inden for 24 timer, så
manageren kan nå at rette den. Før det viser spillet en synlig påmindelse, når
en trup mangler (gul markering i navigationen, tydelig boks på planlægningssiden,
eskalering tæt på fristen; brugerstyret indstilling efter #4983). Den sene
redning ved etape 1 består som sidste værn. En delvis trup, en manuelt valgt
trup og en bevidst ryddet trup røres aldrig (§1b's fem egenskaber gælder).
**Fravalgt:** at blive på `proactive` (kun redning) og `opt_in` som model.
**Åbent:** om 24 t er den rigtige horisont efter måling (defaulten er
spillernes forslag), om sæson-transitionen og admin-genvejen skal følge
tilstanden (§12 pkt. 0), påmindelsens præcise flade og indstilling (#4983),
og om `late_fill` senere også skal top-fylde en delvis trup. **Prod-skridt:**
flippet af `assistant_selection_mode` og migrationen fra #4201 er ejer-gated
prod-mutationer og sker kun på ejerens ordrette go; dette valg er retningen.
**Foreslået verifikation:** en manager der intet gør, får en trup 24 t før
start og en påmindelse før det; en manager med én manuel rytter får ingen
assistent-tilføjelse før etape 1; en ryddet trup forbliver ryddet.

## Q-039 · Må assistenten lade en plads stå tom?

**Status:** stillet 10/9 (Claude Code) med tre kolonner (Københavns Klassiker,
fem friske brostensryttere, resten trætte klatrere). A valgt, se D-035.
**A, anbefalet:** altid gulvet (6); pladser derover kun med ryttere over en
egnetheds-/træthedsgrænse; tomme pladser vises med årsag. **B:** fyld altid
til max (i dag). **C:** fyld til max, men markér svage valg.
**Tradeoff:** A skåner trætte, dårligt matchede ryttere (som ellers mister
træningsdagen, D-018, og tager skaderisiko) og forklarer sig; B giver fulde
trupper uden forklaring; C giver information, men den fraværende manager
kører stadig med de svage valg. Kilder: ASSISTANT_RULES §4 trin 4, §12 pkt. 1
(`raceAutopick.js:107`), #3957, CALENDAR_RULES §8 (gulv 6, låst 27-28/8).

## D-035 · Assistenten fylder til gulvet, og derover kun egnede ryttere

**Status:** ejer-valgt 10/9, svar på Q-039.
**Ejerens svar, ordret:** "A · Fyld til gulvet, resten kun hvis egnet (anbefalet)".
Assistenten (alle udfyldningsveje A/B/C i ASSISTANT_RULES §0, inkl. D-034's
sene udfyldning) fylder altid op til klassens gulv (6), også med dårligt
matchede ryttere, så holdet stiller op. Pladser over gulvet fyldes kun med
ryttere, der ligger over en egnetheds- og træthedsgrænse. Tomme pladser vises
for manageren med årsag ("ingen egnet rytter"), så han selv kan sætte en ind.
**Fravalgt:** altid til max (B); markering alene (C). Markering af svage valg
er ikke fravalgt som supplement og hører til §12 pkt. 9 (forklaring).
**Åbent:** grænsens tal og om den er pr. løbstype (privat kalibrering,
`AUTOPICK_FATIGUE_DAMPING`, §12 pkt. 2), om gulvet skal fyldes med de
"mindst dårlige" efter samme score som i dag, hvordan årsagen formuleres
(en+da), og om den sene redning ved etape 1 skal følge samme grænse eller
fylde præcis som nu. Ingen build-go; #3957 kan nu få en løsning.
**Foreslået verifikation:** med fem egnede og tre trætte klatrere giver
assistenten 6 udtagne og én tom plads med årsag; med otte egnede giver den 7;
med kun fire ryttere i alt stiller holdet op med 4 + de to mindst dårlige... 
korrektion: med kun fire ryttere kan gulvet ikke nås, og reglen fra
PLANNING_CENTER_RULES §4 pkt. 2 ("der skrives intet hvis gulvet ikke kan nås")
består uændret.

## Q-040 · Hvad får spilleren at vide om egne rytteres indsats efter et løb?

**Status:** stillet 10/9 (Claude Code), tre kolonner (hjælperen "Lund" med ordren
"hjælp kaptajnen" på en kuperet etape). A valgt, se D-036.
**A, anbefalet:** indsatskort pr. rytter under resultatet: ordren, 2-4 hændelser
med km fra v4's tidslinje, én linje om han gjorde sit arbejde; ingen karakter.
**B:** karakter 1-10 pr. rytter (spillerforslag i skemaet). **C:** kun den
levende tidslinje (#4916).
**Tradeoff:** A forklarer hvad ordren betød og bygger direkte på v4's gemte
tidslinje; B er hurtig at læse, men forklarer ikke hvorfor og inviterer til at
sammenligne ryttere; C er stærk for den der ser med, men den fraværende
manager (D-004) skal selv finde sin rytter i 135 km prikker.
Kilder: RACE_ENGINE_RULES (v4 tidslinje, #4893), #4916, skema 10/9 fritekst
("did he attack at km 12? ... maybe with a mark from 1 to 10"), GDD §4 pkt. 3.

## D-036 · Indsatskort pr. rytter: ordre, hændelser, dom

**Status:** ejer-valgt 10/9, svar på Q-040.
**Ejerens svar, ordret:** "A · Indsatskort pr. rytter: ordre, hændelser, dom (anbefalet)".
Efter et løb får manageren for hver af sine ryttere et kort indsatskort: den
ordre/rolle rytteren havde, de 2-4 hændelser fra tidslinjen der betød noget
(med km), og én dom i klar tekst ("gjorde sit arbejde", "faldt igennem",
"kørte over evne") med den vigtigste konsekvens (fx træthed før → efter).
Ingen numerisk karakter. Kortet er grundmodellen for feedback på løbsdagen;
den levende tidslinje (#4916) supplerer, erstatter ikke.
**Fravalgt:** karakter 1-10 (B); kun replay (C).
**Åbent:** hvilke hændelsestyper der udvælges og hvordan (regel, ikke AI-tekst),
dommens ordforråd (en+da, TONE_OF_VOICE), om kortet vises i indbakken/"Siden
sidst" eller kun på løbssiden, mobilvisning, og om AI-holds ryttere får kort
(ikke nødvendigt). Kræver v4-flippet; ingen build-go.
**Foreslået verifikation:** for en hjælper der dækkede et udbrud og trak i
38 km viser kortet netop de hændelser og dommen "gjorde sit arbejde"; for en
sprinter på en bjergetape med ordren "spar kræfter" viser kortet ikke en dårlig
dom for at blive sat af.

## Q-041 · Hvad skal den første session ende i?

**Status:** stillet 10/9 (Claude Code) som første kort i kapitlet "dag 1 og de
første 7 dage", med tal fra `docs/audits/launch-cohort-dropoff-2026-09-07.md`
(#4964) og tre baner. B valgt, se D-037.
**Tal (7/9, consent-uafhængigt):** nye spillere har holdt 33-46 % fra uge 1 til
uge 2 siden maj; launch-kohorten: 7 af 18 væk inden en time, bimodalt (enten
binder første session, eller også er det slut). Uge 2-retention med/uden
handling inden 48 t: bud 52 %/19 %, egen udtagelse 55 %/31 %, træning 55 %/30 %.
Onboarding-trin 4 (bestyrelsesplan) flipper uden spillerhandling (90 % "færdige").
**A:** som i dag (draft, anbefalet bud, frit dashboard med fire trin).
**B, anbefalet:** første session ender i spillerens første løb: draft → udtag
selv til næste løb (assistenten forudvælger, spilleren bytter) → én taktik
(kaptajn, plan) → resultat med indsatskort (D-036); auktion og bestyrelse
åbner bagefter. **C:** fuld lineær tutorial gennem alle områder.
**Tradeoff:** B tvinger de to handlinger frem, som hænger sammen med at blive,
og giver et forståeligt resultat (GDD §7, scenarie 1); A er administration
uden belønning; C holder genrekendere i hånden i en halv time (D-005).
Kilder: auditten ovenfor, DASHBOARD_RULES §1 (Clarity), FEATURE_REGISTRY
`onboarding-first-session` (live, 4 trin + tour), Living World-doktrinen.

## D-037 · Første session ender i spillerens første løb

**Status:** ejer-valgt 10/9, svar på Q-041.
**Ejerens svar, ordret:** "B · Første session ender i dit første løb (anbefalet)".
Den nye managers første session er én ledet bane: draft som i dag, derefter
egen udtagelse til holdets næste løb (assistenten forudvælger, spilleren
bytter), én taktisk beslutning (kaptajn og plan), og resultatet leveres med
indsatskort pr. rytter (D-036) samt besked, hvis spilleren er gået. Auktion,
træning og bestyrelse åbner i eget tempo bagefter; de forsvinder ikke.
**Fravalgt:** dagens frie firetrinskort som grundmodel (A); fuld lineær
tutorial (C).
**Åbent og skal måles før build:** afstanden fra tilmelding til et nyt holds
første løb i kalenderen (kan "dit næste løb" altid findes inden for samme dag,
eller skal det første løb være et særligt indledende løb?); hvad "én taktik"
konkret er i v3 kontra v4; hvordan banen ser ud på mobil; om draftens
anbefalede bud skal flyttes til efter første løb; og hvordan de fire trin
måles ærligt (trin 4 måler i dag ingenting: `board_profiles.negotiation_status`
flipper uden handling, antaget kilde `boardAutoAccept.js`, se auditten §3).
Ingen build-go. Kandidat til MASTERPLAN bane 2 (fastholdelse) efter måling.
**Foreslået verifikation:** en ny spiller kan i én session på højst 20 minutter
(D-006) gå fra tilmelding til at have udtaget og sat taktik til et konkret
løb; andelen der sætter egen udtagelse inden 48 t stiger fra 35 % (launch)
mod 50 %+, og uge 1→2-retention følger med; trin 4 kan ikke længere blive
grønt uden en spillerhandling.

## Q-042 · Hvad skal bringe den nye manager tilbage på dag 2-7?

**Status:** stillet 10/9 (Claude Code) med tre tidslinjer (tilmelding mandag
aften, første løb onsdag kl. 11). A valgt, se D-038.
**A, anbefalet:** hændelsesdrevet krog: beskeden udløses af det spilleren selv
satte i gang (D-037): resultatet af første løb med indsatskort (D-036) og
"næste løb: fredag 11, trup ikke sat"; dag 1-mailen bliver denne, når der er
et resultat; ingen mail uden hændelse. **B:** kalenderdrevet som i dag
(velkomst, dag 1-tips efter et døgn, fraværs-digest efter tre dage, slukket
og samtykke-gated). **C:** kun i appen.
**Tradeoff:** A gør hver besked til noget spilleren selv valgte; B sender
tips før løbet er kørt og lader resultatet udløse ingenting; C giver nul
støj, men den der ikke åbner appen, hører aldrig at holdet kørte.
Kilder: EMAIL_STACK §2-3 (welcome/day1 transaktionelle, digest samtykke-gated,
#4654), auditten 7/9 (#4964), D-036/D-037.

## D-038 · Hændelsesdrevet krog: "dit løb er kørt"

**Status:** ejer-valgt 10/9, svar på Q-042.
**Ejerens svar, ordret:** "A · Hændelsesdrevet: 'dit løb er kørt' (anbefalet)".
I den nye managers første uge udløses beskeder af spillerens egne handlinger,
ikke af kalenderen: når det løb, han selv udtog til, er kørt, får han
resultatet med indsatskort og næste konkrete skridt ("næste løb, trup ikke
sat"). Dag 1-mailen erstattes af denne, når der findes et resultat; findes
der intet resultat endnu, består dagens dag 1-tekst som fallback. Ingen
besked uden hændelse i første uge. Kanaler: indbakke altid; mail efter
EMAIL_STACK's gate-kæde; Discord-DM hvis koblet.
**Fravalgt:** kalenderdrevne tips som grundmodel (B); kun i appen (C).
**Åbent:** samtykke-hjemlen for en resultat-udløst mail (EMAIL_STACK §2:
welcome/day1 regnes som kontoservice; en resultatbesked om spillerens egen
udtagelse er samme klasse i designerens vurdering, men ejeren har ikke fået
det juridisk efterprøvet), tekst (TONE_OF_VOICE, EN først), hvor mange
hændelser der må udløse mail i uge 1 (loft), og om krogen skal fortsætte efter
uge 1 som en generel "dit løb er kørt"-besked eller overgå til digesten.
Ingen build-go; kandidat til MASTERPLAN bane 2 (fastholdelse, #4964).
**Foreslået verifikation:** en ny manager, der udtog selv, modtager præcis
én besked, når løbet er kørt, med resultat, indsatskort og næste skridt;
en manager uden udtagelse modtager dagens dag 1-tekst; ingen mail sendes
uden en hændelse i uge 1.

## Q-043 · Hvordan skal søndagens akademikandidater findes?

**Status:** stillet 10/9 (Claude Code), tre kolonner (dansk klatreklub). Ejeren
valgte den anbefalede model med en præcisering, se D-039.
**A:** to tilfældige kandidater (i dag). **B, anbefalet:** kuldet følger en
scoutingprofil (region/nationalitet + ryttertype); designeren foreslog
scoutniveau som driver af antal og match. **C:** kun åben ungdomsauktion.
**Tradeoff:** A giver ingen styring og gør nationalitets-identitet til held;
B gør klubidentitet til en handling (V-001) uden at købe potentiale; C lader
den rige klub købe de gode unge hver søndag (mod "balance = struktur", D-001).
Kilder: YOUTH_RULES §2.3/§4 (2 kandidater pr. hold hver søndag, 7 dages
tilbud, ungdomsauktion, #2456 låst), D-032, #5064, skema 10/9 (akademi
"fungerer dårligst" 11 af 36; "viser for få unge"), forum 8-9/9.

## D-039 · Kuldet følger klubbens ønskede profil, drevet af akademifaciliteten

**Status:** ejer-valgt 10/9, svar på Q-043, med ejerens præcisering.
**Ejerens svar, ordret:** "1 -  Det skal være faciliteten, hvor man kan udvide
sit akademi, som skal gøre sådan man får bedre muligheder her. Det skal stadig
være muligt at få ryttertyper og nationaliteter man ikke har bedt om, men der
skal være en overvægt mod det, som man ønkser at udvikle."
Manageren angiver en ønsket profil for akademiet (nationalitet/region og
ryttertype). Søndagens kuld trækkes med **overvægt** mod profilen, aldrig
udelukkende: kandidater uden for profilen forekommer stadig. **Driveren er
akademifaciliteten** (den man udvider, jf. D-032), ikke scoutniveauet:
højere facilitetstrin giver bedre muligheder i kuldet (fx flere kandidater
og stærkere overvægt mod profilen). Potentialefordelingen er den samme for
alle; faciliteten køber bredde og match, ikke talent (doktrin: penge må ikke
købe bedre potentiale). Tilbud, frist og ungdomsauktion er uændrede (#2456).
**Fravalgt:** tilfældigt kuld uden styring (A), kun åben auktion (C), og
scoutniveau som driver (designerens forslag; ejeren pegede på faciliteten).
**Åbent:** profilens felter (én nationalitet/region og én type, eller flere),
hvor stærk overvægten er pr. facilitetstrin (privat kalibrering), antal
kandidater pr. trin, om profilen kan ændres frit eller pr. sæson, og om
scouten/scoutniveauet spiller nogen sekundær rolle (fx synlighed af
kandidaternes bånd, jf. #5064). Ingen build-go; hører til slice 1/2 i
YOUTH_RULES §5 og til D-032's økonomi-sim.
**Foreslået verifikation:** over mange søndage har en klub med profilen
"Danmark + klatrer" en tydelig overvægt af danske klatrere, men modtager
stadig andre typer/nationaliteter; potentialefordelingen i kuldet er
uafhængig af facilitetstrin; to klubber med samme trin og forskellig profil
får samme kvalitet, forskellig sammensætning.

## Overdragelse 10/9 efter Q-031

Ejeren bad udtrykkeligt om at afslutte Codex-sessionen, fortsætte i Claude Code
og få aftalte, endnu ikke byggede dele registreret i GitHub. Ingen ny
spildesignbeslutning eller build-godkendelse følger af den administrative
anmodning. Q-032 er ikke stillet. [CLAUDE_HANDOFF](CLAUDE_HANDOFF.md) er den
kompakte indgang; [GITHUB_HANDOFF](GITHUB_HANDOFF.md) ejer opgavekortet.

## E-008 · Evneinventar og FM-inspiration

**Status:** kilde-/kodekontrol 10/9 ved `1e17a5ba`; ingen prod-/modelsim.
ABILITY_REGISTRY har 15 poster, gengivet i kandidatrapporten. Det beviser ikke
fravær af andre skjulte/planlagte egenskaber. RACE_ENGINE_RULES nævner tre
tidligere ejer-valgte stats; deres enkelte leverancestatus er ikke genmålt.
`teamPlay.ts` har hjælperpris/kaptajnbeskyttelse; `leadout.ts::QUALITY_KEYS`
bruger positionering, tempo og acceleration. Nye effekter skal afgrænses mod
dem, ikke bygge på en påstand om at holdspil mangler. HOWTO_ADD_ABILITY er læst;
dens gamle #3668-status bruges ikke som aktuel blocker. FM24's officielle
manual er læst om Teamwork, Composure og Leadership; ingen skjult FM-formel
eller aktuel FM26-kalibrering påstås kendt. Vores effekter er forslag.

## E-007 · Ekstern research til R-002

**Status:** primærkilder læst online 10/9; ingen egen FM-test eller sportssimulation.
FM24-manualen og en navngiven FM26-guide på den officielle hjemmeside giver
forskellige evidenstyper: produktmanual og strategiguide. De blandes ikke sammen
til en påstand om kendte motorformler. Gallo-studiet beskriver racebelastning,
ikke kausal effekt af løbskategori på talentudvikling. Clark-studiet undersøger
struktureret træning hos voksne, ikke debuter hos unge. UCI-kilder er praksiseksempler.
Direkte links, korte referater og begrænsninger står i researchforslaget S1-S6.
Den foreslåede debut-/erfaringsmekanik er original spildesignfortolkning, ikke
noget kilderne dokumenterer som en præcis fysisk eller FM-intern regel.

**Lokal afgrænsning:** `applyRaceDevelopmentTick` i `dailyTraining.js` blev læst
igen; den kontrollerede signatur rummer profil og indsats, ikke historik over
debuter. Det er en observation af én kodevej, ikke bevis for fravær af al
erfaringslogik i hele projektet. Intet nyt runtimebugfund eller feature-issue oprettet.
Supplerende kontrol ved `6370a4c5`: `StageOutput` i v4's `types.ts` rummer
belastningsdata og gruppesnapshots; de er kandidatkilder til deltagelse, ikke
bevis for persisteret end-to-end-integration. TRAINING_RULES §2/§7 er desuden
læst om tick-rækkefølge og træner/facilitet; gamle målinger er ikke genmålt.

## E-006 · Den ældre fordel til løbsudvikling

**Status:** kilde-/kodekontrol 10/9 ved `ece1cb13`; ingen ny prod-måling eller simulering.
TRAINING_RULES §6 og spec `2026-08-06-loebsdags-model-design.md` D2 angiver en
udviklingsfordel ved løb, begrænset til relevante evner. `dailyTraining.js`
har `RACE_DEV_CONFIG` og `applyRaceDevelopmentTick` som den kontrollerede
implementationssti. SSOT §6 daterer udviklingsflaget som slukket i S3; den
gamle formel er ikke dermed et bevis for nutidig live-adfærd. §13 fastlægger
den nyere løbsdagsomlægning. Q-020 udfordrer formålet med løbsfordelen, ikke
et konstateret runtimebugfund; ingen private multiplikatorer kopieres hertil.
Efter ejerens afklaring: hele spec
`2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md` læst; #4850 læst
med kommentarer, status OPEN ved kontrollen 10/9. Den bekræfter reworket og
de tidligere ejerbeslutninger; status alene siger ikke at enhver del er ubygget.
Nyere noter om intentions-feltets konkrete placering findes i RACE_ENGINE_RULES
§1b; den gamle specs kolonneforslag er ikke et tilstrækkeligt implementeringsgrundlag.

## E-005 · Årgange, intake og historik er forskellige kilder

**Status:** afgrænset kilde-/kodekontrol 10/9 ved `be62a839`, ingen prod-måling.
YOUTH_RULES §1/§4 definerer `generation_tag` som årgangsmærke; det er ikke i sig
selv en tilskrivning af uddannelse til en bestemt klub. `academyIntakeReconcile.js`
skelner mellem tilbud, underskrevet kandidat og kandidat købt af en anden klub.
Et tilbud alene er derfor ikke bevis for at klubben har udviklet rytteren.
`riderHistory.js` samler offentlig handelshistorik og henviser til
`rider_ownership_events`; filen angiver at den særskilte ejerskabslog blev indført
senere end de ældste handler. Historisk dækning af udviklingsperioder er ikke
verificeret; ingen universel rekonstruktion eller ny mangelliste er vedtaget.

## E-004 · Hjælperrollen og holdarbejdet er eksisterende mekanikker

**Status:** kilde-/kodekontrol 10/9 ved `be62a839`; ingen prod- eller UI-prøve.
RACE_ENGINE_RULES §1 definerer `helper` som arbejder for kaptajnen. §2e beskriver
beskyttelse til kaptajnen og en pris for hjælperens eget resultat. Kodekontrollen
finder roller og work-cost i `backend/lib/raceRoles.js` samt arbejdende roller,
betaling og beskyttelse i `backend/lib/engine/v4/mechanics/teamPlay.ts`.
NOW angiver v3 for S3 og v4 som særskilt kommende flip; fundet er ikke en påstand
om at v4 er live. Ingen historiske kalibreringstal er genmålt eller gentaget.

**Designhypotese:** En lav personlig placering kan være forenelig med vigtig
hjælp til holdet. Vi har ikke kontrolleret, hvor tydeligt dette formidles i
resultater, referater, rytterhistorik eller karrierevurdering. Der er derfor
ikke belæg for at kalde manglende synlighed en eksisterende UI-bug endnu.

**Kildeafstemning:** PROGRESSION_RULES §6's gamle støjkrav er markeret afløst af
den nyere ejerbeslutning i TRAINING_RULES §13. Det er en dokumentkonflikt rettet
ved kildehenvisning, ikke en ny designbeslutning eller en runtimeændring.

## E-003 · Den eksisterende DNA-genvalgslås

**Status:** kodekontrolleret 10/9 efter genoptagelse ved `c51231e5`; ingen prod-læsning.
`backend/lib/boardMembers.js::chooseDnaForTeamCore` læser eksisterende DNA og
bestyrelsesmedlemmer. Ved en anden DNA-nøgle og eksisterende medlemmer kaldes
`isWithinFirstSeasonForTeam`; uden for første sæson afvises genvalg med
`DNA_ALREADY_CHOSEN`. Samme nøgle og recovery følger særskilte veje. Kodekommentaren
refererer ejerbeslutning 29/6 og senere drift; `boardClubDna.js` har fem pakker.

**Afgrænsning:** dette er en lås på erklæret DNA, ikke et bevis på at klubben
ikke kan ændre trup eller faktiske handlinger. Den gamle slice
`docs/slices/02-board-redesign-MASTER.md` nævner senere DNA-drift; aktuel komplet
leverancestatus for drift er ikke fastslået her. Fundet er derfor en forskel at
afklare ved design af den nye identitetsmodel, ikke et nyt konstateret bugfund.

## E-002 · Markedsadgang: autobud og eksisterende tidsdiskussion

**Status:** afgrænset dokument-, kode- og issuekontrol 10/9 på grundlaget
`3759ab2e639ffcb3f4888e105338a97aad63484e`; ingen ny prod-måling eller spillerprøve.
TRANSFER_MARKET_RULES §2/§4 læst; `backend/lib/proxyBidding.js` viser autobud
på en eksisterende auktion og `backend/lib/auctionEngine.js` viser validering
af spiller-valgt sluttid. `backend/routes/api.js:6564` bevarer særskilte veje
for flash, valgt sluttid og standardberegning. Der er ikke påvist en ny bug.

**Nyere status end SSOT'ens gamle issueangivelse:** #4177 er CLOSED, tekstdelen
leveret i #4674. Seneste kommentar 4/9 henviser det resterende tidsvalg til
[#4714](https://github.com/NicolaiDolmer/CyclingZone/issues/4714), målt OPEN 10/9.
Ejeren har 3/9 besluttet spillerafstemning før det konkrete valg. Denne samtale
foregriber ikke afstemningen. Historiske prod-tal fra 30/8 er ikke genmålt og
bruges ikke som aktuelle aktivitets- eller balancebeviser.

**Designhypotese:** Autobud beskytter selve budforløbet efter discovery, men kan
ikke alene bevise, at en spiller med D-004's kadence ser tilstrækkeligt mange
relevante muligheder. Det skal testes mod udbud, frister og alternativer samlet.

## E-001 · Daglig klikbonus: implementeret adfærd og godkendt afløser

**Status:** dokument- og kodekontrolleret 10/9 2026 ved `3759ab2e639ffcb3f4888e105338a97aad63484e`.
Ingen prod-læsning eller spiltest gennemført i denne session.

**Historiske kilder:** [doktrinen](../../superpowers/specs/2026-06-08-living-world-product-doctrine-design.md),
Product Identity og Amendments. Den kobler konkurrencedygtighed ved få ugentlige
besøg med en senere tilføjet bonus ved en aktiv daglig træningshandling.

**Nyere ejerbeslutning:** [TRAINING_RULES §13](../../TRAINING_RULES.md) og
[#4850](https://github.com/NicolaiDolmer/CyclingZone/issues/4850), læst på GitHub
10/9. Ejeren valgte 6/9 at fjerne både knap og bonus ved omlægningen til træning
pr. løbsdag. Dokumentet skelner udtrykkeligt mellem den beslutning og det byggede.

**Kodebevis:** `backend/lib/dailyTrainingEngine.js:130` vælger bonus ved
`executedBy === "manager"`; `backend/lib/dailyTraining.js:166` anvender
`DAILY_TRAINING_CONFIG.bonusMult`; `frontend/src/lib/useTraining.js:251` kalder
den manuelle udløser. Symboler og stier bevares, private balanceværdier kopieres ikke.

**Designervurdering:** En gentagen sportslig fordel ved fremmøde kan skabe pres,
selv om handlingen kaldes frivillig. Det er en relevant designprøve, men ejerens
beslutning om selve fjernelsen er allerede truffet og skal ikke stilles igen.
Ingen måling af oplevet spillerpres er foretaget her.

**Konsekvens for GDD:** gengiv den nyere retning som historisk ejer-godkendt og
hold den adskilt fra kodeobservationen. Undersøg senere om de øvrige systemers
deadlines og automatisering understøtter den samme ambition om spillerens tid.
Der er ikke oprettet en dubletopgave om træningsknappen.

## Skabelon ved næste konkrete beslutning

Hver D-post får stabilt ID, titel, dato, status, berørte kapitler og SSOT-kilder.
Indhold: problemet og beviset; ejerens relevante ord; designerens fortolkning;
alternativer med konsekvenser; anbefaling og begrundelse; ejerens præcise valg;
accepterede ulemper og fravalg; verifikationsplan og kriterium for genåbning.
Ved ændring refereres den afløste beslutning, og relevante dokumenter opdateres.
Afventende eller afviste forslag slettes ikke for at få designet til at fremstå enigt.
