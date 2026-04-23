# BOARD SYSTEM V1 — Cycling Zone

_Formål: Definere den nye bestyrelsesfunktion som et realistisk, dybt og multiplayer-egnet managersystem med simpelt UI og stærk bagvedliggende simulation._

---

## 1. Designmål

Bestyrelsesfunktionen skal:

- føles realistisk for cykelsport
- skabe langsigtet karrierefølelse
- være privat pr. manager
- være let at forstå i UI
- være dyb og vægtet bagved
- kunne bygges videre ud i senere versioner
- genbruge nuværende board-UI, satisfaction bar og sponsor-multiplier

Systemet skal ikke kunne fyre spilleren. Pres og konsekvenser skal i stedet ske via budget, ambitioner, vurderinger og fremtidige målsætninger.

---

## 2. Fantasy og player experience

Spilleren skal føle:

> “Jeg bygger et hold over tid, og sponsor + ledelse reagerer realistisk på mine valg — ikke kun på om jeg vinder.”

Det betyder:

- store sejre hjælper meget, men redder ikke alt
- identitet og økonomi betyder noget, men resultater betyder mest
- bestyrelsen husker 2–3 sæsoner tilbage
- det skal være muligt at være “på rette vej”, selv hvis én sæson ikke er perfekt
- det skal føles som en karriere i et manager-spil, bare multiplayer

---

## 3. Bestyrelsen i Cycling Zone

Bestyrelsen er en samlet funktion bestående af:

- sponsor
- ledelse

Bestyrelsen kan:

- sætte målsætninger
- give feedback
- justere fremtidigt budget
- justere ambitioner
- acceptere eller afvise forespørgsler
- påvirke sponsor-multiplier og økonomisk spillerum

Bestyrelsen kan ikke:

- fyre spilleren
- tvinge transfers

---

## 4. Struktur: 1 år + 3 år + 5 år

Hver manager har altid tre lag aktive samtidig:

### 1-årsmål
- sæsonspecifikke
- låses efter forhandling og sæsonstart
- kan ikke ændres undervejs

### 3-årsretning
- semi-fast
- kan påvirkes lidt over tid
- bruges som mellemfristet kurs

### 5-årsvision
- langsigtet identitet og ambition
- mere stabil end 3-årsretningen
- skal skabe karrierefølelse og retning

---

## 5. Board personality

Hver bestyrelse får tre kerneakser:

### Sportslig ambition
- lav
- mellem
- høj

### Økonomisk risikovillighed
- forsigtig
- balanceret
- aggressiv

### Identitetsstyrke
- lav
- mellem
- høj

Disse akser påvirker:

- hvilke mål der genereres
- hvor hårdt økonomi vurderes
- hvor meget identitet betyder
- hvor store krav der stilles efter succes
- hvor fleksibel bestyrelsen er i forespørgsler

---

## 6. Specialiseringer (v1)

Hvert hold kan have:

- én hovedspecialisering
- én sekundær specialisering

Mulige specialiseringer i v1:

- GC-hold
- sprinthold
- klassikerhold
- etapejæger/udbrudshold
- ungdoms-/udviklingshold
- balanceret hold

Specialisering påvirker:

- hvilke resultater der prioriteres
- hvilke ryttere der vurderes som værdifulde
- hvilke mål der genereres

---

## 7. Objective categories

Hver sæson skal bestyrelsen generere en målpakke bestående af:

- 1–2 sportslige mål
- 1 økonomisk mål
- 1 identitetsmål
- 1 ranking-/progressionsmål

Eksempel:

- Top 5 i Giro
- Vind 6 løb
- Slut sæsonen med positiv balance
- Hav mindst 4 franske ryttere
- Forbedr verdensranglisten

---

## 8. Objective generation rules

Mål skal genereres dynamisk ud fra:

- division
- verdensrangliste
- sidste sæsons performance
- oprykning/nedrykning sidste sæson
- økonomisk status
- specialisering
- board personality
- identitetsprofil
- 3-årsretning
- 5-årsvision

Der må gerne bruges et lille antal håndlavede klub-DNA-regler ovenpå det systemgenererede.

### Vigtigt
Mål må ikke være selvmodsigende.

