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
| `7535-new5/` | Ny side efter opfølgningsrunde 1 (14/11): flag, U23, rask-igen-dato, belastning, ugetavlen på 390 |
| `pr-screens/7535/runde1-*` (i repoet) | Preview-mock efter runde 1: `runde1-ny-1440.png`, `runde1-ny-390.png` og arkene `runde1-sammenligning-pc-1440.png`, `runde1-sammenligning-mobil-390.png` (wireframe, nuværende, ny) |
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
| Ugetavlen på 390 | Tidslinje der scroller vandret (prototype 375) | - | Før: barerne stak ud over skærmen; derefter afkortet til forbogstavet. **Nu (runde 1): tidslinjen scroller vandret inde i kortet som wireframet** (siden selv er stadig 390, målt), åbner ved det valgte løb, og navnene kan læses | ens med WF (rettet) |
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
| Ryd dag / Ryd alt (hele sæsonen) | Nej | Dag: ja | Nej | dårligere, **ikke nået**: endpointene og "Ryd alt"-dialogen kan genbruges uændret, men ejeren skal vælge (a) hvor knapperne står på en side uden "dag"-kolonner, og (b) om en masse-rydning må gemme med det samme på en side hvor alt andet er en kladde |

## Ruteprofil

| Punkt | Wireframe | Nuværende side | Ny side | Dom |
|-|-|-|-|-|
| Profil for løbet, etape 1 først, pile + prikker | Ja | Dag: nej; Løb: stor profil med højdeakse, stigningsnavne og stigningsprocent-farver | Ja, løbssidens kompakte kort med stat-linje og terræn-mærker | bedre end Dag, ens med WF |
| Højdeakse, navngivne stigninger | Nej | Løb: ja | Nej (kompakt), linket til løbssiden er ét klik væk | dårligere end Løb, **ikke nået**: ejeren skal vælge om planlægningssiden skal have løbssidens fulde profil (fylder en skærmhøjde) eller en "vis fuld profil"-knap; komponenten findes |
| Skjul profil (huskes) | Ja | - | Ja | ens |
| Endagsløb: ingen pile/prikker | Ja | - | Ja | ens |

## Trup-tabel

| Punkt | Wireframe | Nuværende side | Ny side | Dom |
|-|-|-|-|-|
| Vælg (afkrydsning, max), rolle ved valg | Ja | Dag: træk/klik på chip, ordre-menu | Ja | ens |
| Rytternavn på én linje på pc | Ja | Ja | Før: navne brød over to linjer ved 1440. **Nu: én linje på pc**, brydes kun på mobil | ens (rettet) |
| Nation-flag i navnecellen (TASTE P12) | Nej | Form: ja; Dag: nej | **Nu (runde 1): rigtigt flag før navnet** (spillets `Flag`, læst fra `riders.nationality_code` som rytter-hoverkortet) | ens med Form (rettet) |
| Status: skadet, udgående, for gammel, trænet i dag, "I <løb>" | U23, I <løb> | Dag: "Låst · kører <løb>" | Ja. Før: "I <løb>" i versaler, afkortet efter få tegn. **Nu: almindelig skrift, længere før afkortning, fuld tekst i titlen** | ens (rettet) |
| U23-mærke | Ja | Form: alder | **Nu (runde 1): spillets U23-mærke i status** (samme aldersregel som holdsiden, fødselsdato fra `riders`) | ens med WF (rettet) |
| Skadet "tilbage 9 nov" | Ja | Nej | **Nu (runde 1): "SKD" + "Rask igen (ca.) <dato>"**, rytterprofilens tekst og regel (`rider_condition.injured_until`) | ens med WF (rettet) |
| Type-kolonne | Ja | Form: ja | Rollemærke ved rating | ens |
| Rating, Form, Træthed (tal + lille bjælke), Rute-match, kolonne pr. rutetype | Ja | Dag: rute-match + form | Ja, alle sorterer | bedre end Dag |
| "Efter løbet" (forventet træthed) | Ja | Nej | Nej | dårligere end WF, **ikke nået**: tallet findes ingen steder i spillet i dag; det kræver motorens træthedsmodel bag et nyt læse-endpoint (hard rule 36). Ejeren skal vælge om det bygges som eget skridt, eller kolonnen udgår af trin 1 |
| Sæson-belastning pr. rytter (løbsdage tilmeldt i sæsonen) | Nej | Dag: ja (rytter-chip) | **Nu (runde 1): "16d" ved navnet med samme titel**; serverens eget tal (`seasonLoadByRider` fra `GET /api/races/distribution`, samme kald som Dag), hentes igen efter gem | ens med Dag (rettet) |
| Én linje der forklarer rute-match og form | "Pick riders and give them a role · every column sorts" | Dag: ja | Før: nej. **Nu: samme linje som Dag** | ens (rettet) |
| Mobil 390: navn + rute-match, form, træthed (D-047), ingen vandret scroll | Bundark (trin 3) | Dag: stakket, kolonner pr. løb | Stakket liste så arbejdsflade, tre tal-kolonner | ens med D-047; bundark er trin 3 |

## Afvigelser fra spec'en (fra PR-teksten) og dom

| # | Afvigelse | Dom |
|-|-|-|
| 1 | "After race" ikke med | Dårligere end WF; kræver nyt læse-endpoint fra motorens model og et ejer-valg. Mangler før afløsning |
| 2 | Skadesdato vises ikke | Rettet i runde 1 ("Rask igen <dato>") |
| 3 | U23-mærke vises ikke | Rettet i runde 1 |
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

Trin 1, ikke nået (dårligere end en nuværende side eller wireframet), efter opfølgningsrunde 1 (14/11):

- "Efter løbet" (forventet træthed): kræver motorens træthedsmodel bag et nyt læse-endpoint. Ejer-valg: eget skridt, eller kolonnen udgår af trin 1.
- "Ryd dag" / "Ryd alt" over flere løb: endpoints og dialog findes. Ejer-valg: placering, og om en masse-rydning må gemme straks på en side hvor alt andet er en kladde.
- Fuld ruteprofil med højdeakse og navngivne stigninger som på løbssiden: komponenten findes. Ejer-valg: fuld profil på siden eller en "vis fuld profil"-knap.
- Sæsonmatrixen (rytter × løbsdag med udtagelser, rute-match, form og peak, belastning, "Kun problemer") har ingen modpart; den bør være et eget punkt i planen.

Rettet i runde 1: ugetavlen på 390 (vandret scroll i kortet som wireframet), nation-flag, U23-mærke, skadesdato ("Rask igen"), sæson-belastning pr. rytter.
