import { useState } from "react";

const PATCHES = [
  {
    version: "1.92",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Ryttere",
        items: [
          "Synkroniseret rytterværdier med Google Sheet (autoritativ UCI-kilde, 3000 ryttere) — 35 ryttere opdateret inkl. Mick van Dijke, Brent Van Moer, Kwiatkowski, Valter, Tesfazion, Aniołkowski m.fl.",
          "Rettet forældede værdier sat fra gammel CSV: Tobias Halland Johannessen (2393 pts), Magnus Cort Nielsen (321 pts), Fredrik Dversnes (431 pts) m.fl.",
          "Forbedret import-algoritme: håndterer nu polske/nordiske specialtegn (ł, Ø) og alternativ translitteration (Tesfazion/Tesfatsion)",
        ],
      },
    ],
  },
  {
    version: "1.91",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Ryttere",
        items: [
          "Rettet rytterværdier for 17 ryttere med sammensatte efternavne eller mellemnavne i UCI-data (fx Tobias Lund Andresen, Tobias Halland Johannessen, Magnus Cort Nielsen, Mikkel Honoré m.fl.) — disse var sat til minimumsværdi (20.000 CZ$) pga. navne-mismatch ved import",
          "Forbedret import-algoritme: navnematch bruger nu token-baseret søgning der håndterer omvendt navnerækkefølge, mellemnavne i UCI og varianter som Joe/Joseph og Bjoern/Bjorn",
        ],
      },
    ],
  },
  {
    version: "1.90",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Fuld nulstilling dækker nu alle spildata: transferarkiv (listings, tilbud, swaps), finanslån og renter, indbakke og præmiepenge-bonus på ryttere nulstilles korrekt ved reset",
          "Nye individuelle reset-knapper: Nulstil transferarkiv, Nulstil lån og Nulstil indbakke",
          "Rettet fejl hvor sæson-sletning fejlede pga. FK-constraint på board_plan_snapshots og board_profiles",
        ],
      },
    ],
  },
  {
    version: "1.89",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Sikkerhed",
        items: [
          "Erstattet xlsx-biblioteket (afviklet, to kendte sårbarheder) med exceljs — XLSX-import af løbsresultater er upåvirket",
        ],
      },
    ],
  },
  {
    version: "1.88",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Dashboard",
        items: [
          "Nyt Sæsonstatus-banner på dashboardet — viser aktiv sæson, antal dage til sæsonslut, løbsdage-progress og om transfervinduet er åbent eller lukket",
        ],
      },
    ],
  },
  {
    version: "1.87",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "UI",
        items: [
          "Tabeloverskriften (navn, evner, potentiale mv.) er nu sticky på rytteroversigten og auktionssiden — rækken fryser fast øverst, mens du scroller ned",
        ],
      },
    ],
  },
  {
    version: "1.86",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Auktioner",
        items: [
          "Byd-kolonnen er nu fastlåst i højre side af tabellen — input og knap er altid synlige uden vandret scroll",
          "Fjernet 'Min. bud'-tekst fra hver række — minimumsbud er allerede forudindtastet i feltet",
          "Tættere rækker giver overblik over flere auktioner på skærmen ad gangen",
          "Sælger- og Alder-kolonner skjules på mindre skærme og vises kun på meget brede skærme (1280px+)",
        ],
      },
    ],
  },
  {
    version: "1.85",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Auktioner",
        items: [
          "Rettet: Sortering på kolonner (navn, værdi, stats, potentiale) virkede ikke — rækkefølgen forblev uændret uanset valgt sortering",
        ],
      },
    ],
  },
  {
    version: "1.84",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Ryttere",
        items: [
          "Rettet: Potentiale-synkronisering opdaterede kun ~900 ryttere — nu opdateres alle 7.600+ ryttere korrekt",
          "Rettet: Halvstjerner (½) blev afrundet ned pga. europæisk decimalformat — potentiale-værdier som 4,5 vises nu korrekt",
        ],
      },
    ],
  },
  {
    version: "1.83",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Ryttere",
        items: [
          "Nyt: Potentiale-felt på alle ryttere — vises med guldstjerner (½–6 stjerner) på alle oversigter, rytterdetalje, auktioner, hold og ønskeliste",
          "Ryttere over 30 år vises med sølvstjerner i stedet for guld — alder afgør fremtidigt potentiale",
          "Sortering på Potentiale tilgængelig via kolonneoverskrift på alle lister",
          "Nyt filter: Potentiale (min–max) i filterpanelet på alle rytteroversigter",
          "Potentiale synkroniseres automatisk fra PCM-data (dyn_cyclist.value_f_potentiel) ved næste dataopdatering",
        ],
      },
    ],
  },
  {
    version: "1.82",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Filtrering",
        items: [
          "Ny land-filter dropdown på alle rytter-oversigter — viser kun lande repræsenteret i det aktuelle datasæt, med flag og fuldt landsnavn",
          "Fjernet 'Sortér efter' dropdown — sortering sker i stedet ved at klikke direkte på kolonneoverskrifterne (TT, BK, FL, Værdi osv.)",
        ],
      },
    ],
  },
  {
    version: "1.81",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Ryttere",
        items: [
          "Alle 8.699 ryttere har nu korrekt nationalitetsflag baseret på PCM-regiondata — vises overalt: rytterliste, holdside, auktioner, transfers og rytterdetalje",
          "138 lande repræsenteret fra PCM's fulde region-database (inkl. Kosovo, Timor-Leste, Ghana, Senegal m.fl.)",
        ],
      },
    ],
  },
  {
    version: "1.80",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Stabilitet",
        items: [
          "Rettet: password reset-flow afventer nu sessionen korrekt ved PKCE-callback, så token ikke mistes ved hurtig redirect",
        ],
      },
    ],
  },
  {
    version: "1.79",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Stabilitet",
        items: [
          "Rettet: dashboardet kan ikke længere sidde fast i en evig indlæsningsspinner ved netværksfejl",
          "Rettet: navn-wizarden kan ikke længere sende formularen flere gange ved gentagne Enter-tryk",
          "Rettet: navn-wizarden viser nu en brugervenlig fejlbesked hvis sessionen er udløbet",
        ],
      },
    ],
  },
  {
    version: "1.78",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Onboarding",
        items: [
          "Ny tvungen navn-wizard: nye managers skal vælge holdnavn og managernavn ved første login — blokkerer navigationen til det er gjort",
          "Ny velkomstmodal for nye managers: tre feature-cards (Marked, Auktioner, Bestyrelse) og et fremtrædende link til Hjælp & Regler",
          "Velkomstmodalen vises automatisk første gang (nul ryttere + ikke tidligere vist) og huskes via localStorage",
        ],
      },
    ],
  },
  {
    version: "1.77",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Marked",
        items: [
          "Rytterværdi viser nu dynamisk markedsværdi: baseværdi plus gennemsnit af seneste op til 3 sæsoners præmiepenge",
          "Auktionsbudsfeltet udfyldes nu med laveste gyldige bud: mindst 10% over nuværende pris, afrundet op til nærmeste 1.000 CZ$",
          "Auktionslisten viser nu sælger tydeligt som AI eller managerhold",
        ],
      },
      {
        category: "Transfers",
        items: [
          "Sendte og modtagne tilbud kan arkiveres, når de er afsluttede",
          "Dashboardets Transfers & Tilbud viser nu konkrete tilbud, modpart, beløb og om noget kræver handling",
        ],
      },
    ],
  },
  {
    version: "1.76",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Finanser",
        items: [
          "Finanssiden viser nu præmiepenge tydeligt: et dedikeret kort med samlet totalbeløb og en løb-for-løb oversigt med løbsnavn og beløb",
          "Præmiepenge-transaktioner viser nu løbsnavn (f.eks. 'Præmiepenge — Tour de France') i stedet for generisk tekst",
          "Divisionsbonus (type: bonus) vises nu korrekt i transaktionshistorik med grøn farve",
        ],
      },
      {
        category: "Økonomi",
        items: [
          "Lønsats sænket fra 15% til 10% af rytterens effektive markedsværdi — giver mere holdbar økonomi med store hold",
          "Gældslofter hævet markant: D1 360K→1.200K · D2 300K→900K · D3 240K→600K — bedre buffer ved svære sæsoner",
          "Startsponsoren for nye hold hævet fra 240K til 260K CZ$/sæson",
        ],
      },
    ],
  },
  {
    version: "1.75",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Økonomi",
        items: [
          "Præmiepenge fra løb er nu adskilt fra sæsonpoint: UCI-point bestemmer ranglisten, og præmiepenge = UCI-point × 15.000 CZ$ udbetales direkte til holdbalancen ved resultatimport",
          "Divisionsbonus ved sæsonafslutning: D1 300K/200K/100K/50K · D2 150K/100K/50K/25K · D3 75K/50K/25K — bogføres som 'bonus' i finance-loggen",
          "Præmiepenge knyttes nu til løbets klasse og UCI-pointtabellen — løb uden løbsklasse genererer 0 i præmie",
        ],
      },
    ],
  },
  {
    version: "1.74",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Profil",
        items: [
          "/profil-siden viser nu korrekt Profil & Indstillinger — holdnavn og managernavn kan redigeres direkte her",
        ],
      },
    ],
  },
  {
    version: "1.73",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Økonomi",
        items: [
          "Nødlån oprettet ved sæsonafslutning bliver nu knyttet til den rigtige sæson i finance-loggen, så admin-verifikation og fremtidig økonomituning kan se dem korrekt",
          "Der er tilføjet en service-visible sæsonafslutnings-verifier, som tjekker løn, lånerenter, nødlån, board snapshots og kendte oprykninger før økonomiændringer rulles videre",
        ],
      },
    ],
  },
  {
    version: "1.72",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Auktioner",
        items: [
          "Auktionsafslutningen har nu en ekstra sikring for aktive fri-/AI-/bankauktioner, der blev startet uden registreret førende budgiver: initiatoren behandles som første budgiver og køber rytteren, hvis ingen overbyder",
          "Auktioner, Min Aktivitet, Dashboard og historik viser nu også implicitte første bud som en føring, så du kan se at du står til at vinde rytteren",
        ],
      },
    ],
  },
  {
    version: "1.71",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Auktioner",
        items: [
          "Når du starter en auktion på en AI-, bank- eller fri rytter, tæller startprisen nu som dit første bud, så du kan vinde rytteren selv hvis ingen andre byder",
          "Auktionslisten viser nu den rigtige førende manager fra start og markerer ikke længere initiatoren som sælger, når rytteren faktisk ikke er deres egen",
        ],
      },
    ],
  },
  {
    version: "1.70",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Sæsonafslutning loader nu hold, ryttere og bestyrelsesplaner separat, så live DB-relationer ikke kan få finance og board til at blive sprunget over",
          "Hvis sæsonafslutning ikke kan læse eller skrive nødvendige economy-/board-data, fejler den nu før sæsonen markeres færdig",
          "Der er tilføjet en admin-reparation for sæsonafslutningens finance og board side effects uden at køre oprykning/nedrykning igen",
        ],
      },
    ],
  },
  {
    version: "1.69",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Teknik",
        items: [
          "Finance- og notifikationskontrakter er afstemt med runtime, så lån, nødlån, lånerenter, admin-justeringer og transfer-interesse ikke rammer DB type-checks forkert",
          "Notifikationssiden grupperer nu lånebeskeder under Økonomi og transfer-interesse under Transfers",
        ],
      },
    ],
  },
  {
    version: "1.68",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Aktiv sæson har nu fået løbskalenderen indlæst fra races-arket, så løbsresultater ikke længere stopper på en tom races-tabel",
          "Google Sheets-resultatimport matcher nu løbsnavne mere robust på tværs af accenter, bindestreger og kendte kalenderaliaser som Volta Valenciana",
          "Resultater Cycling Zone-arket er importeret for sæson 6 med 709 resultatrækker fordelt på 18 løb uden skipped races",
          "Re-import af løbsresultater rydder nu gamle præmie-transaktioner for samme løb først, så finance og holdbalance ikke dubleres ved en ny import",
          "Adminens løbsklasser og pointtabel bruger nu den moderne herre-UCI-skala: Tour de France, Giro/Vuelta, Monuments, WorldTour A/B/C, ProSeries, Class 1 og Class 2",
          "UCI-point for klassement, klassikere, etaper, pointtrøje, bjergtrøje og førertrøje er seedet i spillet og kan fortsat redigeres i Admin",
        ],
      },
    ],
  },
  {
    version: "1.67",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Rangliste",
        items: [
          "Opryknings- og nedrykningszoner på holdranglisten følger nu samme divisionsregel som den rigtige sæsonafslutning: Division 2-3 kan rykke op, og Division 1-2 kan rykke ned",
        ],
      },
    ],
  },
  {
    version: "1.66",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Teknik",
        items: [
          "Frontend-routes lazy-loades nu per side, så appens første JavaScript-bundle er mindre og Vite-build ikke længere advarer om en stor initial chunk",
          "Sideindlæsning bruger en fælles loading-state, så navigationen stadig føles stabil mens en tung side hentes første gang",
        ],
      },
    ],
  },
  {
    version: "1.65",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Auktioner",
        items: [
          "Rytterprofilen viser nu Start auktion for bank- og AI-ryttere, så den eksisterende bank/AI-auktionsmodel kan bruges direkte fra UI",
          "Direkte transfertilbud skjules nu for bank- og AI-ryttere på rytterprofilen, så manageren bliver ledt til auktion i stedet for en blokeret tilbudsvej",
        ],
      },
      {
        category: "Status",
        items: [
          "Roadmap og feature-status er ryddet op, så lukkede review-hardening punkter ikke længere står som næste implementeringsarbejde",
        ],
      },
      {
        category: "Profil",
        items: [
          "Min Profil er tilbage som indstillingsside, så managere igen kan ændre holdnavn og managernavn via den kanoniske backend-route",
          "Egen managerprofil har nu en direkte genvej til redigering af manager- og holdnavn",
        ],
      },
    ],
  },
  {
    version: "1.64",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Season-end preview skelner nu mellem lånerente som øget gæld og kontantbalance efter løn, så nød-lånsbehov matcher den faktiske sæsonafslutning",
        ],
      },
      {
        category: "Verifikation",
        items: [
          "Live season-flow er verificeret read-only mod Supabase: aktiv sæson mangler stadig løbskalender/resultater, så rigtig import-til-standings-flow er blokeret af datagrundlaget",
        ],
      },
    ],
  },
  {
    version: "1.63",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Season-end preview bruger nu samme board-evaluering og sponsor-modifier som den rigtige sæsonafslutning",
          "Preview viser både nuværende og forventet board-tilfredshed, målstatus og forventet sponsorudbetaling for næste sæsonstart",
        ],
      },
      {
        category: "Økonomi",
        items: [
          "Løn, renter, nødlånsbehov og sponsor-preview beregnes samlet i backendens economy engine, så admin-preview ikke driver fra runtime",
        ],
      },
    ],
  },
  {
    version: "1.62",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Integrationer",
        items: [
          "UCI-sync er hardenet til top 3000 med pagination-safety, så syncen fejler før write hvis datadækningen ikke er komplet",
          "UCI-værdier og rytterlønninger opdateres nu i samme kontrollerede flow, så løn følger den nyeste værdi efter en godkendt UCI-sync",
          "Den ugentlige UCI-workflow kører nu salary recalculation automatisk efter pointopdateringen",
        ],
      },
      {
        category: "Økonomi",
        items: [
          "Rytterlønninger genberegnes med den eksisterende økonomiformel: 15% af max(5 UCI-point × 4.000 CZ$ + præmiebonus)",
          "Salary update læser hele ryttertabellen pagineret og skriver i kontrollerede batches, så store opdateringer ikke stopper efter de første 1000 ryttere",
          "Der er tilføjet et manuelt backend-script til kontrolleret løngenberegning ved behov",
        ],
      },
      {
        category: "Sikkerhed",
        items: [
          "UCI-sync stopper nu ved mistænkelig massenedskrivning til 5 UCI-point i stedet for at skrive dårlige værdier live",
          "Dry-run for UCI-sync må ikke skrive til Sheets eller Supabase og bruges som safety-check før live write",
          "Regressionstests dækker både scraper coverage, salary recalculation og økonomiformlen bag lønningerne",
        ],
      },
    ],
  },
  {
    version: "1.61",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Rytterprofil",
        items: [
          "Ny 'Udvikling'-tab på rytterprofilen med graf for UCI-point over tid",
          "Stats-udvikling kan nu vises som graf for hver af rytterens 14 evner",
          "Fanen viser også de seneste historiske datapunkter fra sync-historikken",
        ],
      },
      {
        category: "Hjælp",
        items: [
          "Hjælp og FAQ er opdateret med forklaring af udviklingsfanen på rytterprofilen",
        ],
      },
    ],
  },
  {
    version: "1.60",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Beta-reset er udvidet til en komplet reset-suite med nulstilling af marked, trupper, balancer, divisioner, bestyrelser, løbskalender, sæsoner, XP/level og achievements",
          "Fuld nulstilling markerer nu tydeligt at flowet er en test-reset og viser kvittering for hver del af resetten",
          "Balance-reset kan valgfrit rydde finance-transaktioner for aktive manager-hold uden at røre AI-, bank- eller frosne hold",
        ],
      },
    ],
  },
  {
    version: "1.59",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Resultater",
        items: [
          "Google Sheets-import af løbsresultater bruger nu samme kanoniske backend-path som øvrige resultatflows",
          "Præmiepenge, finance-transaktioner og sæsonstilling opdateres nu konsistent efter Sheets-import",
        ],
      },
      {
        category: "Transfers & Marked",
        items: [
          "Parkerede transferaftaler og byttehandler kan ikke længere annulleres af manager, når begge parter har accepteret",
          "Parkerede direkte transfers holder transferlisten i forhandlingsstatus indtil transfervinduet åbner og handlen faktisk gennemføres",
          "Bankryttere kan ikke længere modtage direkte transfer- eller byttetilbud — de skal gå via auktioner",
        ],
      },
      {
        category: "Auktioner",
        items: [
          "Auktionsbud skal nu være mindst 10% over nuværende pris, afrundet op til nærmeste 1.000 CZ$",
          "Aktive auktionsføringer reserverer nu både disponibel balance og trupplads, så man ikke kan føre flere auktioner end holdet kan rumme",
        ],
      },
      {
        category: "Navigation",
        items: [
          "Min Profil redirecter nu altid til den indloggede managers egen profil",
          "Sidebarens aktive markering matcher nu hele rutesegmenter, så /team ikke længere rammer /teams",
        ],
      },
    ],
  },
  {
    version: "1.58",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Integrationer",
        items: [
          "UCI-point synkroniseres nu automatisk hver mandag fra den officielle UCI-rangliste (top 3000 ryttere)",
          "Historisk log af UCI-points og rytterstats gemmes ved hver synkronisering — danner grundlag for 'udvikling over tid'-visning på rytterprofilen (kommer i næste version)",
        ],
      },
    ],
  },
  {
    version: "1.55",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Ranglister",
        items: [
          "Tydelig oprykningsindikator på alle ranglister: grøn venstrekant og lysegrøn baggrund for oprykningspladser, rød for nedrykningspladser",
          "Zone-separator linje (grøn gradient) adskiller tydeligt oprykningszone fra den øvrige tabel",
          "Zone-separator linje (rød gradient) adskiller nedrykningszone fra den sikre zone",
          "Badges '↑ Op' og '↓ Ned' har nu tydeligere styling med baggrundsfarve",
          "Gælder både aktiv sæsonrangliste og afsluttede sæsonresultater",
        ],
      },
    ],
  },
  {
    version: "1.54",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Rytterprofil",
        items: [
          "Ny 'Historik'-tab på rytterprofilen — viser alle ejerskiftehændelser i kronologisk rækkefølge",
          "AI-salg vises med type-badge og vinderpris",
          "Direkte transferhandler vises med køber, sælger og pris",
          "Byttehandler vises med begge hold og eventuel kontantjustering",
          "Låneaftaler vises med lejer, udlejer, sæsoninterval og gebyr",
        ],
      },
    ],
  },
  {
    version: "1.53",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Transfers & Marked",
        items: [
          "Parkering af direkte transferaftaler og byttehandler: begge parter kan nu bekræfte en handel mens sæsonen er aktiv og transfervinduet er lukket",
          "Handlen parkeres med status 'Aftalt — afventer vindue' (violet badge) og gennemføres automatisk simultant ved transfervinduets åbning",
          "Samme model som auktioner: alle parkerede handler eksekveres på én gang når admin åbner vinduet",
          "Når en handel parkeres, trækkes alle andre aktive tilbud på de involverede ryttere øjeblikkeligt tilbage",
          "Begge parter kan stadig annullere en parkeret handel inden vinduet åbner",
          "Forhandling (tilbud, modbud, bytteforslag) er nu altid tilladt uanset vinduets tilstand",
        ],
      },
    ],
  },
  {
    version: "1.52",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Resultater",
        items: [
          "Google Sheets-import af løbsresultater — admin kan nu importere sæsonresultater direkte fra et Google Sheet med kolonnerne Rank, Name, Team, Benævnelse, Løb, Sæson",
          "Understøtter alle 8 benævnelse-typer: Etapeplacering, Klassement, Klassiker, Pointtrøje, Bjergtrøje, Ungdomstrøje, Etapeløb Hold, Klassiker Hold",
          "Automatisk etape-detektion (rank-nulstilling = ny etape) og standings-genberegning efter import",
          "Re-import er idempotent — eksisterende resultater for matchede løb erstattes",
        ],
      },
    ],
  },
  {
    version: "1.51",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Rytterdatabase",
        items: [
          "Evne-filtre (slidere) virker nu korrekt — min og max er to separate, synlige slidere i stedet for overlappende (grå = minimum, amber = maximum)",
        ],
      },
      {
        category: "Discord",
        items: [
          "Webhook-routing rettet — gennemførte transfers og swaps sendes nu korrekt til 'Transferhistorik'-webhook, øvrige notifikationer til '#auktioner'",
        ],
      },
    ],
  },
  {
    version: "1.50",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Indbakke",
        items: [
          "FM-style indbakke — notifikationer og aktivitetsfeed samlet på én side med to faner: 'Mine' og 'Ligaen'",
          "'Mine'-fanen har kategorifiltre: Alle, Ulæste, Auktioner, Transfers, Bestyrelse, Finans",
          "'Ligaen'-fanen viser globale spilhændelser med filtre: Alle, Auktioner, Transfers, Sæson",
          "Aktivitetsfeed-siden er nu en del af Indbakke — /activity-feed redirecter automatisk",
        ],
      },
    ],
  },
  {
    version: "1.49",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Managerprofiler",
        items: [
          "Online-status er nu live — grøn indikator vises på managerprofiler og holdlisten når en manager har været aktiv inden for de seneste 5 minutter",
          "Sidst set vises på managerprofiler (fx '12 min siden') når manageren er offline",
          "Login-streak tæller daglig aktivitet og vises på managerprofilen (🔥)",
          "Online-tæller i sidebaren viser antal aktive managere lige nu",
        ],
      },
      {
        category: "Notifikationer",
        items: [
          "Ulæste-badge på 'Indbakke' i navigationssidebaren — viser antal ulæste notifikationer (maks 9+)",
          "Mobilvisning: klokkebadge øverst til højre viser ulæste i realtid",
        ],
      },
    ],
  },
  {
    version: "1.48",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Beta-testværktøjer — ny admin-sektion med 4 handlinger: annuller marked, nulstil trupper, nulstil balancer og fuld nulstilling",
          "Hvert værktøj kræver bekræftelse og viser kvittering med præcist antal påvirkede ryttere, holds og markedsaktiviteter",
        ],
      },
    ],
  },
  {
    version: "1.47",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Rytterdatabase",
        items: [
          "Sort-dropdown viser nu 'Værdi' i stedet for 'UCI Point' — mere præcist navn",
          "Ny 'Løn'-kolonne i rytterlisten — viser årsløn i CZ$, sorterbar ligesom Værdi",
          "Nyt lønfilter — filtrer ryttere på løn-interval (min/max CZ$) med filter-chip",
        ],
      },
      {
        category: "Head-to-Head",
        items: [
          "Hold B viser nu automatisk holdforslag ved fokus i søgefeltet — ingen typing nødvendig",
        ],
      },
    ],
  },
  {
    version: "1.46",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Økonomi",
        items: [
          "Startkapital for nye hold er sænket fra 2.000.000 til 800.000 CZ$",
          "Standard sponsor-indkomst er sænket fra 400.000 til 240.000 CZ$ pr. sæson",
          "Alle eksisterende hold er opdateret til de nye værdier",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Garanteret salg er nu låst til egne ryttere — exploit der tillod køb af AI-ejede ryttere til 50% af Værdi via Garanteret salg er lukket",
          "Bestyrelses-outlook og category-scores på Dashboard vises nu korrekt igen efter boardEngine-refactor",
        ],
      },
    ],
  },
  {
    version: "1.45",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Bugfix",
        items: [
          "Rettet: man kan nu købe en AI/fri rytter på auktion, selvom man er den eneste byder — fejlen skyldtes at en mislykket budplacering blev vist som succes uden feedback",
        ],
      },
    ],
  },
  {
    version: "1.44",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Økonomi",
        items: [
          "Rytterværdi er nu dynamisk: UCI-point × 4000 CZ$ + gennemsnit af seneste op til 3 sæsoners præmiepenge fra spillet",
          "Lønnen er ændret fra 10% til 15% af rytterens effektive markedsværdi",
          "Alle eksisterende rytterlønninger er genberegnet med den nye 15%-model",
          "Minimum-regel: ryttere med færre end 5 UCI point tildeles automatisk 5 UCI point (20.000 CZ$ minimumsværdi)",
          "Præmiebonus opdateres ved sæsonslut for alle ryttere — værdien vokser med holdsuccesen",
          "Køb via auktion eller transfer sætter straks ny løn baseret på køberens præmiebonus + handelspris",
        ],
      },
    ],
  },
  {
    version: "1.43",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Økonomi",
        items: [
          "Alle beløb og værdier er skaleret ×4000 — rytterpriser, holdbudgetter, præmiepuljer, lønninger og gæld",
          "Rytterens markedsværdi er nu UCI-point × 4000 CZ$ (f.eks. en rytter med 500 UCI-point er nu 2.000.000 CZ$ værd)",
          "Holdenes startkapital er 2.000.000 CZ$ og standard sponsor-indkomst er 400.000 CZ$ pr. sæson",
          "Alle eksisterende hold, ryttere, lån, auktioner og transaktioner er opdateret tilsvarende via database-migration",
        ],
      },
    ],
  },
  {
    version: "1.42",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Ny Brugere-sektion i Admin: se alle brugere med hold og rolle, skift rolle mellem admin og manager, og slet brugere permanent",
          "Sletning af bruger fjerner Supabase-login og notifikationer — holdet bevares men mister sin ejer",
          "Løbskalender har nu Slet-knap — sletter løbet og alle tilknyttede resultater",
        ],
      },
    ],
  },
  {
    version: "1.41",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Hvert bestyrelsesmål viser nu om det er et obligatorisk krav eller ej — tydeligt markeret i måloversigten",
          "Mål der er bagud vises med advarselsstatus (I fare / Tæt på / På sporet) baseret på aktuelle holddata",
          "Aktuelle fremskridt vises direkte på hvert mål — f.eks. nuværende placering vs. mål for top N-finish",
          "Bestyrelsens karakter (sportsambition, økonomirisiko, identitetsstyrke) vises nu i plankortet under bestyrelsens vurdering",
          "Ny advarselsbanner hvis tilfredshed falder under 25% — ingen fyring, men skærpede krav ved næste planforhandling",
          "Forhandlingswizarden viser nu tydeligt hvilke mål der er obligatoriske krav",
        ],
      },
    ],
  },
  {
    version: "1.40",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Board-siden viser nu tre parallelle bestyrelsesplaner (5-årsplan, 3-årsplan og 1-årsplan) simultant på samme side — hver plan har egne mål og tilfredshedsmåling",
          "Wizard-flowet åbner nu for én specifik plantype, så du forhandler med bestyrelsen om præcis den plan du vælger",
          "Første gang du åbner Board-siden oprettes alle tre planer automatisk i rækkefølge 5yr → 3yr → 1yr",
        ],
      },
    ],
  },
  {
    version: "1.39",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Nationalitetsflag vises nu på Hold, Team-profil, Auktioner, Ønskeliste, Transfermarked, Auktionshistorik, Head-to-Head og Ryttersammenligning — flag er nu konsekvent på alle rytterflader",
        ],
      },
    ],
  },
  {
    version: "1.38",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Gennemførte transfers og byttehandler sendes nu automatisk til en dedikeret Discord-kanal — konfigureres via Admin under Discord webhooks med typen 'Transferhistorik'",
        ],
      },
    ],
  },
  {
    version: "1.37",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Løbsarkiv er nu tilgængeligt under Resultater — alle løb fra alle sæsoner kan nu browses på ét sted",
          "Hvert løb har sin egen historikside med alle tidligere udgaver og vinderen af hver sæson",
          "Bedste ryttere vises akkumuleret på tværs af alle udgaver af et løb — sorteret efter sejre og point",
          "Akkumuleret point-graf viser de bedste rytteres samlede præstationer i et givet løb",
          "Løbsarkiv er tilføjet som hub-link på Resultater-overblikssiden",
        ],
      },
    ],
  },
  {
    version: "1.36",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Resultater-hub tilføjet som samlet indgang til resultatområdet — viser tophold, topscorere og links til alle resultat-sider",
          "Rytterrangliste er nu tilgængelig under Resultater — vis alle rytteres sæsonresultater med etapesejre, GC-sejre, pointklassement, bjergklassement og ungdomsklassement",
          "Rytterranglisten inkluderer både manager-ejede og AI-ejede ryttere og kan filtreres og sorteres på alle kolonner",
        ],
      },
    ],
  },
  {
    version: "1.35",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "'UCI Point' er omdøbt til 'Værdi' i hele UI — rytterliste, auktioner, transfers og ønskeliste bruger nu det samme begreb",
          "Auktionsformularen håndhæver nu minimum Værdi som startpris — du kan ikke sætte en lavere pris end rytterens Værdi",
          "'Garanteret salg' er nu tydeligt markeret som undtagelse i auktionsformularen — afkrydses for at sætte startpris til 50% af Værdi",
          "Rytterliste og rytterside viser nu en '⚡ Auktion'-badge hvis rytteren er i en aktiv auktion",
          "Transferlisten viser nu hvornår en rytter blev sat til salg",
          "Ryttertype vises nu som et tydeliggjort badge på ryttersiden",
          "Nationalitetsflag vises nu på rytterlisten og ryttersiden",
          "Du får nu notifikation i indbakken når en rytter på din ønskeliste sættes til auktion eller salg",
        ],
      },
    ],
  },
  {
    version: "1.34",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Min Aktivitet er ombygget til seks faner: Kræver handling, Auktioner, Transfers, Lån, Ønskeliste og Historik",
          "Siden åbner nu på 'Kræver handling' som default — tilbud du skal svare på, modbud og afventende lejeforslag samles øverst",
          "Auktioner der slutter inden for 1 time vises i 'Kræver handling' med live-nedtæller",
          "Lån (lejeaftaler) har fået sin egen fane med adskillelse af 'Jeg udlåner' og 'Jeg låner'",
          "Ønskeliste-fanen viser dine gemte ryttere kompakt med markedsstatus-badge hvis en rytter er i aktiv auktion",
          "Historik-fanen samler afsluttede auktioner, lukkede transfers og færdige lejeaftaler",
          "Klik på rytternavn i alle rækker åbner rytterens statistikside direkte",
        ],
      },
    ],
  },
  {
    version: "1.33",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Design",
        items: [
          "UI er konverteret fra mørkt tema til lyst tema — varm creme-baggrund, hvide kort, mørk navy-sidebar",
          "Navigationen har nu tydelig hierarki: sektionsoverskrifter (OVERBLIK, MARKED osv.) er klart adskilt fra klikbare menupunkter",
          "Sidebar-ikoner er fjernet fra menupunkter for et renere og mere scanbart udtryk",
          "Aktiv menupunkt vises med gyldent highlight og afrundede kanter",
          "Status-farver (grøn/rød/orange/blå) er justeret for god kontrast på lys baggrund",
          "Spinner og loading-states er opdateret til lyst tema",
          "CSS custom properties introduceret som fundament for design-tokensystemet",
        ],
      },
    ],
  },
  {
    version: "1.32",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Notifikationer er omdøbt til Indbakke — siden samler alle systemhændelser ét sted",
          "Klik på en besked i Indbakken fører nu direkte til den relevante side (auktioner, transfers, løb osv.) i stedet for blot at markere som læst",
          "Holdoversigten viser nu en grøn online-indikator ved managere der er aktive lige nu",
        ],
      },
    ],
  },
  {
    version: "1.31",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Navigationen er omstruktureret med fire tydelige grupper: Overblik, Marked, Resultater og Liga — tidligere var sider spredt på kryds og tværs",
          "Ranglisten, Sæsonresultater og Hall of Fame er samlet i en ny 'Resultater'-gruppe",
          "Min Aktivitet og Ønskeliste (tidligere Talentspejder) er nu under Marked",
          "Løbskalender og Sæson Preview er flyttet under Liga",
          "Notifikationer og Min Managerprofil er rykket op under Overblik",
          "Klik på Cycling Zone-logoet fører nu direkte til Dashboard",
          "Min Profil er foldet ind i managerprofilen — /profil-siden redirecter automatisk",
        ],
      },
    ],
  },
  {
    version: "1.30",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Hemmelige achievements afslører ikke længere navn eller beskrivelse i tooltip-hover, før de er låst op — låste hemmelige achievements viser nu '???' i stedet",
          "Discord-webhooks sendes nu korrekt ved nye auktioner, overbud, transfer-tilbud, transfer-svar og sæsonstart/-slut — notifier-modulet var tidligere koblet fra alle event-sites",
        ],
      },
    ],
  },
  {
    version: "1.29",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Standings gemmer nu også divisionens interne placering (`rank_in_division`), så board-evaluering og sæsonruntime ikke længere mangler rangeringsdata ved season-end",
          "Admin har nu en direkte '↻ Standings'-rebuild på sæsoner, så en aktiv eller afsluttet sæson kan genberegnes sikkert ud fra gemte løbsresultater, hvis live-data tidligere er drevet",
        ],
      },
    ],
  },
  {
    version: "1.28",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Board-siden forklarer nu tydeligere hvorfor bestyrelsen reagerer, med synlige drivere pr. kategori samt ekstra forklaring på signaler fra historik, national kerne og stjerneprofil",
          "Seneste board request viser nu konkrete fokus- og målændringer direkte i UI, så tradeoffs ikke kun står som en kort tekstbesked",
          "National kerne vises nu med landenavn og flag på Board-siden i stedet for kun en rå landekode",
        ],
      },
    ],
  },
  {
    version: "1.27",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Bestyrelsen bruger nu national kerne og stjerneprofil direkte i sin løbende vurdering, så tydelig identitet og store profiler faktisk tæller i board-outlook og season-end",
          "Store profiler giver nu lidt ekstra sponsor/prestige i boardets læsning af holdet, men de hæver også forventningerne til resultater og sponsorvækst i mere ambitiøse planer",
          "Direkte board-skift mellem ungdomsspor og stjernespor bliver nu oftere håndteret som et gradvist tradeoff via en balanceret mellemposition i stedet for et hårdt instant switch",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Backend og database stopper nu dobbelt board-requests i samme sæson, så race conditions ikke kan oprette to svar fra bestyrelsen på én gang",
        ],
      },
    ],
  },
  {
    version: "1.26",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Board-siden viser nu også national kerne og stjerneprofil, så bestyrelsens læsning af holdets identitet går dybere end kun specialisering, U25-andel og trupstatus",
          "Balancerede hold med en tydelig national kerne kan nu få et nationalt identitetsmål direkte i bestyrelsesplanen, så board-krav bedre matcher holdets faktiske DNA",
          "Board-status og season-end-evaluering bruger nu samme board-riderfelter til identitetslæsningen, så national/stjerneprofil ikke driver mellem UI og runtime",
        ],
      },
    ],
  },
  {
    version: "1.25",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Nye bestyrelsesplaner skalerer nu efter division, nuværende holdprofil og trupbredde, så mål ikke længere kan lande uden for divisionens holdgrænser",
          "Board-siden viser nu bestyrelsens læsning af holdet med primær/sekundær specialisering, U25-andel og trupstatus direkte fra den delte board-engine",
          "Board requests bruger nu også holdprofilen, så skift mod mere ungdom eller mere resultatfokus bliver vurderet mere kontekstuelt",
        ],
      },
    ],
  },
  {
    version: "1.24",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Login-flowet har nu fået et rigtigt 'Glemt password?'-entrypoint, så managers kan bede om et reset-link uden manuel hjælp",
          "Recovery-mails lander nu på en dedikeret `/reset-password`-side, så ny adgangskode kan vælges uden at blive afbrudt af login-redirects",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler og FAQ forklarer nu også, hvordan password reset fungerer i auth-flowet",
        ],
      },
    ],
  },
  {
    version: "1.23",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Board-siden har nu fået board requests, så du kan sende én strategisk forespørgsel pr. aktiv sæson direkte til bestyrelsen",
          "Bestyrelsen kan nu svare med godkendelse, delvis godkendelse, afvisning eller et tradeoff, og resultatet bliver logget på den samme backend-path som resten af board-systemet",
          "Board-status returnerer nu også request-status og request-muligheder, så BoardPage læser både outlook og requests fra samme kanoniske `/api/board/status`-path",
        ],
      },
    ],
  },
  {
    version: "1.22",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Achievements syncer nu mod live historik i stedet for stale backend-felter, så bud-, transfer-, watchlist-, hold- og board-relaterede unlocks kan dukke op igen",
          "Achievement-checket kører nu efter login-streak-opdateringen ved app-load, så streak-baserede unlocks ikke bliver tabt på en race condition",
        ],
      },
    ],
  },
  {
    version: "1.21",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Admin-import af løbsresultater kører nu gennem samme backend execution path som godkendte pending resultater, så standings og præmiepenge opdateres ens med det samme",
          "Admin-sæsonstart og -afslutning bruger nu kun ét kanonisk backend-entrypoint, så validering og guardrails ikke kan drive mellem `api.js` og `server.js`",
        ],
      },
    ],
  },
  {
    version: "1.20",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Udløbne AI-, free- og andre non-user-auktionsflows kan nu blive afsluttet igen, fordi auktionsschemaet matcher backendens delte finalizer",
          "Auktionshistorikken kan nu sikkert rydde `seller_team_id` på ikke-ejede auktioner uden at live-databasen stopper finaliseringen",
        ],
      },
    ],
  },
  {
    version: "1.19",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "AI- og andre non-user-ejede auktioner krediterer nu den faktiske ejer ved afslutning i stedet for at lade provenuet følge auktionsinitiatoren",
          "Stale auktioner annulleres nu sikkert, hvis rytteren i mellemtiden ejes af en anden menneskelig manager, så der ikke bogføres forkert payout eller falsk salgs-historik",
        ],
      },
    ],
  },
  {
    version: "1.18",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Backend-notifikationer deduplikerer nu nylige identiske events, så samme besked ikke spammes igen ved cron-kørsler eller retries",
          "Board-, låne-, API- og cron-paths bruger nu samme notification-writer i stedet for separate rå inserts til `notifications`",
        ],
      },
    ],
  },
  {
    version: "1.17",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Signup og Min Profil gemmer nu holdnavn og managernavn via samme backend-route i stedet for direkte browser-writes til `teams`",
          "Managers med en tidligere halv-oprettet konto kan nu initialisere deres hold fra Min Profil, hvis team-rækken mangler",
          "Hold-bootstrap sikrer nu også, at et manglende board-profile bliver oprettet sammen med holdet",
        ],
      },
    ],
  },
  {
    version: "1.16",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Admin-import af løbsresultater og admin-godkendelse af pending resultater bruger nu samme backend execution path, så præmiepenge og standings opdateres ens",
          "Godkendelse af pending resultater markerer nu submissionen som approved på serveren i stedet for at afhænge af en efterfølgende browser-write",
          "Race-præmier bogføres nu konsekvent som gyldige `prize`-transaktioner i det fælles result-flow",
        ],
      },
    ],
  },
  {
    version: "1.15",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Bestyrelsen bruger nu en mere gradvis og vægtet evaluering, hvor nær-miss, stærk identitet og økonomisk kontrol stadig tæller med i den samlede vurdering",
          "Dashboardets bestyrelseskort læser nu via den samme `/api/board/status`-path som Board-siden og viser et kort outlook med kategori-scores",
          "Board-siden viser nu bestyrelsens aktuelle outlook og category breakdown direkte oven på den eksisterende UI-skabelon",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Dashboardet bruger nu korrekt `budget_modifier` i stedet for det forkerte felt `budget_multiplier` i bestyrelsesstatus-kortet",
          "Season-end board-evaluering tæller nu også U25-ryttere korrekt, fordi season-end runtime-pathen indlæser de nødvendige rytterfelter til board-checks",
        ],
      },
    ],
  },
  {
    version: "1.14",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Bestyrelsens mål og forhandlede kompromiser genereres nu via backend, så Board-siden og season-end bruger samme kanoniske board-logik",
          "Forny kontrakt går nu gennem en rigtig API-route i stedet for direkte database-write fra browseren",
          "Board-flowet er nu dækket af en direkte backend-regressionstest for season-end, så fælles board-ændringer bliver fanget før deploy",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Board-wizarden kan ikke længere sende vilkårlige mål til serveren; backend validerer nu kun de tilladte server-genererede mål og forhandlinger",
        ],
      },
    ],
  },
  {
    version: "1.13",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Lejegebyr på rider-loans trækkes nu igen for hver dækket sæson i aftalen i stedet for kun ved første aktivering",
          "Sæsonstart bogfører nu fortsatte lejeaftaler i finance-loggen for både låner og udlejer, så saldo og historik følger samme runtime-path",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler præciserer nu, at første sæson betales ved aktivering, mens senere dækkede sæsoner opkræves automatisk ved sæsonstart",
        ],
      },
    ],
  },
  {
    version: "1.12",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Squad-limit tæller nu også aktive lejeaftaler med i den delte market-state, så lån, transfers og auktioner vurderer holdstørrelse ud fra samme runtime-sandhed",
          "Lejeforslag, låneaktivering og auktionsfinalisering stopper nu korrekt, hvis holdet allerede er fyldt op af indgående handler eller lånte ryttere",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Dashboardets holdstørrelse-advarsel tæller nu både indgående handler og aktive lejede ryttere med, så UI og backend viser samme squad-status",
          "Hjælp & Regler præciserer nu, at lejede ryttere tæller mod din divisions holdgrænse",
        ],
      },
    ],
  },
  {
    version: "1.11",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Dashboardets divisionsstilling og Hold-siden viser nu kun den aktive sæsons rangliste i stedet for at blande gamle sæsoner ind",
          "Ranglistekort og holdoversigt falder nu tilbage til 0-point-rækker for alle aktive hold, så siden ikke ser tom eller forkert ud før første live result-godkendelse",
        ],
      },
    ],
  },
  {
    version: "1.10",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Auktions-cron kan igen starte korrekt på Railway, så udløbne auktioner ikke længere crasher ved bootstrap",
          "Expired auction-finalisering er nu dækket af en direkte backend-regressionstest, så helper-regressioner bliver fanget før deploy",
        ],
      },
    ],
  },
  {
    version: "1.9",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Transfers og byttehandler bruger nu samme backend-guardrails ved endelig bekræftelse, så ejerskab, saldo og holdgrænser bliver tjekket igen før handlen lukkes",
          "Gennemførte handler rydder nu relaterede listings, transferbud og bytteforslag op for de involverede ryttere, så markedet ikke efterlader stale forhandlinger",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler præciserer nu, at transfer- og byttehandler kun kan sendes og lukkes i åbent transfervindue, og at begge parter skal bekræfte den endelige handel",
        ],
      },
    ],
  },
  {
    version: "1.8",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "AI- og frirytter-auktioner betaler ikke længere salgsprovenu til manageren, der blot startede auktionen",
          "Auktionsfinalisering bruger nu samme backend-logik i både cron og admin/API, så payout, squad-limit og transfer-window vurderes ens",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler præciserer nu, at initiatoren af en fri rytter-auktion ikke automatisk er sælgeren",
        ],
      },
    ],
  },
  {
    version: "1.7",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Finance-siden kan igen oprette manager-lån uden at kollidere med rider-låneflowet",
          "Finance-lån og rider-lån kører nu på adskilte API-routes, så lån og lejeaftaler ikke blander domæner",
        ],
      },
    ],
  },
  {
    version: "1.6",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Admin-sæsonflowet er stabiliseret, så sæsoner og løb kan oprettes igen via backend-routes",
          "Godkendte løbsresultater gemmes nu med korrekt holdtilknytning, så point og præmier følger det rigtige hold",
          "Sæsonstillingen recalculeres nu fra gemte løbsresultater i stedet for kun inkrementelle writes",
          "Sæsonafslutning stopper nu, hvis der stadig ligger afventende løbsresultater i sæsonen",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler er præciseret omkring hvornår sæsonstillingen opdateres",
          "FAQ er opdateret med svar om result-godkendelse og sæsonafslutning",
        ],
      },
    ],
  },
  {
    version: "1.5",
    date: "2026-04-18",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Manager-profil — dedikeret profilside for hver manager med hold, sæsonhistorik, achievements og transferaktivitet",
          "Online status — grøn prik + 'sidst set'-tekst vises overalt hvor manager-navn optræder",
          "Managers online — tæller på Dashboard viser antal aktive managers lige nu",
          "Login-streak — 🔥 tæller viser hvor mange dage i træk du har logget ind",
          "Achievements — 45 achievements fordelt på auktioner, transfers, hold, sæson og hemmelige kategorier",
          "Hemmelige achievements — låses op overraskende undervejs og vises som 🔒 indtil opdaget",
          "Watchlist-tæller — se hvor mange managers der følger en rytter på rytterens statistikside (anonymt)",
          "Transferrygter fix — notifikation til holdejer fungerer nu korrekt når en manager besøger en rytterside",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler — ny sektion om Manager-profil, Achievements, Online status og Login-streak",
          "FAQ opdateret med 6 nye spørgsmål",
          "Patch Notes opdateret med denne version",
        ],
      },
    ],
  },
  {
    version: "1.4",
    date: "2026-04-17",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Aktivitetsfeed — offentlig realtidsstrøm af auktioner, transfers og sæsonhændelser",
          "Transferrygter — anonym notifikation når en manager kigger på din rytter (max 1/time per rytter)",
          "Deadline Day — rødt countdown-banner på Dashboard de sidste 48 timer inden transfervinduet lukker",
          "Onboarding guide — 3-trins velkomstguide til nye spillere der endnu ikke har ryttere",
          "Fejringsanimation — konfetti-modal med animation når du vinder en auktion eller en transfer accepteres",
          "Mobil forbedringer — RidersPage med horisontal scroll, bedre padding på alle sider",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler — ny sektion om Aktivitetsfeed og Transferrygter",
          "FAQ opdateret med 4 nye spørgsmål",
          "Auktioner logger automatisk til aktivitetsfeed ved start og sejr",
          "Transfers logger automatisk til aktivitetsfeed ved gennemførelse",
        ],
      },
    ],
  },
  {
    version: "1.3",
    date: "2026-04-17",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Transfersystem v2 — Football Manager-stil forhandling direkte mellem managers",
          "Send tilbud på enhver rytter fra rytterens side — ingen listing nødvendig",
          "Modtagne tilbud — accepter, afvis eller send modbud med din pris",
          "Sendte tilbud — accepter modbud, send nyt bud eller træk tilbud tilbage",
          "Ubegrænset forhandlingsrunder frem og tilbage — runde-tæller viser fremgang",
          "Tilbud er private — kun køber og sælger ser deres forhandling",
          "Besked-felt på alle tilbud og modbud",
          "Rytter skifter hold ved næste vindueåbning, forhandling kan ske hele sæsonen",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler opdateret med transfersystem v2",
          "Transfers-siden omstruktureret med faner: Marked, Modtagne tilbud, Sendte tilbud",
          "Konfetti-animation ved accepteret transfer",
        ],
      },
    ],
  },
  {
    version: "1.2",
    date: "2026-04-17",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Løbskalender — dedikeret side med alle løb, detaljer og resultater",
          "Resultatindberetning — managers uploader PCM Excel-filer til admin-godkendelse",
          "Admin godkendelse — gennemgå og godkend/afvis indberetninger",
          "Sæsonresultater — slutstillinger med op/nedrykning markeret, altid tilgængelig",
          "Pointudviklingsgraf — SVG-linjegraf for dit holds kumulative point løb for løb",
          "Delt RiderFilters komponent — samme filtrering på alle sider med ryttere",
          "Filtrer på navn, Værdi, alder, U25, U23, fri agent og hold",
          "Sortering på alle stats med retningspil",
          "Aktive filter-chips der kan fjernes enkeltvis",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Dashboard — holdstørrelse-advarsel, transfers & tilbud sektion, divisions-stilling",
          "Rangliste — mini sparkline-graf, progress-bars, op/nedrykning zoner",
          "Transfers — RiderFilters på markedet",
          "Bestyrelse — mål progress-bar, tilfredshedsniveauer forklaret",
          "Alle sideoverskrifter ensrettet til samme størrelse",
        ],
      },
    ],
  },
  {
    version: "1.1",
    date: "2026-04-17",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Fold-ud navigation — menuen organiseret i grupper: Overblik, Marked, Mit Hold, Liga",
          "Auto-åbner aktiv gruppe ved navigation",
          "Balance og division vist direkte i sidebaren",
          "Hall of Fame — rekorder, manager niveau-rangering, divisionshistorik",
          "Sæson Preview — holdstyrker og topstjerner",
          "Head-to-Head — sammenlign to managers statistik og transfers",
          "Rytter sæsonhistorik — holdskifte og resultater på rytterens side",
          "Manager XP system — optjen XP og stig i niveau (Rookie → Legende)",
          "Patch Notes side",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Dashboard viser nu løb korrekt uanset status",
          "Alle sideoverskrifter ensrettet",
        ],
      },
    ],
  },
  {
    version: "1.0",
    date: "2026-04-17",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Hjælp & Regler — komplet regeloversigt med søgefunktion og FAQ",
          "Talentspejder / Ønskeliste — gem ryttere privat med ★ stjerne og noter",
          "Min Aktivitet — samlet overblik over bud, auktioner og transfers",
          "Discord integration — notifikationer ved ny auktion og andre events",
          "Manuel override i admin — flyt ryttere direkte til hold",
          "Min Profil — tilknyt Discord bruger-ID",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Auktionskort opdateres øjeblikkeligt efter bud",
          "'Andre managers' fane på auktionssiden",
          "Holdstørrelsesgræ nser per division med advarsel",
          "Balance skjult for andre managers",
          "Sæsonstart lukker transfervindue og genberegner lønninger automatisk",
        ],
      },
    ],
  },
];

