# Nye rytterevner med et konkret formål

**Status:** forslag under R-003, 10/9 2026. **D-021:** ejeren vil arbejde videre
med alle fire kandidater, med Holdarbejde først. Konkrete effekter er ikke
godkendt til build. Ejerens D-019 om erfaring gennem evner består; nye forslag er ikke
en genindførelse af skjult løbsrutine under et andet navn.

[GDD](../../GAME_DESIGN_DOCUMENT.md) · [Beslutninger](DECISIONS.md) ·
[Træning og løb](TRAINING_RACE_DEVELOPMENT_RESEARCH.md).

**SSOT:** [PROGRESSION_RULES](../../PROGRESSION_RULES.md),
[RACE_ENGINE_RULES](../../RACE_ENGINE_RULES.md), [TRAINING_RULES](../../TRAINING_RULES.md).
Evneinventar: `backend/lib/abilityRegistry.js`.
[HOWTO_ADD_ABILITY](../../HOWTO_ADD_ABILITY.md) er læst som integrationsreference;
dens historiske issue-statusser er ikke genmålt og bruges ikke som aktuelle blockers.

## Hvad vi allerede har

Kodekontrol 10/9 på den eksisterende designbranch viser **15 registrerede evner**:
climbing, time_trial, flat, tempo, sprint, acceleration, punch, endurance,
recovery, durability, descending, cobblestone, positioning, aggression og tactics.
Listen dokumenterer registry-indhold, ikke en fuld verifikation af alle deres effekter.

RACE_ENGINE_RULES' katalog nævner allerede tre ejer-valgte stats: dagsform-
stabilitet, vejrteknik og højdetolerance. De er derfor **eksisterende designretning**,
ikke nye idéer her. Bygget/aktiveret status for hver er ikke afgjort af dette inventar.

Der er allerede holdspil og leadout. Kodekontrol af v4's `mechanics/teamPlay.ts`
viser en mekanik for hjælperens pris og kaptajnens beskyttelse.
`mechanics/leadout.ts::QUALITY_KEYS` bruger positioning, tempo og acceleration.
En ny holdarbejdsevne skal bidrage med noget særskilt og undgå dobbelt belønning.

## Hvad jeg låner fra Football Manager

