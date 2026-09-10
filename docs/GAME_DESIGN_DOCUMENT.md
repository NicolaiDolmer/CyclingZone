# Cycling Zone · Game Design Document

Status: **Arbejdende udkast, discovery startet 10/9 2026. Ikke godkendt som samlet spildesign.**
Ejer: Nicolai. Designpartner: Codex. Produktets historiske samlingspunkt: [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145).

## Læs dette først

Denne bog skal forklare hvilket spil vi vil skabe, hvorfor det er værd at spille,
og hvordan systemerne tilsammen skaber den oplevelse. Den udarbejdes gennem en
kritisk designsamtale med ejeren og verificering af eksisterende dokumenter og kode.
Den er endnu ikke en udtømmende beskrivelse af spillet.

**Genoptag samtalen:** læs [sessionsjournalen](design/gdd/SESSION_LOG.md), derefter
[beslutninger og spørgsmål](design/gdd/DECISIONS.md). Find områdets kilder i
[dækningsregistret](design/gdd/COVERAGE.md). V-001 og D-001 til D-013 er registreret.
**Aktuelt:** Q-016 om opfølgning siden sidste besøg afventer.
R-001 bevarer ejerens ønske om at følge ryttere "af egen avl".
[Genoptagelsesbriefen](design/gdd/RESUME_PROMPT.md)
bevarer pausepunktet; journalens sidste handoff er den aktuelle samtaletilstand.

**Eksisterende kompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md).
Det dokument er historisk ejer-godkendt, men nyere områdebeslutninger kan have
afløst enkelte dele. Udkastet her ændrer ingen gældende spilregler.

## 1. Mandatet

Ejeren ønsker en grundig gennemgang af hele projektets spildesign, også det
designpartneren ikke forstår eller er uenig i. Samtalen må strække sig over flere
timer og fortsættes, indtil funktionernes intentioner og sammenhæng er forstået.
Målet er professionelt designarbejde med reel modstand, ikke en efterrationalisering
af eksisterende funktioner. Også tidligere ejerbeslutninger må udfordres med
begrundelse; de ændres først ved en ny eksplicit beslutning.

Bevar både ejerens intention og begrundelsen bag valgene, herunder fravalg,
uenigheder, ubesvarede spørgsmål og hvilke observationer der kan ændre vurderingen.
GDD-arbejdet er ikke i sig selv godkendelse til at bygge, omprioritere eller frigive.

## 2. Fundamentet vi undersøger

Den eksisterende doktrin beskriver et vedvarende multiplayer-cykeldynasti:
klubben består, ryttere udvikler sig gennem generationer, og verden bevæger sig
mens manageren er offline. Den prioriterer klub- og rytterdynastiet, dernæst det
sociale marked og derefter den troværdige cykelmanager. Løb, træning, ungdom og
marked udgør de fire produktmotorer. Dette er en gengivelse af den historiske
retning, **ikke en ny bekræftelse fra ejeren den 10/9**.

### Ejerens vision, formuleret 10/9 2026 (V-001)

Spilleren skal kunne skabe en unik klubidentitet i multiplayer gennem eksempelvis
ungdomsudvikling, resultater eller en bestemt nationalitet. Managerrollen skal
føles ægte: meningsfulde beslutninger former klubbens egen rejse. Træning, akademi,
ungdomsudvikling, transfers og auktioner skal være bærende systemer.

En enkel brugerflade skal give adgang til stor dybde. Realisme skal tjene spillet;
den er ikke et mål i sig selv. Spilleren skal ofte mærke fremgang og momentum mod
egne mål, og spillet skal være sjovt, også uden hyppige sejre.

Verden skal leve og udvikle sig under spillerens fravær. Spilleren er en lille,
indflydelsesrig del af en større helhed, som skabes af alle spillernes handlinger.
Det fulde ejerudsagn bevares i [journalen](design/gdd/SESSION_LOG.md).

