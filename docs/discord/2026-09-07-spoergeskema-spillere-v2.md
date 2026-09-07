# Player survey v2: two axes, so a "no" counts (EN/DA), ejeren poster selv

> Skrevet 7/9 2026 til #4943 (spørgeskema til alle spillere) og #4820 (indholdsplan).
> **v2 erstatter v1 som sandhed.** v1 (`2026-09-07-spoergeskema-spillere.md`) bevares
> som historik, men det er v2 der skal bygges i Google Forms og sendes.
>
> **Ejer-krav 7/9 (ordret):** funktioner fra de seneste 14 dages samtaler med spillerne,
> flere spørgsmål så svarene kan krydses, "hvor god en idé" og "hvor vigtigt for dig",
> så det trækker ned hvis en bruger ikke ønsker en funktion, og en mere professionel form.
>
> **Grundlag:** `2026-09-07-feature-inventar-24-8-til-7-9.md` (50 funktioner, 24/8 til 7/9,
> verificeret mod GitHub og `docs/MASTERPLAN.md`). De 12 funktioner i afsnit 4 er valgt
> derfra, bredt over motorerne.
>
> **Tone:** `docs/TONE_OF_VOICE.md` (jeg-stemme, EN først, DA under, ingen tankestreg).
> Ejeren sender selv. Claude leverer kun udkastet.

---

## 1. Værktøj og opsætning

**Anbefaling: Google Forms.** Gratis, kan være anonymt, dækker alle spørgsmålstyper i
skemaet, og svarene kan lægges direkte i et regneark og krydses.

**Om grid-formatet, bekræftet:** Google Forms har ikke en spørgsmålstype der hedder
"linear scale grid". Det du skal bruge hedder **"Multiple-choice grid"** (dansk:
**"Gitter med flere valgmuligheder"**). Den laver præcis det du vil have: én række pr.
funktion, og en kolonne pr. trin på skalaen. Sæt kolonnerne til `1`, `2`, `3`, `4`, `5`
og en sjette kolonne `Don't know`, så har hver række en 1-5-skala plus en ærlig udvej.
Spørgsmålstypen "Linear scale" findes også, men den kan kun én række ad gangen, så den
bruges kun til NPS-spørgsmålet.

### Opsætning, sektion for sektion

Opret formularen på forms.google.com, og byg den som **ni sektioner**. Én sektion pr.
blok gør at folk ikke kan se deres tidligere svar mens de svarer på næste blok, og det er
netop pointen med at holde "god idé" og "vigtigt for mig" adskilt.

| Sektion | Indhold | Spørgsmålstype i Forms |
|---|---|---|
| 1 | Intro-tekst, ingen spørgsmål | Sektionsbeskrivelse |
| 2 | Om dig (6 spørgsmål) | Multiple choice |
| 3 | Sådan har du det i dag (2 spørgsmål) | Linear scale + Multiple choice |
| 4 | Hvor god en idé? Del 1 (6 funktioner) | Multiple-choice grid |
| 5 | Hvor god en idé? Del 2 (6 funktioner) | Multiple-choice grid |
| 6 | Hvor vigtigt for dig? Del 1 og 2 (2 gitre à 6) | Multiple-choice grid |
| 7 | Hvad fungerer dårligst (2 spørgsmål) | Checkboxes + Paragraph |
| 8 | Én ting, spille mere, invitere en ven (3 spørgsmål) | Short answer + Paragraph |
| 9 | Pro + afslutning (5 spørgsmål) | Checkboxes + Multiple choice + Short answer |

**Sådan opretter du et gitter (gør det fire gange, én gang pr. blok på seks funktioner):**

1. Tryk `+` for nyt spørgsmål, og vælg **Multiple-choice grid** i typelisten.
2. Skriv spørgsmålsteksten i toppen (se afsnit 4 for den præcise ordlyd).
3. Under **Rows**: indsæt de seks funktionsnavne, én pr. række. Skriv EN-navnet, og sæt
   DA-navnet i parentes bagefter på samme linje, så begge sprog er dækket i én formular.
