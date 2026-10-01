# Kalibrering: GC-reaktion i løbsmotoren (v4), 1. oktober

Refs #5978, #5984 (Task 4). Status: bygget og **slukket**. Intet er tændt.

Repoet er offentligt, så denne rapport er kvalitativ. De præcise tal (før/efter pr. variant, pr. profil og pr. scenarie) ligger privat i `balance-internals/5978-gc-reaction/2026-10-01-v4-gc-reaction-calibration-tal.md` (første måling) og `balance-internals/5955-breakaway-balance/2026-10-01-5955-breakaway-balance-tal.md` (genkørslen efter udbrud/jagt-balancen).

## Kort fortalt

Holdene kan nu reagere på en reel trussel mod deres klassement, ud fra det klassement der var offentliggjort før etapen. I første måling ændrede reaktionen næsten ingen resultater, fordi udbruddene under den nye regel-revision faldt fra hinanden eller blev hentet. Udbrud og jagt er nu balanceret (#5955), og udbruddene overlever omtrent lige så ofte som under legacy. Reaktionen ændrer dog stadig næsten intet, fordi den ikke kan påvirke den fase hvor hullet bygges op. **Anbefaling: tænd den ikke endnu.** Først kræves én designbeslutning (se Anbefaling).

**Opdatering 2 (ejer-valg B, samme aften):** reaktionen må nu bremse lad-gå-fasen ved en alvorlig trussel og flytter mærkbart resultater. Se næste afsnit.

## Opdatering 2, samme aften: GC-reaktionen må bremse lad-gå-fasen (ejer-valg B)

Refs #5955. Stadig **slukket**: `CURRENT_RACE_RULES_REVISION` er `legacy`, legacy-løb er byte-identiske (golden fixtures og en test med klassementet sendt med), intet er skrevet i prod. Tallene ligger privat i `balance-internals/5955-gc-brake/2026-10-01-5955-gc-brake-tal.md`.

**Hvad er bygget (kun `orders_gc_v1`):**

- *Bremsen:* ved en alvorlig GC-trussel må holdet bremse lad-gå-fasen. Det gælder et hold hvis GC-reaktion er i gang (neutral eller den forebyggende undtagelse ved "lad gå"), og et hold med eksplicit jagtordre. Bremsen virker med de hjælpere der allerede arbejder i GC-rytterens gruppe, og et træt hold bremser svagere.
- *Hold hullet nede, ikke luk det:* hullet vokser frit op til det forspring holdet kan tåle (truslens klassementshul minus det han kan nå at vinde på resten af etapen). Over det dæmpes væksten. Bremsen stopper aldrig væksten helt, så et udbrud får altid plads, og ingen indhentning er garanteret.
- *Bremsen koster:* de bremsende ryttere betaler for de km de faktisk bremser, i samme valuta som jagten. Den forebyggende undtagelses budget pr. hold pr. etape dækker nu også bremsen og holder (test). Eksplicit jagt er som før ikke begrænset af budgettet, men betaler sit arbejde.
- *Moderat trussel og jagtordre uden trussel bremser ikke.* De virker som før kun i jagtfasen. En jagtordre alene giver altså ikke længere et udbrud mindre plads, hvis ingen GC-rytter er truet.
- *Trussel-følsomhed:* fremskrivningen på åbent terræn har nu et loft. Før blev næsten enhver klassementsrytter i et udbrud tidligt på en lang etape vurderet som alvorlig, fordi mange åbne km tilbage gav en stor fremskrivning. Stigningsleddet er uændret.

**Resultat (samme harness, felt, etaper og seeds; legacy / gc_off / gc_on, AI og stresstest):**

- GC-reaktionen har nu en reel, synlig effekt. På etaper hvor et hold reagerer, overlever udbruddet klart sjældnere end uden GC-kontekst. På etaper uden reaktion er overlevelsen næsten uændret, så bremsen rammer de udbrud der faktisk truer klassementet, ikke alle udbrud.
- Færre nye førere kommer fra udbrud, GC-favoritterne taber mindre tid, og den samlede vinder skifter nu i en mærkbar del af løbene (før: kun i ganske få). Udbrud vinder stadig etaper jævnligt, oftest på kuperede og bjergetaper.
- Stresstesten (alle lader gå): den forebyggende undtagelse bruger nu oftest hele budgettet, og udbruddene overlever sjældnere end uden GC-kontekst, men stadig oftere end under legacy. Loftet bider, som det skal.
- Hastighed: lidt langsommere pr. etape, stadig langt under flip-gatens loft.

**Stillingtagen til de tre punkter fra første måling:**

1. *Trussel-følsomhed tidligt på lange etaper:* loftet på åbent terræn er indført. Reaktionerne starter stadig typisk ved dannelsen, men truslerne er nu ryttere der står tæt på holdets GC-rytter i klassementet (ofte foran ham). Det er reelle trusler, ikke støj fra lange etaper. Anbefaling: behold.
2. *Manglende ledige hjælpere:* det sker stadig ofte, typisk når holdets hjælpere allerede er brugt på holdspillet eller sidder i en anden gruppe. Det meldes ærligt i tidslinjen. Jeg har ikke ændret reglen: at lade trætte eller fraværende hjælpere bremse ville være gratis arbejde. Et senere valg kunne være at lade GC-rytteren selv bidrage lidt; det er en produktbeslutning.
3. *Budgetstørrelse:* uændret. I AI-scenariet bliver det sjældent brugt op; i stresstesten ofte. Bremsen gør budgettet mere relevant, fordi den koster fra første km. Anbefaling: behold størrelsen nu, og vurder den igen med rigtige spillerordrer efter en eventuel aktivering.

**Valg undervejs (kvalitativt, tallene ligger privat):** en stærk bremse på både moderate og alvorlige trusler tog næsten alle udbrud på de truede etaper, også med tolerancen for forspring, fordi de truende ryttere typisk står tæt i klassementet. Jeg valgte derfor en mildere bremse, kun ved alvorlig trussel, så et truet hold mærkbart holder udbruddet nede, men ikke afgør etapen alene.

**Anbefaling nu:** GC-reaktionen flytter nu resultater. Næste skridt er ejerens vurdering af kvalitetsmålene (hvor ofte et udbrud med en klassementstrussel skal kunne holde hjem), og derefter et ejer-kort om at tænde `orders_gc_v1` for nye løb. Spillerfladerne (Task 5) er ikke rørt.

## Opdatering samme dag: genkørt efter udbrud/jagt-balancen (#5955)

Refs #5955 (Task 3 og 6). Stadig **slukket**: `CURRENT_RACE_RULES_REVISION` er `legacy`, legacy-løb er byte-identiske, intet er skrevet i prod.

**Hvad var galt.** Under `orders_gc_v1` faldt morgenudbruddet næsten altid fra hinanden allerede ved dannelsen. Næsten alle hold havde en jæger med i forsøget, og fradraget for et overfyldt forsøg voksede med antallet af angribere, så hvert enkelt forsøg nærmest altid mislykkedes. Resultatet var ofte slet intet udbrud, og ellers en enkelt rytter. Den del der overlevede dannelsen, blev hentet: lad-gå-modellen fra legacy er kalibreret på udbrud hvor stærke ryttere, også kaptajner, blev fyldt ind. Under den nye regel-revision kommer kun de ryttere med, der faktisk fik ordre til at angribe. Det er typisk jægere, og de taber meget tid på stigningerne.

**Hvad er ændret (kun `orders_gc_v1`):**

- *Dannelsen:* fradraget for overfyldning og for modreaktion er gjort mildere. Et travlt morgenforsøg giver nu en rigtig gruppe på nogle få til en håndfuld ryttere i stedet for en enkelt rytter. Reglerne er de samme som før: der fyldes aldrig op med ryttere, et forsøg koster stadig, nul udbrydere er stadig et gyldigt udfald, og der er en øvre grænse for gruppens størrelse. En ny test sikrer at en travl morgen ikke igen ender med at udbruddet falder fra hinanden.
- *Lad gå:* feltet giver et ufarligt udbrud mere plads, forskelligt pr. etapetype. På bjergetaper når hullet også at blive bygget op før første stigning. Jagtmodellen, jagtgulvet i finalen og klatreselektionen er de samme. Legacy læser intet af det (test: faktor 1 for legacy på alle profiler).

**Resultat (AI-scenariet, samme harness, felt, etaper og seeds som før):**

- Udbruddet bliver dannet på stort set alle vejetaper, og gruppen er af realistisk størrelse. Den er mindre end legacy's altid fyldte gruppe.
- Udbruddets overlevelse pr. etapetype ligger nu tæt på legacy-niveauet: sjælden på flade etaper, af og til på rullende, oftest på kuperede, og jævnligt på bjerg- og højfjeldsetaper.
- Udbrudsryttere vinder klart sjældnere etaper end under legacy. Under legacy var kaptajner fyldt ind i udbruddet, og det pustede tallet op (samme mønster som #5957 fandt i prod). Det er en forbedring.
- Stresstesten (alle hold lader gå) giver, som forventet, flere overlevende udbrud end legacy, fordi ingen jager.

**GC-reaktionen kan nu vurderes, og den er for svag.** Holdene reagerer nu på omkring halvdelen af etaperne og meget oftere i stresstesten, og i stresstesten bliver budgettet ofte brugt op. Alligevel ændrer reaktionen næsten intet: udbruddets overlevelse, nye førere fra udbrud og GC-favoritternes tidstab er praktisk talt ens med og uden GC-kontekst, og den samlede vinder skifter kun i ganske få løb. Årsagen er strukturel og ligger ikke i balancen. Reaktionen virker kun gennem jagtens stance-multiplikator. Den har ingen effekt i lad-gå-fasen, hvor hullet vokser uanset ordrer (#5812-kontrakten: "ingen ordre rører lad-gå-fasen"). Bagefter ganger den kun på jagtens nettofordel, og den er ofte nul eller negativ uden for massespurtsetaper. En truet GC-rytters hold kan altså hverken bremse hullets vækst eller lukke det mærkbart.

## Hvad er bygget

- **Trusselsvurdering** (`gcThreat.ts`): for hvert hold med en rytter blandt de forreste i klassementet vurderer motoren ryttere i udbrud foran: hvor langt nede de er i klassementet, hvor stort forspring de har på vejen, hvor meget terræn der er tilbage, og hvor stærke de er sammenlignet med holdets egen GC-rytter. En svag rytter langt nede er ingen trussel. En virtuel førertrøje alene er heller ikke nok.
- **Reaktion og budget** (`teamChaseReaction.ts`):
  - *Jag*: holdets ordre styrer som før. Ikke begrænset af budgettet.
  - *Vurder undervejs (neutral)*: holdet reagerer kun ved en egentlig GC-trussel, med de hjælpere det har ledige i GC-rytterens gruppe.
  - *Lad gå*: kun ved en alvorlig trussel, og kun inden for ét begrænset arbejdsbudget pr. hold pr. etape. Budgettet nulstilles aldrig undervejs og deles på tværs af pauser og nye trusler. Når det er brugt, stopper holdet.
- **Ærlige kvitteringer**: når et hold starter, stopper eller har brugt budgettet, kommer det i tidslinjen. Det gør det også når der ikke er nogen ledige hjælpere, og når klassementet mangler. Der står aldrig tal i kvitteringerne.
- **Slukket**: alt ligger under regel-revisionen `orders_gc_v1`. Den er ikke tildelt nye løb (`CURRENT_RACE_RULES_REVISION` er stadig `legacy`), og jeg har tjekket i prod, læst kun: intet løb er bundet til den. Legacy-løb er byte-identiske. Det har jeg testet både på de faste golden fixtures og med klassementet sendt med.

## Sådan er det målt

Jeg kørte en lokal harness, kun på diagnostiske data. Den bygger på den eksisterende v4-harness (fast felt hele løbet igennem, som i `v4GcMargin.mjs`, og AI-ordrer for alle hold ad prod-vejen, som i `headToHeadV4.js`). Den bruger den låste population og de låste proxy-etaper, de etapeløb der har mindst fem etaper, fulde hold og ti seeds. Alle tre varianter kører på nøjagtigt samme felt, samme etaper og samme seeds:

1. **legacy**: reglerne i dag.
2. **gc_off**: `orders_gc_v1` uden GC-kontekst, dvs. det nye morgenudbrud uden GC-reaktion.
3. **gc_on**: `orders_gc_v1` med klassementet før etapen, dvs. med GC-reaktion.

Der er to scenarier: et hvor alle holdene er AI-hold, og en stresstest hvor alle hold lader gå og alle jægere og frie roller går efter udbruddet.

## Første måling (før #5955): hvad ændrede sig

**GC-reaktionen alene (gc_off mod gc_on):**

- **Hvor ofte reagerer holdene?** I AI-scenariet på en mindre del af etaperne, oftest på bakke- og bjergetaper. Her er det oftest neutrale hold, og som regel kun et par stykker ad gangen. I stresstesten sker det oftere, og der er det den begrænsede forebyggende reaktion fra hold der lader gå.
- **Budgetforbrug:** i AI-scenariet bliver budgettet næsten aldrig brugt op. I stresstesten bliver det brugt op i en betydelig del af tilfældene. Det viser at loftet faktisk bider, og at holdet stopper i stedet for at jage videre.
- **Ingen ledige hjælpere:** det sker ofte. Hjælperne har tit allerede brugt kræfterne på holdspillet for kaptajnen, så holdet ikke kan reagere. Det bliver meldt ærligt, men er et kalibreringspunkt.
- **GC-favoritternes tidstab og klassementet:** i AI-scenariet er der stort set ingen forskel. I stresstesten er der en meget lille forskel: en sjælden gang får et løb en anden samlet vinder, og favoritterne taber lidt mindre tid på bjergetaperne.

**Hvorfor så lille en effekt?** Under `orders_gc_v1` overlever morgenudbruddet næsten aldrig, heller ikke uden GC-reaktion. Under legacy overlever det jævnligt og vinder etaper. Når udbruddet alligevel bliver hentet, er der ingen GC-tid at redde. Så koster reaktionen kun hjælpernes kræfter. Det er et spørgsmål om balancen i udbrud og jagt under den nye regel-revision (#5955, Task 3 og 6), ikke en fejl i GC-reaktionen. Men det betyder, at GC-reaktionens kvalitet ikke kan bedømmes endnu.

**Truslernes fordeling:** langt de fleste reaktioner bliver udløst af "rival foran". Fordi terrænet der er tilbage tæller med, bliver en klassementsrytter i et udbrud tidligt på en lang etape næsten altid vurderet som alvorlig. Det kan være for ivrigt.

**Hastighed:** samme størrelsesorden som før, langt under flip-gatens loft.

## Anbefaling (efter genkørslen)

**Ikke klar til et ejer-kort om at tænde `orders_gc_v1` for nye løb.** Udbrud og jagt er nu balanceret under den nye regel-revision. Men GC-reaktionen, som er en af revisionens to bærende dele, flytter stadig næsten ingen resultater. Tænder man nu, får spillerne en "reagér på GC-trussel"-adfærd, som de ikke kan se virke.

Næste skridt, i denne rækkefølge:

1. **Designbeslutning (ejer):** må en GC-reaktion, eller en eksplicit jagtordre, bremse lad-gå-fasen og lukke hullet uden om jagtens nettofordel, når truslen er reel? #5812-kontrakten siger i dag nej ("ingen ordre rører lad-gå-fasen"). Uden et ja kan reaktionen ikke få reel effekt. Anbefaling: ja, kun under `orders_gc_v1`, begrænset af det budget der allerede findes.
2. Byg det bag samme regel-revision, og kør denne kalibrering igen. Tag samtidig stilling til tre ting: hvor følsom truslen skal være tidligt på lange etaper (stadig næsten kun "rival foran"), hvor ofte der mangler ledige hjælpere, og hvor stort budgettet for "lad gå" skal være.
3. Ejeren godkender kvalitetsmål for udbrud og reaktion. Regressionsbunden og legacy-niveauet er referencer, ikke en godkendelse.

Udbruds-balancen kan merges slukket allerede nu: legacy er byte-identisk, intet løb kan få `orders_gc_v1` uden et separat ejer-go, og testene låser kontrakten.

Uden for dette spor, men set i målingen: på bjergetaper henter klatreselektionen på tidlige stigninger et udbrud af jægere meget hurtigt, også under legacy. Det passer med #5957 (for stor top-10-spredning på bjergetaper). Balancen kompenserer under `orders_gc_v1` ved at give hullet mere plads, men det egentlige greb er selektionens timing på stigninger før finalen. Det ligger i den fælles motor og kræver en separat beslutning.

## Hvad målingen ikke dækker

- Rigtige hold, rigtige spillerordrer og rigtige klassementer fra prod. Feltet er sammensat af den låste population.
- Træthed fra etape til etape. Den ligger i runneren, ikke i motoren, og bliver ikke ført videre her.
- Spillerflader (taktikkort, film, hjælp). De er Task 5 og er ikke rørt.
- Migrationen og en egentlig aktivering. Ingen af delene er sket.
