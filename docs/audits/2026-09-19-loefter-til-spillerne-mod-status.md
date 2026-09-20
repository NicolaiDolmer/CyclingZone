# Ejerens 29 løfter mod den verificerede tilstand

**Dato:** 19/9 2026 · **Type:** read-only gennemgang. Intet bygget, intet merget, ingen prod-skrivning, ingen SQL.

**Hvad det er.** De 29 punkter som ejeren har skrevet til spillerne, holdt op mod hvad der faktisk er merget på `origin/main`, hvad GitHub siger om issues og PR'er, og hvad der er meldt ud i patch notes. Docs er behandlet som cache, ikke som sandhed.

**Hvor teksten bor.** Løfterne er ikke en side i spillet. De står som et Discord-udkast i to filer i repoet:
`docs/drafts/roadbook-discord-2026-09-15.md` (copy-paste-klar, EN + DA, 8 beskeder) og
`docs/drafts/roadbook-plan-2026-09-15.md`. Begge er sidst ændret **15/9** (commits `36f7a137d`, `f49e64e41`).
Spillerne kan altså ikke slå listen op i appen. `RoadmapPage.jsx` findes, men den er afstemnings-roadmappen, ikke denne tekst, og forummet har en Roadmap-kategori (patch note 7.264) hvor kun ejeren kan poste.

**Rettelse til opgavens præmis:** nyeste patch note på `main` er **7.288** (18/9), ikke 7.289.

**Tidsregnskab:** i dag er 19/9. *"During season 3"* = inden 27/9. *"Before season 4 starts"* = inden 28/9. Det er 8 dage. *"Maybe"* (punkt 10-14 og 29) er ikke løfter og bedømmes ikke på tid.

---

## Tabel: alle 29