FM24's officielle manual skelner mellem samarbejde, ro under pres, lederskab,
taktiske valg og positionering. Det nyttige er, at profiler kan være værdifulde
på forskellige måder; navnene alene er ikke en grund til at tilføje dem.
Manualens mekanikker og skala kopieres ikke.
[FM24, Mental Attributes](https://community.sports-interactive.com/sigames-manual/football-manager-2024/players-r4958/).

Særligt FM's samarbejdsbegreb omfatter også efterlevelse af instruktioner.
Jeg anbefaler en snævrere Cycling Zone-evne: **kvaliteten af holdarbejdet**, så
et lavt tal ikke i sig selv giver rytteren lov til at ignorere managerens ordre.
De følgende effekter er vores egne forslag, ikke dokumenterede FM-formler.

## Min prioriterede liste

| Kandidat | Nyt managerbehov den kan dække | Afgrænsning | Anbefaling |
|---|---|---|---|
| **Holdarbejde** | Vælg den rigtige beskytter/leadout frem for bare højeste samlede rating | Kvaliteten af hjælpen til andre, ikke egen rå styrke eller villighed til at adlyde | **Stærkeste første kandidat** |
| **Ro under pres** | Skeln mellem gode ryttere i kritiske situationer | Situationsbestemt udførelse, ikke generel dagsform eller et skjult fradrag i alle evner | **Næste kandidat, hvis effekten kan afgrænses** |
| **Lederskab** | Giv rutinerede ryttere værdi i udvikling og organisering | Påvirkning af andre, ikke nødvendigvis den sportsligt beskyttede kaptajn | Senere, sammen med et reelt mentor-/organiseringssystem |
| **Træningsdisciplin** | Gør træningsmiljø og individuelle vaner relevante | Skal kunne påvirkes meningsfuldt; må ikke bare være et ekstra potentialetal | Afvent; stor risiko for overlap og en obligatorisk købsfiltrering |

## Holdarbejde: den tydeligste nye rolle for en evne

**D-022, ejer-valgt 10/9:** To ryttere kan levere sammenlignelig fysisk indsats, men
den dygtige hjælper omsætter den mere effektivt til læ, koordinering eller
et brugbart leadout for en holdkammerat. Han kan stadig være en dårligere
selvstændig afslutter. Det skaber en begrundelse for at udvikle og beholde ham.
Ejeren tilføjer, at kaptajnens egen høje Holdarbejde også skal gøre hjælperne
mere villige til at arbejde for ham, fordi han har støttet dem. Forholdet
er valgt i **D-023:** egenskaben giver en startvirkning, som faktisk godt
samarbejde med holdet kan styrke.
Dette skal afgrænses fra Lederskab. **D-024:** kaptajnens effekt er bedre
samarbejde inden for valgte ordrer, uden automatisk ekstra træthed. Det eksisterende
holdarbejde har stadig sin pris; effekten må ikke skabe ubegrænset hjælp.

Det nye valg er: "Hvem hjælper bedst med denne opgave på denne rute?" En billigere
rytter kan være et bedre køb til hjælperrollen, hvis hans profil passer bedre.
Det betyder ikke, at bedre fysisk styrke straffes: med ellers samme forhold
må en stærkere rytter ikke blive dårligere af at være stærkere.

**Det skal holdes adskilt fra:**

- Taktik: læse og vælge den sportslige handling.
- Positionering: komme til og holde en god position i feltet.
- Fysisk evne og reserve: kunne følge med og levere indsatsen.
- Holdarbejde: hvor brugbar den indsats bliver for andre.

**Udviklingsvej, foreslået:** relevante holdopgaver og koordinerede teknik-/holdpas
kan udvikle evnen. At vælge rollen i en menu uden faktisk deltagelse er ikke
tilstrækkeligt. Det eksisterende erfaringssystem kan være en kilde til læringen;
evnen giver ingen ekstra generel erfaringseffekt ved siden af sit domæne.

**Grænser:** ingen gratis kræfter, ingen ubegrænset bonus fra mange hjælpere,
ingen hjælp fra en rytter som slet ikke er i situationen, og ingen automatisk
ordrenægtelse ved lavt tal. Leadout og beskyttelse skal afstemmes som forskellige
forbrugere, så en ny evne ikke tælles dobbelt oven i de eksisterende årsager.

**Eksempel på ønsket feedback, ikke godkendt copy:** "Hans holdarbejde hjalp
kaptajnen med at bevare en god position før finalen." Den tekst kræver en
faktisk registreret effekt; den må ikke blot genereres ud fra et højt tal.

## Ro under pres: lovende, men med en streng adgangsprøve

En rytter kan være dygtig og have den rigtige plan, men udføre den dårligere
i et kritisk øjeblik. Forslag: evnen hjælper med at fastholde en god udførelse
under pres i fx en tæt finale eller et afgørende taktisk øjeblik.

**Afgrænsning:** taktik vedrører den sportslige vurdering; ro vedrører udførelsen
under pres. Dagsform-stabilitet handler om variation mellem dage. Hvis motoren
ikke kan adskille disse effekter og vise deres konsekvenser, bør vi ikke tilføje
en ny evne. Så skal de eksisterende stats løse opgaven.

Jeg fraråder "hader store løb" som et ubestemt fald i alle evner. Et prestigeskilt
må heller ikke gøre en ellers rutinemæssig situation nervøs. Presset skal have
en konkret situation, og erfaring skal kunne bidrage til udvikling uden at
tilføje D-019's fravalgte skjulte rutinebonus igen.

## Lederskab og træningsdisciplin kræver mere end et tal

**Lederskab** kan give veteranen en legitim plads i en ung trup: organisering,
støtte eller videregivelse af kunnen. Men først skal der være et meningsfuldt
system med et valg, en begrænset virkning og en forklaring. Flere ledere må ikke
bare lægges sammen til gratis holdstyrke. Kaptajnrollen i løbet er ikke automatisk
det samme som at være truppens leder. Derfor anbefaler jeg at parkere evnen,
indtil vi har designet den relevante relation eller mentoropgave.

**Træningsdisciplin** kan i princippet handle om stabile vaner og kvaliteten af
at gennemføre programmet. Men hvis den bare ganger udviklingsfarten, dublerer
den potentiale og bliver en næsten obligatorisk høj værdi ved alle talentkøb.
Den er først interessant, hvis manageren kan påvirke problemet gennem få
meningsfulde valg. Dagligt ros-/skældud-arbejde ville kollidere med D-004/D-006.

## Det jeg ikke ville tilføje som nye stats nu

| Idé | Hvorfor den foreløbig ikke fortjener eget tal |
|---|---|
| Læringsevne | Potentiale styrer allerede udviklingsfarten |
| Ekstra taktisk intelligens/anticipation | Stort overlap med tactics og positioning uden en ny tydelig beslutning |
| Koncentration + ro + dagsform-stabilitet på én gang | For mange nærtliggende forklaringer på samme dårlige resultat |
| Ekstra træthedsmodstand | Skal først skelnes fra endurance, recovery og durability |
| Arbejdsvillighed som automatisk indsatsvalg | Manageren vælger allerede rolle og intention; kan udhule handlefriheden |
| Loyalitet som direkte løbsbonus | Blander tilknytning med fysisk/sportslig effekt; bør høre til kontrakt-/relationsdesign |

## Hvordan de kan passe til den enkle brugerflade

En god evne behøver ikke altid endnu en kolonne på alle skærme. Den skal være
tilgængelig og forklaret dér, hvor den ændrer valget: fx valg af hjælpere, rytterens
udviklingsplan eller scouting. Præcis synlighed, skala og fog of war er ikke valgt.

Stat, erfaring og rolle er tre forskellige ting: **evnen** beskriver dygtighed,
**erfaringen** dokumenterer læringsbaggrund, **rollen** er managerens opgave til
rytteren. Et fremtidigt godkendt nyt stat skal høre til samme evnesystem; det
er ikke en undtagelse fra D-019 eller et nyt usynligt erfaringslag.

## Før nogen bygger en ny evne

1. Vis et konkret før/efter-scenarie, hvor evnen ændrer en relevant beslutning
   uden blot at gentage eksisterende stats.
2. Afklar navnet og domænet med ejeren, inklusive hvad evnen aldrig påvirker.
3. Kortlæg påvirkningen på generation, progression/lofter, typeklassifikation,
   visningsrating, scouting, værdi/løn og motor. De er forskellige kontrakter;
   én registry-post må ikke stiltiende ændre dem alle.
4. Afstem de tre allerede planlagte stats, før det samlede evnesæt udvides.
5. Test relevante profiler og roller over flere løb: forbedring af andre evner
   må ikke blive en straf, og en ny stats må ikke gøre alle gamle ryttere defekte.
6. Aftal behandling af eksisterende ryttere og manglende historik. Ingen
   tilfældig masseomskrivning eller påstået præcis historisk rekonstruktion.
7. Vis desktop/mobil efter PAGE_TEMPLATES/TASTE; fastlæg test-tier og staging-runde
   som del af det konkrete design. Ingen af disse featureprøver er udført her.

**Aktuel ejerretning D-021:** Holdarbejde først. Ejeren ønsker også at tale om
at få de øvrige kandidater med; min oprindelige anbefaling om at afvente nogle
er ikke en ejerbeslutning om at fravælge dem. D-022 vælger mere hjælp for samme
indsats og tilføjer kaptajnens gensidige holdånd. D-023 vælger startvirkning
plus fælles samarbejde. D-024 vælger bedre koordinering uden automatisk ekstra
træthed. Q-028 om samspillets tilhørsforhold ved klubskifte afventer;
den konkrete mekanik og balance er ikke godkendt til build.