Eksempel på ting der ikke må ske samtidig:

- meget stramt økonomimål + aggressivt stjernekrav + højt sportsligt sprintkrav i samme sæson, hvis holdet ikke har realistisk økonomi
- stærkt nationalitetskrav + stærkt star-signing krav, hvis spilleren reelt ikke kan opfylde begge med rimelighed

Systemet skal vælge en sammenhængende målpakke.

---

## 9. Objective weight model

Mål vurderes ikke ens.

Hvert mål har:

- kategori
- subtype
- importance
- weight
- context multiplier

### Importance
- required
- preferred
- desired

### Context multiplier
Samme mål har ikke samme værdi for alle hold.

Eksempel:
- Top 10 i Touren er langt større for et Pro-hold end for et top-WT-hold
- Vind et .Pro-løb er vigtigere for et CT-/Pro-hold end for et elite WT-hold

### Vigtige designprincipper
- Grand Tour samlet sejr ≠ etapesejr i lille løb
- monument-podie ≠ top 10 i mindre løb
- mål skal vægtes hierarkisk og kontekstuelt

---

## 10. Evaluation engine

Board-systemet bruger en skjult samlet score bagved.

### Grundvægtning i v1
- Resultater: 50%
- Økonomi: 20%
- Identitet: 20%
- Rangliste/progression: 10%

Dette er startværdier og må gerne justeres via tuning senere.

### Regler
- vurdering er gradvis, ikke binær
- tæt på mål = delvis opfyldelse
- langt fra mål = klart miss
- overperformance giver bonus
- momentum betyder noget
- systemet husker 2–3 sæsoner tilbage

### Store resultater
Store resultater må hjælpe meget, men ikke redde alt.

Eksempel:
- vinder Touren, men saboterer økonomi og ignorerer identitet
- bestyrelsen bliver stadig overordnet glad, men ikke ukritisk begejstret

---

## 11. Momentum og historik

Board-systemet skal kunne skelne mellem:

- dårlig start + stærk afslutning
- stærk start + kollaps til sidst

Historikken skal bruges som en 2–3 sæsoners hukommelse, så:

- stabil fremgang belønnes
- enkelte dårlige sæsoner kan tilgives bedre efter stærke perioder
- vedvarende stagnation eller tilbagegang mærkes over tid

---

## 12. Identitetssystem (v1)

Følgende identitetsområder er med fra start:

- national identitet
- ungdomsfokus
- stjernefokus
- sportslig specialisering
- økonomisk disciplin

### Regional identitet
Ikke med i v1.

### National identitet
Kan fx være:
- mindst X ryttere fra et land
- en vis procentdel af truppen fra et land
- mindst én nøglerytter fra et land

### Ungdomsfokus
Kan fx måles via:
- antal unge ryttere
- udvikling hos unge ryttere
- U25-andel i truppen

### Stjernefokus
Bestyrelsen kan ønske ryttere med højt omdømme.

Bagved skal systemet have mindst to skjulte dimensioner:
- sportslig værdi
- stjerneværdi

Ud til spilleren vises kun ét samlet label, fx:
- ukendt
- lokalkendt
- nationalt kendt
- verdenskendt

### Sportslig specialisering
Holdet vurderes også på, om truppen matcher den sportslige identitet.

### Økonomisk disciplin
Identiteten kan også være, at holdet skal drives sundt og bæredygtigt.

---

## 13. Økonomimål (v1)

Følgende økonomimål er med fra start:

- slut sæsonen med positiv balance
- hold løn under en bestemt andel af økonomien
- undgå gæld/lån
- lave profitable transfers

Derudover kan systemet bruge:
- forbedre balance vs sæsonstart
- øge sponsorindtægt over tid

Der bruges ikke et mål om at tjene mere end andre managers, da man ikke kan se andres økonomi.

---

## 14. Ranking og multiplayer

Evalueringen bruger både:

- holdets verdensrangliste
- relative sammenligninger på tværs af managerstyrede hold

Verdensrangliste er primær.
Manager-sammenligning er sekundær bonus/malus.

Systemet må gerne bruge både:
- rang som del af evalueringen
- rang som direkte mål

