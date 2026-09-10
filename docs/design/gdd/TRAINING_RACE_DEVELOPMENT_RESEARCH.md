# Træning, løb og de første store erfaringer

**Status: research og designforslag, 10/9 2026. Ikke ejerbesluttet eller godkendt
til build.** Udarbejdet efter ejerens R-002 under Q-020. Det tidligere A/B-valg
er ikke besvaret; denne undersøgelse udvider beslutningsgrundlaget.

[GDD](../../GAME_DESIGN_DOCUMENT.md) · [Ejerens svar og beslutninger](DECISIONS.md)
· [Journal](SESSION_LOG.md).

**Eksisterende SSOT:** [TRAINING_RULES](../../TRAINING_RULES.md) §6/§12/§13,
[PROGRESSION_RULES](../../PROGRESSION_RULES.md), [RACE_ENGINE_RULES](../../RACE_ENGINE_RULES.md)
§1b/§2e og [YOUTH_RULES](../../YOUTH_RULES.md). Hele reworkdesignet fra
[6/9](../../superpowers/specs/2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md)
er læst. Forslaget ændrer ikke disse regler uden nye ejerbeslutninger.

## Anbefalingen

Bevar én dagsaktivitet: træning **eller** løb. Lad begge udvikle rytteren, men
med forskellig præcision og erfaring. Et passende løb giver fysisk stimulus
og læring i konkurrencesituationen. Målrettet træning kan være bedst til at
bearbejde bestemte svagheder. Store debuter er betydningsfulde lærings- og
historieøjeblikke, ikke en automatisk pakke med gratis evnepoint.

Jeg anbefaler at lade **passende udfordring, relevant deltagelse og ny erfaring**
bestemme løbets udviklingsværdi. Kategorien bidrager som signal om miljøet, men
er ikke en universel multiplikator for hele udviklingen. En WorldTour-start
skal ikke mekanisk være det bedste udviklingsvalg for enhver ung rytter.

Dette er mit forslag. Kilderne nedenfor giver inspiration og realismegrundlag;
de beviser ikke den konkrete spilmodel eller en bestemt balance.

## Hvad Football Manager faktisk beskriver