4. Under **Columns**: skriv `1`, `2`, `3`, `4`, `5`, `Don't know`. Seks kolonner i alt.
5. Skriv skalaens betydning i spørgsmålets **Description** (trykket på de tre prikker,
   "Show" og "Description"), for eksempel `1 = poor idea, 5 = excellent idea`. Forms
   viser ikke tekst på gitterets kolonner, så beskrivelsen er det eneste sted den kan stå.
6. I de tre prikker nederst til højre: slå **"Shuffle row order"** TIL. Det fjerner den
   fordel den øverste funktion ellers får.
7. Slå **"Require a response in each row"** TIL. Det er forsvarligt her, netop fordi
   `Don't know` findes som kolonne, så ingen tvinges til at gætte.
8. Lad **"Limit to one response per column"** være slået FRA. Slås den til, kan hver
   værdi kun bruges én gang, og så er skemaet i stykker.

**Formular-indstillinger (tandhjulet):**

- **Responses**: "Collect email addresses" FRA. Skemaet skal kunne besvares anonymt.
- **Responses**: "Limit to 1 response" FRA. Den kræver Google-login og koster svar.
- **Presentation**: "Show progress bar" TIL. Folk falder mindre fra når de kan se enden.
- **Presentation**: "Shuffle question order" FRA. Rækkefølgen her er bevidst.
- Når svarene tikker ind: fanen **Responses**, ikonet "Link to Sheets", og du har et
  regneark hvor hver besvarelse er én række og hver funktion sin egen kolonne.

**Længde:** 24 spørgsmål, hvoraf 20 er klik. Målt på en normal besvarelseshastighed
lander det under seks minutter. Skriv det i introen, det er den enkeltstørste ting du kan
gøre for svarprocenten.

---

## 2. Sektion 1: intro

**EN:**
> I want to know what to build next, and I would rather ask you than guess.
>
> This takes about five minutes. Nothing here is required except your division, and you
> can answer in English or Danish. It is anonymous unless you choose to leave your manager
> name at the end.
>
> Two things I am asking about every idea: whether you think it is a good idea at all, and
> how much it matters to you right now. Those are different questions, and I need both.

**DA:**
> Jeg vil gerne vide hvad jeg skal bygge næste gang, og jeg spørger hellere dig end gætter.
>
> Det tager cirka fem minutter. Intet er obligatorisk undtagen din division, og du må
> svare på engelsk eller dansk. Det er anonymt, medmindre du selv skriver dit managernavn
> til sidst.
>
> Jeg spørger om to ting ved hver idé: om du overhovedet synes den er god, og hvor meget
> den betyder for dig lige nu. Det er to forskellige spørgsmål, og jeg har brug for begge.

---

## 3. Sektion 2 og 3: om dig, og hvordan du har det i dag

### Sektion 2: om dig (til krydsning af svarene)

**Q1. Division (required, multiple choice)**

**EN:** Which division are you in right now?
Division 1 / Division 2 / Division 3 / Division 4 / I am not sure

**DA:** Hvilken division er du i lige nu?
Division 1 / Division 2 / Division 3 / Division 4 / Jeg er ikke sikker

**Q2. Seasons played (optional, multiple choice)**

**EN:** How many seasons have you played?
This is my first / Two / Three or more

**DA:** Hvor mange sæsoner har du spillet?
Det er min første / To / Tre eller flere

**Q3. Login frequency (optional, multiple choice)**

**EN:** How often do you open the game?
Several times a day / About once a day / A few times a week / Less often than that

**DA:** Hvor tit åbner du spillet?
Flere gange om dagen / Cirka en gang om dagen / Et par gange om ugen / Sjældnere end det

**Q4. Pro (optional, multiple choice)**

**EN:** Do you have Pro right now?
Yes / No / I am not sure

