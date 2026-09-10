# Cycling Zone · Game Design Document

Status: **Arbejdende udkast, discovery startet 10/9 2026. Ikke godkendt som samlet spildesign.**
Ejer: Nicolai. Designpartner: Codex. Produktets historiske samlingspunkt: [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145).
Samlet GDD-opfølgning og Claude-overdragelse: [#5087](https://github.com/NicolaiDolmer/CyclingZone/issues/5087).

## Læs dette først

Denne bog skal forklare hvilket spil vi vil skabe, hvorfor det er værd at spille,
og hvordan systemerne tilsammen skaber den oplevelse. Den udarbejdes gennem en
kritisk designsamtale med ejeren og verificering af eksisterende dokumenter og kode.
Den er endnu ikke en udtømmende beskrivelse af spillet.

**Genoptag samtalen:** læs [sessionsjournalen](design/gdd/SESSION_LOG.md), derefter
[beslutninger og spørgsmål](design/gdd/DECISIONS.md). Find områdets kilder i
[dækningsregistret](design/gdd/COVERAGE.md). V-001 og D-001 til D-028 er registreret.
**Overdraget til Claude Code efter Q-031, 10/9:** intet åbent spørgsmålskort.
Læs [CLAUDE_HANDOFF](design/gdd/CLAUDE_HANDOFF.md) for kort beslutningsoversigt,
næste designarbejde og læserækkefølge; [GitHub-kortet](design/gdd/GITHUB_HANDOFF.md)
viser hvor de endnu ikke byggede dele er registreret.
Konceptspor: [Egen avl](design/gdd/RIDER_LEGACY.md),
[træning og løb](design/gdd/TRAINING_RACE_DEVELOPMENT_RESEARCH.md) og
[nye evner/Holdarbejde](design/gdd/RIDER_ATTRIBUTES_RESEARCH.md).
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
**D-040 (ejer-valgt 10/9 med tilføjelse):** retningen erklæres som 2-3 valg
fra et bredt katalog med primær og sekundær vægt ("gerne med endnu flere
muligheder der passer godt ind i spillet"). Bestyrelsens mandat udledes af
retningerne; de fem DNA-pakker bliver forudfyldte kombinationer, ikke låse.
Kataloget, antallet og migrationen fra DNA er åbne; reworkets release er uændret.
**D-041 (ejer-valgt 10/9 med forbehold):** omdømme er "kendt for"-mærker
optjent af handlinger, ikke ét tal, og ejeren udvidede det til et netværk:
hold, lande, managers, personale, ryttere og løb har hver sit omdømme, og de
påvirker hinanden (en rytter vinder omdømme ved at vinde et løb med højt
omdømme; et løbs omdømme stiger med feltets kvalitet). Eksisterende planer om
omdømme, fans og merchandise skal læses og afstemmes, før noget designes
konkret (research i `design/gdd/REPUTATION_RESEARCH.md`).
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
**D-015, valgt 10/9:** Flere kvalificerende klubber kan stå som udviklingsklubber
og følge rytteren automatisk. Opholdsperioderne er synlige; akademioprindelsen
bliver hos den oprindelige akademiklub. Ingen klub kåres som vigtigst.
**D-013, valgt 10/9:** Udviklingshistorikken bliver offentlig på klubprofilen,
og manageren får eget praktisk overblik. Andre klubbers private træningsoplysninger
følger ikke med. [SOCIAL_RULES](SOCIAL_RULES.md) ejer synlighedens principnote.
**D-014, valgt 10/9:** Eget overblik samler udvalgte milepæle i "Siden sidst" med
adgang til rytterens detaljer. Den præcise milepælsliste afventer; en strøm med
alle løbsresultater og en ren liste uden opsummering er fravalgt som grundmodel.
**D-016/D-017:** Personlige gennembrud vægter højt; i det forelagte eksempel står
hjælperens første mindre sejr over stjernens endnu en almindelig WorldTour-etape.
Manageren kan desuden manuelt følge en personlig favorit uden at tildele klubben
et offentligt udviklingsmærke. Det samlede koncept, scenarier, åbne detaljer og
verifikationsplan står i [Rytterhistorier og egen avl](design/gdd/RIDER_LEGACY.md).
Der er endnu ikke valgt liste, notifikationer, loyalitetsbonus eller ny statistik.

### Træningens allerede besluttede rework

GDD-samtalen bygger videre på [TRAINING_RULES §13](TRAINING_RULES.md) og
[designet fra 6/9](superpowers/specs/2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md),
samlet i #4850. Ejeren fremhævede dette igen ved Q-020 den 10/9.

- Hver rytter enten træner eller kører løb pr. løbsdag; løb giver selv udvikling.
- Løbsdagen bliver træningens tidsenhed; divisionerne får samme antal løbsdage.
- Programmerne kører automatisk; den manuelle træningsknap og klikbonus udgår.
- Løbsintentionen vælges med de taktiske valg og forbinder løb, træthed og udvikling.
- Træningsscoren måler passets kvalitet, er ærlig og ses kun af egen manager.

Dette er tidligere ejerbeslutninger, ikke nye forslag eller et samlet bevis for
leverance. Q-020 angår alene det relative udviklingsudbytte af de to aktiviteter
og har endnu ikke ændret den ældre prioritering af passende løb. Ejeren foreslog
under Q-020 at undersøge kategori og unge rytteres første store erfaringer.
[R-002-researchen](design/gdd/TRAINING_RACE_DEVELOPMENT_RESEARCH.md) sammenholder
officielle FM-kilder, cykelstudier og UCI-praksis. **D-018, valgt 10/9:** passende
udfordring og aftagende læring ved nye erfaringer er retningen til videre design.
Begge dagsaktiviteter udvikler rytteren; træning har præcision, passende løb
giver fysisk stimulus og erfaring. Højere kategori er ikke automatisk bedst
for enhver rytter. **D-019:** erfaring udvikler relevante eksisterende evner;
historikken styrer den aftagende læring uden særskilt skjult præstationsbonus.
**D-020:** fælles erfaringsområder overfører læring mellem løb; løbsnavnet alene
giver ikke ekstra udvikling. Katalog, alder og konkrete udbytter afklares; alle detaljer
i researchen er ikke godkendt ved disse valg.

**R-003/D-021:** Ejeren ønsker at arbejde videre med Holdarbejde, Ro under pres,
Lederskab og Træningsdisciplin, med Holdarbejde først. Det er prioritering af
design og interesse i kandidaterne; effekter, skala og build er ikke godkendt.
De tre allerede planlagte stats i RACE_ENGINE_RULES holdes adskilt fra nye forslag.
En ny evne skal skabe et konkret valg og afgrænses mod taktik, positionering og potentiale.
**D-022:** Hjælperens Holdarbejde giver mere brugbar hjælp for samme egen indsats.
Ejeren ønsker også, at en kaptajns høje Holdarbejde kan få mere ud af hjælperne
som følge af hans støtte til dem. **D-023:** egenskaben giver en startvirkning,
som faktisk godt samarbejde kan styrke. Relation til Lederskab, definition af
godt samarbejde og samspillets tilhørsforhold skal afklares. **D-024:** kaptajnens
effekt forbedrer koordineringen inden for valgte ordrer uden automatisk ekstra
træthed. **D-025:** opbygget samspil følger de konkrete ryttere, også ved
fælles klubskifte; nye relationer til resten af truppen skal opbygges.
Holdarbejdets pris og begrænsninger består. RACE_ENGINE_RULES er afstemt;
ingen konkret formel er valgt.
**D-026:** Lederskab har sit hovedformål i en udpeget mentorrolle og truppens
udvikling over tid. Veteranen kan være værdifuld uden at være blandt de stærkeste
i løbsopstillingen, men optager stadig plads og koster løn. Konkrete
læringsområder er i **D-027** afgrænset til mentale færdigheder og vaner som
hovedområde. Mentoren skal selv have relevant kunnen. Endelig evneliste,
antal mentees og effekt er ikke fastlagt. **D-028:** mentorindflydelsen er kun
positiv; et dårligt match giver begrænset udbytte og mulighedsomkostning,
ikke dårligere vaner/evner hos den unge. **D-029 (Claude Code, 10/9):**
manageren udpeger selv et navngivet mentorpar: én mentor og højst to mentees
i samme klub, på tværs af trupper. Udbyttet bygges op pr. løbsdag, kun på
mentale evner hvor mentoren er tydeligt bedre, og aftager når den unge nærmer
sig mentoren. Passiv trupvirkning er fravalgt. **D-030:** Lederskab bliver en
ny evne i det almindelige evnesystem; den vokser med alder og kaptajn-/mentortid,
og mentor-egnethed kræver en tærskel plus tydelig overlegenhed på den mentale
evne. Lederskab påvirker intet i løbet. Synlighed (hvem ser tallet) er
udtrykkeligt parkeret til fog of war-kapitlet. **D-031:** parret kan altid
skiftes, men et nyt par bygger udbyttet op forfra over løbsdage; det lærte
beholdes, også når parret ophører ved salg. Sæsonlås og omkostningsfrit skift
er fravalgt. Opbygningens længde, feedback og UI er åbne.

### Ungdomstrupper: kapacitet (D-032, ejer-valgt 10/9)

[YOUTH_RULES](YOUTH_RULES.md) ejer strukturen (Junior 16-18, U23 19-22, egne
løb og pyramider, ejer 2/9). GDD-samtalen tilføjer princippet for kapacitet:
alle klubber får samme grundloft pr. trup, og ekstra pladser købes som trin på
akademifaciliteten med anlægspris og stigende drift. Kapacitet følger aldrig
division eller resultater. Det giver talentfabrikken (D-001) en vækstvej og
købeklubben (D-008) et frit fravalg, uden at styrke belønnes med struktur.
Lofter, trin og priser afgøres af økonomi-simulationen i YOUTH_RULES §6.
Spillerdata 10/9 (roadmap nr. 2, skema nr. 3) fik ejeren til at løfte området
til nr. 3 på MASTERPLANs venteliste; det er en rækkefølge, ikke et build-go.
**D-039 (ejer-valgt 10/9 med præcisering):** søndagens kuld trækkes med
overvægt mod klubbens ønskede profil (nationalitet/region og ryttertype),
aldrig udelukkende, og driveren er akademifaciliteten, ikke scoutniveauet:
højere trin giver bedre muligheder i kuldet, men samme potentialefordeling
som alle andre. Klubidentitet gennem nationalitet (V-001) bliver dermed en
handling, uden at penge køber talent.
**D-033 (ejer-valgt 10/9, mod designerens anbefaling):** ingen udlån af
ryttere. Overskydende unge håndteres med købt kapacitet, salg eller bytte;
designerens forbehold om permanent tab ved salg af talent er noteret til
økonomi-simulationen.

### Holdudtagelse: den glemte trup (D-034, ejer-valgt 10/9)

[ASSISTANT_RULES](ASSISTANT_RULES.md) og [PLANNING_CENTER_RULES](PLANNING_CENTER_RULES.md)
ejer reglerne; ejerens grundregel fra 25/8 ("pull, ikke push") består. GDD-samtalen
afgjorde §12 pkt. 0: assistenten skal køre **sen udfyldning**: en helt tom trup
fyldes 24 timer før første etape, så manageren kan rette den, og spillet viser
en synlig påmindelse før fristen (#4983). Den sene redning ved etape 1 er sidste
værn. Det er svaret på D-004/D-006 for løbsdagen: 2-3 besøg om ugen må ikke
koste en Tour. Selve flippet af tilstanden og #4201's migration er ejer-gatede
prod-skridt. **D-035:** assistenten fylder altid til gulvet (6), men pladser
derover kun med ryttere over en egnetheds- og træthedsgrænse; tomme pladser
vises med årsag. Grænsen er kalibrering. **D-036 (løbsdagen):** efter et løb
får manageren et indsatskort pr. rytter: ordren, 2-4 hændelser med km fra
v4's tidslinje og én dom i klar tekst, ingen karakter; den levende tidslinje
(#4916) supplerer. Det er svaret på GDD §4's krav om konsekvens og feedback
og kræver v4-flippet. **Fog of war (Q-037)** er parkeret:
ejeren stiller spørgsmålet til spillerne som forum-afstemning med billede,
før der besluttes.

### Dag 1: første session ender i første løb (D-037, ejer-valgt 10/9)

Målt 7/9 (#4964): nye spillere har holdt 33-46 % fra uge 1 til uge 2 siden
maj, og frafaldet er bimodalt: enten binder første session, eller også er
det slut. De handlinger, der hænger sammen med at blive, er egen udtagelse og
en beslutning med konsekvens; auktionen er oftest den sidste flade før
frafald. Den nye managers første session bliver derfor én ledet bane: draft,
egen udtagelse til næste løb (assistenten forudvælger), én taktik, og
resultatet med indsatskort (D-036). Auktion, træning og bestyrelse åbner i
eget tempo bagefter. Før build skal afstanden fra tilmelding til første løb
måles, og onboarding-kortets trin 4 skal måle en reel handling.
**D-038 (dag 2-7):** krogen tilbage er hændelsesdrevet: "dit løb er kørt"
med indsatskort og næste konkrete skridt erstatter dag 1-tips, når der
findes et resultat; ingen besked uden hændelse i første uge. Samtykkehjemlen
for en resultatudløst mail er ikke juridisk efterprøvet (EMAIL_STACK §2).

### Sponsorer og bestyrelse: to roller (D-042, ejer-retning 10/9)

[SPONSOR_RULES](SPONSOR_RULES.md) og [BOARD_RULES](BOARD_RULES.md) ejer reglerne.
Ejeren satte 10/9 to ting foran ethvert sponsor-redesign: **popularitet laves
om til omdømme** (ingen selvstændig popularitetsstørrelse ved siden af D-041's
netværk), og **sponsor og bestyrelse skal have tydeligt adskilte roller**:
sponsorer primært penge og resultater, bestyrelsen primært holdets identitet
(rollefordelingen designes i Q-047). Inden for den ramme er retningen for
sponsormål (D-042): bonussen udbetales, når målet er nået, ellers ikke; ingen
tilbagebetaling og ingen straf. Grundreglerne er udskudt til efter 27/9.

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
**Interviewets betjening, ejer 10/9:** Hold ét spørgsmål åbent, indtil ejeren har
svaret. Afslut ikke turen og genudsend ikke kortet, mens han forsøger at svare.
Arbejd på uafhængige dokumentopgaver eller vent i korte intervaller undervejs.
Genvis kun ved en udtrykkelig anmodning eller konstateret behov hos ejeren.
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
  D-014 om "Siden sidst" og D-015 om flere udviklingsklubber valgt;
  D-016 om personligt gennembrud og D-017 om manuel opfølgning valgt;
  konceptkapitlet RIDER_LEGACY samlet; Q-020 om træning kontra løb stillet.
  Q-020 gav researchønske R-002; forslag med kilder gemt; D-018 grundmodel valgt;
  D-019 om eksisterende evner og D-020 om fælles erfaringsområder valgt;
  R-003 evneforslag samlet; D-021 prioriterer Holdarbejde; D-022 vælger
  hjælpervirkning og kaptajnens gensidighed; D-023 om startvirkning og samarbejde
  valgt; D-024 om bedre koordinering uden ekstra træthed og D-025 om samspil ved
  transfer valgt; D-026 om Lederskabs hovedformål og D-027 om mentalt læringsområde
  valgt; Q-031 om dårlig påvirkning stillet.
  D-028 vælger kun positiv mentorindflydelse. Session overdraget til Claude Code
  på ejerens ønske med kort beslutningsoversigt og GitHub-opgavekort.
  Ingen nye spilmekanikker besluttet. Patch notes og FEATURE_REGISTRY-ændring er
  ikke relevante for dette dokumentationscheckpoint, fordi spilleradfærd og featuretilstande er uændrede.
- 10/9 2026 (Claude Code): samtalen genoptaget efter overdragelsen. D-029 om
  navngivet mentorpar med højst to mentees valgt. Designpartner er nu Claude Code.
  D-030 om Lederskab som ny evne (kun mentor/trup) valgt; fog of war parkeret som
  eget kapitel på ejerens ønske; muligheder vises visuelt før kortet.
  D-031 om frit mentorskift med opbygning forfra valgt; mentortråden samlet.
  D-032 om ungdomstruppernes kapacitet (fast grundloft + købte udvidelser) valgt.
  D-033: ingen udlån (ejerens fravalg af designerens anbefaling).
  Q-037 (fog of war) parkeret til spillerafstemning. D-034 om sen udfyldning
  24 t før start + påmindelse valgt (kapitel: holdudtagelse og løbsdagen).
  D-035 (assistenten fylder til gulvet, derover kun egnede) og D-036
  (indsatskort pr. rytter efter løbet) valgt. D-037 om første session og
  D-038 om den hændelsesdrevne krog valgt (kapitel: dag 1 og de første 7 dage).
  D-039 om profilstyret akademikuld drevet af faciliteten valgt (ejerens præcisering).
  D-040 om retning fra et bredt katalog valgt (kapitel: klubidentitet og ambitioner).
  D-041 om omdømme som netværk valgt med forbehold om at læse eksisterende planer.
  D-042 om sponsorbonus ved opfyldelse valgt med to forudsætninger (popularitet →
  omdømme; sponsor/bestyrelse adskilles).
