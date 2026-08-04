# Etape-struktur i rigtige WorldTour-etapeløb (2024-2026)

Kalibrerings-grundlag for [#3326](https://github.com/NicolaiDolmer/CyclingZone/issues/3326) (finale-drevne ordnings-arketyper). Ejer-direktiv 4/8: rækkefølgen skal følge virkeligheden, ikke et opfundet forhold.

## Datasæt

41 brugbare løb, 407 etaper. Alle mænds WorldTour-etapeløb i sæsonerne 2024, 2025 og 2026 (14 pr. sæson), hentet fra Wikipedias strukturerede etape-tabeller (kolonnen `Type`). Kilde-URL står i hver løbs-sektion.

| Fil | Indhold |
|---|---|
| `stage-races-2024.md` | 14 løb, 138 etaper |
| `stage-races-2025.md` | 14 løb, 137 etaper |
| `stage-races-2026.md` | 14 løb, 135 etaper (11 kørt, 1 i gang, 2 med offentliggjort rute) |
| `analyse.mjs` | Udleder fordelingerne. `node analyse.mjs` fra denne mappe. |

Renewi Tour 2026 udelades automatisk af scriptet — Wikipedia har ingen artikel endnu, og alle 5 etaper står som UKENDT.

## Hovedtal

**En-uges-løb (n=32), sidste etapes terræn:** kuperet 37,5 % · bjerg 28,1 % · flad 18,8 % · enkeltstart 15,6 %

**Grand tours (n=9), sidste etapes terræn:** flad 77,8 % · enkeltstart 22,2 % · **bjerg 0 %**

**Første etape (n=41):** kuperet 46,9 % · flad 28,1 % · enkeltstart 21,9 % · bjerg 3,1 % — altså **70,7 % åbner ikke fladt**

**Hårdeste etape, en-uges-løb:** næstsidste dag 56,3 % · sidste dag 40,6 % · tidligere 3,1 %

## Forbehold

1. **"Hårdeste etape" er en proxy** — sidste forekomst af den hårdeste etapetype, ikke den etape der faktisk afgjorde klassementet. De øvrige tal er direkte optællinger.
2. **`Hilly stage` er en bred kasse** i kilden: dækker både punchy bykredsløb og rullende etaper der ender i spurt.
3. **Udtrækket er WebFetch + en lille model**, ikke rå HTML-parse. Kun usædvanlige rækker er dobbeltverificeret mod rå wikitext. 8 af 407 rækker havde ikke-standard typer; remapningen står i `analyse.mjs`.
4. **Stikprøven er WorldTour.** Divisionerne 2-4 er lavere niveau. Forskellen mellem GT og en-uges-løb er stor (0 % mod 28,1 % bjerg-finaler), så formatet betyder noget — en ProSeries-stikprøve kan flytte tallene for de lavere divisioner og bør laves før båndene låses for D3/D4.

## Historik

Første runde byggede på 12 løb læst som rute-guides og løbsreportager. Den gav flad finale ~40 % og kuperet ~10 %. Den strukturerede optælling viser det modsatte (flad 18,8 %, kuperet 37,5 %) — stikprøven var skæv mod mindeværdige spurtfinaler. Fuld korrektion i [#3326-kommentaren](https://github.com/NicolaiDolmer/CyclingZone/issues/3326).
