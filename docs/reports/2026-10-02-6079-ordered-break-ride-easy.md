# #6079: beordret udbrud og "Kør roligt" under orders_gc_v1 (2/10)

Kvalitativ rapport. Tal, fordelinger og varianter ligger privat i `balance-internals/6079/RESULTATER.md` (repoet er offentligt). Alt gælder kun løb bundet til `orders_gc_v1`; legacy er byte-identisk (golden fixtures og egne tests).

## Del 1: beordret slår spontant (ejer-beslutning A)

- Et forsøg med effektiv udbrudsordre (hunterens rolledefault eller "Forsøg udbrud") får et tillæg til succes-chancen. En fri rolle der selv forsøger får det ikke.
- Er der flere lykkede forsøg end pladser, beholdes de beordrede først, dernæst den største margin.
- En fri rolle uden ordre kan stadig komme med.
- Målt i AI-scenariet: beordrede forsøg lykkes klart oftere, og spontane sjældnere; udbruddet består nu næsten kun af beordrede ryttere. I stress-scenariet (alle forsøger på ordre) er billedet uændret.

## Del 2: mindre tidstab på stigninger for Kør roligt (ejer-beslutning D)

Målt FØR justering med tvillinger: to identiske ryttere i samme felt, den ene på Kør roligt, den anden på normal, på alle bjerg- og højfjeldsetaper i proxy-kalenderen, fem seeds, samme felt og etaper i v3 og v4.

- v3: en Kør roligt-rytter uden holdarbejde taber ingen placering på etapen; en hjælper på Kør roligt kommer lidt foran (han arbejder ikke).
- v4 før: en stærk rytter på Kør roligt tabte flere minutter på bjergetaper og mere på højfjeld. Det er det uforståelige tidstab ejeren beskriver.
- Ændring: save har under orders_gc_v1 egne stignings-tal, så han giver mindre slip end før. Kun save ændres; de øvrige trin er uændrede.
- v4 efter: tidstabet for stærke og topryttere er omtrent halveret på bjergetaper og tydeligt mindre på højfjeld. En Kør roligt-rytter taber stadig tid mod en normal-rytter i medianen og i de fleste etaper (trappen vender ikke; låst af test).
- Afvejning (ejer-synlig): jo mindre tab for stærke ryttere, jo oftere slutter en Kør roligt-rytter midt i feltet foran sin normal-tvilling, fordi normal-rytteren brænder ud. Det sker også i dag; ændringen gør det lidt hyppigere. Den valgte værdi er et midtpunkt; mere reduktion er muligt, men flytter den afvejning tydeligt.

## Del 3: trætheden til næste dag pr. etapeprofil (ejer-beslutning A)

- Under orders_gc_v1 sparer Kør roligt mest på bjerg/højfjeld og mindst på flad; kuperet er uændret. Brosten og klassiker følger kuperet; enkeltstart, holdtidskørsel og ukendte profiler bruger det gamle tal.
- Trappen holder altid: grupetto sparer mindst lige så meget som Kør roligt, og Kør roligt sparer altid mere end normal.
- Runneren sender løbets bundne `engine_rules_revision` med til trætheds-beregningen (forudsigelsen ind i næste etape, skrivningen efter etapen og træningsledgerens belastnings-snapshot). Ingen migration.

## Hele pakken mod main (kalibreringsharness, AI og stress, 10 seeds)

- Udbrudsoverlevelse: ikke forringet; lidt højere i AI-scenariet, uændret i stress.
- Specialist-korrelation (relevant evne mod placering): uændret inden for støj på alle profiler; den største bevægelse er en lille nedgang på rullende etaper i AI-scenariet.
- Udbruddet er lidt større i AI-scenariet, fordi flere beordrede forsøg lykkes.

## Hjælp-tekst

FAQ'en om Kør roligt sagde at trætheds-tilvæksten altid er 70 % af normal. Den er opdateret (en + da) til at besparelsen er størst i bjergene og mindst på flad.

## Hvad målingen ikke dækker

- Proxy-etaper og den pinnede population, ikke rigtige S4-løb.
- Tvillinge-målingen dækker en fri rytter og en hjælper med kaptajn; ikke en kaptajn med eget hold på Kør roligt.
- Trætheds-effekten over et helt etapeløb er testet strukturelt (akkumulering og runner-plumbing), ikke målt på resultater.
