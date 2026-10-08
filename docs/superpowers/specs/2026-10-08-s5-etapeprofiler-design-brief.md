# S5-etapeprofiler: designgrundlag (8/10, ejer-beslutning: stor pakke, kalender live 18/10)

Status: **designgrundlag, ikke byg-go.** Indledende design tages med ejeren en af de kommende dage (design-gate, hard rule 25). Epic: **#6369** (delopgaver #6359-#6368). Relateret: #5841 (S5-kalender synlig), #5833 (sæsonpause), #6332 (Tour-kategorier), #3463 (holdtidskørsel).

## Ejer-beslutninger (låst)

- **8/10:** "Kuperet er bakke-etaper. Hvis der er lange stigninger (bjerge), så skal det være bjergetaper." Mulig ny type "mellembjerg"; den rullende profil/beskrivelse laves om. (memory `feedback_stage_category_definition`)
- **8/10:** Stor pakke til S5, S5-kalenderen live senest **lørdag 18/10** (7 dage før skiftet 25/10). Løft niveauet markant.
- **8/10:** Tour de l'Hexagone etape 11 → kuperet, etape 8 → bjerg m. nedkørselsfinale (rettet i prod, #6332).

## Hvorfor (målt 8/10, S4, read-only)

- 66 af 350 vejetaper (19 %) har en type der ikke passer med rutens stigninger; 42 klart forkerte. Roden: generatoren vælger typen FØR stigningerne trækkes (`CLIMB_SPEC` i `raceRouteGenerator.js`), og spændene overlapper (kuperet tillader 4× kat. 2; bjerg kræver ingen kat. 1).
- Højdemeter følger etiketten (`BASE_ELEVATION` pr. type lægges oveni), ikke ruten.
- Typen styrer motoren (udbrudsstørrelse, feltets samling til finalen, scoring-grundlag, tidsgrænse, pointskala, AI-taktik, kaptajnens terræn), så en forkert type giver forkerte resultater, ikke kun forkert etiket.
- Spillerne mister tillid når kategori og rute ikke passer (Discord 7/10, #6332).

## Hvad der er i spillet i dag

Typer (DB CHECK): flat, rolling ("Bølget"), hilly ("Kuperet"), mountain, high_mountain, itt, itt_hilly, ttt (ubrugt), cobbles, gravel, classic. Finaler: bunch_sprint, reduced_sprint, punch, long_climb, descent, solo_tt, breakaway. S4-fordeling: flat 325 · hilly 287 · mountain 246 · high_mountain 124 · rolling 111 · itt 107 · cobbles 79 · classic 32 · itt_hilly 3 · gravel 2.

## Pakken (forslag til designmødet)

| # | Element | Indhold |
|---|---|---|
| 1 | **Typen udledes af ruten** | Generator trækker stigningerne og afleder typen af længde/kategori (ejerens definition), ikke omvendt. Gennemsigtig regel, dokumenteret i CALENDAR_RULES. |
| 2 | **Mellembjerg** (`medium_mountain`) | Ny type: lange moderate stigninger (typisk kat. 2), uden kat. 1/HC. DB-CHECK, generator, krav-profil, finaleregler, motor-tests, i18n EN/DA, Hjælp. |
| 3 | **Bølget vs. kuperet skarpt adskilt** | Bølget = "falsk fladt" der slider sprinterne; kuperet = korte hidsige bakker (kat. 3/4). Ejeren beslutter navn/beskrivelse. |
| 4 | **Stigende massespurt** (`uphill_sprint`) | Ny finale: sidste 0,5-1 km stiger 2-5 %. Belønner sprint + punch (Matthews/Ewan-type). |
| 5 | **Mur-finale** (`wall_finish`) | Ny finale: kort, meget stejl afslutning (10-20 %, Mur de Huy-type). Adskilt fra punch (5-8 %). |
| 6 | **To akser i visningen** | Terræn (flad → højbjerg) og afslutning (fladt mål, op ad bakke, mur, nedkørsel) vises hver for sig, som ProCyclingStats. |
| 7 | **Etapekort for spilleren** | Profil med nøglestigninger, "her afgøres etapen" og hvilke evner dagen kræver. Design + mockup først. |
| 8 | **Rigtige højdemeter** | Regnet af stigninger og rute, ikke grundtal pr. type. |
| 9 | **Benchmark-gate** | S5-kalenderens fordeling af typer/finaler og tidsgab måles mod rigtige Grand Tours og klassikere før den må gå live (udvider `calendarGoldenDiff`/scorecard). |
| 10 | **Holdtidskørsel** | Allerede lovet til S5 (#3463); finale `team_tt` eller genbrug af `ttt`-profilen. |

## Bevidst IKKE i S5-pakken (vurderet 8/10)

- **"Solostød" som finaletype:** et soloridt er et udfald, ikke en egenskab ved ruten; at forudbestemme det skriver resultatet på forhånd (spillernes hovedklage M1). Rigtigt sted: motoradfærd hvor et stærkt soloangreb 5-15 km fra mål kan lykkes på brosten/grus/klassikere når evner og taktik tillader det — målt mod virkeligheden. Eget issue. Samme kritik rammer den eksisterende "udbrud"-finale; vurderes på designmødet.
- **Opfundne sandsynligheder** (fx "95 % kontrol") — alle tal kalibreres mod rigtige løb.
- **Højde/iltmangel over 2.000 m** — ny motormekanik; senere.

## Tidslinje (forslag)

Designmøde (ejer) → byg i bølge med motor-tests og benchmark-gate → tørkørsel af hele S5-kalenderen → ejer-go på før/efter-billede → **live senest 18/10**. Afhængigheder: sæsonpause-afstemningen (#5833) fastlægger S5-startdato; Tour-pakken (lør 10/10) går forud for motor-kapacitet.

## Åbne spørgsmål til designmødet (ét ad gangen)

1. Præcise grænser for kuperet / mellembjerg / bjerg (stigningslængde, kategori, antal).
2. Navn og beskrivelse af "Bølget" — beholdes, omdøbes eller slås sammen?
3. Hvilke finaler tillades pr. type (inkl. stigende massespurt og mur-finale)?
4. Skal "udbrud" forblive en finaletype?
5. Etapekortets indhold og placering (mockup).
6. Ønsket fordeling af etapetyper i en Grand Tour vs. et kort etapeløb i S5.

---

## Runde 2 (8/10 aften): ejerens Gemini-dialog vurderet + Claudes tilføjelser

Ejeren bad om at bruge Gemini-runde 2 til at gøre designet endnu bedre og selv tilføje mere, så etapeprofilerne kan blive et af spillets klart bedste områder. **Det endelige design sættes fast SAMMEN med ejeren** (ét beslutningskort ad gangen, til sidst én side med hele designet som ejeren godkender ende-til-ende; design-go noteres på #6369).

### Hvad Gemini runde 2 har ret i (tages med)

- **Finaleaksen er rutens geometri de sidste km, ikke et udfald.** "Udbrud" og "solostød" fjernes som finaletyper; motoren afgør om et udbrud eller soloangreb holder hjem. Samme konklusion som Claudes kritik i runde 1. (Afløser spørgsmål 4 ovenfor med en anbefaling: fjern "udbrud" som finale.)
- **Matrix over tilladte kombinationer** (terræn × afslutning) i generatoren, så umulige kombinationer ikke kan opstå (fx bjerg + reduceret spurt, som ramte Tour-etape 8).
- **Kalenderkvoter som gate** (andel flad/bølget, kuperet/mellembjerg, bjerg/højbjerg, enkeltstart) — men tallene skal komme fra rigtige Grand Tours, ikke skøn (se nedenfor).
- **Rytterevner pr. finale** skal designes eksplicit (fx stigende massespurt = sprint + punch + acceleration; mur-finale = punch + acceleration + kort klatring).

### Hvor Gemini runde 2 tager fejl (rettes)

- **Terræn efter samlede højdemeter (500/1.500/2.500/3.500/4.500 m) er forkert.** Højdemeter afhænger af distancen og af mange små bølger; en lang bølget etape kan have flere højdemeter end en kort etape med én kat. 1. Det strider også mod ejerens definition (stigningernes LÆNGDE og karakter). **Terræn skal udledes af de enkelte stigninger** (længde, gennemsnitsgradient, kategori, tæthed), med højdemeter som sekundært sanity-tjek. Det er sådan virkelighedens klassificering fungerer.
- **Brosten, grus og klassiker er ikke terræn.** Brosten og grus er *underlag*; en brostensetape kan være flad (Roubaix) eller kuperet (Flandern med mure). Klassiker/monument er *løbets karakter* (længde, prestige), ikke etapens terræn.

### Claudes tilføjelser til verdensklasse

1. **Tre akser i stedet for to:** (A) terræn af stigningerne: flad, bølget, kuperet, mellembjerg, bjerg, højbjerg · (B) afslutning af de sidste km: flad, stigende spurt, bakke/punch, mur, bjergtop, nedkørsel (+ enkeltstart/holdtidskørsel) · (C) **underlag**: asfalt, brostenssektorer, grussektorer (antal, længde, sværhed). Så kan Flandern (kuperet + mure + brosten) og Roubaix (flad + brosten) være forskellige, som i virkeligheden.
2. **Løbets karakter** på løbsniveau: monument/klassiker (lang distans, 250+ km), Grand Tour, kort etapeløb. Distancen påvirker udholdenhed, ikke terrænet.
3. **Hvor afgøres etapen:** den sidste vigtige stigning og dens afstand til mål (fx Poggio 5,5 km før mål) som felt på etapen. Det er dét, der skiller "stigning og flad finale" fra "bjergtop", og spilleren kan se det.
4. **Rigtig benchmark-database:** de seneste 3-5 års Tour/Giro/Vuelta og monumenter klassificeret med samme regel (fordeling af typer, finaler og typiske tidsgab pr. type). Kvoterne og motorens tidsgab kalibreres mod den, ikke mod gæt.
5. **Grand Tour-struktur, ikke kun kvoter:** rigtige mønstre (flad/kuperet første uge, enkeltstart midtvejs, bjerge og kongeetape i uge 3) som kalenderregel for Grand Tours i spillet.
6. **Kandidater til senere motor-mekanik** (ikke S5 uden ejer-go): sidevind og kanter på flade/bølgede etaper (vejr findes allerede pr. etape), teknisk finale (sving, smalle veje) der vægter positionering, målankomst i højde.
7. **Etapekortet** viser alle tre akser + "her afgøres etapen" + hvilke evner dagen kræver, så holdudtagelsen bliver et reelt valg.

### Rækkefølge for designmødet (ét kort ad gangen)

1. Tre akser ja/nej (terræn, afslutning, underlag) + løbets karakter.
2. Terræn-reglen: grænser for bølget/kuperet/mellembjerg/bjerg/højbjerg ud fra stigningerne (ejerens definition), vist på rigtige S4-etaper.
3. Afslutningstyperne og den tilladte matrix.
4. Rytterevner pr. afslutning.
5. Benchmark-kvoter og Grand Tour-struktur (fra benchmark-databasen).
6. Etapekortet (mockup).
7. Samlet designside → ejerens design-go → byg.
