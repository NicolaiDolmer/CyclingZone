# Udvikling 2.0 del 2: udvikling via løb, Udviklingsscore og catch-up mellem rige og fattige hold

**Status:** design 23/10 2026, ikke bygget. Bygger på låste ejer-valg (§1). Tre nye valg til ejeren i §7.
**Epic:** [#6110](https://github.com/NicolaiDolmer/CyclingZone/issues/6110) · **Catch-up:** [#6950](https://github.com/NicolaiDolmer/CyclingZone/issues/6950) (ejer-valg A 20/10) · **Relateret:** [#5950](https://github.com/NicolaiDolmer/CyclingZone/issues/5950) løbsudvikling · [#1981](https://github.com/NicolaiDolmer/CyclingZone/issues/1981) catch-up for nye klubber · [#6984](https://github.com/NicolaiDolmer/CyclingZone/issues/6984) form og træthed 2.0 · [#4632](https://github.com/NicolaiDolmer/CyclingZone/issues/4632) dagens intention
**Forgængere:** [spec 3/10](2026-10-03-udvikling-2-design.md) (del 1+2's retning) · [form og træthed 2.0](2026-10-20-6984-form-traethed-design.md)
**SSOT for reglerne i dag:** [`TRAINING_RULES.md`](../../TRAINING_RULES.md) §6.2 og §13 · [`PROGRESSION_RULES.md`](../../PROGRESSION_RULES.md) §5 og §11 · GDD D-018/D-019/D-020
**Tal:** privat i `balance-internals/6110-del2/baseline-2026-10-23.md` (hard rule 17). Denne spec beskriver kun mekanik og retning.

## 0. Kort fortalt

Del 2 gør løbet til den bedste udviklingsdag og bruger netop løbet til at løfte bunden. Tre greb, alle uden at tage noget fra toppen:

1. **Løbets tillæg koster ingen penge.** Træner og facilitet løfter fortsat træningen; løbets ekstra udbytte er det samme for alle hold.
2. **Passende sværhed som stræk-bonus.** En rytter der kører mod et felt lidt stærkere end ham selv, får et ekstra skub. Ingen får mindre, fordi han er stærk.
3. **Udviklingsscoren viser også løbsdagen**, så en manager på et lille hold kan se, at hans løb faktisk betaler sig.

Målingen 23/10 viser, at den største kløft i dag ikke er penge, men aktivitet, og at pengene virker gennem facilitet og trænere, også på løbsdage (§2).

## 1. Hvad er låst (genåbnes ikke)

| Hvor | Beslutning | Dato |
|---|---|---|
| #6110 D2 | En løbsdag giver tydeligt mere end en hård træningsdag i etapens evner. En rytter i eget terræn udvikler sig mere end hjemme; et blandet program koster lidt i hovedevnen men giver mere i alt ("løb slår træning, men er mindre målrettet"). Trætheden er prisen | 11/10 |
| #6110 D3 | Alle roller får lige meget ud af en løbsdag. Rollen afgør kun hvor: kaptajn og jæger mest i etapens afgørende evne, hjælpere mest i de bærende evner. Maks +1 pr. evne pr. dag består | 11/10 |
| #6110 D6 | AI-ryttere og frie ryttere udvikler sig ikke | 11/10 |
| #6110 D7 | Del 2 tændes samlet en søndag i S5, når den er bygget og simuleret. Ingen datopres | 11/10 |
| #6110 20/10 | "Træningsscore" omdøbes til "Udviklingsscore" samme søndag som løbsudviklingen tændes, i alle sprog + help.json + patch note | 20/10 |
| #6110 11/10 | Træningsscore variant B: én værdi pr. dag; talentet skiller sig først ud efter nogle træninger; 7-dages snit ved siden af | 11/10 |
| #6950 A | Løft bunden via løb: små hold får fuldt udbytte af løb på deres eget niveau ("passende sværhed", D-018 10/9). Ingen nye penge i økonomien, toppen røres ikke. Skal kunne måles i harness (kløft før/efter) | 20/10 |
| GDD D-018/19/20 | Passende udfordring og aftagende læring; erfaring udvikler eksisterende evner; fælles erfaringsområder på tværs af løb | 10/9 |
| Realisme-reglen | Én løbsdag: løb ELLER træning. Etapeløb binder fra første til sidste etape | 18/9 |
| Kalenderen | Antal løb pr. division røres ikke | 15/9 |
| #6984 B3 | Sæsonbelastningen deler løbsdagstælleren med Udvikling 2.0 | 20/10 |

**Doktrin:** styrke straffes aldrig. Ingen mekanik i del 2 må give en rytter mindre ud af en løbsdag end i dag eller end en hård træningsdag, og ingen regel må give mindre, fordi rytteren eller holdet er stærkt (gate G2).

## 2. Målt baseline (offentlig version)

Målt read-only i prod 23/10 på S4. Metode, stikprøve, opdeling og alle tal står privat i `balance-internals/6110-del2/` (hard rule 17); her står kun de kvalitative konklusioner, som designet bygger på.

**Træning mod løb**
- Løb står i dag for en lille del af rytternes samlede udvikling. Langt det meste kommer fra træning.
- En løbsdag giver klart mindre end en hård træningsdag (samme billede som 3/10). Forskellen er mindre, når man sammenligner inden for den samme rytter, fordi de ryttere der kører mange løb, er ældre og længere fremme. Begge målinger bekræfter D2's præmis: løbet betaler sig ikke i dag.
- Fattige hold kører relativt flere løb og træner hårdt langt sjældnere end rige hold. Løbet er altså allerede deres vigtigste udviklingskilde.

**Rige mod fattige**
- På tværs af divisioner er rigdom næsten det samme som division. Inden for en division er kløften i sæsonudvikling stor i D3 og D4 og lille i D1.
- **Den største forvekslingsfaktor er aktivitet.** I D3 er hele den fattigste tredjedel hold, hvis manager ikke har været inde den seneste uge. Blandt aktive hold er kløften i D1 omtrent nul og i D2 moderat. D4 domineres af hold, der kom til midt i sæsonen.
- **Pengene virker gennem facilitet og trænere.** Kontrolleret for alder og potentiale giver en topfacilitet unge ryttere en markant højere udvikling pr. hård dag end tier 0-1, og en lidt mindre fordel på løbsdagen. Løbsdagen bærer i dag samme facilitets- og træner-led som træningen, fordi den kører gennem `applyDailyTick` med de delte tick-argumenter (`TRAINING_RULES.md` §6.2, "Udbyttet"; `dailyTrainingEngine.js`, `racedToday`). Målingen bekræfter det: facilitetens fordel ses også på løbsdage.
- Rige holds ryttere er også yngre og har højere potentiale. Alderens vægt forsvinder med D1-kurven; potentialets bliver.

**Løbsmuligheder**
- D1 har flere løbsdage med etaper pr. pulje end D2-D4. Gennemsnitsrytteren kører omtrent lige mange løbsdage i alle divisioner, men de mest brugte D1-ryttere kører klart flere end de mest brugte D3-ryttere, hvor loftet allerede binder.

**Niveau mod feltet**
- De fattigste holds ryttere ligger typisk lidt under deres felts median og i en stor del af starterne klart under. De rigeste D3-hold ligger langt over feltet (oprykningskandidater).
- En "passende sværhed", der giver mindre både ved for let og for svært felt, ville derfor ramme bunden af D1 og D2 hyppigt: det modsatte af #6950.

## 3. Udvikling via løb (D2 + D3 udfoldet)

Løbsdagen er fortsat et program gennem den samme `applyDailyTick` som træningen (ingen kopi af formlen, samme fremdrifts-bar, carry-over og +1-loft). Planen er fortsat ikke input.

### 3.1 Byggestenene

| Led | Hvad det gør | Status |
|---|---|---|
| **Basis** | Etapens profil-evner som en hård dag (i dag: mellem-pas) | D2, låst |
| **Tillæg** | Et ekstra udbytte i profil-evnerne oven på basis. Det er D2's "tydeligt mere end en hård dag" | D2, låst; størrelsen privat |
| **Terræn-match** | Matcher etapens profil rytterens type (klatrer på bjergetape), er en større del af tillægget i hovedevnen. Uden match spredes det mere ("mindre målrettet, mere i alt") | D2, låst |
| **Rollen** | Samme samlede udbytte for alle roller; rollen flytter kun hvor tillægget lander | D3, låst |
| **Stræk-bonus** | Ekstra skub når feltet er lidt stærkere end rytteren | nyt, kort 2 |
| **Penge-led** | Træner og facilitet ganges på basis, ikke på tillæg og stræk-bonus | nyt, kort 1 |
| **+1-loft** | Maks +1 pr. evne pr. løbsdag, resten bæres videre | låst |
| **Prisen** | Trætheden fra løbet, med #6984 v2's sæsonbelastning | #6984, låst |

### 3.2 Rollens fordeling (D3)
- Kaptajn (`captain`), spurtkaptajn (`sprint_captain`) og jæger (`hunter`): tillægget lægges mest i etapens afgørende evne (bjerg → klatring, flad → sprint, enkeltstart → enkeltstart, brosten → brosten osv.).
- Hjælpere (`helper`): tillægget lægges mest i de bærende evner (udholdenhed, flad, positionering, restitution afhængigt af profilen).
- Fri rolle (`free_role`): ejer-spørgsmål, se §8.1. Rollerne er motorens `VALID_RACE_ROLES` (`raceRoles.js`).
- Kilde til rollen: etapens rolle i `race_stage_roles` (pr. etape), ellers løbets rolle i `race_entries.race_role`, ellers hjælper-fordelingen. Samme opslagsrækkefølge som løbsmotoren.
- Ingen straf for at hjælpe holdet: summen er ens.

### 3.3 Hvad tæller som en løbsdag
Uændret fra §6.2: rytteren har et etaperesultat på løbsdagen (`race_results` ⋈ `race_stage_schedule`). Bundet uden etape (hviledag i etapeløb) er hvile. Et endagsløb er én løbsdag. Udgået rytter: ejer-spørgsmål, se §8.1.

### 3.4 Sammenhæng med de øvrige S5-dele
- **D1-kurven** bestemmer hvor meget et point koster; løbsdagen arver den automatisk via tick'et.
- **D1b (blødt loft fra potentialet):** tillæg og stræk-bonus flytter aldrig det bløde loft. De er fart mod loftet, ikke højde, og jo tættere rytteren er på loftet, jo mindre giver de, præcis som træningen.
- **#6984 v2:** trætheden er prisen for løbets ekstra udvikling. Sæsonbelastningen gør mange løbsdage dyre, og det er den naturlige bremse på, at D1 har flere løbsdage (§2).
- **D4 (løbsbremse på tilbagegang):** samme løbsdagstæller.
- **Variant B (#4632, dagens intention):** lægges senere oven på som modifikator; denne spec lukker den ikke.

## 4. Catch-up mellem rige og fattige hold (#6950)

Ejerens løfte 28/9 og 1/10: lige muligheder, ikke lige resultat; løft bunden i stedet for at slå toppen ned; ingen valg må føles automatiske. Valget 20/10: via løb, passende sværhed, ingen nye penge.

### 4.1 Greb 1: løbets tillæg er uafhængigt af penge (kort 1)
Træner og facilitet ganges i dag på alt, også løbsdagen. Forslaget: de løfter fortsat basis (og al træning), men **tillægget og stræk-bonussen er ens for alle hold**. Det tager intet fra et rigt hold i forhold til i dag. Det betyder, at den nye værdi D2 lægger i løbet, er lige stor for alle, mens pengenes fordel bliver hvor den hører hjemme: i træningen.

Hvorfor det løfter bunden: fattige hold kører relativt flere løb, og deres ryttere har mindst gavn af facilitets-leddet. Når den nye udvikling i løbet ikke ganges med facilitet, er den relativt størst for dem.

### 4.2 Greb 2: passende sværhed som stræk-bonus (kort 2)
- **Feltets niveau** = medianen af starternes niveau i løbet (alle startere, også AI), fastfrosset ved løbsstart.
- **Rytterens niveau** = hans niveau ved løbsstart.
- **Stræk-zonen:** feltet er moderat stærkere end rytteren. Her gives en stræk-bonus oven på tillægget.
- **Eget niveau og for let:** fuldt tillæg, ingen bonus. Ingen reduktion, uanset hvor overlegen rytteren er.
- **Langt for svært** (helt sat af): fuldt tillæg, ingen bonus. Udmattelse er ikke en genvej (research-rapporten, D-018).
- Bonussen er glidende ind og ud af zonen, ingen trappe.

Hvorfor det løfter bunden: målingen viser, at de fattigste holds ryttere typisk ligger lidt under deres felt. Bonussen rammer dem, ikke toppen. Toppen beholder fuldt udbytte. En overlegen rytter i en for let division taber intet; han vinder bare ikke bonussen, og han rykker op.

Aftagende læring (D-018) og erfaringsområder (D-020) er ikke en del af del 2's første version. Stræk-bonussen er bygget, så de kan lægges ovenpå senere uden at ændre den.

### 4.3 Greb 3: løbsmængden mellem divisionerne (kort 3)
D1 har flere løbsdage med etaper end de lavere divisioner, og kalenderen er låst. Når løbet bliver mere værd, kan D1's mest brugte ryttere få mest ekstra. Forslaget er ingen ny regel: #6984's sæsonbelastning gør mange løbsdage dyre, og harnessen måler, om toppen af løbsmængden stadig skaber en kløft. Først hvis den gør, stilles et nyt kort.

### 4.4 Hvad catch-up ikke gør
- Ingen nye penge (sponsor, præmier) og ingen ændring af præmie- eller divisionsbonusser.
- Ingen belønning for inaktivitet. Assistentens hold kører også løb og får samme regler; aktive managere, der vælger de rigtige løb, får mest.
- Ingen hård begrænsning på rige hold, ingen loft over antal løb.
- Ingen effekt på AI-ryttere (D6), men AI-ryttere tæller med i feltets niveau.

## 5. Udviklingsscoren (omdøbningen + løbsdagen)

- **Navnet** skifter fra Træningsscore til Udviklingsscore samme søndag som løbsudviklingen tændes (låst 20/10). Alle sprog, help.json og patch note i samme PR.
- **Løbsdagen får et tal på samme skala** (forslag, arkitekt-valg; må udfordres). I dag vises "løb" uden tal. Med del 2 er løbet den bedste udviklingsdag, og uden et tal kan en manager på et lille hold ikke se, at hans løb betaler sig. Løbsdagens score bygges af de samme led som træningsdagens (kondition, talent, træner/facilitet på basis) plus terræn-match, rolle og stræk-bonus. Ingen nye skjulte tal vises: kun scoren og én linje "hvad trak op/ned" (fx "stærkt felt: ekstra udbytte").
- Scoren driver fortsat udviklingen med den eksisterende kobling (høj score giver lidt mere, samlet tempo uændret). **På løbsdagen kobles scoren kun på basis-delen.** Tillæg og stræk-bonus ganges ikke med koblingen, ellers ville trænere og facilitet snige sig ind i det ekstra udbytte igen via scoren og bryde kort 1 A. Vælges kort 1 B, kobles scoren på hele løbsdagen som i dag.
- Kortet på rytterprofilen viser løbsdage som punkter på kurven i stedet for huller.
- Ungdomsregler fra 11/10 (skjult potentiale, prognose efter 5 træninger) gælder uændret. Om løbsdage tæller som "træninger" til salgsgrænsen, er et ejer-spørgsmål (§8.1).

## 6. Harness og gates (simulér før ship)

Afspilning af S4's faktiske løbsdage og programmer for alle menneskeholds ryttere, med D1/D1b-kurven, #6984 v2 og del 2 bag hver sin knap. Kun SELECT. Output kun i `balance-internals/6110-del2/`.

| Gate | Hvad der måles | Krav |
|---|---|---|
| G1 Løb slår træning | Udbytte pr. løbsdag mod pr. hård dag, inden for samme rytter, i profil-evnerne | Løbsdag over hård dag (D2) |
| G2 Doktrin | Rytter-løbsdage hvor del 2 giver mindre end (a) løbsdagen i dag og (b) en hård træningsdag for samme rytter; og rytter-løbsdage hvor stræk-bonussen er negativ | Nul. Referencen er IKKE "D2 med pengeled på tillægget": kort 1 A fjerner bevidst pengene fra tillægget, så den sammenligning ville fejle per konstruktion |
| G3 Kløft inden for division (aktive hold) | Sæsonudvikling, fattigste mod rigeste tredjedel | Kløften mindre end i baseline; rigeste tredjedel ikke lavere end i baseline |
| G4 Kløft mellem divisioner (aktive hold) | Sæsonudvikling D3/D4 mod D1 | Kløften mindre end i baseline |
| G5 Løbsmængde | Øverste del af løbsdage pr. rytter pr. division, og hvor meget af kløften den forklarer | Rapporteres; over målbåndet → nyt kort |
| G6 Ingen inflation | Samlet udvikling pr. sæson og milepælene fra D1 | Inden for D1's milepæle |
| G7 Ingen udnyttelse | Gevinst ved at sende en svag rytter i et alt for stærkt felt | Ingen bonus i den yderste zone |
| G8 Paritet | Ugeprognose og aftenafregning giver samme løbsdag for kendte input | Bit-identisk |

Målbåndene står privat og godkendes af ejeren på tænd-kortet. Inaktive hold rapporteres separat, så de ikke skjuler effekten.

## 7. Valg til ejeren (ét ad gangen)

### Kort 1 · Skal løbets ekstra udbytte afhænge af holdets trænere og facilitet?

I dag løfter trænere og facilitet både træning og løb. Rige hold har bedre trænere og faciliteter.

- **A (anbefalet):** Nej. Trænere og facilitet løfter fortsat træningen og den almindelige del af løbsdagen, men løbets **ekstra** udbytte er det samme for alle hold. Ingen mister noget i forhold til i dag; små hold får relativt mest ud af den nye løbsudvikling.
- **B:** Ja, som i dag. Det ekstra udbytte ganges også med trænere og facilitet. Enklere, men pengefordelen vokser med den nye løbsværdi.

Anbefaling: **A**, fordi det løfter bunden uden at tage noget fra toppen, og det er ikke nye penge.

### Kort 2 · Hvordan virker "passende sværhed"?

Små holds ryttere ligger typisk lidt under deres felt. De rigeste hold i de lavere divisioner ligger langt over.

- **A (anbefalet): stræk-bonus.** Alle får fuldt udbytte af løbet. En rytter, der kører mod et felt lidt stærkere end ham selv, får et ekstra skub. Ingen får mindre, fordi han er stærk.
- **B: niveau-zone.** Fuldt udbytte på eget niveau. Er feltet langt for let eller langt for svært, giver løbet mindre (aldrig under en hård træningsdag).

Anbefaling: **A**. B ville ramme bunden af 1. og 2. division i mange af deres løb, og B tager noget fra stærke ryttere. Det strider mod "styrke straffes aldrig".

### Kort 3 · Skal 1. divisions ekstra løbsdage begrænses?

1. division har flere løbsdage med etaper end de andre, og kalenderen er låst. Når løb giver mere, kan de mest brugte 1.-divisionsryttere få mest ekstra.

- **A (anbefalet): ingen ny regel nu.** Den nye træthed (#6984) gør mange løbsdage dyre. Simuleringen måler, om det er nok. Er det ikke, kommer et nyt kort.
- **B: loft.** Kun et fast antal løbsdage pr. sæson giver fuldt ekstra udbytte, ens for alle divisioner. Dagene derover giver en hård træningsdag.

Anbefaling: **A**. B rammer toppen, og den nye træthed er allerede prisen for at køre meget.

## 8. Åbent

### 8.1 Spillervendte spørgsmål til ejeren (stilles efter kort 1-3, ét ad gangen; IKKE afgjort af denne spec)

Et go på kort 1-3 afgør ikke disse. De påvirker spillerens udbytte eller handlemuligheder og kræver hver sit ejer-svar før byg:

- **Udgået rytter (DNF):** får han løbsdagens fulde udbytte, kun basis, eller som en hård dag? Arkitektens forslag: basis uden tillæg.
- **Fri rolle (`free_role`):** hvor lander tillægget? Forslag: halvt som kaptajn, halvt som hjælper.
- **Salgsgrænsen for unge (5 træninger, ejer 11/10):** tæller løbsdage med? Forslag: nej, kun træningsdage, fordi grænsen er knyttet til træningsscoren som første signal.

### 8.2 Tekniske valg til byg-PR'en

- Niveau-målet for felt og rytter: rollens rating ved start, fastfrosset i løbets snapshot. Skal kunne genafspilles.
- U23- og juniortrupper: samme regler på deres egen akse; feltet er trup-løbets felt.
- Flag: ét flag for del 2 (løbsudvikling + catch-up + omdøbning), tændes på en dato-grænse, fail-safe off, bit-identisk off.

## 9. Byg-plan (efter ejer-valg)

1. Harness `backend/scripts/dev/` (kun SELECT): S4-afspilning med G1-G8, output privat.
2. Løbsdagens program: basis hård + tillæg + terræn-match + rolle (D2/D3) i `raceDayYield.js`, bag flag.
3. Penge-leddet (kort 1) og stræk-bonus (kort 2) i samme program; feltets niveau fastfrosset ved start.
4. Udviklingsscoren på løbsdage + omdøbning (alle sprog, help.json, patch note).
5. Rytterprofilens kurve og "hvad trak op/ned".
6. Privat tal-kort med G1-G8 → ejer-go → tænding en søndag i S5 sammen med resten af del 2.

**Verifikationsniveau:** TIER FULL (motor, delte libs, i18n). Ejeren ser preview med rigtige skærmbilleder (desktop og Android-bredde) før merge.

## 10. Kilder

- Måling 23/10: `training_rider_ticks`, `teams`, `league_divisions`, `team_facilities`, `team_staff`, `users`, `race_results`, `races`, `race_stage_schedule` (read-only). Tal: `balance-internals/6110-del2/baseline-2026-10-23.md`.
- Kode: `backend/lib/raceDayYield.js`, `dailyTraining.js` (`applyDailyTick`), `dailyTrainingEngine.js` (`racedToday`), `staffTrainingBonus.js`, `trainingScore.js`, `seasonDevelopmentLoad.js`.
- Issues: #6110 (kommentarer 3/10-20/10), #6950 (ejer-valg 20/10 + triage), #6984 og PR #6988.
