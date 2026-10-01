# Kalibrering: GC-reaktion i løbsmotoren (v4), 1. oktober

Refs #5978, #5984 (Task 4). Status: bygget og **slukket**. Intet er tændt.

Repoet er offentligt, så denne rapport er kvalitativ. De præcise tal (før/efter pr. variant, pr. profil og pr. scenarie) ligger privat i `balance-internals/5978-gc-reaction/2026-10-01-v4-gc-reaction-calibration-tal.md`.

## Kort fortalt

Holdene kan nu reagere på en reel trussel mod deres klassement, ud fra det klassement der var offentliggjort før etapen. Reaktionen virker som den skal. Men i dag ændrer den næsten ingen resultater, fordi udbruddene under den nye regel-revision allerede bliver hentet. **Anbefaling: tænd den ikke endnu.** Først skal den nye regel-revisions udbrud og jagt balanceres, derefter skal GC-reaktionen kalibreres igen.

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

## Hvad ændrer sig

**GC-reaktionen alene (gc_off mod gc_on):**

- **Hvor ofte reagerer holdene?** I AI-scenariet på en mindre del af etaperne, oftest på bakke- og bjergetaper. Her er det oftest neutrale hold, og som regel kun et par stykker ad gangen. I stresstesten sker det oftere, og der er det den begrænsede forebyggende reaktion fra hold der lader gå.
- **Budgetforbrug:** i AI-scenariet bliver budgettet næsten aldrig brugt op. I stresstesten bliver det brugt op i en betydelig del af tilfældene. Det viser at loftet faktisk bider, og at holdet stopper i stedet for at jage videre.
- **Ingen ledige hjælpere:** det sker ofte. Hjælperne har tit allerede brugt kræfterne på holdspillet for kaptajnen, så holdet ikke kan reagere. Det bliver meldt ærligt, men er et kalibreringspunkt.
- **GC-favoritternes tidstab og klassementet:** i AI-scenariet er der stort set ingen forskel. I stresstesten er der en meget lille forskel: en sjælden gang får et løb en anden samlet vinder, og favoritterne taber lidt mindre tid på bjergetaperne.

**Hvorfor så lille en effekt?** Under `orders_gc_v1` overlever morgenudbruddet næsten aldrig, heller ikke uden GC-reaktion. Under legacy overlever det jævnligt og vinder etaper. Når udbruddet alligevel bliver hentet, er der ingen GC-tid at redde. Så koster reaktionen kun hjælpernes kræfter. Det er et spørgsmål om balancen i udbrud og jagt under den nye regel-revision (#5955, Task 3 og 6), ikke en fejl i GC-reaktionen. Men det betyder, at GC-reaktionens kvalitet ikke kan bedømmes endnu.

**Truslernes fordeling:** langt de fleste reaktioner bliver udløst af "rival foran". Fordi terrænet der er tilbage tæller med, bliver en klassementsrytter i et udbrud tidligt på en lang etape næsten altid vurderet som alvorlig. Det kan være for ivrigt.

**Hastighed:** samme størrelsesorden som før, langt under flip-gatens loft.

## Anbefaling

**Ikke klar til at blive tændt for nye løb.** Rækkefølgen bør være:

1. Balancér udbrud og jagt under `orders_gc_v1` (Task 3 og 6), så udbrud kan overleve i et realistisk omfang. Ellers kan GC-reaktionen ikke vurderes.
2. Kør denne kalibrering igen bagefter, og tag stilling til tre ting: hvor følsom truslen skal være tidligt på lange etaper, hvor træt en hjælper må være før han ikke kan reagere, og hvor stort budgettet for "lad gå" skal være.
3. Ejeren godkender kvalitetsmål for reaktionen. En regressionsbund er ikke en godkendelse.

Strukturen kan godt merges slukket allerede nu: legacy er uændret, intet løb kan få den nye regel-revision uden et separat ejer-go, og testene låser kontrakten.

## Hvad målingen ikke dækker

- Rigtige hold, rigtige spillerordrer og rigtige klassementer fra prod. Feltet er sammensat af den låste population.
- Træthed fra etape til etape. Den ligger i runneren, ikke i motoren, og bliver ikke ført videre her.
- Spillerflader (taktikkort, film, hjælp). De er Task 5 og er ikke rørt.
- Migrationen og en egentlig aktivering. Ingen af delene er sket.