**DA:** Har du Pro lige nu?
Ja / Nej / Jeg er ikke sikker

**Q5. Platform (optional, multiple choice)**

**EN:** What do you mostly play on?
Mostly phone / Mostly computer / Both about equally

**DA:** Hvad spiller du mest på?
Mest telefon / Mest computer / Cirka lige meget af hver

**Q6. Language (optional, multiple choice)**

**EN:** Which language do you play in?
English / Danish / Another language

**DA:** Hvilket sprog spiller du på?
Engelsk / Dansk / Et andet sprog

### Sektion 3: hvordan du har det i dag

**Q7. Recommendation (required, linear scale 0 to 10)**

**EN:** How likely are you to recommend Cycling Zone to a friend who likes cycling?
Label at 0: Not at all likely. Label at 10: Extremely likely.

**DA:** Hvor sandsynligt er det at du vil anbefale Cycling Zone til en ven der kan lide
cykling? 0 betyder slet ikke sandsynligt, 10 betyder yderst sandsynligt.

**Q8. Overall satisfaction (required, multiple choice 1 to 5)**

**EN:** All in all, how satisfied are you with Cycling Zone right now?
1 = not satisfied, 5 = very satisfied

**DA:** Alt i alt, hvor tilfreds er du med Cycling Zone lige nu?
1 = ikke tilfreds, 5 = meget tilfreds

---

## 4. Sektion 4 til 6: de 12 funktioner på to akser

De 12 funktioner er valgt fra feature-inventaret 24/8 til 7/9, så de er ting jeg allerede
har talt med jer om, og de er spredt over løbsmotoren, træningen, trupperne, identiteten
og hverdagen som manager. Navnene er skrevet som spilleren oplever dem.

**De 12 rækker (samme rækker og samme ordlyd i begge gitre):**

| # | EN (row label) | DA (samme række, i parentes) | Kilde i inventaret |
|---|---|---|---|
| 1 | Follow a race live while it happens, stage by stage | Følg et løb live mens det kører, etape for etape | #4916 |
| 2 | Choose how hard each rider works on a race day | Vælg hvor hårdt hver rytter arbejder på en løbsdag | #4850, #4632 |
| 3 | Target the mountains or points jersey from the start | Gå efter bjerg- eller pointtrøjen fra løbets start | kun lovet 7/9 |
| 4 | Build a training week once as a reusable program | Byg en træningsuge én gang som et genbrugeligt program | #4629 |
| 5 | Share training programs and use other managers' programs | Del træningsprogrammer og brug andre manageres programmer | #4630 |
| 6 | Form training for riders who no longer gain skills | Formtræning til ryttere der ikke længere kan lære mere | #4633 |
| 7 | U23 and junior teams with their own races | U23- og juniorhold med deres egne løb | #4620, #4621 |
| 8 | Team looks: kit colours, logo and rider portraits | Holdets udseende: trøjefarver, logo og rytterportrætter | #4100 |
| 9 | Deeper staff: more roles, real strengths and weaknesses | Dybere personale: flere roller, rigtige styrker og svagheder | #930, #3854 |
| 10 | Handle transfer offers straight from your inbox | Håndtér transfertilbud direkte fra din indbakke | #4984, #4985 |
| 11 | Send messages to other managers inside the game | Send beskeder til andre managere inde i spillet | #3200, #4751 |
| 12 | A front page you set up yourself, showing what needs action | En forside du selv sætter op, med det der kræver handling | #3513 |

### Sektion 4 og 5: gitter A, "hvor god en idé?"

Del rækkerne i to gitre à seks, så det kan læses på en telefon. Funktion 1 til 6 i
sektion 4, funktion 7 til 12 i sektion 5. Samme spørgsmålstekst og samme kolonner begge
steder.

**Spørgsmålstekst, EN:** How good an idea is this for the game, no matter whether you
would use it yourself?
**Description:** 1 = poor idea, 5 = excellent idea. Pick "Don't know" if you have no view.

