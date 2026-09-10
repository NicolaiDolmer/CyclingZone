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

**Status:** stillet 10/9; afventer.
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