export default function PatchNotesPage() {
  const [expanded, setExpanded] = useState(PATCHES[0]?.version ?? null);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Patch Notes</h1>
        <p className="text-slate-400 text-sm">Opdateringshistorik for Cycling Zone Manager</p>
      </div>

      <div className="flex flex-col gap-3">
        {PATCHES.map((patch) => {
          const isOpen = expanded === patch.version;
          return (
            <div key={patch.version}
              className={`bg-white border rounded-xl overflow-hidden transition-all
                ${isOpen ? "border-amber-200" : "border-slate-200"}`}>
              <button
                onClick={() => setExpanded(isOpen ? null : patch.version)}
                className="w-full flex items-center justify-between px-5 py-4 text-left">
                <div className="flex items-center gap-3">
                  <span className="text-slate-900 font-bold text-sm">v{patch.version}</span>
                  <span className="text-[9px] uppercase bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                    {patch.label}
                  </span>
                  <span className="text-slate-400 text-xs">{patch.date}</span>
                </div>
                <span className={`text-slate-400 text-xs transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 border-t border-slate-200 pt-4 space-y-4">
                  {patch.changes.map((section, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0
                          ${section.category === "Nyt" ? "bg-green-400" :
                            section.category === "Forbedringer" ? "bg-blue-400" :
                            section.category === "Fejlrettelser" ? "bg-red-400" :
                            "bg-[#e8c547]"}`} />
                        <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">
                          {section.category}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-1.5 ml-3.5">
                        {section.items.map((item, j) => (
                          <li key={j} className="flex items-start gap-2">
                            <div className={`w-1 h-1 rounded-full flex-shrink-0 mt-1.5
                              ${section.category === "Nyt" ? "bg-green-400" :
                                section.category === "Forbedringer" ? "bg-blue-400" :
                                section.category === "Fejlrettelser" ? "bg-red-400" :
                                "bg-[#e8c547]"}`} />
                            <span className="text-slate-500 text-sm leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