**Spørgsmålstekst, DA:** Hvor god en idé er det for spillet, uanset om du selv ville
bruge det?
**Beskrivelse:** 1 = dårlig idé, 5 = fremragende idé. Vælg "Don't know" hvis du ikke har
en mening.

**Columns:** `1` `2` `3` `4` `5` `Don't know`

### Sektion 6: gitter B, "hvor vigtigt er det for dig?"

Samme 12 rækker, igen i to gitre à seks, og igen i samme rækkefølge som gitter A.

**Spørgsmålstekst, EN:** How important is this to you right now?
**Description:** 1 = does not matter to me, 5 = this is the one thing I want most.

**Spørgsmålstekst, DA:** Hvor vigtigt er det for dig lige nu?
**Beskrivelse:** 1 = betyder ikke noget for mig, 5 = det er det jeg helst vil have.

**Columns:** `1` `2` `3` `4` `5` `Don't know`

### Sådan læser du krydset

Regn to gennemsnit ud pr. funktion: gennemsnittet på idé-aksen og gennemsnittet på
vigtighedsaksen. Lad "Don't know" stå udenfor gennemsnittet, men tæl hvor mange der
valgte det. Så falder hver funktion i en af fire kasser.

| | **Høj vigtighed (over 3,5)** | **Lav vigtighed (under 3,5)** |
|---|---|---|
| **Høj idé (over 3,5)** | **Byg først.** Folk vil have det, og de vil have det nu. | **Nice to have.** God idé, men den venter. Byg den når den er billig at tage med. |
| **Lav idé (under 3,5)** | Sjældent. Tjek fritekst-svarene: der er som regel et problem bagved som en anden løsning rammer bedre. | **Drop den.** Ingen synes den er god, og ingen har brug for den. |

Tre ting mere, som er dem der gør at et nej faktisk trækker ned:

1. **Veto-andelen.** Tæl hvor stor en andel der giver 1 eller 2 på idé-aksen. Rammer den
   over en fjerdedel, er funktionen omstridt, uanset hvor pænt gennemsnittet ser ud. En
   funktion halvdelen elsker og halvdelen afviser giver samme gennemsnit som en alle er
   lunkne ved, og det er to helt forskellige situationer.
2. **Én samlet score.** Vil du have én talrække at sortere efter, så gang de to
   gennemsnit sammen (idé gange vigtighed). Så skal en funktion score på begge akser for
   at komme øverst, og en enkelt høj akse er ikke nok.
3. **Krydset mod sektion 2.** Kør de samme tal for hver division, for førstesæsons-spillere
   mod veteraner, og for telefon mod computer. Det er der de virkelige svar ligger. Hvis
   Division 4 og førstesæsons-spillerne peger et andet sted end Division 1, er det ikke
   støj, det er to forskellige spil du er ved at bygge.

---

## 5. Sektion 7 og 8: hvad der ikke virker, og hvad du selv ville vælge

**Q9. What works worst (required, checkboxes, max 3)**

I Forms: Checkboxes, og under de tre prikker vælg "Response validation", "Select at most",
`3`.

**EN:** Which parts of the game work worst today? Pick up to three.
- Racing and results
- Training and rider development
- Transfers and auctions
- Team selection and planning
- The season calendar and the routes
- Money, sponsors and the board
- The academy and young riders
- The inbox and notifications
- The forum and the community
- Speed, bugs and things that break

**DA:** Hvilke dele af spillet fungerer dårligst i dag? Vælg op til tre.
- Løbene og resultaterne
- Træning og rytterudvikling
- Transfers og auktioner
- Holdudtagelse og planlægning
- Sæsonkalenderen og ruterne
- Penge, sponsorer og bestyrelsen
- Akademiet og de unge ryttere
- Indbakken og notifikationerne
- Forummet og fællesskabet
- Hastighed, fejl og ting der går i stykker

**Q10. Say more (optional, paragraph)**