**Designerens foreløbige sammenfatning:** ejerskab over en klubhistorie i en fælles
verden. Det er en fortolkning til videre afklaring, ikke en vedtaget tagline.
Q-002 har afklaret talentfabrikken som selvstændig succesvej (D-001 nedenfor).
Målgruppernes indgange, besøgskadence og normaldriftens tidsbudget er afklaret
nedenfor; de konkrete grænser for managerens frihed undersøges videre.

### Flere veje til succes (D-001, ejer-godkendt retning 10/9)

En talentfabrik kan være et langsigtet slutmål. Klubben kan lykkes gennem ryttere,
den udvikler til andre hold, uden selv at vinde store løb ofte. Spillet skal kunne
give den rejse mening; sportslig dominans er ikke alle klubbers nødvendige slutmål.
Den konkrete anerkendelse, bæredygtighed og bestyrelsens vurdering skal undersøges
i systemkapitlerne. D-001 godkender ingen bestemt bonus, økonomisk sats eller ny
rangliste. Se [beslutningsgrundlaget](design/gdd/DECISIONS.md).

**Den omvendte vej er også legitim (D-008, valgt 10/9):** En købeklub kan bygge på
færdige ryttere og minimal egen ungdomsudvikling. Ejeren ønsker vid valgfrihed til
egen vej i spillet. Akademiet skal være vigtigt for verdenen uden at være et
tvunget individuelt succeskrav. De konkrete grænser mellem frihed, ressourcer
og fælles konkurrence skal undersøges; der er ikke besluttet afskaffelse af
konkrete regler. Princippet er afstemt i [YOUTH_RULES](YOUTH_RULES.md).

### Klubidentitet: ambition og omdømme (D-002, ejer-valgt retning 10/9)

Managerens frit kombinerede ambitioner skal fylde mest i den fremtidige identitet,
suppleret af det klubben faktisk gør over tid. Færdige DNA-pakker er ikke den
ønskede eneste model. Hvordan ambitioner erklæres og ændres, og hvordan omdømme
opstår, skal vi stadig designe. **Kursskifte (D-009, valgt 10/9):** Manageren må
frit begynde omlægningen. Trup, kontrakter, investeringer og optjent omdømme giver
modstanden og tager tid at ændre. Der lægges ikke en særskilt skiftepris eller
ventetid oveni alene for at binde identiteten. Et erklæret skifte sletter ikke
aftalte forpligtelser eller giver straks den nye retnings styrker. Den konkrete
overgang for eksisterende mandater og DNA skal fortsat designes.

[Bestyrelsens SSOT](BOARD_RULES.md) ejer de konkrete regler. Det eksisterende
Mandat-rework bevarer DNA-valget og skal ikke forveksles med denne nye retning.
### Bestyrelsen og managerens retning (D-003, ejer-godkendt 10/9)

Bestyrelsen udfordrer planens kvalitet inden for managerens valgte klubidentitet.
Den må kræve troværdig fremgang; den skal ikke automatisk kræve at en talentfabrik
bliver et titelhold. Princippet er afstemt i BOARD_RULES §0.4; konkret måldannelse
og konsekvenser skal stadig designes. Reglerne skal undersøges for, om de måler
det arbejde klubben faktisk prøver at lykkes med.

### Aftalen om spillerens tid (D-004, ejer-bekræftet 10/9)

To til tre besøg om ugen skal kunne bære en konkurrencedygtig klub på dens valgte
niveau og vej. God planlægning skal have reel værdi, mens verden fortsætter under
fravær. Dette er ikke en garanti for at slå dygtigere managers. **D-006, valgt 10/9:**
Et nødvendigt besøg i normal drift må kræve cirka 15-20 minutter; ekstra fordybelse
er frivillig. Dette er et designmål, ikke en målt egenskab ved spillet. Onboarding
og særlige sæsonbegivenheder er ikke tidsfastsat. Fordelen ved hyppigere besøg er
fastlagt kvalitativt i D-007 nedenfor. Kalender, assistance, marked,
kontrakter og bestyrelsesfrister skal vurderes samlet mod aftalen.