**S1 — FM24's officielle manual, afsnit Development.** Den beskriver udvikling
gennem træningsmiljø, trænere, passende planer og meningsfuld spilletid. Første-
holdsminutter tillægges større værdi end ungdoms-/reservekampe. Den beskriver
også taktisk fortrolighed gennem erfaring og mentoring af mentale egenskaber
og spilletræk. Det er dokumenteret design, ikke adgang til motorens formler.
[Kilde](https://community.sports-interactive.com/sigames-manual/football-manager-2024/players-r4958/).

**S2 — FM26's officielle hjemmeside, guide af InvWingbacks, 2/12 2025.** Guiden
anbefaler en udviklingsvej med træning, gradvist større ansvar og spilletid på
et passende niveau. Forfatterens aldersopdelte råd er en strategiguide, ikke
bevis for præcise skjulte aldersgrænser i motoren.
[Kilde](https://www.footballmanager.com/the-dugout/top-tips-youth-development-fm26).

**Det nyttige at låne:** manageren tilrettelægger en udviklingsvej, hvor
træningsmiljø, niveau og reel deltagelse supplerer hinanden. Det er mere
interessant end at kopiere et pointsystem eller en påstået universel formel.
Disse kilder dokumenterer ikke en fast evnebonus ved spillerens første kamp
i en prestigeturnering. Debutmekanikken nedenfor er derfor vores eget forslag.

## Hvad der er troværdigt i cykling

**S3 — Gallo m.fl., 2022, 30 mandlige junior-, U23- og professionelle ryttere.**
Racebelastningen varierede mellem kategorierne; professionelle havde større
absolut belastning, mens juniorer tilbragte en større andel af løbene i høje
interne intensitetszoner. Studiet er tværsnitsbaseret og viser belastning, ikke
at højere kategori kausalt giver bedre langsigtet udvikling.
[Abstract og DOI](https://pubmed.ncbi.nlm.nih.gov/34996033/).

**S4 — Clark m.fl., 2014, kontrolleret træningsforsøg med 28 mandlige cykelryttere.**
En fokuseret træningsintervention forbedrede enkeltstartspræstation; restitution
og individuelle forskelle var vigtige for fortolkningen. Det støtter værdien
af struktureret træning, men er ikke et forsøg med unge debutanter eller en
direkte sammenligning mellem træningsblok og løb.
[Originalartikel](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0115308).

**S5 — UCI World Cycling Centre, praksisbeskrivelse om juniorer.** Juniorryttere
arbejdede med feltposition, kontakt, sving og beslutninger gennem tekniske
øvelser og evaluering af løb. Det viser, hvorfor fysisk kapacitet og anvendelsen
af den i et felt ikke bør være samme begreb. Det er trænerobservationer, ikke
et kontrolleret effektforsøg.
[UCI](https://www.uci.org/article/junior-women-sharpen-technical-skills-at-world-cycling-centre-166923/1EF8gtq9SbnSoX13jGd7fI).

**S6 — UCI World Cycling Talent, program beskrevet i 2026.** Programmet kombinerer
træning, regional konkurrence, professionel støtte og individuel udvikling.
Det giver et konkret eksempel på en gradvis udviklingsvej; det dokumenterer
ikke en bonus ved bestemte debuter.
[UCI-programmet](https://www.uci.org/pressrelease/after-africa-the-world-the-uci-and-uci-wcc-unveil-programme-to-develop-cycling-talent-across-the-globe/5C3tILsNVQEModjELXFV9u).

Kilder læst 10/9 2026. FM24-manual og FM26-guide holdes adskilt; der er ikke
foretaget en egen simulering eller en sammenlignende FM-test. Sportsstudiernes
resultater bruges ikke til at fastsætte spillets konstanter.

## Tre mulige designretninger

| Retning | Styrke | Risiko | Vurdering |
|---|---|---|---|
| A: højere løbskategori + debutbonus giver mere samlet udvikling | Let at forklare, gør store invitationer attraktive | Kapløb om for tidlige debuter, forspring til adgangsstærke klubber, gentagen bonusjagt | For simpelt som hovedmodel |
| B: passende udfordring + fysisk stimulus + erfaring i relevante situationer | Giver træning, løbsvalg og gradvise debuter forskellige styrker | Kræver tydelig feedback og afgrænset historik om erfaring | **Anbefalet** |
| C: fuld model med personlighed, selvtillid, mentorer og mange erfaringstal | Stor variation i karrierer | Mange nye systemer, uklare årsager, høj administrations- og balanceomkostning | Mulig senere udvidelse, ikke nødvendigt fundament |

## B udfoldet: dybde gennem managerens valg

### 1. Træning er præcis; løb er situationsbestemt

En træningsblok kan målrette fx klatring eller enkeltstartsteknik og give et
forudsigeligt fokus. Løbet giver stimulus fra det, rytteren faktisk udsættes
for: terræn, varighed, rolle og indsats. Begge bruger samme grundlæggende
udviklingsregler og restitution; der gives aldrig både fuldt pas og fuldt
løbsudbytte for samme løbsdag.

Fysisk udvikling og løbslæring er to **årsager til udvikling**, ikke nødvendigvis
to nye valutaer i brugerfladen. Første version bør undersøge brug af eksisterende
evner som tactics og positioning frem for en ny universel XP-bar. Teknik og
løbsforståelse kan også trænes; de gøres ikke eksklusivt tilgængelige ved løb.

### 2. Kategorien sætter scenen; passende udfordring er afgørende

Et højere niveau kan give nye erfaringer med tempo, felt og opgavekrav. Men det
giver ikke automatisk mere fysisk udvikling. En rytter, som kan deltage
meningsfuldt på et lavere niveau, kan lære mere dér end ved gentagne gange at
blive sat helt uden for konkurrencen på et langt højere niveau.

"Passende" skal handle om belastning og opgave i forhold til forberedelse,
ikke blot slutplacering eller rytterens samlede rating. En hjælper kan arbejde
godt og slutte langt tilbage. En debutant kan gennemføre en vigtig opgave uden
at være nær topresultater. Det må ikke blive en ekstra bonus til dem, der
allerede vinder. Udmattelse er ikke en genvej til bedre læring.

Kategorien er et brugbart signal, men et højere skilt på samme reelle udfordring
må ikke alene skabe mere udvikling. Samtidig kræver modellen ikke en ny
registreringslås: en risikabel debut kan være et frit valg med tydelige følger.

### 3. Debuter er begyndelsen på tilvænning, ikke et engangsloot

Lad de første meningsfulde erfaringer med et nyt konkurrencemiljø være særligt
lærerige, og lad den ekstra læring aftage, når situationen bliver velkendt.
Eksempler til afklaring: større/tættere felt, brostensløb, længere etapeløb,
ny holdopgave. "Første store løb" er et historieøjeblik; læringen kan foregå
over flere relevante deltagelser. En startlisteplacering alene er utilstrækkelig.

Den nødvendige deltagelse må ikke reduceres til "gennemfør eller intet": et
styrt efter meningsfuldt arbejde skal ikke udslette alt udbytte, mens en meget
kort bevidst afbrudt deltagelse ikke må give fuld debutværdi. Konkrete kriterier
skal designes mod de hændelser, motoren faktisk kan dokumentere.

Erfaring hører til rytteren og følger med ved transfer og sæsonskifte.
Den nulstilles ikke for at kunne høste debutgevinsten igen. Overlappende
førstegange i samme løb må ikke stables til et uforholdsmæssigt spring.

### 4. Ungdom giver tid og modtagelighed; uerfarenhed giver nyhedsværdi

Jeg ville ikke blot gange en debutbonus ekstra op, fordi rytteren er ung.
Alder påvirker allerede udviklingen. Det risikerer at tælle ungdom to gange
og gøre meget tidlig eksponering til den eneste optimale vej.

Unge får ofte større samlet udbytte, fordi de både har udviklingsevne og mange
uprøvede situationer. En erfaren 27-årig kan stadig lære ved sin første reelle
erfaring med brosten eller et langt etapeløb. Han får ikke automatisk samme
fysiske fremgang som en ung. Der er ingen skjult aldersfrist, hvor en vigtig
debut permanent er "spildt".

### 5. Dybden skal ligge i planen

Manageren planlægger passende løb, opgaver og træningsperioder og ser virkningen
ved sine almindelige besøg. Ingen ny daglig bonusknap eller nødvendigt liveklik.
Eventuelle assistentforslag kræver samme respekt for managerens valg som i
ASSISTANT_RULES; automatisk overtagelse af programmet er ikke foreslået.

Et senere lag kan lade træner eller erfaren holdkammerat hjælpe med at omsætte
erfaring til læring. Jeg ville ikke samtidig indføre særskilt selvtillid,
personlighed og en ny mentorøkonomi i fundamentet. De skal først retfærdiggøres
som selvstændige valg og afstemmes med eksisterende personale- og holdspilssystemer.

## Tre konkrete karriereforløb

| Rytter | Fornuftigt valg i eksemplet | Hvad manageren lærer |
|---|---|---|
| Ung klatrer med fysisk svaghed | Målrettet træningsblok, så passende løb | Træning kan være investeringen; løbet prøver og udvikler anvendelsen |
| Ung hjælper klar til større felt | Gradvis introduktion med en reel holdopgave | Dårlig egen placering er ikke ensbetydende med dårlig læring |
| Erfaren rytter uden erfaring med brosten | Teknikforberedelse og passende debut | Ny erfaring har værdi også sent, uden en generel ungdomsbonus |

Det er illustrative forløb, ikke garantier for udfald. Et fremragende ungt
talent kan være klar tidligt; en sen udvikler må ikke gøres irrelevant.

## Enkel feedback oven på dybden

Forslag til korte spillertekster, **ikke godkendt copy**:

- "Næste løb: passende udfordring. Ny erfaring med et større felt."
- "Udviklingsfokus: målrettet klatretræning passer bedst til den aktuelle svaghed."
- "Efter løbet: værdifuld erfaring i positionering; høj belastning kræver restitution."
- "Første store etapeløb: karrieremilepæl."

Hold erfaring, fysisk udbytte og karrierefejring adskilt i forklaringen. Den
allerede besluttede ærlige træningsscore ændres ikke til at måle løbets prestige.
Spilleren behøver ikke se private vægte eller en række skjulte målere for at
forstå sin plan. En sådan flade skal godkendes visuelt senere.

## Det vi skal modbevise før build

- Højeste kategori er ikke bedst for alle unge, når kvaliteten af deltagelsen
  og forberedelsen varierer. Lavere divisionsadgang må ikke give en permanent
  udviklingslås. Det skal testes sammen med kalender og invitationer.
- Hjemmetræning har et reelt fortrin i relevante forløb; gentagen træning alene
  eller maksimal løbsmængde må ikke være et universelt svar.
- Hjælpere kan få meningsfuldt udbytte uden topplacering. All-out og overbelastning
  må ikke give gratis udvikling uden en reel efterfølgende pris.
- Ingen dobbelt kredit pr. løbsdag; delvis deltagelse, hviledage og flere etaper
  håndteres i den nye tidsmodel, ikke med gammel kalenderdagslogik.
- Gentagne starter/afbrydelser, handler, sæsonskift og overlap mellem debuttyper
  kan ikke genudløse eller stable den samme ekstra læring.
- Sammenlign komplette forløb og sæsonudvikling, ikke kun ét isoleret tick.
  Gældende evnelofter, carry-over og udviklingsbudget skal afstemmes før kalibrering.
- AI og menneskehold følger forståeligt samme domæneregler. Manglende historik
  for ældre ryttere må ikke stiltiende gøre alle til debutanter.
- Først afklar ejerretning, så kilde-/dataaudit, model/harness og visuel prototype.
  Ingen af disse checks er bestået alene ved denne research.

## Næste beslutning

Jeg anbefaler at vælge **B som retning til videre design**. Det valg vil stadig
efterlade konkrete spørgsmål om relevante erfaringer, aldersvirkning, fordeling
af udbytte og feedback. Det er ikke en samlet godkendelse af alle forslag ovenfor,
og det ændrer ikke automatisk S4-scope eller det eksisterende rework.
