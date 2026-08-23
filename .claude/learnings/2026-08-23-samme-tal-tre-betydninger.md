# Samme tal, tre betydninger: triagerede en rapport ind i den forkerte klynge

**Dato:** 2026-08-23 · **Issues:** #4098, #4128, #3988 · **Fejlklasse:** triage på ordlyd i stedet for på data

## Hvad skete der

Discord-sweepen fandt @snorkalots rapport: rytteren "Long Chen" havde stadig *"a ceiling of 19"*, selvom DONE-teksten var væk. To tidligere rapporter i samme tråd nævnte også punch og tallet 19. Jeg lagde den som evidens-kommentar på #4098, klyngen om unge ryttere der markeres done langt fra rolleloftet.

Det var forkert. Da tallene blev slået op i prod, viste rytteren sig at have **punch 19 med loft 25**. Han var ikke done og havde 6 point tilbage. Rapporten hørte til et helt andet problem og blev skilt ud i #4128.

## Rod-årsag

Tallet 19 optrådte tre steder med tre forskellige betydninger, og jeg antog at de var samme sag, fordi ordlyden lignede:

| Hvor | Hvad 19 var | Hvem |
|---|---|---|
| #3649's analyse | et ægte evne-loft, aldersnedskrevet fra basis 25 hos 29-30-årige | ryttere over peak |
| samme tal hos 36-37-årige | rytterens **højeste** loft, nedskrevet fra basis 93 | udslidte ryttere |
| @snorkalots rapport | den **aktuelle** punch-værdi, loftet var 25 | 16-årig akademirytter |

Dertil viste det sig at spilleren slet ikke **kan** se et loft: #1162 fastslår at `ability_caps` aldrig forlader serveren. Han så en evne der stod stille og sluttede selv at 19 måtte være loftet. Ordet "ceiling" i rapporten var spillerens fortolkning, ikke en aflæsning.

Punch var tilmed en rød sild. Den har et af de højeste lofter i spillet (median 67), og kun 0,86 % står på 19. At begge de første rapporter nævnte punch var tilfældigt. Climbing rammer 2,4 gange så mange.

## Hvorfor det ikke blev fanget med det samme

Triagen matchede på tekst: samme tråd, samme evne, samme tal. Alle tre signaler pegede på én sag. Ingen af dem var data.

Et enkelt opslag på rytteren ville have afgjort det på under et minut, og det var muligt hele tiden. Jeg lavede det først da der blev spurgt eksplicit til mønsteret.

## Regel fremover

**Når en spillerrapport indeholder et konkret tal, så slå rytteren op før du placerer rapporten i en klynge.** Spillerens ord for tallet ("ceiling", "cap", "max") er en fortolkning af det han ser, ikke feltets navn. Verificér hvilket felt tallet faktisk er, før sagen kobles til et eksisterende issue.

Det gælder særligt når fladen bevidst skjuler det underliggende tal. Der *må* spilleren gætte, og hans gæt bliver til ordlyd i rapporten.

## Hvad der kom ud af det

Den forkerte kobling blev rettet samme dag, og undersøgelsen gav tre ting der ikke var kendt:

- loft-mekanikken kortlagt: fem bånd (25/55/70/80/93), nedskrevet ca. 24 % pr. år fra 27-årsalderen, nul ved 39
- #4098's omfang målt: 353 unge ryttere på 124 af 362 hold, gennemsnitligt 65 points gab
- #4128 afgrænset til 16 uforklarede ryttere med en konkret plan for kodelæsningen