**Markedsaktivitet (D-007, valgt 10/9):** Hyppigere besøg må give flere chancer for
gode handler. Spilleren med få ugentlige besøg skal stadig kunne konkurrere på
markedet og drive en talentfabrik. Enkelte mistede ryttere er acceptable; adgangen
til reelle alternativer skal undersøges. Ingen bestemt fordel, auktionstid eller
ny købsautomatik er vedtaget. Områdets kilde er [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md).

### To indgange, fælles dybde (D-005, ejer-valgt 10/9)

Spillet skal lykkes både for cykelinteresserede uden managererfaring og for
managerspillere, som skal lære cykelsporten. Ejerens sværhedsgrad er **"nemt at
komme ind i, svært at mestre"**. Først skal alle kernefunktioner være nemme at
betjene; spillet skal samtidig tilbyde dybde. Erfaring med begge områder er
ikke et adgangskrav. Ingen af de to indgange er udpeget som vigtigere end den anden.

**Designerens fortolkning til validering:** Betjeningen og de grundlæggende begreber
skal kunne læres hurtigt; mesterskab skal opstå gennem prioriteringer, forståelse
af konsekvenser og langsigtede valg. Vi må ikke forveksle en tæt informationsflade
med en forståelig flade. [TASTE](design/TASTE.md) er fortsat UI-kilden; D-005
godkender ingen ændret sideopskrift eller konkret onboardingmekanik.

### Talentprojektets udfald (D-010, ejer-valgt 10/9)

En lovende ung rytter kan udvikles fornuftigt gennem flere sæsoner og ende som en
god hjælper uden at blive den håbede stjerne. Det er et almindeligt acceptabelt
udfald: god management skal forbedre karrieren, men garanterer ikke stjernestatus.
Undervejs skal der være troværdige tegn på udviklingen og brugbare muligheder for
rytteren. En god karriere skal kunne have værdi for klubbens historie og mål.

Dette fastlægger oplevelsen, ikke en ny tilfældighedsmodel eller skjult stopregel.
[PROGRESSION_RULES](PROGRESSION_RULES.md) ejer udviklingsreglerne, og
[TRAINING_RULES §13](TRAINING_RULES.md) ejer den allerede besluttede ærlige score.
**Ejerønske (R-001, 10/9):** gode måder at følge ryttere "af egen avl", med
Football Manager som inspiration. **D-011, valgt 10/9:** Den automatiske kreds
omfatter eget akademi og unge, som klubben har købt og udviklet en væsentlig del
af karrieren. Oprindelse og udviklingsarbejde vises tydeligt adskilt som "fra
vores akademi" og "udviklet hos os". **D-012, valgt 10/9:** "Udviklet hos os"
kræver mindst tre sæsoners samlet ungdomstid hos klubben frem til og med
U23-perioden. Opholdstid er grundlaget, ikke en bestemt evnefremgang.
Delvise sæsoners opgørelse og historisk datadækning skal præciseres.
**D-013, valgt 10/9:** Udviklingshistorikken bliver offentlig på klubprofilen,
og manageren får eget praktisk overblik. Andre klubbers private træningsoplysninger
følger ikke med. [SOCIAL_RULES](SOCIAL_RULES.md) ejer synlighedens principnote.
Hvordan opfølgningen præsenteres, og hvilke begivenheder der fremhæves, afklares videre.
Der er endnu ikke valgt liste, notifikationer, loyalitetsbonus eller ny statistik.

## 3. Bogens planlagte indhold og undersøgelsesrækkefølge

Dette er en samtalerækkefølge, ikke en ændring af leverancerne i MASTERPLAN.

