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

**Status:** stillet 10/9; afventer.
**A, anbefalet:** cykelinteresserede, også uden erfaring med managerspil.
**B:** erfarne managerspillere, som gerne vil lære cykelsporten.
**C:** erfarne cykelmanagers, der allerede kender begge dele.

**Hvorfor det betyder noget:** afgør hvilke begreber vi må forudsætte, hvor
forklaringerne starter, og hvor hurtigt kompleksitet introduceres. A anbefales
ud fra V-001's cykeltroværdighed, enkel UI og dybde der kan læres. Der er ikke
foretaget en markedsmåling eller valgt en eksklusiv demografisk målgruppe.

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
