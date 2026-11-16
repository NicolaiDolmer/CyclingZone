# Skitse #7535: ét fælles taktikpanel (løbsside v6 og planlægning)

Ejervalg 16/11 på #7535 (punkt 1): én fælles taktik-komponent for løbssidens Taktik-fane (v6, #7778/#8211) og planlægningssidens Taktik-visning, ingen egen planlægnings-udgave. Med v6-valg 15 (mobil: et kort pr. rytter, redigering i et ark fra bunden) og 16 (Hård/Normal/Let som faste indstillinger, detaljerne bagefter). Ingen produktkode.

Åbnes med `npm run dev` i `frontend/` på `/src/preview/sketches/taktik-faelles/index.html?v=race|plan&lang=da|en&theme=dark&edit=r1&notes=0`. Billeder: `pr-screens/taktik-faelles/`. Alle navne og tal er opdigtede eksempler; opgaver, prisord, holdplaner og jagtvalg er spillets egne.

## Hvad panelet er, og hvad værten ejer

| Panelet (fælles) | Værten (løbsside / planlægning) |
|---|---|
| Holdplan (de fem planer fra #7864) og jagten på udbruddet | Etapevalget (etapestribe / "Etape 2 af 7"-stepper) |
| Én række (computer) eller ét kort (telefon) pr. rytter: navn, rolle, rating, form, træthed, rute, Hård/Normal/Let, planen langs ruten, I aften | Ruteprofilen (løbssiden: synlig, kan skjules; planlægning: foldet) |
| Editoren: svævende kort under rækken (computer), ark fra bunden (telefon) | Den ene guld-knap og gem-status ("Gem etape 2" i løbshovedet, "Gem taktik" i planlægningens løbshoved) |
| "Kopiér til etape 3" (sekundær) | Data, gem, konflikt og lås |

Panelet tilpasser sig sin egen bredde (container queries), ikke skærmen: fra 64rem alle kolonner, 42-64rem samles rating/form/træthed/rute i én dæmpet linje under navnet (planlægningens højre kolonne), under 42rem et kort pr. rytter.

## Nye greb i skitsen

1. **Planen langs ruten:** kolonnehovedet er etapens lille profil med km for hver stigning; hver rytter har et spor på samme skala, delt i sine led, mørkere jo hårdere opgaven er (prisordene fra #7864). Et skift "når han er sat" har ingen km, så det forrige led får en åben ende i stedet for et gættet punkt.
2. **Hård/Normal/Let** pr. rytter som en rigtig radiogruppe med mørk aktiv flade som i wireframe v5 (ikke guld: syv rækker guld ville bryde rationeringen).
3. **Prisordet står ikke på chipsene** i tabellen, kun i editoren og i forklaringen ("Opgavens pris"), så "Hård" som indstilling og "Hård" som pris ikke står side om side i samme række.
4. **Guld følger visningen:** panelet har ingen guld-knap; begge værter har én.

## Kritik og tilgængelighed (kørt før PR)

- design-critique: rettet: medium-tabellens kolonner (indsats klippet), rolle ved navnet, dobbelt "175 km", editoren dækkede kæden (står nu under rækken), "I aften" samlet i kortets dæmpede linje (kort ca. 140 px). Åbent: chrome før første rytter (løbssiden ca. 650 px under skitse-etiketten, planlægningen ca. 525 px); se PR'en.
- accessibility-review (målt i Chromium): kontrast `cz-3`-tekst 5,4:1 lys / 5,3:1 mørk; guld-tekst (`--accent-t`) 3,9:1 på lyst kort er systemets eget token (fund på systemniveau, ikke skitsens). Piletaster flytter Hård/Normal/Let; fokusring er synlig også på den mørke aktive flade; editoren får fokus i første felt og giver fokus tilbage til "Ændr" ved Esc; arket er native `<dialog>` med `showModal`, `closedby="any"` og pointer-fallback uden `closedby`. Trykflader 44 px på telefon (navne-links udvidet med negativ margin).