| Del | Det designet skal forklare |
|---|---|
| Identitet og publikum | Målspiller, managerfantasi, designprincipper, fravalg og definition af succes |
| Spillerens tid | Første besøg, dag/uge/sæson, tilbagevenden, offline-spil og automatisering |
| Rytterne | Identitet, evner, usikkerhed, scouting, udvikling, helbred, karriere og tilknytning |
| Sportslig konkurrence | Kalender, udtagelse, roller, taktik, simulation, resultater, ligaer og sæsonskift |
| Klubben som virksomhed | Økonomi, kontrakter, transfers, auktioner, lån, personale, faciliteter, sponsorer og bestyrelse |
| Generationer og verden | Akademi, ungdomstrupper, AI, rivalisering, sociale relationer, historie og anerkendelse |
| Oplevelse og tillid | Informationshierarki, mobil/desktop, tilgængelighed, hjælp, fairness, premium og spillerkommunikation |
| Helheden og validering | Systemkoblinger, flaskehalse, udnyttelsesmuligheder, måling, scenarier og kriterier for redesign |

Det detaljerede [dækningsregister](design/gdd/COVERAGE.md) skal også rumme systemer,
der ikke er synlige som menupunkter. Ruter og FEATURE_REGISTRY bruges til at opdage
oversete områder; de er ikke i sig selv bevis for et fuldt gennemgået spil.

## 4. Sådan bedømmer vi et system

For hvert system skriver vi en sammenhængende designbeskrivelse med følgende indhold:

1. **Formål:** hvilken oplevelse og hvilket spillerbehov retfærdiggør systemet?
2. **Beslutning:** hvad vælger spilleren, med hvilken viden, pris og mulighed for at fortryde?
3. **Konsekvens og feedback:** hvordan mærkes valget, og hvordan lærer spilleren af udfaldet?
4. **Tid:** hvad sker ved hyppige besøg, få besøg, fravær og sæsonskift?
5. **Dybde:** hvornår er forskellige strategier fornuftige; hvornår bliver valget løst eller ren administration?
6. **Sammenhæng:** hvilke andre systemer påvirker det, og hvem bærer omkostningen?
7. **Fairness:** hvad betyder anciennitet, betaling, viden, tidszone, samarbejde og automatisering?
8. **Bevis:** hvilke observationer støtter designet, og hvilke scenarier eller spillerforsøg kan falsificere det?

Kritik formuleres som problem, kilde, berørt spiller, tradeoff, alternativer og
anbefaling. Designerens smag markeres som vurdering. En hypotese må ikke blive en
bug eller en udviklingsopgave alene ved gentagelse.

## 5. Dokumenternes ansvar

| Dokument | Ejer dette ansvar |
|---|---|
| Denne GDD | Spillets samlede intention, oplevelse, principper og koblinger, efter sektionvis godkendelse |
| Områdets eksisterende SSOT | Detaljerede gældende regler og eksplicitte fremtidige ejerbeslutninger |
| DECISIONS | Begrundelser, alternativer, ejerens svar, uenigheder og ændringshistorik |
| COVERAGE | Hvad vi har læst, verificeret, diskuteret og godkendt; hvad vi endnu ikke ved |
| SESSION_LOG | Ejerens væsentlige formuleringer og kort handoff til næste samtale |
| FEATURE_REGISTRY + kode/prod-bevis | Implementationsstatus; en GDD-beslutning er ikke et bevis for live adfærd |
| GitHub-issues + MASTERPLAN + NOW | Leverancer, godkendt rækkefølge og aktivt arbejde |

GDD'en er en samlet læseflade med kapitler og bilag, ikke en ny kopi af alle regler.
Ved konflikt citeres begge kilder og deres datoer; konflikten registreres og løses
eksplicit. Ved en godkendt ændring opdateres det relevante områdedokument i samme
PR. Historiske specs bevares som historik og må ikke stiltiende overtrumfe nyere
ejerbeslutninger. Ingen blanket-erstatning af eksisterende SSOT'er er godkendt.