Eksempel:
- Bliv top 12 i verden
- Slut højere end sidste sæson
- Forbliv i top 3 i divisionen

Alle bestyrelsesmål er private. Spillere kan ikke se andre holds board-mål.

---

## 15. Feedback til spilleren

UI skal være simpelt, tydeligt og let at aflæse.

### Lag 1 — Hurtig status
Eksempeltekst:
- Bestyrelsen er meget tilfreds
- Bestyrelsen er tilfreds
- Bestyrelsen er afventende
- Bestyrelsen er bekymret
- Bestyrelsen er utilfreds

### Lag 2 — Områdefeedback
Eksempel:
- Resultater: stærk
- Økonomi: under forventning
- Identitet: opfyldt
- Langsigtet plan: på rette kurs

### UI-princip
Behold eksisterende:
- satisfaction bar
- sponsor multiplier
- kort status på dashboard

Ny engine skal bare drive disse bedre.

---

## 16. Board requests (v1)

Spilleren skal i v1 kunne sende få, men meningsfulde forespørgsler:

- anmod om lavere krav på ét område
- anmod om mere fokus på ungdom
- anmod om mere fokus på resultater nu
- anmod om at ændre identitetskrav lidt

Mulige outcomes:
- godkendt
- delvist godkendt
- afvist
- godkendt med pris/konsekvens

Eksempel på pris/konsekvens:
- mindre identitetskrav mod strammere økonomikrav
- mere resultatorienteret retning mod højere forventninger næste sæson
- mere ungdomsfokus mod lavere kortsigtede resultatkrav

Mid-season review kan påvirke sandsynligheden for at få requests godkendt.

---

## 17. Mid-season review

Mid-season review skal være:

- primært informativt
- men med lidt skjult påvirkning

Det betyder:
- ingen bindende sæsonændring af 1-årsmål
- tydelig status og kursvurdering
- lidt påvirkning af relation/forventningsniveau og request-behandling

---

## 18. Consequences

Der er ingen fyring.

Konsekvenser sker i stedet via:

- lavere budget end forventet
- ændret sponsor/base funding
- ændret løn-/risikotolerance
- justerede fremtidige ambitioner
- nemmere eller anderledes mål næste sæson
- mere eller mindre fleksibel bestyrelse

Konsekvensniveau:
- moderat, ikke ekstremt

---

## 19. Budget og economics knobs

Bestyrelsen skal arbejde med mindst to økonomiske håndtag:

- sponsor/base funding
- løn-/risikotolerance

Satisfaction skal påvirke:
- sponsorindtægt
- budgetramme næste sæson
- board feedback
- chance for at få board requests godkendt
- ambitionsniveau over tid
- tolerance for dårlige perioder

---

## 20. Integration med nuværende system

Dette er et redesign i retning B:
- byg ovenpå eksisterende board-system
- genbrug det der virker
- udskift og udvid engine-laget

Skal genbruges:
- BoardPage flow og wizard-oplevelse
- satisfaction bar
- sponsor multiplier
- dashboard-kort
- board_profiles som udgangspunkt
- snapshots/historik hvor muligt

Skal videreudvikles markant:
- objective generation
- season evaluation
- identity logic
- long-term plan logic
- board requests
- season-end integration

---

## 21. Backend scope

V1 skal omfatte:

- ny board engine
- dynamisk objective generation
- season-end evaluation
- satisfaction update
- history tracking
- request handling
- integration i season-end flow
- bedre data til dashboard og board page

---

## 22. Ikke med i v1

For at holde implementationen realistisk er dette ikke nødvendigvis med i første version:

- regional identitet
- meget stor request-portal
- facilities/staff investeringstræ
- komplet sponsor-forhandlingssystem
- meget dyb rival/narrative AI
- offentlig sammenligning af andre holds bestyrelsesmål

---

## 23. Claude Code implementeringsretning

Claude skal:
- bygge modulært
- undgå hacks
- beholde UI simpelt
- lægge kompleksitet i engine og datamodel
- integrere med nuværende board-, economy- og season-flow
- opdatere docs ved afslutning

Kør `npm run sync-docs` når arbejdet er færdigt.