**EN:** What exactly goes wrong there? The more concrete, the better.

**DA:** Hvad går præcist galt der? Jo mere konkret, jo bedre.

**Q11. One thing (required, short answer)**

**EN:** If I could only build one thing in the next month, what should it be?

**DA:** Hvis jeg kun kunne bygge én ting den næste måned, hvad skulle det så være?

**Q12. Play more (optional, paragraph)**

**EN:** What would make you play more than you do now?

**DA:** Hvad ville få dig til at spille mere end du gør nu?

**Q13. Invite a friend (optional, paragraph)**

**EN:** What would make you invite a friend to join?

**DA:** Hvad ville få dig til at invitere en ven med?

---

## 6. Sektion 9: Pro og afslutning

Rammen her er den samme som altid: the game must be fair for everyone. You cannot pay for
better riders, faster training, or better results. Skriv den ind som beskrivelse på
sektionen, så ingen svarer i den tro at Pro kan købe resultater.

**Sektionsbeskrivelse, EN:** Pro is optional and always will be. The game must be fair for
everyone. You cannot pay for better riders, faster training, or better results. So this is
about what else Pro could hold.

**Sektionsbeskrivelse, DA:** Pro er valgfrit og bliver ved med at være det. Spillet skal
være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller
bedre resultater. Så spørgsmålet her er hvad Pro ellers kunne indeholde.

**Q14. What belongs in Pro (optional, checkboxes)**

**EN:** What would belong in Pro, if you got to decide? Pick as many as you like.
- Deep rider comparison tools
- Advanced statistics and analytics
- Extended history and palmares
- Team looks: kit, logo, rider portraits
- Renaming riders, from an approved name list
- A badge on your profile
- Faster or better scouting
- Nothing extra, I would just be backing the project

**DA:** Hvad hører hjemme i Pro, hvis du bestemte? Vælg lige så mange du vil.
- Grundig sammenligning af ryttere
- Avanceret statistik og analyse
- Udvidet historik og palmares
- Holdets udseende: trøje, logo, rytterportrætter
- Omdøbning af ryttere, fra en godkendt navneliste
- Et mærke på din profil
- Hurtigere eller bedre scouting
- Ikke noget ekstra, jeg ville bare bakke projektet op

**Q15. What should stay out of Pro (optional, short answer)**

**EN:** Is there anything that should stay out of Pro? Tell me what, and why.

**DA:** Er der noget der ikke skal ind i Pro? Skriv hvad, og hvorfor.

**Q16. Would you pay (required, multiple choice)**

**EN:** Would you pay for Pro as you have described it?
Yes / Maybe / No / I already do

**DA:** Ville du betale for Pro, sådan som du har beskrevet det?
Ja / Måske / Nej / Det gør jeg allerede

**Q17. Manager name (optional, short answer)**

**EN:** Your manager name, if you want me to be able to place your answers. Optional.

**DA:** Dit managernavn, hvis du gerne vil have at jeg kan placere dine svar. Valgfrit.

**Q18. Follow up (optional, multiple choice)**

**EN:** May I come back to you about your answers?
Yes / No

**DA:** Må jeg vende tilbage til dig om dine svar?
Ja / Nej

**Afslutningstekst (Forms: "Confirmation message"), EN:**
> Thank you. I read every single answer myself, and I will tell you in the forum what came
> out of it.

**DA:**
> Tak. Jeg læser hvert eneste svar selv, og jeg fortæller i forummet hvad der kom ud af det.

---

## 7. Discord-opslag (ejeren poster selv)

**EN:**
> @everyone I could really use your help with something fun.
>
> I have put together a short survey about where Cycling Zone goes next. You rate each
> idea twice: whether you think it is a good idea at all, and how much it matters to you
> right now. That second part is what tells me which order to build things in, and it is
> the part I have been guessing at until now.
>
> It takes about five minutes, it is anonymous, and there is room to tell me what is not
> working as well.
>
> **[LINK TIL GOOGLE FORMS]**
>
> Every answer lands with me. Thank you.