| # | Løftet, kort | Status | Holdes til tiden? | Område | Omfang |
|---|---|---|---|---|---|
| **Under sæson 3** ||||||
| 1 | Forklaring på ryttere der står stille i værdi + de meldte fejl | Delvist leveret til alle | Holdes hvis #4263 får en linje i UI'et | intet område | S |
| 2 | Afklaring af sekundær ryttertype | Ikke startet | **Nej** | intet område | S-M |
| 3 | Kort formpas dagen før løb, alle ryttere | Ikke startet | **Nej** | 5 | M |
| 4 | Mentale evner: nye + taktik/aggression uden alder, besked før det lander | Landet 15/9 uden beskeden | **Delvist brudt allerede** | intet område | M |
| 5 | Bedre mobilvisning: træning, transfers, auktioner, sæsonmatrix | 2,5 af 4 flader | Holdes hvis matrix + flip | intet område | S-M |
| 6 | S4-kalenderen, inkl. U23 og junior | Senior bygget/ikke kørt; U23+junior ikke startet | Senior ja, U23+junior **nej** | 1 og 7 | S / L |
| 7 | Alle divisioner samme antal løbsdage | Bygget, ikke merget (PR #5169) | Holdes hvis afstemningen postes nu | 3 | M |
| 8 | Beta-programmet åbner for alvor | **Leveret til alle** 18/9 | **Holdt** | intet område | — |
| 9 | Træningsscoren for alle | Leveret i beta (`training_score_visible`) | Holdes hvis du flipper | intet område | S |
| **Måske, hvis der er plads (ikke løfter)** ||||||
| 10 | Flere faciliteter | Ikke startet | var aldrig datobundet | intet område | M |
| 11 | Mobil ud over træning og transfers | Delvist | var aldrig datobundet | intet område | M |
| 12 | Hastighed på alle sider | Leveret løbende | var aldrig datobundet | intet område | — |
| 13 | Flere værktøjer til fair play | Delvist | var aldrig datobundet | intet område | L |
| 14 | Rettelser til Pro | Delvist | var aldrig datobundet | intet område | M |
| **Inden sæson 4 starter** ||||||
| 15 | Race engine v4 færdig og tændt | Ikke klar (dormant) | **var aldrig datobundet** (løftet siger det selv) | 11 | L |
| 16 | Bestyrelses-reworket færdigt: mandat + rigtigt møde | Bygget, i beta | Holdes hvis S4-rækken + flip-go | 10 | S |
| 17 | U23 og junior bliver rigtige trupper | Fundament merget, trupperne ikke | **Nej** | 6 | L |
| 18 | U23- og junior-løb, egne kalendere og ligaer | Ikke startet | **Nej** | 7 | L |
| 19 | Graduation Day, ugen før skiftet | Ikke startet | **Nej** — sub-fristen brydes i morgen | 8 | M |
| 20 | Træning fra løb kommer tilbage; træner eller kører løb | Del A bag slukket flag, del B dormant | Holdes hvis begge flag tændes | 4 (+ intet område) | M |
| 21 | Ugeplanen sætter sessionen for hver løbsdag | Ikke startet, har ikke eget issue | **Nej** | 5 | M-L |
| 22 | Træning én gang om aftenen, bonus-knappen væk | Bygget, ikke tændt | Holdes på flip-dagen | 4 | M |
| 23 | Skader tælles i løbsdage | Besluttet, hører til B4-rettelsen | Holdes hvis den tages med i B4 | 4 og 5 | S-M |
| 24 | Træningssiden bygget færdig én gang | Mobil afgjort (beta), desktop åben | **Nej** | 5 | L |
| 25 | Sponsor-fejlrettelser | **Leveret til alle** 17/9 | **Holdt** | intet område | — |
| 26 | Én rytter-opdatering med en besked fra dig | Formen er brudt; beskeden mangler | **Nej på formen**, beskeden kan nås | intet område | S |
| 27 | Inaktive managers parkeres + tydelig tilmelding | Delvist bygget | Holdes hvis du godkender listen i denne uge | 9 | M |
| 28 | Assistenten fortæller når den har udtaget holdet | Ikke startet | Holdes hvis den tages nu | 9 | S-M |
| **Måske** ||||||
| 29 | Upkeep-rework | Ikke startet | var aldrig datobundet | intet område | L |

**Holdt i dag: 8 og 25.** To ud af 24 rigtige løfter.

---

## Løfte for løfte

### 1. Forklaring på hvorfor ryttere står stille i værdi, plus de meldte fejl

**Status: delvist leveret til alle.**
De to fejl spillerne meldte er lukket: #4417 (markedsværdi står uændret i 14 dage, knud_r_flink 29/8, lukket 5/9) og #4872 (to ryttere står stille efter værdi-justeringen, knud_r_flink 6/9, lukket 14/9). Forklaringen er kommet i Hjælp: patch note 7.271 (13/9) *"Help now says when a rider's value starts to fall"* (#5181, lukket 14/9), og tidligere 7.239 (3/9) *"Current value is not the ceiling"*.

**Hvad spilleren faktisk har fået:** svar på to konkrete fejl, plus to hjælpetekster han selv skal finde.

**Hvad der mangler:** #4263 er stadig åben — *"Rytterens værdi falder 240k på to måneder mens evnerne stiger, intet i UI forklarer hvorfor"* (mandia1984 26/8). Det er præcis løftets ordlyd, og den mangler på selve rytterfladen, ikke i Hjælp. **Omfang: S.**

**Holdes til tiden?** Holdes hvis #4263 får sin linje inden 27/9.

**Område:** intet område. Overblikket har ikke rytterværdi-kommunikation.

---

### 2. Afklaring af hvordan en rytters sekundære type virker

**Status: ikke startet efter løftet.**
Hjælpeteksten om primær og sekundær type findes i `frontend/public/locales/{en,da}/help.json` — men den er fra **14/8** (commit `e89c2b15e`), altså en måned før løftet. Der er ingen patch note om sekundær type siden 15/9.

**Hvad spilleren faktisk har fået:** ingenting nyt. Fire åbne issues er netop det løftet skal rydde op i:
#3813 (rytterens sekundære type matcher ikke altid hans næsthøjeste loft — spilleren kan ikke bruge typen til at læse potentialet), #3631 (skæv fordeling: sprinter 33,7 % i bestanden), #5030 (puncheur-opskriften er for bred), #4822 (ubesvaret spillerspørgsmål fra 4/9).

**Hvad der mangler:** en afgørelse af om typen skal matche loftet (#3813), og derefter én forklaring til spillerne. **Omfang: S** hvis det kun er en forklaring, **M** hvis #3813 skal rettes først.

**Holdes til tiden?** **Nej** som en rigtig afklaring. En ren forklaring kan nås, men den vil være en forklaring på noget der stadig er skævt.

**Område:** intet område.

---

### 3. Et kort formpas dagen før løb, for alle ryttere

**Status: ikke startet.**
#5238 (*Åbnere / Race Sharpener*, femte dagstype) er åben med `claude:todo`, ingen PR. Den forudsætter #5205 (merget 15/9) og #3763 (åben: spilleren skal kunne se formen bevæge sig).

**Rettelse til overblikket:** område 5 siger at #5238 *"kræver et A/B-svar fra dig"*. Det svar **foreligger**: ejer-beslutning 14/9 på #4633 — formtræning = (b), en session med sin egen form-effekt med (a)'s træthedskobling indbygget, aldrig evner, loft på dage i træk, kvalitativ visning. Blokeringen er væk; kun #3763 og selve byggeriet mangler.

**Hvad der mangler:** dagstypen i stigen, form-effekt nær løb i `riderCondition.js`, loftet på dage i træk, fog-of-war-visningen, skærmbillede EN+DA, patch note. **Omfang: M.**

**Holdes til tiden?** **Nej** inden 27/9 uden at noget andet ryger. Den er ikke begyndt, og den deler kø med alt andet på træningssiden.

**Område:** 5.

---

### 4. De mentale evner får mere plads; taktik og aggression uden alder; ingen mister noget; hele historien fra dig før det lander

**Status: landet til alle 15/9 — på funktionen, ikke på garantierne.**
Patch note 7.277 (15/9) leverede begge dele: *"Two new mental abilities: Teamwork and Leadership"* og *"Tactics and aggression no longer come with a hidden age bonus"* (#5268, #5280, #3668). PR #5280 er merget 15/9.

**Hvad spilleren faktisk har fået:** funktionen — og et brud på begge garantier.
*"No rider loses anything"* holdt ikke i praksis. #5351 (åben, `priority:high`) dokumenterer med citater fra fem spillere at rating og potentiale faldt 2-5 point 15-17/9. #5288 (lukket 17/9) var en tilbagerulning af baroudeurens aggressions-loft. Patch note 7.278 *"Your fighters got their potential back"* og 7.286 *"One rating per rider, everywhere"* er begge rettelser af netop dette.
*"You will get the full story from me before it lands"*: beskeden er **ikke sendt**. #5351's punkt 3 står ordret som *"Spillerbesked (ejeren poster selv): hvad der er sket, og at rytterne ikke er blevet dårligere"* — åben.

**Hvad der mangler:** point-flytningen #5268 (åben, ejer-gated — det er den der får tallene til at rette sig selv), loft-beslutningen i #5351 (NOW.md: *"byg intet"* indtil samtalen er taget), og selve beskeden. **Omfang: M** for det hele, **S** for beskeden alene.

**Holdes til tiden?** **Delvist brudt allerede.** Funktionen er leveret; begge garantier er ikke holdt. Det kan ikke gøres om — kun forklares.

**Område:** intet område. Overblikket har ikke evne- og rating-sporet.

---

### 5. En bedre mobilvisning af daglig træning, transfers, auktioner og sæsonmatricen

Fire flader, hver for sig:

| Flade | Status | Bevis |
|---|---|---|
| Transfers | **Leveret til alle** | PR #5235 merget 17/9, patch note 7.285 |
| Auktioner | **Leveret til alle** | D-047 live (#5124-kommentar 17/9); 7.285: *"Auctions already used cards on small screens"* |
| Daglig træning | **Leveret i beta** | PR #5397 merget 19/9, flag `training_mobile_table` = **beta** |
| Sæsonmatricen | **Ikke ændret** | 7.285: matrixen *"beholder sin låste navnekolonne med vilje"*; #5124-kommentar 19/9: *"Resten af #5124 er uændret"* |

**Hvad spilleren faktisk har fået:** to flader helt, én i to lag (D-047-tabellen for alle, den nye mockup-2-tabel kun for beta-testere efter ejerens eget valg 19/9: *"Jeg vil have det kun live for beta testere i starten"*), og én uændret. #5124 er stadig åben med `needs-design`. Sæsonmatricens egen åbne UX-sag er #4535.

**Hvad der mangler:** sæsonmatricen, og et flip af `training_mobile_table` fra beta til on. **Omfang: S-M.**

**Holdes til tiden?** Holdes hvis matricen får samme behandling og flaget flippes. Som det står i dag er 2,5 af 4 flader holdt.

**Område:** intet område.

---

### 6. Løbskalenderen for sæson 4, inklusive U23- og junior-kalenderen

Tre kalendere, tre svar:

- **Senior:** bygget, ikke kørt. Sæson 4-rækken findes ikke i databasen (målt 19/9). Alle tekniske forhindringer er væk efter #5406-#5409, merget 19/9. Mangler ét go pr. kørsel og løbsdags-tallet fra løfte 7. **Omfang: S.**
- **U23:** ikke startet. #4620 åben, `claude:todo`, ingen PR. Generator A6 er ikke bygget.
- **Junior:** ikke startet. #4621 åben, `claude:todo`, ingen PR.

**Hvad der mangler:** dit go til `--apply` (senior); hele fase A+B af specen (U23 og junior), som specen selv sætter til 80+ timer. **Omfang: S for senior, L for resten.**

**Holdes til tiden?** Senior-delen holdes hvis du giver go inden 21/9. U23 og junior holdes **ikke**.

**Område:** 1 (senior), 7 (U23 og junior).

---

### 7. Alle divisioner får samme antal løbsdage fra sæson 4

**Status: besluttet og bygget, ikke merget.**
Tallet **140 er låst** (ejer 15/9, `TRAINING_RULES.md` §13.3 beslutning 2). PR #5169 er åben, ikke merget, mærket `backend-only` + `needs-design`. Prøvepakningen 19/9 er grøn på begge måder.

**En mekanisk detalje der betyder noget:** kalendertætheden er i dag ejer-låst pr. division — `TIER_DENSITY` = 5/4/3/3 i `backend/lib/calendarTierCaps.js`. Med den alene har D4 tre løbsdage pr. dato, ikke fem. Løftet *"lower divisions get more days to train"* leveres altså **kun** hvis #5169 merges; den låste tæthed gør det ikke af sig selv.

**Hvad der mangler:** afstemningen A/B postes og aflæses → #5169 bygges færdig → merge → kalenderen genereres med `--race-days 140`. **Omfang: M** (tiden ligger i afstemningen, ikke i kode).

**Holdes til tiden?** Holdes hvis afstemningen postes i dag eller i morgen. Det er den enkeltpost der blokerer flest andre.

**Område:** 3.

---

### 8. Beta-programmet åbner for alvor

**Status: leveret til alle 18/9. HOLDT.**
Patch note 7.288 (18/9): *"Ask to join the beta group"* — profilen har et Beta-gruppe-kort med opt-in og opt-out, og ejeren svarer selv i indbakken. PR #5373 merget, #5259 mærket `claude:done`. Samme udrulning bruger stadie-flag off/beta/on, som `training_mobile_table` og `training_score_visible` nu kører på.

**Hvad der mangler:** ingenting for at løftet er holdt.

**Holdes til tiden?** **Holdt.**

**Område:** intet område.

---

### 9. Træningsscoren for alle

Løftet siger selv *"It is in beta now"* — altså at den skal ud til alle.

**Status: leveret i beta.**
Registret: `training-score`, state `beta`, flag `training_score_visible`. PR #5261 merget 15/9 (formel, tabel, kolonne, profilkort). #4851 er mærket `claude:done` men står stadig åben.

**Hvad spilleren faktisk har fået:** intet, medmindre han er beta-tester eller admin.

**Hvad der mangler:** et flip til `on`, og udmeldingen af 1-99-skalaen som du selv satte til senest 21/9 (`NOW.md`). Koblingen er at #5351 siger *"byg intet"* på loft- og potentiale-sporet indtil ejer-samtalen er taget — og scoren og potentialet hænger sammen. **Omfang: S** for flippet, **S** for udmeldingen.

**Holdes til tiden?** Holdes hvis du tager loft-samtalen og flipper. Der mangler ingen kode.

**Område:** intet område. Overblikket har ikke dette flip.

---

### 10-14. "Måske, hvis der er plads" — ikke løfter

Bedømmes ikke på tid. Kort status, fordi de er skrevet til spillerne:

- **10 Flere faciliteter:** ikke startet. Registret siger `facilities` er live, men noten er *"Træning/scouting live, resten ikke"*.
- **11 Mobil ud over træning og transfers:** delvist. D-047 ramte også ønskelisten (#5124-kommentar 17/9); patch notes 7.269 og 7.273.
- **12 Hastighed:** leveret løbende. Patch 7.288 *"Lighter pages"* (#5055, #5177), 7.271 *"Faster loads after an update"*.
- **13 Flere fair play-værktøjer:** delvist. #5284 admin-fair play merget 17/9; epic #3131 og ugescan #5203 er åbne.
- **14 Pro-rettelser:** delvist. 7.252 og 7.240 (CZ Pro v1.1). #4514 er åben og alvorlig: en kunde havde ubetalt faktura i 23 dage med fuld Pro-adgang.

---

### 15. Race engine v4 færdig og tændt

**Status: ikke klar.**
Registret: `race-engine-v4` = **dormant**, off i prod (#4951). #4914 (kalibreringspakke: holdspil-gab, M12 all_out/grupetto, feltspredning, 5-seed-gate) er åben. #4915 (TTT- og passage-følgesager) er åben. #4948 (Hjælp-sektionen `raceDay` er hardkodet skjult) er åben. v3 kører S3 færdig og er låst fallback.

**Hvad der mangler:** kalibreringen lukkes, følgesagerne lukkes, og dit go. Efter reglen fra 27/6 er gen-tænding af en live løbsmotor kun dit kald. **Omfang: L.**

**Holdes til tiden?** **Var aldrig datobundet.** Løftet siger det selv: *"It goes live when it beats the current engine, not on a date."* Den skal ikke med i en undskyldning.

**Område:** 11.

---

### 16. Bestyrelses-reworket færdigt: mandater og et rigtigt møde

**Status: bygget, i beta.**
Både mandatet og mødet findes: Boardroom-siden (PR #4844, merget 5/9), årsmødet (`frontend/src/pages/annualMeeting/AnnualMeetingPage.jsx`, `boardMandateMeeting.js`, `BOARD_RULES.md` §3.2-3.3), Sponsors flyttet ud af Board (PR #4843). Flaget `board_mandate_model_enabled` er **beta**. #4855 (hjælpetekst + patch note) og #4856 (bonustilbud-fejlen) er lukket.

**Hvad spilleren faktisk har fået:** beta-testere ser det. Alle andre ser stadig listen af mål.

**Hvad der mangler:** #4857 backfill af de 2 hold uden bestyrelsesrelation (kræver dit go til `--apply`), sæson 4-rækken i databasen (#4270 — uden den efterlader skiftet 237 hold med et afsluttet mandat og intet nyt, fundet i #4838), visningsfejlen i beta som egomadsen fandt 18/9 (manglende ord i Mandat-fladen, din egen diagnose *"en fejl med speaks"*, dokumenteret på #4859), og derefter flippet (#4859, åben). **Omfang: S.**

**Holdes til tiden?** Holdes hvis S4-rækken kommer i databasen og du giver flip-go. Lav risiko — det er det billigste af de store løfter.

**Område:** 10.

---

### 17. U23-hold og juniorhold bliver rigtige trupper; "kommer snart"-kortet bliver ægte

**Status: fundamentet merget, trupperne ikke bygget.**
Merget: `riders.squad` og trup-lofter (#5279, 15/9), ét delt senior-trup-prædikat (#5396, 18/9), U23-fødselsbåndet variant A (#5401, 18/9), rytterfødsel uden PCM-stats (#5278), den synlige generator-test (#5368). Registret siger `three-squads` = **spec**, note: *"Slice 0 er leveret; resten er spec"*.

Selve "kommer snart"-kortet er live siden patch note 7.235 (2/9, #4618). Det er præcis det kort løftet siger skal blive ægte.

**Hvad der mangler:** generator A6 (specen sætter den alene til 10 timer), backfill af `riders.squad` (ejer-gated, ikke kørt — indtil da kræver senior-prædikatet både `squad=senior` OG `is_academy=false`), og selve trup-fladerne. Plus #5283's punkt 2: sammenligningen med 10 eksisterende prod-ryttere er ikke lavet, og den var din betingelse 15/9 før nye ryttere genereres. **Omfang: L.**

**Holdes til tiden?** **Nej.**

**Område:** 6.

---

### 18. U23-løb og junior-løb, på egne kalendere og i egne ligaer

**Status: ikke startet.**
#4620, #4621 og epic #2492 er alle åbne med `claude:todo`. Der findes ingen PR på kalenderen eller fladerne. Specen fra 15/9 deler arbejdet i fase A (skal ligge før S4-genereringen, 44-50 timer) og fase B (klar ved cutover hvis løbene skal køre fra dag 1, ca. 36 timer). Du besluttede 15/9 (§13.3 punkt 5) at U23-kalenderen bygges med i cutoveren; risikoen blev flagget samme dag som *"13 dage, nul buffer"*. Der er nu 8 dage, og fase A er ikke begyndt.

**Hvad der mangler:** hele fase A og B, seks åbne beslutninger som specen selv lister, og visuel godkendelse fra dig på hver flade før merge. **Omfang: L.**

**Holdes til tiden?** **Nej.** Det er det største enkelte stykke arbejde på hele listen.

**Område:** 7.

---

### 19. Graduation Day erstatter gradueringslisten, ugen før skiftet

**Status: ikke startet.**
#2491 er åben med `claude:todo`, ingen PR. MASTERPLAN har den i bølge 6 markeret som ikke startet, med *"senest 20/9"*.

**Hvad spilleren faktisk har fået:** en ændret aldersgrænse, ikke ritualet. Patch note 7.277 (15/9): *"Graduation Day comes at 23, not 22"* (#4619, #5279). Det er navnet på en regel, ikke den side løftet beskriver. Nedrykning ≤ 21 er ikke live (#5145 parkeret 14/9).

**Løftets egen frist:** *"the week before the switch"* starter ca. 20/9 — i morgen. Den frist brydes uanset hvad du beslutter i dag.

**Hvad der mangler:** selve siden (T1, `YOUTH_RULES` §2.6), default-kæden ved skiftet, fog-gate på trænerens vurdering, EN+DA, hjælpetekst, patch note. **Omfang: M.**

**Holdes til tiden?** **Nej.** Og den er tom uden løfte 17 og 18: uden en U23-trup er der ingen trup at rykke op i.

**Område:** 8.

---

### 20. Træning fra løb kommer tilbage; fra sæson 4 træner en rytter eller kører løb

To dele, og de sidder i hver sit flag:

- **Del A — rytteren træner eller kører løb.** Fundamentet #5205 er merget 15/9 bag flaget `training_tick_per_race_day`, som er **off**. Overbygningen B4 (PR #5264) er åben og skal rettes før merge: gennemgangen 18/9 fandt tre brud mod din egen realisme-regel.
- **Del B — "racing develops the abilities the race actually uses".** Det er `race_day_development_enabled`, og registret siger **dormant**, note: *"Bygget (D2); afventer #4850"*. #4850 er åben. Patch note 7.221 (30/8) bekræfter at den blev slukket. Det er præcis den del løftet kalder *"comes back"*.

**Overblikkets område 4 dækker kun del A.** Del B har intet område og dukker ikke op i de 14.

**Hvad der mangler:** B4's tre rettelser, merge af B3, og et flip af **begge** flag. Del B's gentænding er en balance-beslutning, ikke kun et klik. **Omfang: M.**

**Holdes til tiden?** Holdes hvis B4 rettes og begge flag tændes ved skiftet. Del B er den usikre.

**Område:** 4 (del A) og intet område (del B).

---

### 21. Ugeplanen sætter også sessionen for hver løbsdag, for én rytter eller hele truppen

**Status: ikke startet, og har ikke et eget issue.**
Det er beslutning 8 i `TRAINING_RULES.md` §13.3: program pr. løbsdag = 7 ugedage × 5 løbsdage = 35 celler. Ejeren afviste 15/9 den enklere model efter at have set billedet. Der findes hverken issue eller PR. Det kræver en migration af `training_week_plans`, hvor 27 hold har data.

**Hvad der mangler:** mockup → issue → byg → migration af eksisterende planer. **Omfang: M-L.**

**Holdes til tiden?** **Nej** inden 28/9 uden at noget andet ryger.

**Område:** 5.

---

### 22. Den daglige træning kører én gang om aftenen; "Træn i dag"-bonussen forsvinder

**Status: bygget, ikke tændt.**
PR #5264 (B4) bygger begge dele: én samlet sweep når dagens sidste løb er lukket og klokken er mindst 20 dansk tid, plus den frivillige knap *"Kør dagens træning nu"* uden bonus. PR #5281 (B3) fjerner bonussen fra formlen og merges bevidst først på flip-dagen, fordi den ændrer balancen for alle.

**Vigtig præcisering fra PR #5264's egen tekst:** `DAILY_TRAINING_CONFIG.bonusMult` (1,25) og strengen *"Train today (+25% …)"* er **ikke** fjernet. De lever uændret på den gamle kalenderdags-sti og slettes først i cutover-skridtet. Spilleren ser altså stadig +25 %-knappen indtil flippet.

**Hvad der mangler:** B4-rettelserne, merge af B3, flippet, verifikation. **Omfang: M.**

**Holdes til tiden?** Holdes på selve flip-dagen — ikke før.

**Område:** 4.

---

### 23. Skader tælles i løbsdage

**Status: besluttet, hører til B4-rettelsen.**
§13.3 beslutning 7 siger ordret at *"PR #5205's kalenderdags-valg ændres i B4"*. B4 (PR #5264) er åben og skal rettes, og dens egen ændringsliste nævner ikke skadesvarighed. Så: besluttet, men ikke synligt bygget.

**Hvad der mangler:** konverteringen plus UI'et (*"ca. <dato>"*). **Omfang: S-M.**

**Holdes til tiden?** Holdes hvis den tages med i B4-rettelsen. Tændes flaget uden den, viser spillet skader i kalenderdage mens træningen regner i løbsdage, og de to tal stemmer ikke for spilleren.

**Område:** 4 og 5.

---

### 24. Træningssiden bygget færdig én gang, med scoren, programmet og de nye sessioner samlet

**Status: mobilen afgjort og leveret i beta; desktop ikke startet.**
`TRAINING_RULES.md` §13.1 siger det direkte: træningssidens layout er *"Afgjort for MOBIL 18/9 … Desktop-fladen er stadig åben."* #4849 (tests, hjælpetekst og patch note for omlægningen) er åben.

**Og løftet siger "én gang".** Mobilfladen er nu bygget om ad to omgange alene: D-047-grenen i PR #5235 (17/9) og mockup-2-tabellen i PR #5397 (19/9) — og den gamle gren lever videre i `TrainingPage.jsx` indtil flaget går til `on`. *"Bygget færdig én gang"* er allerede ikke sandt.

**Hvad der mangler:** desktop-fladen designet og bygget, med scoren, programmet og de nye sessioner samlet. **Omfang: L.**

**Holdes til tiden?** **Nej.**

**Område:** 5.

---

### 25. Sponsor-fejlrettelser

**Status: leveret til alle. HOLDT.**
PR #5336 merget 17/9 (renown-fallback før første løb, frossen default-pris, ærlig hjælpetekst). Meldt ud i patch note 7.284 *"Picking your sponsor early no longer costs you"* (#4860, #4376) og 7.286 *"The season start sponsor line names your contract"* (#4861).

**Note:** #4376 og #4861 er mærket `claude:done`, men står stadig åbne — samme mønster som #4851, #5259 og #452. Det er bogføring, ikke manglende arbejde. De sponsor-sager der er tilbage (#3595 mål uden konsekvens, #3987 skalering, #3147 løbende udbetaling, #5116 sponsor-univers) er features og balance, ikke fejl.

**Holdes til tiden?** **Holdt**, som løftet er formuleret.

**Område:** intet område.

---

### 26. Én rytter-opdatering med en besked fra dig: tre trupper, de mentale evner på plads, intet taget fra nogen

**Status: formen er brudt, indholdet er halvt, beskeden mangler.**

- *"Én"* holder ikke: rytter-ændringerne er allerede kommet i tre patch notes — 7.277 (15/9, evnerne), 7.278 (16/9, *"Your fighters got their potential back"*) og 7.286 (17/9, *"One rating per rider, everywhere"*).
- *"Tre trupper"* er ikke leveret (registret: `three-squads` = spec).
- *"De mentale evner på plads"* er ikke færdigt: point-flytningen #5268 er åben og ejer-gated, og evnerne er i dag data uden at være med i rating-opskriften (NOW.md 17/9).
- *"Intet taget fra nogen"* blev synligt brudt i 2-3 dage (#5351, #5288).
- **Beskeden er ikke sendt.** #5351's punkt 3 er stadig åbent.

**Hvad der mangler:** #5268 kørt, trupperne, og selve beskeden. **Omfang: S for beskeden alene**, L for resten.

**Holdes til tiden?** **Nej på formen.** Beskeden kan stadig nås, og den er den billigste enkeltpost på hele listen.

**Område:** intet område.

---

### 27. Inaktive managers parkeres ved skiftet, og en tydelig tilmelding til den nye sæson

**Status: delvist bygget.**
Definitionen og rapporten er bygget (#4592's første del): `managerActivity.js`, `dormantTeamsReport.js`, SQL-skabelon, en linje i cutover-preflighten. Tilmeldingsknappen (#452) er bygget og ligger bag `season_signup_enabled`, som registret markerer **dormant**, note: *"Dormant til S4-cutover (#452)"*. Patch noten er bevidst ikke skrevet endnu (#4592-kommentar 7/9).
Selve parkeringen er ikke bygget — bevidst, fordi du skal se kandidatlisten først. Målingen 2/9: 96 menneskehold i D3, 17 aktive, 64 sovende.

**Hvad spilleren faktisk har fået:** ingenting. Knappen er usynlig.

**Hvad der mangler:** frisk rapport → din godkendelse af listen → parkeringen bygges → flaget tændes ved cutover + patch note. **Omfang: M.**

**Holdes til tiden?** Holdes hvis du godkender listen i denne uge.

**Område:** 9.

---

### 28. Assistenten fortæller dig når den har udtaget dit hold

**Status: ikke startet.**
#4759 er åben med `claude:todo` og har ingen aktivitet siden 4/9. Issuet dækker både beskeden og valget af `assistant_selection_mode` ved S4-cutover.

**Hvad spilleren faktisk har fået:** en ændring af hvornår assistenten griber ind — patch note 7.273 (14/9) *"The assistant only fills a squad that is completely empty"* (#5136) — men ingen besked når den har gjort det.

**Hvad der mangler:** notifikationstype, tekst EN+DA, og dit valg mellem `proactive`, `late_fill` (24 t) og `opt_in`. **Omfang: S-M.**

**Holdes til tiden?** Holdes hvis den tages nu. Den er lille, og valget skal du alligevel træffe før cutoveren.

**Område:** 9.

---

### 29. Upkeep-rework — "Måske"

Ikke et løfte. Status: ikke startet. #4385 er åben (dit direktiv 29/8: upkeep skal blive en løbende rejse- og personaleudgift pr. løbsdag i stedet for et fladt sæsonstart-træk), og #3720 er åben og alvorlig: kalibreringen bag upkeep-kurven byggede på en præmie der er 3,7-6,6 gange for lav.

---

## (a) Løfter der er HOLDT, men ikke fortalt til spillerne

Kort liste, fordi der ikke er meget her — det meste der er leveret, er også meldt ud.

1. **Løfte 5's træningsdel.** PR #5397 er merget 19/9 og er live for beta-testere. Der er ingen patch note: nyeste er 7.288 fra 18/9. Beta-testerne får en helt ny mobilflade uden et ord om at den er ny, hvad den erstatter, eller at de kan sige fra. Det er dem du udtrykkeligt ville *"snakke om det og tilpasse"* med.
2. **Løfte 27's tilmeldingsknap.** #452 er bygget og har ligget færdig siden 2/9 bag `season_signup_enabled`. Patch noten er bevidst tilbageholdt til flippet — det er en rigtig beslutning, men det betyder at der ligger en færdig funktion spillerne ikke ved eksisterer, og den bliver først synlig samtidig med at folk bliver parkeret.
3. **Løfte 4's funktion er meldt ud, men ikke dens historie.** 7.277 fortalte *hvad* der skete. Løftet lovede *hvorfor*, og at det kom først. Den del mangler stadig (#5351 punkt 3).
4. **Løfte 1 er halvt fortalt.** Hjælpen siger nu hvornår værdien begynder at falde (7.271), men rytterfladen forklarer det ikke (#4263, åben).

Bogførings-note, ikke kommunikation: #4851, #5259, #452, #4376, #4861, #5124, #5283 og #3643 er alle mærket `claude:done` og står stadig åbne. Det gør backloggen sværere at læse, men spillerne mærker det ikke.

---

## (b) Løfter der efter en ærlig læsning IKKE holdes til tiden

Grupperet, med hvad en ærlig udmelding skal dække. **Selve teksten skriver og poster du selv.**

### Gruppe 1: U23- og junior-sporet — løfte 6 (delvist), 17, 18, 19

Det største. Fire løfter, og ingen af dem er begyndt på den del der tæller: U23- og junior-kalenderen, trupperne som rigtige trupper, deres egne ligaer, og Graduation Day. Fundamentet er merget, men specens eget skøn for det der skal ligge **før** kalenderen genereres er 44-50 timer, og fase B er yderligere ca. 36. Der er 8 dage, som også skal rumme senior-kalenderen, træningen, mandatet og selve skiftet.

En udmelding skal dække: at de tre trupper og deres løb ikke er med fra sæson 4's start; hvad *"kommer snart"*-kortet på Akademi-siden så betyder nu; hvad der sker med ryttere der er vokset ud af akademiet ved skiftet (den eksisterende kæde kører, uden ceremoni); og hvornår det så kommer. Den skal også nævne at Graduation Day-alderen allerede er flyttet til 23, så spillerne ikke tror det var hele løftet.

### Gruppe 2: Træningens overbygning — løfte 3, 21, 24, og risikoen på 23

Det der **kan** nås 28/9 er tick'et pr. løbsdag, aftenkørslen og knappen uden bonus (løfte 20 del A og 22). Det der **ikke** når det er formpasset (3), programmet pr. løbsdag (21) og træningssiden samlet (24). Skader i løbsdage (23) når det kun hvis den tages med i B4-rettelsen.

En udmelding skal dække: præcis hvad der ændrer sig for spilleren 28/9 og hvad der ikke gør; at +25 %-knappen forsvinder den dag og ikke før; og at resten af træningssiden kommer i løbet af sæson 4. Den skal være konkret om hvad en spiller skal gøre anderledes fra dag 1, fordi træningens rytme ændrer sig for alle på én gang.

### Gruppe 3: De to halve fra sæson 3 — løfte 2 og løfte 5's sæsonmatrix

Sekundær ryttertype er ikke afklaret, og sæsonmatricen på mobil er ikke rørt. Begge er små i forhold til gruppe 1 og 2, men de står på listen under *"During season 3 (now)"*, og sæson 3 slutter om 8 dage.

En udmelding skal dække: at typen stadig undersøges, hvad der konkret er skævt (#3813: typen matcher ikke altid næsthøjeste loft), og om matricen kommer eller er som den skal være.

### Gruppe 4: Løftets form — løfte 26, og garantierne i løfte 4

*"Én rytter-opdatering med en besked fra mig"* kan ikke længere holdes: opdateringen er allerede kommet ad tre omgange, og beskeden kom ikke før. *"Intet taget fra nogen"* blev brudt synligt i to-tre dage.

En udmelding skal dække: hvad der skete 15-17/9, at rytterne ikke er blevet dårligere, hvad point-flytningen (#5268) vil gøre ved tallene når den kører, og hvornår trupperne kommer. Det er den ene af alle disse der er billig at levere og som spillerne allerede har bedt om i fem separate Discord-beskeder.

### Ikke i (b)

**Løfte 15** (race engine v4) undtager sig selv: *"It goes live when it beats the current engine, not on a date."* Den skal ikke med i en undskyldning. Det samme gælder punkt 10-14 og 29, der står under *"Maybe"*.

---

## (c) Løfter der tvinger et område op i "skal være klar 27/9"

| Område | Overblikkets dom i dag | Løfterne siger | Ny dom |
|---|---|---|---|
| **5** Resten af træningen | "Nej" — kan lande efter | Løfte 21, 23 og 24 er *"Before season 4 starts"*. Løfte 3 er endda *"During season 3"* | **Ja, lovet** — men når det ikke. Overblikket har ret i at intet går i stykker; det har uret i at området er valgfrit |
| **6** U23- og junior-ryttere | "Kun hvis U23 med" | Løfte 17 er et rent løfte før sæson 4, ikke et valg | **Lovet.** Udskydelse er stadig den rigtige beslutning, men den kræver en udmelding, ikke bare et valg |
| **7** U23-kalender og trup-flader | "Kun hvis U23 med" | Løfte 6 og 18 lover begge U23- og junior-kalendere | **Lovet.** Samme som 6 |
| **8** Graduation Day | "Ja, frist var 20/9" | Løfte 19 sætter selv fristen til *ugen før skiftet* | Uændret på tid, men **fristen er løftets egen**, ikke en intern plan. Den brydes i morgen |
| **11** Race engine v4 | "Nej" | Løfte 15 undtager sig selv | **Uændret.** Ingen ændring |
| **2** Kalenderens kvalitet | "Nej" | Ikke lovet | **Uændret** |

**Rækker overblikket mangler helt.** Disse løfter har intet område i dag, og seks af dem har en frist:

1. **Evne- og rating-sporet** (løfte 4 og 26): #5268 point-flyt, #5351 loft-beslutning, og beskeden. Lovet før sæson 4.
2. **Træningsscoren ud til alle** (løfte 9): et flip af `training_score_visible` plus udmeldingen af 1-99-skalaen, som `NOW.md` selv sætter til senest 21/9. Lovet i sæson 3.
3. **Mobil-fladerne** (løfte 5): sæsonmatricen, og flippet af `training_mobile_table` fra beta til on. Lovet i sæson 3.
4. **Rytterværdi-forklaringen på fladen** (løfte 1): #4263. Lovet i sæson 3.
5. **Sekundær ryttertype** (løfte 2): #3813. Lovet i sæson 3.
6. **Løbsdags-udvikling** (løfte 20 del B): `race_day_development_enabled` er dormant og afventer #4850. Overblikkets område 4 dækker kun tick'et, ikke den del af løftet der hedder *"racing develops the abilities the race actually uses"*.

---

## (d) Modsigelser mellem løfter og låste ejer-beslutninger

1. **Løfte 19 mod kalenderen.** *"The week before the switch"* starter ca. 20/9 — i morgen. #2491 er ikke startet, og MASTERPLAN har den i bølge 6 som ikke startet. Fristen er løftets egen og brydes uanset hvad du beslutter i dag. Den kan ikke reddes ved at flytte en intern frist.

2. **Løfte 4 og 26 mod det der allerede er sket.** Begge lover en besked fra dig **før** det lander. Det landede 15/9 (patch note 7.277). Beskeden er stadig et åbent punkt (#5351 punkt 3). Løfte 26's *"én rytter-opdatering"* er også allerede brudt: 7.277, 7.278 og 7.286 er tre.

3. **Løfte 4's "ingen rytter mister noget" mod #5351.** Fem spillere målte fald på 2-5 point i rating og potentiale 15-17/9. Visningen er rettet (7.286), baroudeur-loftet rullet tilbage (#5288), men loft-beslutningen er stadig åben, og `NOW.md` siger *"byg intet"* indtil ejer-samtalen er taget. Løftet er altså brudt på et punkt der stadig ikke er lukket.

4. **Løfte 7 mod den låste divisionstæthed.** `TIER_DENSITY` er ejer-låst til 5/4/3/3. Med den alene har D4 tre løbsdage pr. dato, ikke fem, og løftet om lige mange løbsdage leveres ikke. Det holdes **kun** hvis PR #5169 merges — og #5169 venter på en afstemning der ikke er postet. Det er ikke en modsigelse i ord, men i mekanik: den låste beslutning leverer ikke løftet af sig selv.

5. **Løfte 22 mod PR #5264's egen tekst.** `bonusMult` og strengen *"Train today (+25% …)"* slettes først i cutover-skridtet, ikke ved merge. Det er den rigtige rækkefølge, men det betyder at løftet først er synligt holdt på selve flip-dagen. Går flippet ikke igennem 27-28/9, står +25 %-knappen der stadig, og løftet er brudt uden at nogen har besluttet det.

6. **Løfte 9 mod #5351's "byg intet".** Scoren skal ud til alle, men loft- og potentiale-sporet er sat i stå indtil ejer-samtalen. Scoren og potentialet hænger sammen, så flippet og samtalen kan ikke skilles ad.

7. **Løfte 24 "bygget færdig én gang" mod mobil-beslutningen 18-19/9.** Træningssiden er nu bygget om ad to omgange på mobil alene, og den gamle gren lever videre indtil flaget går til `on`. Det var en god beslutning; den modsiger bare løftets ord.

8. **Løfte 5 mod dit eget beta-valg 19/9.** Løftet lover spillerne en bedre mobilvisning af daglig træning i sæson 3. Beslutningen 19/9 er at kun beta-testere ser den: *"Jeg vil have det kun live for beta testere i starten."* Beslutningen er rigtig efter beta-programmets logik, men løftet er skrevet til alle.

9. **Løfte 3 mod overblikket, ikke mod dig.** Område 5 siger at Åbnere venter på et A/B-svar fra dig. Svaret kom 14/9 på #4633 (formtræning = b). Det er overblikket der er forældet, ikke beslutningen der mangler.

---

## Kilder

GitHub: issues og PR'er læst 19/9 (seneste kommentarer på #5124, #4592, #4859, #4633, #5351; state og `mergedAt` på PR #5169, #5235, #5247, #5261, #5264, #5281, #5397, #5401, #5279, #5396, #5368, #5409, #5412-#5414, #3512).
Kode på `origin/main`: `docs/FEATURE_REGISTRY.yml`, `docs/TRAINING_RULES.md` §13-§13.3, `docs/BOARD_RULES.md`, `frontend/src/data/patchNotes.js` (t.o.m. 7.288), `frontend/public/locales/{en,da}/help.json`, `backend/lib/calendarTierCaps.js`.
Løfteteksten: `docs/drafts/roadbook-discord-2026-09-15.md` og `docs/drafts/roadbook-plan-2026-09-15.md` (sidst ændret 15/9).
Flag-tilstande er **registrets** tal, ikke aflæst i prod.
