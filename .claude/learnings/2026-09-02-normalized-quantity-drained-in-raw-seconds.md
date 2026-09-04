# En normaliseret størrelse tæret i rå sekunder bliver binær

**Dato:** 2026-09-02 · **Issue:** #4604 · **Område:** race engine v4 (skygge-motor)

## Symptomet

Sprintere vandt kun 45-61 % af massespurterne i v4 mod et krav på ≥ 90 %. Det så ud som et *finale*-problem: forkert demand-vektor, manglende lead-out-tog, for stor vægt på W'-reserven.

Det var ingen af delene. Da jeg målte i stedet for at gætte, vandt massespurterne af ryttere med **sprint-evne 0**, alene i front, 100+ sekunder foran feltet.

## Rodårsagen

W'-reserven (`wprimeMax`) er **normaliseret 0-1**. Tæringen var skrevet som formlen står i specen:

```
wprime -= (demand - cp) * dtSeconds
```

`dtSeconds` er et helt segments varighed — typisk 2.000-5.000 sekunder. Et overforbrug på 0,001 over CP tærede altså 2-5 gange hele reserven på ét segment. W' var i praksis **binær**: enten præcis fuld (strengt under CP hele vejen) eller nul.

Konsekvenskæden derfra var lang og så ud som fire uafhængige fejl:

1. 179 af 180 ryttere stod med `wprime <= 0` ved etapens første stigning.
2. M2's wprime-tvungne selektion er fysiologisk absolut og har ingen tærskel — så **hver eneste split var præcis 179 ryttere**. Hele feltet blev skrællet på den første småbakke, også på etaper klassificeret som massespurt.
3. Den ene overlevende sad alene i front, og gruppe-hastigheden havde intet størrelses-led — så hans forspring voksede monotont resten af etapen.
4. Massespurten blev afgjort af den rytter, ikke af sprinterne.

## Hvad der gjorde den svær at se

Fejlen var **ikke i formlen** — formlen er skrevet præcis som §5 i specen siger. Fejlen var at de to sider af formlen lever i hver sin enhed, og specen skrev ingen af dem ned. Der findes ingen type der fanger "normaliseret 0-1" ganget med "sekunder".

En tidligere session havde allerede mærket symptomet fra den anden side: genopladningen "snappede" til fuld reserve i ét Euler-skridt, og fixet blev sub-tick-integration. Det behandlede skridtstørrelsen, ikke enhederne — og fordi tæringen er lineær og dermed sub-tick-invariant, gjorde sub-tick-fixet **ingenting** ved tæringsgrenen. Symptomet blev flyttet, ikke fjernet.

## Læringen

**Når en normaliseret størrelse ændres af noget ganget med rå tid, mangler der en tidskonstant.** Spørg altid: *hvor lang tid tager det at bruge det hele op?* Er svaret "sekunder" for noget der skal holde en hel etape, er enheden forkert — uanset hvor pænt formlen matcher specen.

**Og: en guard skrevet mod division med nul kan vende sin egen betydning.** Samme fil havde `if (wprimeMax <= 0) return 0` i energi-underskuds-funktionen. Guarden var skrevet for at undgå `x/0`, men oversatte i praksis "ingen anaerob kapacitet overhovedet" til "fuldstændig frisk". De 6 ryttere i populationen uden punch/acceleration/sprint blev dermed **immune** over for selektion. Når en nul-guard returnerer en værdi i den fysiske skala, så spørg hvad den værdi *betyder* — ikke bare om den er sikker.

## Forward-guards lagt ind

- Property-tests på gruppe-læets fart-gevinst (solo = 0, monoton i størrelse, bounded, terræn-rangorden = hjul-rabattens).
- Test der låser at tæringen er tidskonstant-skaleret, og at et minimalt overforbrug over en time ikke tømmer reserven.
- Test der låser at `wprimeMax = 0` gør en rytter maksimalt sårbar, ikke immun.
- Test der låser at en småbakke ikke kan skrælle et udmattet felt med ens klatreevne, mens en HC-klatring kan.

## Metodefund i samme omgang

Scorecardet der målte det hele er **seed-domineret**: samme kode og kalender giver ±12 procentpoint på sprinter-ankeret alene ved at skifte seed, fordi etaper med samme etapenummer deler både feltsample og motor-seed. Både det oprindelige "45-61 %" og ethvert enkelt-seed-tal over 90 % ligger inden for støjen. Et anker må ikke erklæres grønt eller rødt på ét seed.