**DA:**
> @everyone Jeg kunne godt bruge din hjælp til noget sjovt.
>
> Jeg har lavet et kort spørgeskema om hvor Cycling Zone skal hen. Du giver hver idé to
> karakterer: om du synes den er god, og hvor meget den betyder for dig lige nu. Det andet
> er det der fortæller mig i hvilken rækkefølge tingene skal bygges, og det er præcis det
> jeg har gættet mig til indtil nu.
>
> Det tager cirka fem minutter, det er anonymt, og der er også plads til at fortælle mig
> hvad der ikke fungerer.
>
> **[LINK TIL GOOGLE FORMS]**
>
> Hvert eneste svar lander hos mig. Tak.

## 8. In-app besked

**EN:**
> Help me decide what to build next. Rate each idea twice: is it a good idea, and does it
> matter to you? It takes about five minutes.
> **[LINK TIL GOOGLE FORMS]**

**DA:**
> Hjælp mig med at vælge hvad der skal bygges næste gang. Giv hver idé to karakterer: er
> den god, og betyder den noget for dig? Det tager cirka fem minutter.
> **[LINK TIL GOOGLE FORMS]**

---

## 9. Verifikation

- Ingen tankestreg i filen, tjekket med grep på tegnet.
- EN altid før DA, i hvert eneste afsnit.
- Jeg-stemme hele vejen, ingen "vi" i player-facing tekst.
- Ingen tal og ingen datoer i afsnit 7 og 8, bortset fra "cirka fem minutter", som er en
  varighed og ikke en dato. Vil du helt undgå det, så skriv "det tager få minutter".
- Fairness-løftet står ordret i sektion 9's beskrivelse, jf. `TONE_OF_VOICE.md`.
- Ingen forbudte termer: ikke "freemium", ikke "Founder Supporter", ikke "støt", ikke
  "free forever", ingen sprint- eller validation-jargon.
- De 12 funktioner er verificeret mod feature-inventaret og GitHub 7/9. Ingen af dem er
  allerede shippet, så ingen bliver bedt om at stemme om noget der findes i forvejen.
- Alle spørgsmål er ét spørgsmål ad gangen. Ingen af dem spørger om to ting i samme
  sætning, og ingen af dem lægger et svar i munden på nogen.

## 10. Hvad jeg lærte fra v1 til v2

1. **Én akse kan ikke prioritere.** v1 spurgte kun "hvad er vigtigst" og lod spilleren
   vælge tre. Det giver en top tre, men det siger intet om de syv der ikke blev valgt: var
   de dårlige idéer, eller var de gode idéer som bare ikke haster? Det er to helt
   forskellige svar, og kun det ene er et nej. To akser og en "ved ikke"-udvej gør det
   muligt at se forskel, og gør at en funktion ingen ønsker faktisk trækker ned.
2. **Ti brede områder kan ikke bygges.** v1's ti valgmuligheder var kategorier
   ("løbsmotoren", "økonomi og sponsorer"). Man kan ikke bygge en kategori. v2 spørger om
   12 navngivne funktioner som ejeren allerede har talt med spillerne om de sidste 14
   dage, hvilket både gør svaret handlingsanvisende og viser spillerne at deres tråde blev
   læst. De brede områder er flyttet ned til "hvad fungerer dårligst", hvor en kategori
   giver mening, fordi man dér leder efter et sted at kigge, ikke efter en ordre.
3. **Uden segmentering er gennemsnittet en løgn.** v1 havde ingen baggrundsspørgsmål, så
   alle svar ville lægge sig oven i hinanden. Seks korte spørgsmål om division, sæsoner,
   hyppighed, Pro, platform og sprog koster under et minut, og de er forskellen på "folk
   vil have træningsprogrammer" og "de spillere der logger ind hver dag vil have
   træningsprogrammer, mens de nye ikke aner hvad det er".
