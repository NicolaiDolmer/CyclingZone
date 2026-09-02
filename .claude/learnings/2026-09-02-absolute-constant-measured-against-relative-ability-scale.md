# Absolut konstant målt mod en relativ evne-skala

**Dato:** 2026-09-02 · **Issue:** #4604 (bjerg-anker) · **PR:** #4609
**Beslægtet:** `2026-09-02-normalized-quantity-drained-in-raw-seconds.md` (#4606), samme session, samme fejlfamilie

## Symptom

v4's bjerg-top-10-spredning var 977-1.239 s mod et bånd på 180-240 s. Løbsfilmen viste en vinder der soloede 877 s foran nummer 2, og en gruppetto der ankom 1.482 s bagud. Det lignede ikke en professionel bjergetape.

## Rodårsag

`tickGroupRiders` beregnede en rytters krav som `terrain.baseDemand[kind] * positionFactor`. `baseDemand` er en **absolut** konstant på 0-1-skalaen (climb 0,8). Rytterens `cp` kommer fra `deriveCp`, som er et **vægtet gennemsnit af normaliserede evner** på samme 0-1-skala.

De to tal ser ud som om de ligger på samme skala. Det gør de kun hvis populationens middel-evne ligger omkring midt-skala. Det gør den ikke:

| | Krav (i læet) | CP p50 | Andel over CP |
|---|---|---|---|
| climb | 0,720 | 0,097 | 100,0 % |
| descent | 0,225 | 0,082 | 89,1 % |

Median-evnen i S3-populationen er **11 af 99**, ikke ~50. Hele feltet lå derfor over CP hele tiden, også på nedkørsler. W'-dimensionen var død, og M2 splittede hele feltet på hvert climb-segment, hvorefter frontgruppen kollapsede til én rytter.

## Læring

**Når en konstant sammenlignes med en afledt størrelse, er skalaen en antagelse om data, ikke en egenskab ved koden.** Konstanten var rigtig for den population dens forfatter forestillede sig. Den var forkert for den population der findes.

To spørgsmål der ville have fanget den:

1. **Hvad er fordelingen af den størrelse jeg sammenligner med?** Fem minutters måling mod prod-snapshottet (`deriveCp` over 5.938 ryttere) gav svaret med det samme. Ingen læsning af koden ville have gjort det: begge tal står som `0,8` og `0-1-normaliseret` i kommentarerne.
2. **Er sammenligningen population-uafhængig?** Et krav der er relativt til gruppens eget tempo giver samme selektions-dynamik uanset om årgangen er stærk eller svag. Et absolut krav skifter betydning hver gang populationen flytter sig.

## Forward-guard

`backend/lib/engine/v4/segmentLoop.load.test.ts`. Vagterne er formuleret som **skala-invarianter**, ikke som forventede tal, og køres over flere evne-niveauer (5, 11, 30, 60, 99):

> Et ensartet felt kan ikke køre sig selv tømt på sit eget gruppetempo, og det skal gælde ved ethvert evne-niveau.

En test der låste et konkret tal ville have været grøn hele vejen igennem fejlen, fordi de eksisterende golden fixtures bruger syntetiske ryttere med midt-skala-evner. Det er selve pointen: **fejlen var usynlig for enhver test der ikke varierede skalaen.**

Vagterne blev kørt mod basis før merge og fælder den.

## Genbrugelig tjekliste

Når du sammenligner en tuning-konstant med en beregnet størrelse:

- Mål fordelingen af den beregnede størrelse mod ægte data, ikke mod fixtures
- Spørg om sammenligningen overlever at populationen flytter sig
- Skriv vagten som en invariant over flere skalaer, ikke som ét forventet tal
- Vær ekstra mistænksom når begge sider hedder "normaliseret 0-1": det ord skjuler at de to normaliseringer kan have vidt forskellige effektive områder