Præcise private balancetal og formler publiceres ikke i denne bog, offentlige issues
eller kommentarer. De henvises med symbol og fil til den eksisterende private
dokumentation. Øvrig varig designkontekst gemmes i versionsstyrede repo-dokumenter
og pushes løbende til GitHub. Lokal memory og chatopsummeringer er kun genveje.

## 6. Arbejds- og godkendelsesstatus

En beslutning kan være **spørgsmål**, **hypotese**, **anbefaling**,
**ejer-godkendt** eller **afløst**. Et evidenspunkt kan være **dokumenteret**,
**kodekontrolleret**, **testet** eller **prod-observeret** med dato og kilde.
De to akser må ikke blandes: godkendelse beviser intention, observation beviser adfærd.

Efter et væsentligt svar bevares ejerens relevante ord og designerens fortolkning
hver for sig. Vi afklarer fortolkningen, hvis den har konsekvens for spilleroplevelsen.
En tidligere godkendelse genåbnes kun med en konkret grund; åbne ønsker bliver
ikke automatisk til løfter. Bogens samlede godkendelse afventer gennemgangen.

Et kapitel er klar til godkendelse, når centrale tradeoffs er besluttet, kilder er
afstemt, væsentlige huller er synlige, og en verifikationsplan er aftalt. En ny
funktion kræver desuden repoets særskilte design-go og visuelle bevis før release.

## 7. Scenarier der skal forbinde kapitlerne

Disse er foreslåede designprøver, ikke vedtagne balancekrav:

- Ny manager uden stor cykelviden: første meningsfulde valg og første forståelige resultat.
- Erfaren manager med begrænset tid: konkurrencedygtig planlægning og konsekvenser af en uges fravær.
- Lille klub mod etablerede klubber: realistiske delmål, progression og troværdig vej frem.
- Hjemmeavlet talent fra intake til gennembrud, mulig transfer og afsluttet karriere.
- Sportslig og økonomisk modgang: nederlag, skade, nedrykning og mulighed for genopbygning.
- Samme intention på mobil og desktop; forståelige deadlines på tværs af tidszoner.
- Marked og konkurrence ved få mennesker, høj aktivitet og forsøg på at udnytte reglerne.

For hver prøve fastlægger vi forventet spilleroplevelse, afgørende valg, målemetode
og hvad der ville få os til at ændre designet. Kodechecks kan bevise en regel, men
spillerens forståelse og glæde kræver observation og samtaler med spillere.

## Ændringslog

- 10/9 2026: mandat, kildestruktur og dækningsregister oprettet; vision V-001
  bevaret; D-001 om selvstændige succesveje og D-002 om klubidentitet valgt;
  bestyrelsesrework afstemt; D-003 om bestyrelsens rolle og D-004 om spillerens tid
  valgt; D-005 om to målgruppeindgange, D-006 om besøgslængde og D-007 om
  markedsaktivitet valgt; D-008 om købeklubben og vid valgfrihed valgt.
  Interview pauset efter Q-009 med genoptagelsesbrief og spørgsmålstekster.
  Genoptaget fra `c51231e5` samme dag; D-009 om fri omlægning valgt efter kodekontrol.
  D-010 om talentprojektets usikkerhed valgt; Q-012 besvaret med ønske R-001
  om at følge egen avl og mere konkrete spørgsmål. D-011 om afgrænsningen valgt;
  D-012 om tre sæsoners ungdomstid og D-013 om offentlig/eget overblik valgt;
  Q-016 om opfølgning siden sidst stillet.
  Ingen nye spilmekanikker besluttet. Patch notes og FEATURE_REGISTRY-ændring er
  ikke relevante for dette dokumentationscheckpoint, fordi spilleradfærd og featuretilstande er uændrede.
