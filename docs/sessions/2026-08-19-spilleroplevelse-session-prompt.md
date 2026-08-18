# Session-prompt: Spilleroplevelses-design (resultat-oejeblikket + udviklingsrejsen)

> Skrevet 18/8, optimeret 18/8 aften med Discord-sweep + traenings-/lofte-sporet vaevet ind (ejer-bestilling).
> NB: Loen-design-sessionen (#3393+#2840, prompt i 2026-08-19-loen-design-session-prompt.md) er stadig booket og maa ikke fortraenges - denne session koeres SEPARAT.
> Design-frihed: taenk IKKE i nuvaerende regler, planlagte datoer eller hvad der er blokeret/udskudt. Design den rigtige oplevelse foerst, sekvenser bagefter. Maalet er blandt verdens bedste managerspil, og denne session skal tage et aegte langsigtet skridt.

---

Laes docs/NOW.md og docs/discord/2026-08-18-svarudkast-uge33.md foerst. Dagens maal: designe EEN sammenhaengende spilleroplevelse omkring de to ting der beviseligt betyder mest for spillerne, og overgaa deres forventninger i stedet for at lappe.

## Nordstjernen: spillerens dag er EEN historie, ikke to features

Feedback-analysen 18/8 (Discord 7 dage + forum + in-app) viste to tyngdepunkter: udviklings-tilliden ("Is Development dead now?", 22 svar, 2 churn-signaler) og resultat-oejeblikket kl. 16-18 efter loebene kl. 15 (980 sessioner kl. 18, ugens hoejeste). Traening er stoerste daglige handling (6.968 fokus-saet paa 14 dage).

De to tyngdepunkter er den SAMME historie set fra hver sin ende: "betoed mine valg noget?" Resultatet kl. 16-18 er dagens svar; rytterens udvikling er saesonens svar. Spillerens dag-loop skal designes som een kaede:

1. **Morgen:** traeningskvittering (hvad gav gaarsdagen?) + dagens fokus-valg + udtagelse til kl. 15-loebene
2. **Kl. 15:** loebene koerer
3. **Kl. 16-18:** resultat-oejeblikket - dagens hoejdepunkter, egne placeringer, troejeskift
4. **Aften:** hvad betoed dagen for mine ryttere (udvikling, form, naeste skridt) + planlaegning af i morgen

Alt i denne session designes ind i den kaede. En feature der ikke styrker et af de fire led, hoerer ikke til her.

## Blok 1: Resultat-oejeblikket (design + byg lag 1)

Spidsbelastningen 16-18 er spillets vigtigste oejeblik, og i dag er det bare "tjek selv resultatlisten". Design hele kaeden saa den foeles som en fodboldrunde:

1. "Resultatet er landet"-notifikation med deep link til etapens resultat (deep-linket fixet 18/8 via #3912/#3929, fundamentet virker). Opret issue + byg.
2. Race Centre som landingsside for tidsrummet: dagens hoejdepunkter samlet (vindere, egne placeringer, troejeskift, naeste dags etaper). #3858 er live, #3927 (dagens etaper paa dashboard) og #3936 (movement signals) er merget - byg videre, opfind ikke nyt.
3. **Dashboardet ER indgangen til oejeblikket** og skal baere det: ejer-direktiver 18/8 paa #3513 (customizable, brugs-sorteret default, kategoriseret, LANGT mere kompakt - "scroller man 80% ned er praesentationen forkert") + #3958 (miniature-ruteprofilerne paa Dagens etaper skal bruge aegte rutedata, misvisende > manglende er uacceptabelt).
4. Etape-resultater i Discord-divisionskanalerne (#3950, ejer-go 18/8) - kompakt format, genbrug webhook-infrastrukturen.
5. **Guard for de travle:** assistentens auto-udtagelse sender bjergryttere og ungdom til flade klassikere (#3957, spiller-rapport 18/8). Et daarligt autovalg oedelaegger resultat-oejeblikket for praecis dem der ikke naaede at udtage selv. Match udtagelsen mod loebsprofilen.
6. Afspiller v2 (#3859/PR #3863 draft) er naeste niveau - vurder om den skal med i denne uge eller efter cutover.
7. Naeste-dags-leddet: planlaegningsfladen er informationsfattig praecis hvor beslutningen traeffes (#3955: etapeprofiler inline + Available Riders op; #3954: tilbage-knappen taber fanen). Begge er smaa og lukker loopet "resultat -> planlaeg i morgen".

## Blok 2: Udviklingsrejsen (traening + lofter + prognose SOM EEN FLADE)

Dette er sessionens langsigtede skridt. I dag er udviklingen spredt over: traeningssiden (aldrig struktur-designet, roster som 6. element, #3721), rytterprofilens 9 faner med evneliste to steder (#3721), trin 7-prognosefladen (PR #3798, bygget men ikke merget), kvitterings-designet (#3924, laast), form-synlighed (#3763) og forstaaelighed (#3659). Det skal designes SAMLET - ejer-krav 18/8: traeningsside + rytterprofil er EEN opgave, sparkline-komponenten ligger klar.

Design-maal: **rytterens udviklingsrejse skal kunne LAESES som en fortaelling.** Spilleren skal kunne aabne en rytter og se: hvor er han, hvor er han paa vej hen (prognose-baand), hvor hurtigt (fart = potentiale, trin 7), hvad gjorde gaarsdagen (kvittering, #3924), og hvad var de store oejeblikke undervejs (milepaele i indbakken, #3924). Scouting er samme fortaelling FOER du ejer rytteren: usikkerheds-reduktion paa praecis de tal prognosen viser.

1. **Strukturen foerst (#3721):** traeningssiden reorganiseres (roster oeverst, forklaringer opsoeges, historik taet paa) og rytterprofilens dublet loeses (Overblik = hvem er rytteren; Traening = hvad goer traeningen). Vurder de 9 faner. PAGE_TEMPLATES er bindende.
2. **Trin 7-fladerne (#3798/#3803) taenkes IND i strukturen, ikke ovenpaa:** prognose-baand, scout-praecision, loebslaere-fokus. Verificer udrulningens tilstand: hvad mangler foer den kan gaa ud? (Ejer-visuelt go er gaten; backfill-kaeden i #3803 ligger klar.) Kvitteringen (#3924) er ejer-godkendt og bygges efter trin 7-merget - design den ind i den nye struktur nu, saa den lander rigtigt foerste gang.
3. **Spillernes egne ideer 18/8 tages med som designsporgsmaal** (fra #3592-kommentaren):
   - Unikhed vs. flade rolle-tag: "hvis potentiale kun er fart, bliver alle ryttere teknisk set ens" - praecis #3592's matematiske fund oplevet fra spillersiden. Kandidat: spillerens traeningsvalg over tid former rytterens profil inden for rollens naturlige graenser (ejerens eget svar i kanalen peger den vej: "det giver mest mening at traene en sprinter i sprint, men du kan vaelge andet").
   - Udviklings-tempo-anker: en 16-aarig boer tage ca. et virkeligt aar til peak (log-kurve-forslag). Brug som sanity-anker naar prognosen designes, ikke som ny motor-regel uden simulering.
   - "Traening af unge foeles sloej" - det er FOELELSEN kvitteringen + prognosen skal vende; motoren er allerede rettet (landing 2 + trin 7).
4. **Efter udrulning:** maal om forum-traaden vender. Forbered "State of Development"-opfoelgning nr. 2 med FAKTA fra prognose-fladen. A6-loeftet ("goal text is getting clearer") peger paa #3948 - byg den.
5. **Scouting 2.0-design** (aftalt 18/8, "efter traeningstingene"): kortere missioner (1-2 dage), scout-kvalitet paavirker akademi-prospekter, scouten kan finde nye ryttere. Targeting + navngivne fund shippede 17/8 (#3846) - byg ovenpaa, og lad trin 7's "scouting = usikkerheds-reduktion" vaere baerende ide. Prognose-sproget paa scouting-kortet og rytterprofilen skal vaere DET SAMME sprog. Design foerst, ejeren vaelger.

Balance-foelsomme aendringer (unikheds-kandidaten, tempo-kurver): simulér-foer-ship mod aegte population, altid. UI/formidling kan designes frit.

## Blok 3: Restpunkter fra 18/8 (korte)

- #3952 radius-konvergering: lav foer/efter-screenshots af 3-4 steder til ejer-go (IKKE koere boelgen endnu).
- #3949/#3941 Race Control: verificer at ops_notices-migrationen er applied og banneret virker i prod; vis ejeren hvordan han skriver en notice.
- Svarudkast-pakken: tjek hvilke af de 21 svar ejeren har sendt.
- #3942/#3943 (akademi-loen-preview + stille fjernelse fra loeb): reproducer og fix, spillerne venter paa svar i #bugs.
- #3944/#3945/#3956 (mobil-auktionssortering + training-sortering + popularitet paa holdoversigt/auktion/mobil): smaa, kan med i en boelge.
- #2884 (auktions-varighed + anti-snipe): frisk evidens 18/8 ligger paa issuet; anti-snipe mangler stadig. Hoerer i transfer-sporet, men naevn den for ejeren hvis der aabnes en boelge.

## Regler

Een beslutning ad gangen til ejeren, med anbefaling. Vis mockups (show_widget) FOER du bygger UI, og foelg PAGE_TEMPLATES-kontrakten slavisk (5px radius, hairlines, een gold pr. view, stroke-ikoner). Alt visuelt kraever ejer-go foer merge. Patch notes + help.json ved alt spillervendt. Ingen em-dash i spillervendt copy. Verificer tal foer de bruges i beskeder. Loop-guard: 2 CI-fails samme symptom -> stop og spoerg.
