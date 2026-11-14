# Planlægningssiden trin 1 (#7535, PR #8056): sammenligning punkt for punkt

Natten 13.-14/11. Ejerens krav 13/11: den nye side må ikke være dårligere end wireframet nogen steder, og ikke dårligere end de nuværende sider for holdudtagelse, formplan og løbsside.

## Billeder

Rigtige skærmbilleder taget med Billedstationen (`scripts/pr-shots.mjs`, lokal build mod prod-API'et, læse-only, skrivninger blokeret). De indeholder ægte rytter- og holdnavne og ligger derfor **kun privat** i `OneDrive\CyclingZone-context\private-handoffs\pr-shots\`, aldrig i repoet:

| Mappe | Indhold |
|-|-|
| `7535-current/` | Nuværende sider, 1440 og 390: `planning-*` (Holdudtagelse, dagvisning), `planning-view-season-*` (sæsonvisning med matrix), `planning-tab-form-*` (Formplan/peaks), `planning-tab-strategy-*`, `planning-tab-calendar-*`, `races-<id>-*` (løbssiden for samme løb) |
| `7535-new/` | Ny side før nattens rettelser, 1440 og 390 (`planning-workbench-*`), kontakten slået til med en mock af `/api/feature-flags` |
| `7535-new3/` | Ny side efter rettelsen af ugetavlen på 390 |
| `7535-new2/` | Ny side efter nattens rettelser, samme opsætning |
| `pr-screens/7535/natten-*` (i repoet) | Lokal preview-mock med opdigtede navne: nuværende `/planning` og ny side, 1440 og 390, samt de to annoterede ark `natten-sammenligning-pc-1440.png` og `natten-sammenligning-mobil-390.png` (wireframe, nuværende, ny) |

Wireframet er den klikbare prototype; billederne af den ligger i repoet: `pr-screens/7535/prototype-desktop-1440.png` og `prototype-mobile-375.png`. Billeder til PR'en med opdigtede navne (preview-seed) ligger i `pr-screens/7535/`.

Forkortelser i tabellen: **WF** = wireframe/prototype, **Dag** = Holdudtagelse dagvisning (`/planning`), **Sæson** = sæsonvisning (`/planning?view=season`), **Form** = Formplan-fanen, **Løb** = løbssiden, **Ny** = den nye side.

## Løbsliste og ugeoversigt

| Punkt | Wireframe | Nuværende side | Ny side | Dom |
|-|-|-|-|-|
| Ugeoversigt synlig ved første besøg | Ja, øverst (WF 1440) | Sæson: hele sæsonens tidslinje med baner | Før: skjult som standard. **Nu: vist som standard**, valget huskes | ens (rettet) |
| Til/fra-kontakterne viser deres tilstand | Ja, kontakt-ikon | - | Før: to ens knapper, tilstanden kunne ikke ses. **Nu: udfyldt/tom firkant på knappen** | ens (rettet) |
| Overlap ses som baner | Ja | Sæson: ja (baner) | Ja (7-kolonners uge, baner) | ens |
| Bladre mellem uger / hele sæsonen | Uge-pile | Sæson: hele sæsonen på én flade, sæsonvælger (S4/S5) | Uge-pile + "Hele sæsonen" i listen; ingen tidligere sæson | dårligere på sæsonvælger (trin 1-scope: nej, tidligere sæsoner hører til Resultater) |
| x/6 og klar/mangler pr. løb | Ja | Dag: "0 / 7 · underbemandet"; Sæson: farvesignatur | Ja ("x/N", firkant grøn/rav) | ens |
| Løbsliste grupperet pr. uge, senere uger foldet | Ja | Nej (dag-for-dag) | Ja | bedre |
| Række: navn, dato, klasse, etaper, etape-stribe, overlap, status | Ja | Dag: ja (pr. kolonne) | Ja, plus løbsdage | ens |
| "Næste 7 dage / Hele sæsonen", "Vis tidligere" | Ja | - | Ja | ens |
| Andre divisioners løb (Min division / Andre divisioner) | Nej (hører til løbssiden) | Dag: ja | Nej | afvigelse efter spec'en: andre holds opstillinger hører til løbssiden |
| Fristboks "Trup mangler" med nedtælling | - | Dag/Sæson/Form: ja, øverst | Før: nej. **Nu: samme boks og samme data øverst** | ens (rettet) |
| Ugetavlen på 390 | Tidslinje der scroller vandret (prototype 375) | - | Før: barerne stak ud over skærmen (siden blev bredere end 390, målt på det rigtige billede). **Nu: ingen vandret scroll (målt 390), x/N står altid**, men et løbsnavn i en bar på én dag afkortes til forbogstavet | ens på bredde (rettet); dårligere på navne, **ikke nået** (løsningen er et designvalg: kortnavn, to linjer eller kun liste på mobil) |
| Tom / indlæser / fejl | - | Ja | Ja (tom med handling, skelet, fejl med "Prøv igen") | ens |

## Løbshoved og bjælken for ugemte ændringer

| Punkt | Wireframe | Nuværende side | Ny side | Dom |
|-|-|-|-|-|
| Start (dato, klokkeslæt) | Ja | Dag: dato; Løb: "Låser 13.00" | Ja, med klokkeslæt | ens |
| Tid til start ("om 12 t") | - | Dag (fristboks), Løb ("om 12 timer") | Før: nej. **Nu: "om 12 t" i hovedet** (eksisterende tekst) | ens (rettet) |
| Kopiér trup fra..., Foreslå trup, Gem trup (én guld) | Ja | Dag: Auto-udfyld (gemmer straks) | Ja; forslaget er en kladde, ikke et gem | bedre |
| Ryd udtagelse | - | Dag: ja | Før: nej. **Nu: i trup-tabellens fod** (kladde, Train now-låste bliver) | ens (rettet) |
| Afmeld / Deltag igen | - | Dag: ja | Før: nej (kun "gem melder til igen"). **Nu: i foden, samme endpoint og guards** | ens (rettet) |
| Ugemt-markør + bjælke "Bliv / Kassér / Gem og åbn" | Ja | Dag: nej (gemmer pr. klik) | Ja | ens med WF |
| Låst løb siger hvorfor | - | Dag: ja | Ja | ens |
| Payback-advarsel | Nej | Dag: ja | Nej | dårligere: **trin 3** (Peak form), se nederst |
| Ryd dag / Ryd alt (hele sæsonen) | Nej | Dag: ja | Nej | dårligere, **ikke nået**; masse-handlinger over flere løb bør designes, ikke kopieres |

## Ruteprofil

| Punkt | Wireframe | Nuværende side | Ny side | Dom |
|-|-|-|-|-|
| Profil for løbet, etape 1 først, pile + prikker | Ja | Dag: nej; Løb: stor profil med højdeakse, stigningsnavne og stigningsprocent-farver | Ja, løbssidens kompakte kort med stat-linje og terræn-mærker | bedre end Dag, ens med WF |
| Højdeakse, navngivne stigninger | Nej | Løb: ja | Nej (kompakt), linket til løbssiden er ét klik væk | dårligere end Løb, **ikke nået** (en fuld profil på planlægningssiden er et designvalg til ejeren) |
| Skjul profil (huskes) | Ja | - | Ja | ens |
| Endagsløb: ingen pile/prikker | Ja | - | Ja | ens |

## Trup-tabel

| Punkt | Wireframe | Nuværende side | Ny side | Dom |
|-|-|-|-|-|
| Vælg (afkrydsning, max), rolle ved valg | Ja | Dag: træk/klik på chip, ordre-menu | Ja | ens |
| Rytternavn på én linje på pc | Ja | Ja | Før: navne brød over to linjer ved 1440. **Nu: én linje på pc**, brydes kun på mobil | ens (rettet) |
| Nation-flag i navnecellen (TASTE P12) | Nej | Form: ja; Dag: nej | Nej | dårligere end Form, **ikke nået** (selection-endpointet sender ikke nation) |
| Status: skadet, udgående, for gammel, trænet i dag, "I <løb>" | U23, I <løb> | Dag: "Låst · kører <løb>" | Ja. Før: "I <løb>" i versaler, afkortet efter få tegn. **Nu: almindelig skrift, længere før afkortning, fuld tekst i titlen** | ens (rettet) |
| U23-mærke | Ja | Form: alder | Nej (endpointet sender ikke fødselsdato) | dårligere end WF, **ikke nået** (kræver endpoint-udvidelse) |
| Skadet "tilbage 9 nov" | Ja | Nej | Nej (endpointet sender kun ja/nej) | dårligere end WF, **ikke nået** |
| Type-kolonne | Ja | Form: ja | Rollemærke ved rating | ens |
| Rating, Form, Træthed (tal + lille bjælke), Rute-match, kolonne pr. rutetype | Ja | Dag: rute-match + form | Ja, alle sorterer | bedre end Dag |
| "Efter løbet" (forventet træthed) | Ja | Nej | Nej | dårligere end WF, **ikke nået**: kræver motorens condition-model via et nyt læse-endpoint (hard rule 36, eget designet skridt) |
| Sæson-belastning pr. rytter (løbsdage tilmeldt i sæsonen) | Nej | Dag: ja (rytter-chip) | Nej | dårligere end Dag, **ikke nået** (tallet kommer fra serveren; må ikke gen-regnes i klienten med en anden definition) |
| Én linje der forklarer rute-match og form | "Pick riders and give them a role · every column sorts" | Dag: ja | Før: nej. **Nu: samme linje som Dag** | ens (rettet) |
| Mobil 390: navn + rute-match, form, træthed (D-047), ingen vandret scroll | Bundark (trin 3) | Dag: stakket, kolonner pr. løb | Stakket liste så arbejdsflade, tre tal-kolonner | ens med D-047; bundark er trin 3 |

## Afvigelser fra spec'en (fra PR-teksten) og dom

| # | Afvigelse | Dom |
|-|-|-|
| 1 | "After race" ikke med | Dårligere end WF; kræver nyt læse-endpoint fra motorens model. Mangler før afløsning |
| 2 | Skadesdato vises ikke | Dårligere end WF; kræver endpoint-udvidelse. Mangler før afløsning |
| 3 | U23-mærke vises ikke | Dårligere end WF; kræver fødselsdato i endpointet. Mangler før afløsning |
| 4 | Ingen Squad / Tactics / Peak form-kontrol | Korrekt: en kontrol med to døde valg ville være opdigtet (P11). Kommer med trin 2 og 3 |
| 5 | Firkantet mærke i stedet for venstre-kant | Accepteret: TASTE forbyder venstre-bjælker |
| 6 | Ugeoversigt som 7-kolonners gitter | Accepteret: virker på 375 px uden vandret scroll |
| 7 | "Suggest squad" er en klient-kladde | Bedre: det eksisterende auto-udfyld gemmer straks |
| 8 | Løbshoved i T2-typografi, ikke Bebas | Accepteret: Bebas kun i T3-heroer |
| 9 | Mobil er en stakket flade, ikke bundark | Trin 3 (mobil-ark) |
| 10 | Ruteprofil fylder mere end prototypens rene graf | Accepteret: ægte data (stat-linje, terræn-mærker) |
| 11 | Låste løb skrivebeskyttede; afmeldt hold kan melde til | Ens med Dag; afmeld/deltag igen er nu også knapper |
| 12 | Ny rute i stedet for at erstatte `/planning` | Accepteret til beta; `/planning` er uændret |
| 13 | Ugemt kladde overlever navigation | Ens med udtagelsespanelet |

## Mangler før den nye side kan afløse den gamle

Trin 2 (Tactics): rytternes plan langs ruten (løbssidens `StagePlanBoard`), Holdstrategi-genvejen, Strategi-fanens indhold.

Trin 3 (Peak form + mobil-ark): Formplan-fanens peaks (mål, "hvad den er værd", assistentens udkast, acceptér/nulstil), payback-advarslen ved løbet, bundarket på mobil.

Trin 1, ikke nået i nat (dårligere end en nuværende side eller wireframet):

- "Efter løbet", skadesdato og U23-mærke (kræver endpoint-udvidelser).
- Sæson-belastning pr. rytter (Dag-visningens rytter-chip).
- Nation-flag i navnecellen.
- Sæsonmatrixen (rytter × løbsdag med udtagelser, rute-match, form og peak, belastning, "Kun problemer") har ingen modpart; den bør være et eget punkt i planen.
- "Ryd dag" / "Ryd alt" over flere løb.
- Ugetavlen på 390: navnet i en bar på én dag afkortes til forbogstavet (siden holder sig nu inden for skærmen).
- Fuld ruteprofil med højdeakse og navngivne stigninger som på løbssiden.
