import { useState } from "react";

const PATCHES = [
  {
    version: "4.51",
    date: "2026-06-02",
    label: "Beta",
    changes: [
      {
        category: "Fixes · Language menu",
        items: [
          "EN · The language menu could be cut off at the bottom of the screen, so you couldn't see or pick the other language. It now always opens fully on screen and flips upward when there isn't room below. Refs #787.",
          "DA · Sprog-menuen kunne blive skåret af i bunden af skærmen, så du ikke kunne se eller vælge det andet sprog. Den åbner nu altid helt på skærmen og vender opad når der ikke er plads nedenunder. Refs #787.",
        ],
      },
    ],
  },
  {
    version: "4.50",
    date: "2026-06-02",
    label: "Beta",
    changes: [
      {
        category: "Fixes · Divisions",
        items: [
          "EN · Test accounts no longer take up division slots. They are hidden from the standings, but were still counting towards a division's capacity, which pushed real teams down a division. Capacity now counts only the real teams you see on the standings. Refs #962.",
          "DA · Testkonti optager ikke længere pladser i en division. De er skjult på ranglisten, men talte alligevel med i en divisions kapacitet, hvilket skubbede rigtige hold en division ned. Kapaciteten tæller nu kun de rigtige hold du ser på ranglisten. Refs #962.",
        ],
      },
    ],
  },
  {
    version: "4.49",
    date: "2026-06-02",
    label: "Beta",
    changes: [
      {
        category: "Improvements · Divisions",
        items: [
          "EN · New teams now fill the highest division with room first (Division 1, then 2, then 3) instead of all starting in Division 3, so the early field meets at the top and the game feels alive from day one. Existing teams have been moved up to match. Refs #962.",
          "DA · Nye hold fylder nu den højeste division med ledig plads først (Division 1, så 2, så 3) i stedet for at alle starter i Division 3, så det tidlige felt mødes i toppen og spillet føles levende fra dag ét. Eksisterende hold er rykket op tilsvarende. Refs #962.",
        ],
      },
    ],
  },
  {
    version: "4.48",
    date: "2026-06-02",
    label: "Beta",
    changes: [
      {
        category: "Improvements · Filters",
        items: [
          "EN · The filter reset button is now always visible (greyed out until you set a filter) and shows how many filters are active, for example \"Reset all (3)\". You no longer have to discover it only after you have already filtered. Refs #960.",
          "DA · Nulstil-knappen i filtre er nu altid synlig (grå indtil du sætter et filter) og viser hvor mange filtre der er aktive, for eksempel \"Nulstil alt (3)\". Du skal ikke længere opdage den først efter du allerede har filtreret. Refs #960.",
        ],
      },
    ],
  },
  {
    version: "4.47",
    date: "2026-06-02",
    label: "Beta",
    changes: [
      {
        category: "Fixes · Loans and transfers",
        items: [
          "EN · Buying out a loaned rider while the transfer window is closed no longer counts that rider twice against your squad size. Teams that did this could be wrongly blocked from agreeing further loans or transfers until the window reopened. Refs #19.",
          "DA · At udnytte købsoptionen på en lejet rytter mens transfervinduet er lukket tæller ikke længere rytteren dobbelt mod din trupstørrelse. Hold der gjorde dette kunne fejlagtigt blive blokeret fra at indgå flere lejeaftaler eller handler indtil vinduet åbnede igen. Refs #19.",
        ],
      },
    ],
  },
  {
    version: "4.46",
    date: "2026-06-02",
    label: "Beta",
    changes: [
      {
        category: "Fixes · Dashboard and board plans",
        items: [
          "EN · The dashboard's Upcoming races list now only shows races from the current season. Races from other seasons no longer leak into the list. Refs #913.",
          "DA · Dashboardets Kommende løb viser nu kun løb fra den nuværende sæson. Løb fra andre sæsoner lækker ikke længere ind på listen. Refs #913.",
          "EN · Board plans can no longer be renegotiated once the season is more than halfway through, or in its final five race-days. You can still adjust a plan early in the season, but the option locks for the rest of the season so you cannot switch to easier targets right before the board's review. Refs #915.",
          "DA · Bestyrelsesplaner kan ikke længere genforhandles når sæsonen er mere end halvvejs, eller i de sidste fem race-days. Du kan stadig justere en plan tidligt i sæsonen, men muligheden låses resten af sæsonen, så du ikke kan skifte til lettere mål lige før bestyrelsens evaluering. Refs #915.",
        ],
      },
    ],
  },
  {
    version: "4.45",
    date: "2026-06-02",
    label: "Beta",
    changes: [
      {
        category: "Fixes · UI and notifications",
        items: [
          "EN · The rider list now updates live when a rider changes team. When a rider is sold to an AI team, the list no longer keeps showing them as Free until you reload. Refs #916.",
          "DA · Rytterlisten opdateres nu live når en rytter skifter hold. Når en rytter sælges til et AI-hold, viser listen ikke længere rytteren som Fri indtil du genindlæser. Refs #916.",
          "EN · A rumor notification (someone is looking at one of your riders) now takes you to that rider's profile when you click it, instead of the general transfers page. Refs #921.",
          "DA · En transferrygte-besked (nogen kigger på en af dine ryttere) fører dig nu til rytterens profil når du klikker, i stedet for den generelle transfer-side. Refs #921.",
          "EN · Head-to-Head team search now lists every matching team with a scrollable dropdown, instead of stopping at the first six. Refs #919.",
          "DA · Holdsøgningen i Head-to-Head viser nu alle hold der matcher i en dropdown du kan scrolle i, i stedet for at stoppe ved de første seks. Refs #919.",
          "EN · The five-year plan timeline circles now stay inside their card on narrow screens and scroll sideways if the plan is long. Refs #920.",
          "DA · De fem cirkler i femårsplanens tidslinje bliver nu inde i kortet på smalle skærme og kan scrolles sidelæns hvis planen er lang. Refs #920.",
          "EN · The bell badge now consistently shows 9+ when you have ten or more unread messages. Refs #830.",
          "DA · Klokke-badget viser nu konsekvent 9+ når du har ti eller flere ulæste beskeder. Refs #830.",
          "EN · Incoming riders now show their nationality flag when you view another team's squad, the same as the current riders. Refs #922.",
          "DA · Indkommende ryttere viser nu deres nationalitetsflag når du ser et andet holds trup, ligesom de nuværende ryttere. Refs #922.",
        ],
      },
    ],
  },
  {
    version: "4.44",
    date: "2026-06-01",
    label: "Beta",
    changes: [
      {
        category: "Economy · Rider values update when prize money is paid",
        items: [
          "EN · Rider values and salaries used to only refresh at the end of a season. Now they also recalculate the moment prize money is paid out, so this season's race prizes feed into a rider's value while the season is still running. Value stays a rolling average across the last few seasons: a finished season counts in full, and the active season counts by how far it has progressed, so values rise smoothly instead of jumping when a new season starts. Refs #895.",
          "DA · Rytter-værdier og lønninger blev før kun opdateret ved sæson-slut. Nu genberegnes de også i samme øjeblik præmiepengene udbetales, så denne sæsons løbspræmier tæller med i en rytters værdi mens sæsonen stadig kører. Værdien er stadig et rullende gennemsnit over de seneste sæsoner: en afsluttet sæson tæller fuldt, og den aktive sæson tæller efter hvor langt den er nået, så værdier stiger jævnt i stedet for at hoppe når en ny sæson starter. Refs #895.",
        ],
      },
    ],
  },
  {
    version: "4.43",
    date: "2026-06-01",
    label: "Beta",
    changes: [
      {
        category: "Admin · Race points cascade editor",
        items: [
          "EN · Race ranking points can now be tuned with a cascade model instead of editing ~900 point cells one by one. Set the master category once (Tour de France for stage races, Monuments for one-day races) and every other category scales automatically by an editable per-category factor; changing a master anchor rescales all categories that share that classification. Per-category curve shapes stay fixed. The model is seeded to reproduce today's points exactly, and the old per-cell editor remains under 'Advanced (manual)'. Admin-only. Refs #894.",
          "DA · Point pr. placering kan nu finjusteres med en kaskade-model i stedet for at redigere ~900 point-felter ét ad gangen. Sæt master-kategorien én gang (Tour de France for etapeløb, Monuments for endagsløb), og alle andre kategorier skaleres automatisk efter en redigerbar faktor pr. kategori; at ændre et master-anker omskalerer alle kategorier der deler den benævnelse. Kurveformer pr. kategori er fastlåste. Modellen er seedet til at reproducere dagens point præcist, og den gamle per-celle-editor findes stadig under 'Avanceret (manuel)'. Kun admin. Refs #894.",
        ],
      },
    ],
  },
  {
    version: "4.42",
    date: "2026-06-01",
    label: "Beta",
    changes: [
      {
        category: "Transfers · Loan agreements work while the window is closed",
        items: [
          "EN · Rider loan proposals, loan acceptances and buy-option exercises now follow the same closed-window model as transfers: managers can agree the deal while the transfer window is closed, money moves immediately, and the loan or permanent rider registration is completed when the window opens. Refs #19.",
          "DA · Rytter-lejeforslag, accept af lejeaftaler og udnyttelse af købsoption følger nu samme model som transfers udenfor vinduet: Managere kan aftale handlen mens transfervinduet er lukket, pengene flyttes med det samme, og lejen eller det permanente rytterskift registreres når vinduet åbner. Refs #19.",
        ],
      },
    ],
  },
  {
    version: "4.41",
    date: "2026-06-01",
    label: "Beta",
    changes: [
      {
        category: "Transfers · Offers work while the window is closed",
        items: [
          "EN · Direct transfer offers, listed-rider offers and swap proposals are no longer hidden behind a disabled 'transfer window closed' button. You can negotiate now; if both sides agree while the window is closed, the rider move is parked until the next opening. Loan agreements remain locked until the loan follow-up lands. Refs #19.",
          "DA · Direkte transfertilbud, tilbud på transferlistede ryttere og bytteforslag er ikke længere gemt bag en deaktiveret 'transfervindue lukket'-knap. Du kan forhandle nu; hvis begge parter bliver enige mens vinduet er lukket, parkeres rytterskiftet til næste åbning. Lejeaftaler er stadig låst indtil loan-opfølgningen er leveret. Refs #19.",
        ],
      },
      {
        category: "AI · AI-Autopilot Phase 2: Mandatory AI Review",
        items: [
          "EN · AI-Autopilot Phase 2 is now live. Loop D (Auto-PR-review) is upgraded from advisory to mandatory: every pull request must pass an automated AI review before merging. This ensures no code ships without checking for contract violations, secret leaks, and release hygiene. Loop F (Subagent-orchestration) is established for strategic coordination of large features. Refs #08.",
          "DA · AI-Autopilot Fase 2 er nu live. Loop D (Auto-PR-review) er opgraderet fra rådgivende til obligatorisk: hver pull request skal passere et automatiseret AI-review før merge. Dette sikrer, at ingen kode udgives uden tjek for kontrakt-overtrædelser, secret-leaks og udgivelses-hygiejne. Loop F (Subagent-orkestrering) er etableret til strategisk koordinering af store features. Refs #08.",
        ],
      },
      {
        category: "Board · Club DNA now comes before board members",
        items: [
          "EN · After season 1, Club DNA is now the required first step before board members appear or the first board plan can be negotiated. Board members are assigned from both your season-1 identity snapshot and chosen DNA, so voices like the Classics Purist only become a strong fit when your club direction supports it. If auto-accept has to step in, it now picks the best-matching DNA first. Refs #820.",
          "DA · Efter sæson 1 er Klub-DNA nu det obligatoriske første trin, før bestyrelsesmedlemmer vises, eller den første bestyrelsesplan kan forhandles. Bestyrelsen sammensættes ud fra både dit sæson-1 identity-snapshot og dit valgte DNA, så stemmer som Klassiker-purist kun bliver et stærkt match når klubretningen understøtter det. Hvis auto-accept må tage over, vælger den nu først det bedst matchede DNA. Refs #820.",
        ],
      },
      {
        category: "Board · Choosing Club DNA can no longer lock you out",
        items: [
          "EN · Choosing your Club DNA is now safe even if something fails halfway through. Previously, a hiccup while building your board could leave you marked as having chosen a DNA but with no board members and no way to retry. The step is now atomic and self-healing: if board setup fails it rolls back so you can choose again, and if a club was already stuck it automatically rebuilds the board on your next attempt. Refs #878.",
          "DA · Det er nu sikkert at vælge dit Klub-DNA, selv hvis noget fejler undervejs. Før kunne en fejl midt i opbygningen af din bestyrelse efterlade dig som havende valgt DNA, men uden bestyrelsesmedlemmer og uden mulighed for at prøve igen. Trinnet er nu atomisk og selv-helende: fejler opsætningen, rulles den tilbage så du kan vælge igen, og var en klub allerede låst fast, genopbygges bestyrelsen automatisk ved næste forsøg. Refs #878.",
        ],
      },
    ],
  },
  {
    version: "4.38",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Admin · Internal tools recover from connection errors",
        items: [
          "EN · Admin-only buttons for user management, race/result imports, season controls, economy actions, market pauses and webhook tests no longer get stuck if the API request fails or returns an unexpected non-JSON response. They now reset their loading state and show a clear connection or HTTP error so the action can be retried. Refs #861.",
          "DA · Admin-knapper til brugerhåndtering, løbs-/resultatimport, sæsonstyring, økonomi-handlinger, markedspauser og webhook-tests hænger ikke længere fast, hvis API-kaldet fejler eller svarer med uventet non-JSON. De nulstiller nu loading-tilstanden og viser en tydelig forbindelses- eller HTTP-fejl, så handlingen kan prøves igen. Refs #861.",
        ],
      },
    ],
  },
  {
    version: "4.37",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Riders · Season history now counts wins correctly",
        items: [
          "EN · A rider's Season history tab now counts wins correctly. It used to read only the rider's 20 most recently imported result rows, so season totals were off, and it counted every first place as a win, including days when a rider merely held a jersey. Wins now appear in their own columns (stage wins, GC wins, one-day wins, points jersey, mountain jersey) and are counted across the rider's full season. The 'Season {n}' label that showed a raw placeholder is fixed too. Refs #868.",
          "DA · En rytters Sæsonhistorik-fane tæller nu sejre korrekt. Den læste før kun rytterens 20 senest importerede resultat-rækker, så sæson-totalerne var forkerte, og den talte hver førsteplads som en sejr, også dage hvor rytteren bare bar en trøje. Sejre vises nu i egne kolonner (etapesejre, GC-sejre, klassikersejre, pointtrøje, bjergtrøje) og tælles på tværs af hele rytterens sæson. 'Sæson {n}'-mærkaten, der viste en rå placeholder, er også rettet. Refs #868.",
        ],
      },
      {
        category: "Results · Spring stage races now show every stage",
        items: [
          "EN · A few stage races used to show only their final stage, so the intermediate stages' results, points and jersey-leader days were missing. Every stage is now imported, and rider and team season totals include them. Refs #866.",
          "DA · Nogle få etapeløb viste før kun deres sidste etape, så mellem-etapernes resultater, point og trøje-leder-dage manglede. Alle etaper er nu importeret, og rytter- og hold-sæson-totaler tæller dem med. Refs #866.",
        ],
      },
    ],
  },
  {
    version: "4.36",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Board · First meeting sequence is clearer",
        items: [
          "EN · The board setup wizard now states the first meeting order directly: 5-year plan first, then 3-year plan and finally 1-year plan. Refs #818.",
          "DA · Bestyrelses-wizard'en siger nu direkte, hvilken rækkefølge første møde følger: først 5-årsplan, derefter 3-årsplan og til sidst 1-årsplan. Refs #818.",
        ],
      },
    ],
  },
  {
    version: "4.35",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Stability · Buttons no longer get stuck if the connection drops",
        items: [
          "EN · Across the game, buttons and forms that talk to the server (transfer offers, swaps and loans, board contracts and requests, taking and repaying loans, sending rider offers, and the manager and season finance screens) no longer get stuck on \"Working…\" if your connection drops or the server returns an unexpected response. They now reset and show a clear \"Connection failed. Check your internet and try again.\" message so you can try again. Refs #792.",
          "DA · I hele spillet kan knapper og formularer, der taler med serveren (transfertilbud, bytter og lejeaftaler, bestyrelseskontrakter og -anmodninger, optag og tilbagebetaling af lån, afsendelse af ryttertilbud samt manager- og sæson-finansskærmene), ikke længere hænge fast på \"Arbejder…\", hvis forbindelsen ryger, eller serveren svarer uventet. De nulstiller nu og viser en tydelig \"Forbindelsen fejlede. Tjek din internetforbindelse og prøv igen.\"-besked, så du kan prøve igen. Refs #792.",
        ],
      },
    ],
  },
  {
    version: "4.34",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Onboarding · Create-team step no longer hangs on a connection error",
        items: [
          "EN · When you set up your team for the first time, the 'Create team and start' button could get stuck on 'Saving…' with no message if the request failed to reach the server (for example on a flaky connection). It now shows a clear error and lets you try again instead of hanging. Refs #792.",
          "DA · Når du opretter dit hold første gang, kunne 'Opret hold og start'-knappen sætte sig fast på 'Gemmer…' uden besked, hvis forespørgslen ikke nåede frem til serveren (for eksempel på en ustabil forbindelse). Den viser nu en tydelig fejl og lader dig prøve igen i stedet for at gå i stå. Refs #792.",
        ],
      },
    ],
  },
  {
    version: "4.33",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Head-to-Head · Squad lists now show points riders earned racing",
        items: [
          "EN · In the Head-to-Head team comparison, the number next to each rider in the Top 5 squad lists now shows the race points that rider has actually earned across all seasons, instead of their static UCI strength rating. Earlier a rider who had raced and scored could still show 0, because the column was reading a fixed strength attribute that never updates from in-game results. The Top 5 is now ranked by those earned points (with the strength rating as a tie-breaker before any races have run). Refs #826.",
          "DA · I Head-to-Head-holdsammenligningen viser tallet ud for hver rytter i Top 5-truplisterne nu de løb-point, rytteren faktisk har optjent på tværs af alle sæsoner, i stedet for sin statiske UCI-styrkerating. Før kunne en rytter, der havde kørt og scoret, stadig stå med 0, fordi kolonnen læste et fast styrke-attribut, der aldrig opdateres fra resultater i spillet. Top 5 rangeres nu efter de optjente point (med styrkeratingen som tie-breaker, før der er kørt nogen løb). Refs #826.",
        ],
      },
    ],
  },
  {
    version: "4.32",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Riders · Clear status labels in their own column",
        items: [
          "EN · Rider status now shows as short, readable text labels (U23, U25, AI, IN, OUT) in their own dedicated column, instead of the emoji icons used before. The labels are easy to scan down a list: U23 and U25 show a rider's age group (only the youngest one that applies), AI marks AI-run teams, and IN and OUT mark riders moving in or out on a transfer. The auction history also shows whether you bought, sold or kept a rider. Hover any label for the full description. Refs #837.",
          "DA · Rytter-status vises nu som korte, læsbare tekst-labels (U23, U25, AI, IND, UD) i deres egen kolonne, i stedet for de emoji-ikoner der blev brugt før. Labelsene er nemme at skanne ned gennem en liste: U23 og U25 viser rytterens aldersgruppe (kun den yngste der gælder), AI markerer AI-styrede hold, og IND og UD markerer ryttere på vej ind eller ud i en transfer. Auktionshistorikken viser også, om du købte, solgte eller beholdt en rytter. Hold musen over et label for den fulde beskrivelse. Refs #837.",
        ],
      },
    ],
  },
  {
    version: "4.31",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Riders · One consistent colour scale for abilities everywhere",
        items: [
          "EN · Rider abilities now use one consistent colour scale everywhere you see them: rider lists, squad views, auctions, the transfer market, the watchlist, the rider page and the rider comparison. Each value gets the same colour wherever it appears, shifting smoothly from grey for low values through green, yellow and gold up to red for elite abilities. In the comparison the best rider for each ability is now highlighted as a bold, filled tag instead of being told apart by colour. Earlier the colours differed from page to page (and the rider page used a blue scale), so the same number could look different in two places. Refs #855.",
          "DA · Rytter-evner bruger nu én ensartet farveskala alle steder du ser dem: rytterlister, trup-visninger, auktioner, transfermarkedet, overvågningslisten, rytter-siden og rytter-sammenligningen. Hver værdi får samme farve uanset hvor den vises, og skifter blødt fra grå for lave værdier gennem grøn, gul og guld op til rød for elite-evner. I sammenligningen fremhæves den bedste rytter for hver evne nu som et fedt, fyldt mærke i stedet for at blive skelnet på farve. Før var farverne forskellige fra side til side (og rytter-siden brugte en blå skala), så det samme tal kunne se forskelligt ud to steder. Refs #855.",
        ],
      },
    ],
  },
  {
    version: "4.30",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Transfers · Trade while the window is closed",
        items: [
          "EN · You can now send and accept transfer offers, swaps and sale listings even when the transfer window is closed. The money moves as soon as both managers agree, but the rider only switches teams once the window opens again. Until then the deal is locked in and the rider is reserved. Direct loans still wait for the window to open, and that is coming in a follow-up. Refs #19.",
          "DA · Du kan nu sende og acceptere transfertilbud, byttehandler og salgs-listinger, selvom transfervinduet er lukket. Pengene flyttes, så snart begge managere er enige, men rytteren skifter først hold, når vinduet åbner igen. Indtil da er handlen låst, og rytteren er reserveret. Lejeaftaler venter stadig på, at vinduet åbner, og det følger i en senere opdatering. Refs #19.",
        ],
      },
    ],
  },
  {
    version: "4.29",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Squads · One shared roster cap of 30 for all divisions",
        items: [
          "EN · The maximum squad size is now 30 riders in every division. Previously the cap depended on your division (Division 1 allowed 30, Division 2 allowed 20, Division 3 allowed 10). The minimum squad sizes are unchanged (20 / 14 / 8), so Division 2 and 3 teams now have much more room to build a deeper squad. Refs #838.",
          "DA · Det maksimale antal ryttere på holdet er nu 30 i alle divisioner. Før afhang loftet af din division (Division 1 tillod 30, Division 2 tillod 20, Division 3 tillod 10). Minimumsgrænserne er uændrede (20 / 14 / 8), så hold i Division 2 og 3 har nu markant mere plads til at bygge en dybere trup. Refs #838.",
        ],
      },
    ],
  },
  {
    version: "4.28",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Auctions · Guaranteed 50% sale has been removed",
        items: [
          "EN · You can no longer start a guaranteed sale: an auction with the starting price locked to 50% of a rider's Value, where the AI bought the rider if no manager bid higher. The option has been removed from the rider page and the squad action menu, so a normal auction is now the way to put your own rider up for sale. Guaranteed sales you made earlier still show correctly in your auction history. Refs #839.",
          "DA · Du kan ikke længere starte et garanteret salg: en auktion med startprisen låst til 50% af en rytters Værdi, hvor AI'en købte rytteren hvis ingen manager bød højere. Muligheden er fjernet fra rytter-siden og holdets handlingsmenu, så en normal auktion er nu vejen til at sætte din egen rytter til salg. Garanterede salg du har lavet tidligere vises stadig korrekt i din auktionshistorik. Refs #839.",
        ],
      },
    ],
  },
  {
    version: "4.27",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Standings · Better colour contrast in light and dark mode",
        items: [
          "EN · On the standings the promotion zone (top rows) and the gold highlight for your own team used fixed colours that didn't adapt to the theme — leaving a harsh bright band on the runner-up rows in dark mode and a washed-out, hard-to-read gold in light mode. They now use the theme's own colours, so the promotion zone is subtle in dark mode (matching the relegation zone) and your team's gold stays legible in both modes. Refs #825.",
          "DA · På ranglisten brugte promotion-zonen (de øverste rækker) og guld-fremhævningen af dit eget hold faste farver, der ikke tilpassede sig temaet — det gav et grelt lyst bånd på de næstbedste rækker i dark mode og en udvasket, sværtlæselig guld i light mode. De bruger nu temaets egne farver, så promotion-zonen er afdæmpet i dark mode (som nedrykningszonen), og dit holds guld forbliver læsbar i begge temaer. Refs #825.",
        ],
      },
    ],
  },
  {
    version: "4.26",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Season Snapshot · Calendar is now sorted by date",
        items: [
          "EN · The race calendar on the Season Snapshot page was sorted alphabetically by race name. It is now sorted chronologically by race date, so the season reads top-to-bottom in the order the races are run. Your team's point-progression chart follows the same chronological order. Refs #823.",
          "DA · Løbskalenderen på Sæson Snapshot-siden var sorteret alfabetisk efter løbsnavn. Den er nu sorteret kronologisk efter løbsdato, så sæsonen kan læses oppefra og ned i den rækkefølge løbene køres. Dit holds pointudviklings-graf følger den samme kronologiske rækkefølge. Refs #823.",
        ],
      },
    ],
  },
  {
    version: "4.25",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Rankings · Owner filter now separates free agents from managed teams",
        items: [
          "EN · On the rider rankings, the \"Manager-owned\" filter used to also include free agents (riders with no team). It now shows only riders on human-managed teams, and there is a new \"Free agents\" filter so unsigned riders have their own category alongside AI-owned. Refs #777.",
          "DA · På rytterranglisten tog \"Manager-ejede\"-filteret før også fri-agenter med (ryttere uden hold). Det viser nu kun ryttere på menneske-managede hold, og der er et nyt \"Fri agenter\"-filter, så ryttere uden kontrakt har deres egen kategori ved siden af AI-ejede. Refs #777.",
        ],
      },
    ],
  },
  {
    version: "4.24",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Riders · Status badges are now compact icons with tooltips",
        items: [
          "EN · The small labels next to a rider's name (U25, auction, AI team, incoming/outgoing transfer, and the bought/sold/internal markers in your auction history) are now compact icons instead of words. Hover or focus an icon to see what it means, and screen readers announce the full label. This keeps the name column clean and uniform now that nation and team have their own columns. Refs #801.",
          "DA · De små mærkater ved siden af en rytters navn (U25, auktion, AI-hold, indgående/udgående transfer og købt/solgt/intern-markeringerne i din auktionshistorik) er nu kompakte ikoner i stedet for ord. Hold musen over eller fokusér et ikon for at se, hvad det betyder, og skærmlæsere læser den fulde tekst op. Det holder navne-kolonnen ren og ensartet, nu hvor nation og hold har deres egne kolonner. Refs #801.",
        ],
      },
    ],
  },
  {
    version: "4.23",
    date: "2026-05-31",
    label: "Beta",
    changes: [
      {
        category: "Riders · Rider name stays visible while scrolling wide tables",
        items: [
          "EN · On the stat-heavy rider tables (rider database, your squad, other squads, watchlist and the rider rankings) the name column now stays pinned to the left edge while you scroll sideways through the stat columns. You no longer lose track of which rider a value belongs to when a table is wider than the screen. Refs #799.",
          "DA · På de stat-tunge rytter-tabeller (rytterdatabase, dit hold, andres hold, ønskeliste og rytterranglisten) bliver navne-kolonnen nu stående i venstre kant, mens du scroller vandret gennem stat-kolonnerne. Du mister ikke længere overblikket over, hvilken rytter en værdi hører til, når en tabel er bredere end skærmen. Refs #799.",
        ],
      },
    ],
  },
  {
    version: "4.22",
    date: "2026-05-30",
    label: "Beta",
    changes: [
      {
        category: "Board · Open for testing with a frozen economy",
        items: [
          "EN · The board (\"bestyrelsen\") is now open for everyone to try. You can negotiate and sign your multi-year plans (5yr, then 3yr, then 1yr), make requests, and see goals and consequences play out — exactly as it will work in production. During this test period the board's effect on your economy is frozen: sponsor income is unaffected, bonus offers pay nothing real, and forced sales and sponsor pull-outs are held back, so you can explore freely without real financial consequences. The board's hard limits (salary cap and signing restrictions) do still apply on real transfers. The test data is cleared automatically at the next season change. Refs #805.",
          "DA · Bestyrelsen er nu åben for alle at prøve. Du kan forhandle og underskrive dine flerårsplaner (5 år, så 3 år, så 1 år), sende forespørgsler og se mål og konsekvenser udspille sig — præcis som det kommer til at fungere i drift. I denne testperiode er bestyrelsens effekt på din økonomi frosset: sponsorindtægten påvirkes ikke, bonustilbud udbetaler ingen rigtige penge, og tvangssalg og sponsorexit holdes tilbage, så du kan udforske frit uden reelle økonomiske konsekvenser. Bestyrelsens hårde grænser (lønloft og indkøbsrestriktioner) gælder dog stadig på rigtige transfers. Testdataene ryddes automatisk ved næste sæsonskifte. Refs #805.",
        ],
      },
    ],
  },
  {
    version: "4.21",
    date: "2026-05-30",
    label: "Beta",
    changes: [
      {
        category: "Riders · Team name is now clickable everywhere",
        items: [
          "EN · A rider's owning team is now a clickable link in more places. On the watchlist and the rider comparison view the team name used to be plain text; it now links straight to the team's profile, the same way it already does in the rider database and other tables. Free agents stay as plain text. Refs #800.",
          "DA · En rytters ejer-hold er nu et klikbart link flere steder. På ønskelisten og i rytter-sammenligningen var holdnavnet før ren tekst; det linker nu direkte til holdets profil, ligesom det allerede gør i rytterdatabasen og andre tabeller. Fri-agenter forbliver ren tekst. Refs #800.",
        ],
      },
    ],
  },
  {
    version: "4.20",
    date: "2026-05-30",
    label: "Beta",
    changes: [
      {
        category: "Season · Season progress now counts completed race days",
        items: [
          "EN · Season progress now reflects how many race days have actually been ridden. The counter was never advanced when results were imported, so it stayed at 0 even after races were finalized — and the board's plan-negotiation reminders, which key off that counter, never fired. It is now recomputed from the completed races (a one-day race counts 1 day, a stage race counts its stages) every time results are imported, and Season 1 has been backfilled. Refs #804.",
          "DA · Sæson-fremgangen afspejler nu hvor mange løbsdage der faktisk er kørt. Tælleren blev aldrig talt op når resultater blev importeret, så den blev stående på 0 selv efter løb var afviklet — og bestyrelsens påmindelser om planforhandling, der bygger på den tæller, blev derfor aldrig udløst. Den genberegnes nu ud fra de afviklede løb (et endagsløb tæller 1 dag, et etapeløb tæller sine etaper) hver gang resultater importeres, og Sæson 1 er rettet med tilbagevirkende kraft. Refs #804.",
        ],
      },
    ],
  },
  {
    version: "4.19",
    date: "2026-05-30",
    label: "Beta",
    changes: [
      {
        category: "Riders · Nation now has its own column",
        items: [
          "EN · In rider tables the flag and name used to share one wide column. The nation (flag plus 3-letter code) now sits in its own column next to the name across the rider database, your squad, other teams' squads, the watchlist, the rider rankings and the auction history. Where a rider's owning team is shown, it stays in its own column too. The name column is now narrower and the tables are easier to scan. On small screens the nation and team columns are hidden to keep the table compact.",
          "DA · I ryttertabeller delte flag og navn før én bred kolonne. Nationen (flag plus 3-bogstavskode) ligger nu i sin egen kolonne ved siden af navnet på rytterdatabasen, din trup, andre holds trupper, ønskelisten, rytterranglisten og auktionshistorikken. Hvor en rytters ejer-hold vises, bliver det også i sin egen kolonne. Navnekolonnen er nu smallere, og tabellerne er nemmere at skanne. På små skærme skjules nation- og hold-kolonnerne for at holde tabellen kompakt.",
        ],
      },
    ],
  },
  {
    version: "4.18",
    date: "2026-05-30",
    label: "Beta",
    changes: [
      {
        category: "Riders · Season history now groups by game season",
        items: [
          "EN · The Season tab on a rider's page now groups results by game season (Season 1, Season 2, ...) instead of by the race's calendar edition year. The result list under each race also shows the game season. Wins, top-3s and prize money are now totalled per season the way the standings work. Refs #793.",
          "DA · Sæson-fanen på en rytters side grupperer nu resultater efter spil-sæson (Sæson 1, Sæson 2, ...) i stedet for løbets kalender-udgaveår. Resultatlisten under hvert løb viser også spil-sæsonen. Sejre, top-3 og præmiepenge tælles nu sammen pr. sæson på samme måde som ranglisten. Refs #793.",
        ],
      },
    ],
  },
  {
    version: "4.17",
    date: "2026-05-30",
    label: "Beta",
    changes: [
      {
        category: "Riders · Race result history now shows on the rider page",
        items: [
          "EN · The Results tab on a rider's page now lists that rider's race results again, and the Season tab counts their wins, top-3s and prize money. The query was asking for a race date field that no longer exists, which made the whole request fail and left both tabs empty. It now reads the race edition year and finishing rank correctly. Refs #780.",
          "DA · Resultat-fanen på en rytters side viser nu rytterens løbsresultater igen, og Sæson-fanen tæller sejre, top-3 og præmiepenge. Forespørgslen bad om et løbsdato-felt der ikke længere findes, hvilket fik hele kaldet til at fejle og efterlod begge faner tomme. Den læser nu løbets udgaveår og placering korrekt. Refs #780.",
        ],
      },
    ],
  },
  {
    version: "4.16",
    date: "2026-05-30",
    label: "Beta",
    changes: [
      {
        category: "Results · Standings, results and dashboard now update live",
        items: [
          "EN · The standings, results hub and dashboard now refresh on their own when new race results come in — no more hard reload to see updated points, season progress or top riders. Previously these pages only loaded once when opened, so they could show stale numbers after a race was finalized. Refs #783.",
          "DA · Ranglisten, resultat-hubben og dashboardet opdaterer nu af sig selv når nye løbsresultater kommer ind — ingen hård genindlæsning mere for at se opdaterede point, sæson-fremskridt eller top-ryttere. Tidligere indlæste siderne kun data én gang ved åbning, så de kunne vise gamle tal efter et løb var finaliseret. Refs #783.",
        ],
      },
    ],
  },
  {
    version: "4.15",
    date: "2026-05-30",
    label: "Beta",
    changes: [
      {
        category: "Admin · PCM-resultatimport (sæson 1)",
        items: [
          "EN · Admins can now import race results directly from Pro Cycling Manager export files. For stage races you select all stage files at once — the pipeline orders the stages itself, awards stage-finish points every stage, jersey-leader points on intermediate stages (for holding the leader's jersey that day), and pays out the full general classification, jerseys and team result only on the final stage. One-day races are just one file. Riders are matched to their owner team by exact name (accent-tolerant); team results map through a manually verified PCM→game team-name table. Always dry-run preview first — it shows points, prize money and flags any unmatched riders that would otherwise score. Re-import cleanly replaces a race's results. Player-facing results pages are unchanged; this is an admin import tool.",
          "DA · Admins kan nu importere løbsresultater direkte fra Pro Cycling Manager-eksportfiler. For etapeløb vælger du alle etape-filer på én gang — pipelinen finder selv etape-rækkefølgen, giver etape-point hver etape, trøje-leder-point på mellemetaper (for at holde førertrøjen den dag), og udbetaler først hele klassementet, trøjerne og holdresultatet på sidste etape. Endagsløb er bare én fil. Ryttere matches til deres ejer-hold på præcist navn (accent-tolerant); holdresultater mappes via en manuelt verificeret PCM→game-holdnavn-tabel. Forhåndsvis altid først — det viser point, præmiepenge og markerer evt. umatchede ryttere der ellers ville score. Re-import erstatter et løbs resultater rent. Spillervendte resultatsider er uændrede; dette er et admin-importværktøj.",
        ],
      },
    ],
  },
  {
    version: "4.14",
    date: "2026-05-30",
    label: "Beta",
    changes: [
      {
        category: "Localization · Hall of Fame now switches fully to English",
        items: [
          "EN · The Hall of Fame page — record categories, manager titles, the division-history view and all table labels — now displays fully in English when the app language is set to English. Previously these showed Danish text regardless of the selected language. Refs #678.",
          "DA · Hall of Fame-siden — rekordkategorier, manager-titler, divisionshistorik-visningen og alle tabel-labels — vises nu fuldt på engelsk når appens sprog er sat til engelsk. Tidligere viste disse dansk tekst uanset det valgte sprog. Refs #678.",
        ],
      },
    ],
  },
  {
    version: "4.13",
    date: "2026-05-29",
    label: "Beta",
    changes: [
      {
        category: "Localization · More pages now switch fully to English",
        items: [
          "EN · Profile, Activity, Watchlist, Standings, Head-to-Head, the team and manager pages, rider rankings and comparison, and the season finance report now display fully in English when the app language is set to English. Previously these pages showed Danish labels regardless of the selected language. Refs #678.",
          "DA · Profil, Aktivitet, Ønskeliste, Rangliste, Head-to-Head, hold- og managersiderne, rytterrangliste og -sammenligning samt sæson-finansrapporten vises nu fuldt på engelsk når appens sprog er sat til engelsk. Tidligere viste disse sider danske labels uanset det valgte sprog. Refs #678.",
        ],
      },
    ],
  },
  {
    version: "4.12",
    date: "2026-05-29",
    label: "Beta",
    changes: [
      {
        category: "Reliability · Admin result import no longer crashes on an expired session",
        items: [
          "EN · Importing race results from the admin panel now shows a clear \"session expired — log in again\" message if your login expired mid-upload, instead of throwing a silent error and leaving the import stuck. Admin-only; no change for managers. Refs #761.",
          "DA · Import af løbsresultater fra admin-panelet viser nu en tydelig \"session udløbet — log ind igen\"-besked hvis dit login udløb midt i en upload, i stedet for at kaste en stille fejl og efterlade importen hængende. Kun admin; ingen ændring for managers. Refs #761.",
        ],
      },
    ],
  },
  {
    version: "4.11",
    date: "2026-05-29",
    label: "Beta",
    changes: [
      {
        category: "Reliability · Stale-chunk recovery now covers initial page load",
        items: [
          "EN · The stale-tab reload guard (added in 4.09) now also fires when a chunk fails to load before React itself has initialised — for example when the Layout or a large top-level module cannot be fetched after a deploy. Previously that case could leave the page blank with no recovery attempt. Refs #728.",
          "DA · Stale-tab genindlæs-sikringen (tilføjet i 4.09) aktiveres nu også når en chunk fejler inden React selv er initialiseret — fx når Layout eller et stort top-level modul ikke kan hentes efter et deploy. Tidligere kunne den situation efterlade siden blank uden genindlæsningsforsøg. Refs #728.",
        ],
      },
    ],
  },
  {
    version: "4.10",
    date: "2026-05-28",
    label: "Beta",
    changes: [
      {
        category: "Reliability · UCI safety-gate also catches zero-point matches",
        items: [
          "EN · The weekly UCI value sync now protects high-value riders even when the upstream ranking matches their name but reports 0 points. That case now reuses the existing safety-gate instead of overwriting stars to the minimum value, adding another guard after the May 27 PCS decimal-points incident. Refs #702.",
          "DA · Den ugentlige UCI-værdi-sync beskytter nu high-value ryttere selv når upstream-ranglisten matcher navnet men returnerer 0 point. Den situation genbruger nu den eksisterende safety-gate i stedet for at overskrive stjerner til minimumsværdi, som ekstra værn efter PCS-decimaltal-hændelsen 27. maj. Refs #702.",
        ],
      },
    ],
  },
  {
    version: "4.09",
    date: "2026-05-27",
    label: "Beta",
    changes: [
      {
        category: "Reliability · Blank crash screens now explain what happened",
        items: [
          "EN · If the frontend crashes, Cycling Zone no longer leaves you on an empty beige screen. The global error screen now explains that something went wrong, gives you a reload action, and includes an error ID when Sentry provides one. Stale-tab deploy errors are handled separately: if your browser still has an older app version open and a lazy-loaded page chunk can no longer be fetched, the app attempts one safe reload instead of trapping you on a blank page. Refs #711.",
          "DA · Hvis frontend'en crasher, efterlader Cycling Zone dig ikke længere på en tom beige skærm. Den globale fejlside forklarer nu at noget gik galt, giver dig en genindlæs-knap, og viser et fejl-id når Sentry leverer et. Stale-tab deploy-fejl håndteres særskilt: hvis din browser stadig har en ældre app-version åben og en lazy-loaded side-chunk ikke længere kan hentes, prøver appen én sikker genindlæsning i stedet for at fange dig på en blank side. Refs #711.",
        ],
      },
    ],
  },
  {
    version: "4.08",
    date: "2026-05-27",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Achievements sync no longer fails for teams with multiple board plans",
        items: [
          "EN · Achievement sync now handles the parallel board-plan model correctly. Managers with 5yr/3yr/1yr board plans no longer get `/api/achievements/check` failures from the old single-board-profile assumption, so bids, transfers, watchlist actions and login-triggered achievement checks can unlock normally again.",
          "DA · Achievement-syncen håndterer nu den parallelle bestyrelsesplan-model korrekt. Managers med 5yr/3yr/1yr-planer får ikke længere `/api/achievements/check`-fejl fra den gamle antagelse om én board-profile pr. hold, så bud, transfers, ønskeliste-handlinger og login-triggerede achievement-checks kan låse op normalt igen.",
        ],
      },
    ],
  },
  {
    version: "4.07",
    date: "2026-05-27",
    label: "Beta",
    changes: [
      {
        category: "Language · Club DNA text now follows EN/DA on the board page",
        items: [
          "EN · Club DNA names, descriptions, suggestion rationales and tradition-goal labels on the Board page now render through the board translation namespace instead of backend Danish strings. English mode now shows the season-2 DNA choices fully in English while Danish keeps the original tone. Refs #695.",
          "DA · Klub-DNA-navne, beskrivelser, forslagstekster og tradition-mål på Bestyrelse-siden renderes nu via board-oversættelser i stedet for danske backend-strenge. Engelsk mode viser nu sæson-2 DNA-valgene fuldt på engelsk, mens dansk bevarer den oprindelige tone. Refs #695.",
        ],
      },
    ],
  },
  {
    version: "4.06",
    date: "2026-05-27",
    label: "Beta",
    changes: [
      {
        category: "Language · Country names now follow EN/DA on rider screens",
        items: [
          "EN · Country names in the rider filter dropdown, active country filter chip, rider detail nationality line and flag tooltips now follow the active language. English mode now shows names like Slovenia, Austria and United Arab Emirates instead of the Danish labels, and the country dropdown sorts by the visible localized names. Refs #649.",
          "DA · Landenavne i rytter-filterets dropdown, aktivt land-filter, rytter-detailens nationalitetslinje og flag-tooltips følger nu aktivt sprog. Engelsk mode viser nu navne som Slovenia, Austria og United Arab Emirates i stedet for danske labels, og land-dropdownen sorterer efter de synlige lokaliserede navne. Refs #649.",
        ],
      },
    ],
  },
  {
    version: "4.05",
    date: "2026-05-27",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Rider values are accurate again — 296 riders restored after broken UCI sync",
        items: [
          "EN · This morning's scheduled UCI value-update accidentally reset 319 riders to the minimum (5 UCI points / 20.000 CZ$), including stars like Vingegaard, Evenepoel, Pidcock, Pedersen, Bernal and Almeida. Root cause: the upstream PCS library silently returns `0` instead of decimal points (e.g. Vingegaard's `6885.1` became `0`), and our safety-gate didn't catch it because the riders WERE matched — just to a zero. We now also parse the raw PCS HTML to recover decimal points, so Vingegaard is back to 6885 and the other 295 affected riders are restored. Forward-guard: two new unit tests verify decimal parsing won't regress. Refs PR #700.",
          "DA · Værdi-opdateringen i morges nullstillede ved et uheld 319 ryttere til minimum (5 UCI-point / 20.000 CZ$), inkl. stjerner som Vingegaard, Evenepoel, Pidcock, Pedersen, Bernal og Almeida. Rod-årsag: PCS-biblioteket returnerer stille `0` i stedet for decimaltal-points (fx Vingegaards `6885.1` blev til `0`), og vores safety-gate fangede det ikke fordi rytterne BLEV matched — bare mod et nul. Vi parser nu også rå PCS-HTML for at recovere decimaltal, så Vingegaard er tilbage på 6885 og de andre 295 berørte ryttere er gendannet. Forward-guard: to nye unit-tests sikrer decimal-parsingen ikke regresserer. Refs PR #700.",
        ],
      },
    ],
  },
  {
    version: "4.04",
    date: "2026-05-26",
    label: "Beta",
    changes: [
      {
        category: "UI · Rider value header no longer breaks awkwardly on mobile",
        items: [
          "EN · The rider detail header no longer uses character-by-character wrapping for the value number on narrow screens. Long locale-formatted values now stay on one tidy line with overflow protection, while the full CZ$ value remains available on hover/title. Refs #655.",
          "DA · Rytter-detail-headeren bruger ikke længere tegn-for-tegn linjeskift for værdien på smalle skærme. Lange locale-formaterede værdier bliver nu på én ryddelig linje med overflow-beskyttelse, mens den fulde CZ$-værdi stadig findes i hover/title. Refs #655.",
        ],
      },
    ],
  },
  {
    version: "4.03",
    date: "2026-05-26",
    label: "Beta",
    changes: [
      {
        category: "Language · Mobile bottom-nav + 6 player-facing screens now switch labels with the language toggle",
        items: [
          "EN · The mobile bottom-nav (Inbox / Market / Riders / My Team) stayed hard-coded Danish even when the language was set to English — it was the parallel mobile-version of the desktop sidebar but never got migrated when the rest of the navigation was. Fixed. Plus a sweep of six other screens that still had a few hard-coded Danish labels: the Manager Profile's rider-count stat, the Auction History page heading, the Deadline Day table's column header, the Activity page's Auctions + Watchlist filter tabs, the Season Preview's per-team rider-count stat, and the Admin area's Finance tab. All of them now follow the active language. A new CI guard (`i18n-check-nav-strings.mjs`) blocks future regressions: any new label literal in a Nav / Sidebar / Layout component fails the build until it's wired through i18n. Refs #678.",
          "DA · Mobile bottom-nav'en (Indbakke / Marked / Ryttere / Mit Hold) forblev hard-kodet dansk selv når sproget var sat til engelsk — det var den parallelle mobile-version af desktop-sidebaren, men blev aldrig migreret da resten af navigationen blev oversat. Rettet. Plus en oprydning af seks andre skærme der stadig havde nogle få hard-kodede danske labels: Manager-profilens rytter-antal-stat, Auktionshistorik-sidens overskrift, Deadline Day-tabellens kolonne-header, Aktivitet-sidens Auktioner + Ønskeliste-filterfaner, Sæson Preview's pr-hold rytter-antal-stat, og Admin-områdets Økonomi-fane. Alle følger nu aktivt sprog. En ny CI-guard (`i18n-check-nav-strings.mjs`) blokerer fremtidige regressioner: enhver ny label-literal i en Nav / Sidebar / Layout-komponent fejler bygget indtil den er wired igennem i18n. Refs #678.",
        ],
      },
    ],
  },
  {
    version: "4.02",
    date: "2026-05-26",
    label: "Beta",
    changes: [
      {
        category: "Language · Backend-generated messages now follow the active language (finance warnings, transactions, board notifications)",
        items: [
          "EN · The finance forecast card's warnings (debt-near-cap, salary-exceeds-sponsor, debt-trend), the transaction history rows (sponsor income, salaries, interest, division bonus, loans received and repaid, emergency loan, loan fees, loan interest, squad fines) and the in-app notifications (board plan expired, mid-plan review, season report, chairman replaced, forced rider listing, sponsor pullout, bonus offer, division promotion/relegation, T-3/T-1 plan reminders, auto-accept, autobid placed, loan created, emergency loan, loan paid off) used to be hard-coded Danish strings in the backend libraries, which leaked through to EN-mode players on the Finance page and in the inbox. Backend now emits a structured `{ code, params }` payload per event; the frontend renders it via the new `backendMessages` i18n namespace with locale-aware number formatting. Same content, properly translated. Closes the final blocker for the Tour de France 2026 EN-mode launch on June 20. Refs #666.",
          "DA · Finansprognose-kortets advarsler (gæld-tæt-på-loft, løn-overstiger-sponsor, gælds-trend), transaktionshistorikkens rækker (sponsorindtægt, lønninger, renter, divisionsbonus, lån modtaget og tilbagebetalt, nødlån, lejegebyrer, lånerenter, trupbøder) og in-app-notifikationerne (bestyrelsesplan udløbet, halvvejs-evaluering, sæsonrapport, formand udskiftet, tvunget rytter-listing, sponsor-pullout, bonus-tilbud, op-/nedrykning, T-3/T-1 plan-påmindelser, auto-accept, autobud afgivet, lån oprettet, nødlån, lån tilbagebetalt) var hard-kodede danske strenge i backend-bibliotekerne, hvilket lækkede igennem til EN-mode-spillere på Finanser-siden og i indbakken. Backend udsender nu en struktureret `{ code, params }`-payload pr. event; frontend renderer via den nye `backendMessages` i18n-namespace med locale-aware tal-formattering. Samme indhold, korrekt oversat. Lukker den sidste blocker for Tour de France 2026 EN-mode-launch 20. juni. Refs #666.",
        ],
      },
    ],
  },
  {
    version: "4.01",
    date: "2026-05-26",
    label: "Beta",
    changes: [
      {
        category: "Language · Numbers and dates now follow the active language across 21 player-facing screens",
        items: [
          "EN · Across 21 player-facing screens (auction history, head-to-head, standings, season-end, rider rankings, race history, race points, results, manager profile, team profile, watchlist, races, hall of fame, activity, season preview, season finance report, teams, privacy policy, plus the price-change modal and the auction confetti), every number and date was previously hard-coded to Danish formatting (`1.234.567` thousand-separators, `26-05-2026` date order). Now they delegate to the locale-aware `formatNumber()`, `formatDate()` and `formatDateTime()` helpers and follow the active i18next language. In English you now see `1,234,567` and `May 26, 2026`; in Danish it still renders `1.234.567` and `26. maj 2026`. Foundation step toward the Tour de France 2026 EN-mode launch on June 20. Refs #678.",
          "DA · På tværs af 21 spiller-rettede skærme (auktionshistorik, head-to-head, ranglister, sæson-slut, rytter-ranglister, løbshistorik, point-side, resultater, manager-profil, hold-profil, ønskeliste, løbsoversigt, hall of fame, aktivitet, sæson-preview, sæson-finansrapport, holdoversigt, privatlivspolitik plus pris-ændrings-modalen og auktions-konfetti) var hvert tal og hver dato hard-kodet til dansk format (`1.234.567` tusind-separatorer, `26-05-2026` dato-rækkefølge). Nu kalder de de locale-aware `formatNumber()`, `formatDate()` og `formatDateTime()`-helpers og følger aktivt i18next-sprog. På engelsk ser du nu `1,234,567` og `May 26, 2026`; på dansk renderer det stadig `1.234.567` og `26. maj 2026`. Fundamentskridt frem mod Tour de France 2026 EN-mode-launch 20. juni. Refs #678.",
        ],
      },
    ],
  },
  {
    version: "4.00",
    date: "2026-05-25",
    label: "Beta",
    changes: [
      {
        category: "Language · EN/DA support extended to Finance page",
        items: [
          "EN · The Finance page now renders in both English and Danish via the language switcher. This covers the balance, debt and prize-money KPIs, the season forecast card (including the 1-5 season horizon selector and the multi-season table), the first-visit explainer card with the four cashflow streams, the onboarding tour for balance/debt-ceiling/transaction history, the active-loans list (principal, interest, seasons remaining, repayment flow), the take-out-loan form (fee, interest, total preview), the loan-terms table per division, and the full transaction history with all 12 transaction types (sponsor, salary, transfer in/out, loan received/repayment/interest, emergency loan, prize, bonus, admin adjustment, interest). Numbers follow the active language (1,500 in EN, 1.500 in DA). Em-dashes replaced with sentences per tone-of-voice guide. Phase 3.5 of the i18n rollout (#483). Refs #489.",
          "DA · Finanser-siden rendres nu på både engelsk og dansk via sprog-vælgeren. Det dækker balance-, gæld- og præmiepenge-KPI'erne, sæsonprognose-kortet (inkl. 1-5 sæsons-horisont-vælgeren og multi-sæson-tabellen), første-besøgs-explainerkortet med de fire pengestrømme, onboarding-touren for balance/gældsloft/transaktionshistorik, aktive-lån-listen (hovedstol, rente, sæsoner tilbage, tilbagebetalings-flow), optag-lån-formularen (gebyr, rente, total-preview), lånebetingelser-tabellen pr. division, og fuld transaktionshistorik med alle 12 transaktionstyper (sponsor, løn, transfer ind/ud, lån modtaget/rate/renter, nødlån, præmie, bonus, admin justering, renter). Tal følger aktivt sprog (1,500 i EN, 1.500 i DA). Em-dashes erstattet med sætninger jf. tone-of-voice-guide. Fase 3.5 i i18n-udrulningen (#483). Refs #489.",
        ],
      },
    ],
  },
  {
    version: "3.99",
    date: "2026-05-25",
    label: "Beta",
    changes: [
      {
        category: "Infrastructure · RTL-readiness foundation (no visible LTR change)",
        items: [
          "EN · Internal refactor: 88 Tailwind `ml-*/mr-*` margin classes across 43 files migrated to logical-property equivalents `ms-*/me-*` (margin-inline-start/end). In English and Danish (left-to-right) the layout is pixel-identical — no user-visible change. This is a foundation step that lets future right-to-left languages (Arabic, Hebrew) mirror correctly without per-component fixes. An ESLint rule blocks future regressions back to the old left/right classes. Refs #438 #409.",
          "DA · Intern refaktor: 88 Tailwind `ml-*/mr-*` margin-klasser på tværs af 43 filer migreret til logical-property-varianterne `ms-*/me-*` (margin-inline-start/end). På engelsk og dansk (venstre-til-højre) er layoutet pixel-identisk — ingen brugerrettet ændring. Det er et fundamentsskridt der gør at fremtidige højre-til-venstre-sprog (arabisk, hebraisk) kan spejles korrekt uden per-komponent-fixes. En ESLint-regel blokerer fremtidig regression tilbage til de gamle venstre/højre-klasser. Refs #438 #409.",
        ],
      },
    ],
  },
  {
    version: "3.98",
    date: "2026-05-25",
    label: "Beta",
    changes: [
      {
        category: "Language · Rider values now follow the active language everywhere",
        items: [
          "EN · The `formatCz()` helper that renders every rider value, balance and CZ$-amount across the app (rider detail header, comparisons, transfers, watchlist, admin, season preview) was hard-coded to Danish thousand-separators (`46.520.000`), so EN-mode users saw period-separated numbers instead of `46,520,000`. Now the helper delegates to the locale-aware `formatNumber()` and picks up the i18next language. Same fix applied to the rider development chart's tooltip (`toLocaleString(\"da-DK\")` → `formatNumber()`) and its date axis. Refs #650.",
          "DA · Hjælpe-funktionen `formatCz()` der renderer hver rytter-værdi, saldo og CZ$-beløb i appen (rytter-detail-header, sammenligning, transfers, ønskeliste, admin, sæson-preview) var hard-kodet til danske tusind-separatorer (`46.520.000`), så EN-brugere så punktum-separerede tal i stedet for `46,520,000`. Nu kalder den den locale-aware `formatNumber()` og følger i18next-sproget. Samme fix på rytter-udviklings-grafens tooltip (`toLocaleString(\"da-DK\")` → `formatNumber()`) og dens dato-akse. Refs #650.",
        ],
      },
    ],
  },
  {
    version: "3.97",
    date: "2026-05-25",
    label: "Beta",
    changes: [
      {
        category: "UI · Active-auction badge background was invisible",
        items: [
          "EN · The orange \"Active auction\" pill next to a rider's name in the Riders table and on the rider detail page had a broken Tailwind opacity class (`bg-cz-accent/100/15` is not valid syntax — two opacity modifiers chained), so the background rendered as transparent and only the orange text was visible. Fixed to `bg-cz-accent/15` so the pill has the intended 15%-opacity accent background, matching every other accent-pill on the site. Refs #647.",
          "DA · Den orange \"Aktiv auktion\"-pille ved siden af en rytters navn i Rytter-tabellen og på rytter-detail-siden havde en kaput Tailwind opacity-klasse (`bg-cz-accent/100/15` er ikke gyldig syntaks — to opacity-modifiers kædet sammen), så baggrunden rendrede transparent og kun den orange tekst var synlig. Rettet til `bg-cz-accent/15` så pillen har den tiltænkte 15%-opacity accent-baggrund, ligesom alle andre accent-piller på siden. Refs #647.",
        ],
      },
    ],
  },
  {
    version: "3.96",
    date: "2026-05-25",
    label: "Beta",
    changes: [
      {
        category: "Language · EN/DA support extended to Team page",
        items: [
          "EN · The Team page now renders in both English and Danish via the language switcher. This covers the squad table (14 rider attributes, transfer/loan tags, action buttons), the Economy tab (KPI cards, season forecast, transaction breakdown, full history table with all transaction types: prize money, sponsor income, sales, purchases, salaries, interest), the rider action modal (auction, transfer list, guaranteed sale with full descriptions), and the transfer-window status badge. Numbers and dates follow the active language. Em-dashes replaced with sentences per tone-of-voice guide. Phase 3.5 of the i18n rollout (#483). Refs #488.",
          "DA · Hold-siden rendres nu på både engelsk og dansk via sprog-vælgeren. Det dækker trup-tabellen (14 rytter-attributter, transfer/leje-tags, handlingsknapper), Økonomi-fanen (KPI-kort, sæsonprognose, transaktions-fordeling, fuld historik-tabel med alle transaktionstyper: præmiepenge, sponsorindtægt, salg, køb, lønninger, renter), rytter-handlingsmodalen (auktion, transferliste, garanteret salg med fulde beskrivelser) og transfervindue-status-badge. Tal og datoer følger aktivt sprog. Em-dashes erstattet med sætninger jf. tone-of-voice-guide. Fase 3.5 i i18n-udrulningen (#483). Refs #488.",
        ],
      },
    ],
  },
  {
    version: "3.95",
    date: "2026-05-25",
    label: "Beta",
    changes: [
      {
        category: "Language · EN/DA support extended to rider detail, inbox, riders database",
        items: [
          "EN · Three large pages now render in both English and Danish via the language switcher: Rider detail (full skill breakdown across 14 attributes, bid and transfer flows, season history, tabs), Inbox (filters, all notification types with proper plurals, time-relative strings), and Riders database (search, all 14 skill filters, watchlist toggle, onboarding tour, empty-state). Bonus: the shared rider-filter component used across Auctions, Transfers, Watchlist, Team and Riders also picks up its translations. Numbers, currency and dates follow the active language. Phase 3.5 of the i18n rollout (#483). Refs #485 #486 #487.",
          "DA · Tre store sider rendres nu på både engelsk og dansk via sprog-vælgeren: Rytter-detail (skill-overblik på 14 attributter, bud- og transfer-flows, sæsonhistorik, faner), Indbakke (filtre, alle notifikationstyper med korrekt flertal, relativ tid) og Rytter-database (søgning, alle 14 skill-filtre, ønskeliste-toggle, onboarding-tur, tom-state). Bonus: den delte filter-komponent som bruges på Auktioner, Transfers, Ønskeliste, Hold og Ryttere får også oversættelser med. Tal, valuta og datoer følger aktivt sprog. Fase 3.5 i i18n-udrulningen (#483). Refs #485 #486 #487.",
        ],
      },
    ],
  },
  {
    version: "3.94",
    date: "2026-05-25",
    label: "Beta",
    changes: [
      {
        category: "Observability · Improved error tracking (user-context)",
        items: [
          "EN · Improved error tracking: we can now see how many unique users are affected by a given error. After login (both fresh sign-in and session-restore) and on token-refresh, the frontend tags every Sentry event with your account ID (UUID only — no email, no team name, no personal data). The backend does the same on every authenticated API request. On logout, the user-context is cleared. Until now, Sentry's \"Affected users\" counter was stuck at 0 on every issue because no user identity was attached, so we couldn't tell whether a bug hit one tester or twenty. Refs #621 #348.",
          "DA · Forbedret fejl-tracking: vi kan nu se hvor mange unikke brugere der rammes af en given fejl. Efter login (både fresh sign-in og session-restore) samt ved token-refresh tagger frontend hver Sentry-event med dit konto-ID (KUN UUID — ingen email, ingen holdnavn, ingen personlige data). Backend gør det samme på hvert authenticated API-kald. Ved logout ryddes user-context. Indtil nu sad Sentry's \"Affected users\"-counter på 0 for hver issue fordi ingen bruger-identitet var attached, så vi kunne ikke se om en bug ramte én tester eller tyve. Refs #621 #348.",
        ],
      },
    ],
  },
  {
    version: "3.93",
    date: "2026-05-24",
    label: "Beta",
    changes: [
      {
        category: "Reliability · Squad-enforcement partial-failure recovery",
        items: [
          "EN · Backend-only reliability fix for the squad-size enforcement cron (the system that auto-buys/sells riders and fines you if your squad is outside the per-division limits when a transfer window closes). Before #606: if the cron process died mid-loop (Railway deploy, OOM), the window was marked as 'done' even though only some teams had been enforced — the unhandled teams stayed outside squad-limits forever with no fine. Fix: two-phase claim (started_at + completed_at) with stale-claim recovery after 10 minutes, plus per-team idempotency_key on fines so replay can't double-fine. Cron-audit verdict updated from 🔴 to ✅. Refs #606.",
          "DA · Backend-only reliability-fix for squad-size enforcement cron (systemet der auto-køber/sælger ryttere og bøder dig hvis din trup er uden for division-grænserne ved window-close). Før #606: hvis cron-processen døde midt i loopen (Railway-deploy, OOM), blev windowet markeret som 'færdig' selvom kun halvdelen af holdene var enforced — de manglende hold forblev uden for squad-limits permanent uden bøde. Fix: to-faset claim (started_at + completed_at) med stale-recovery efter 10 minutter, plus per-team idempotency_key på bøder så replay ikke kan double-fine. Cron-audit-verdict opdateret fra 🔴 til ✅. Refs #606.",
        ],
      },
    ],
  },
  {
    version: "3.92",
    date: "2026-05-22",
    label: "Beta",
    changes: [
      {
        category: "Performance · XLSX lazy-loading on /races",
        items: [
          "EN · The @e965/xlsx library (~493 kB) is now loaded on demand when a user triggers a file upload on the Races page, instead of being bundled into the initial route chunk. The RacesPage initial chunk drops from ~392 kB to ~28 kB. Upload functionality is unchanged. Refs #521.",
          "DA · @e965/xlsx-biblioteket (~493 kB) indlæses nu on demand, når en bruger uploader en fil på Races-siden, i stedet for at være inkluderet i det initiale route-chunk. RacesPage initial chunk falder fra ~392 kB til ~28 kB. Upload-funktionalitet er uændret. Refs #521.",
        ],
      },
    ],
  },
  {
    version: "3.91",
    date: "2026-05-22",
    label: "Beta",
    changes: [
      {
        category: "Security · Race-result submit blev atomisk + RLS strammet på pending_race_result_rows",
        items: [
          "EN · Two-in-one fix on the manager-driven race-result upload flow (#518). (1) Atomicity: the frontend previously inserted the parent pending_race_results row and the child pending_race_result_rows in two separate Supabase calls with no transaction — if the second call failed, an orphan parent row was left in the DB. The whole submit now goes through a single Postgres RPC submit_race_results(p_race_id, p_rows jsonb) that wraps both inserts in one transaction. (2) RLS lockdown: pending_race_result_rows had INSERT WITH CHECK (true) and SELECT USING (true), meaning any authenticated user could (a) read every other manager's pending submissions and (b) inject fake rows under anyone else's pending_id. Both policies replaced with owner-or-admin-gated equivalents that join to the parent row to verify submitted_by = auth.uid() (or is_admin()). Live-verified with two impersonated user sessions: user B sees 0 rows from user A's submission (was: all rows), and user B's direct INSERT under user A's pending_id is rejected with RLS violation 42501 (was: silent success). Admin approve/reject workflow unaffected — backend uses service_role which bypasses RLS. This clears the last rls_policy_always_true advisor warning. Refs #518.",
          "DA · To-i-én fix på det manager-drevne race-result upload flow (#518). (1) Atomicity: frontend inserterede tidligere parent pending_race_results og børnene pending_race_result_rows i to separate Supabase-kald uden transaction — fejlede andet kald, var en orphan parent-row efterladt i DB. Hele submit går nu via en enkelt Postgres-RPC submit_race_results(p_race_id, p_rows jsonb) der wrapper begge inserts i én transaction. (2) RLS-lockdown: pending_race_result_rows havde INSERT WITH CHECK (true) og SELECT USING (true), så enhver authenticated user kunne (a) læse alle andre managers' pending submissions og (b) injicere fake rows under andres pending_id. Begge policies erstattet med owner-or-admin-gated equivalents der joiner til parent for at verificere submitted_by = auth.uid() (eller is_admin()). Live-verificeret med to impersonerede user-sessioner: user B ser 0 rows fra user A's submission (var: alle rows), og user B's direkte INSERT under user A's pending_id afvises med RLS-violation 42501 (var: silent success). Admin approve/reject upåvirket — backend bruger service_role som bypasser RLS. Sidste rls_policy_always_true advisor-warning er nu væk. Refs #518.",
        ],
      },
    ],
  },
  {
    version: "3.90",
    date: "2026-05-22",
    label: "Beta",
    changes: [
      {
        category: "Security · RLS permissive policy lockdown + users PII leak fix",
        items: [
          "EN · Five-in-one security hardening pass following the #548 RLS correctness audit. Five Row-Level Security policies named \"Service role full access X\" were technically scoped to the `public` PostgreSQL role, which in Postgres semantics means ALL roles — so any signed-in user could write through them. Verified exploits on prod (rolled back): random auth user could (1) INSERT/UPDATE/DELETE any team's loans, (2) UPDATE loan_config — changing interest rates and debt ceilings for ALL teams in the game, (3) INSERT phishing notifications targeting any user (\"You won $100k, click: evil.com\" — would appear as official in-app notification), (4) INSERT fake activity feed entries for any team, (5) INSERT fake admin_log entries (blocked only by CHECK constraint as defense-in-depth, not RLS). Plus a sixth, unrelated finding from the same audit: the \"Public read basic user info\" policy on the users table exposed EVERY column (email × 24, discord_id × 14, consent_preferences) to ANY authenticated user — a GDPR/doxxing risk. Fix migration applied to prod 2026-05-22: all 5 permissive policies rescoped to `TO service_role` (which is the only role that should be writing system tables — service_role bypasses RLS anyway, so this is the correct \"only service can write\" idiom), and the users policy was replaced with an admin-only cross-user read via the existing `is_admin()` SECURITY DEFINER function. Post-fix advisor: 15 → 10 findings (-33%). All flows verified: admins still see all users + emails, normal users only see their own profile. Refs #548. Audit: docs/RLS_AUDIT_2026-05-22.md. Postmortem: .claude/learnings/2026-05-22-rls-permissive-public-policies.md.",
          "DA · Fem-i-én sikkerhedshærdning efter #548 RLS correctness audit. Fem Row-Level Security policies med navne som \"Service role full access X\" var teknisk scopet til `public` PostgreSQL-rollen, hvilket i Postgres-semantik betyder ALLE roller — så enhver logget-ind bruger kunne skrive via dem. Verificerede exploits på prod (rullet tilbage): random auth user kunne (1) INSERT/UPDATE/DELETE ethvert holds lån, (2) UPDATE loan_config — ændre renter og gældslofter for ALLE hold i spillet, (3) INSERT phishing-notifikationer rettet mod enhver bruger (\"Du har vundet $100k, klik: evil.com\" — ville fremstå som official in-app-notifikation), (4) INSERT fake activity-feed-entries for ethvert hold, (5) INSERT fake admin_log-entries (blokeret kun af CHECK-constraint som defense-in-depth, ikke RLS). Plus et sjette, urelateret fund fra samme audit: \"Public read basic user info\"-policy på users-tabellen eksponerede HVER kolonne (email × 24, discord_id × 14, consent_preferences) til ENHVER authenticated user — en GDPR/doxxing-risiko. Fix-migration applied til prod 2026-05-22: alle 5 permissive policies re-scopet til `TO service_role` (den eneste rolle der bør skrive system-tabeller — service_role bypasser RLS uanset, så dette er det korrekte \"kun service kan skrive\"-mønster), og users-policy'en blev erstattet med admin-only cross-user læsning via den eksisterende `is_admin()` SECURITY DEFINER function. Post-fix advisor: 15 → 10 findings (-33%). Alle flows verificeret: admins ser stadig alle users + emails, normale brugere ser kun egen profil. Refs #548. Audit: docs/RLS_AUDIT_2026-05-22.md. Postmortem: .claude/learnings/2026-05-22-rls-permissive-public-policies.md.",
        ],
      },
    ],
  },
  {
    version: "3.89",
    date: "2026-05-22",
    label: "Beta",
    changes: [
      {
        category: "Sikkerhed & Discord-DMs · webhook-URL'er låst ned + DM-observability",
        items: [
          "EN · Two-in-one hardening pass. (1) Security #517: Discord webhook URLs were public-readable through Supabase's anon role — anyone could pull the full webhook list including the secret URL. Public read-policy on discord_settings has been dropped (verified: anon now sees 0 rows). Admin UI for Discord webhooks now goes through new backend endpoints under /api/admin/discord-settings, and the frontend only ever receives a masked URL (last 8 chars) for display — full URL never leaves the server. ACTION REQUIRED FROM ADMIN: rotate existing Discord webhook URLs in Discord (Server Settings → Integrations → Webhooks → regenerate) since the old URLs were exposed during the leak window. (2) Bug #449: Discord DMs on outbid silently stopped working around May 11. Root cause not 100% confirmed (likely related to the May 11 Supabase rotation/redeploy), but we found a class of silent fail-patterns in the notification pipeline: sendDM returned without logging when DISCORD_BOT_TOKEN was missing, and 5 .catch(() => {}) calls swallowed all DM-send errors. All now log structured warnings/errors so Railway logs will surface the real failure mode next time. If your DMs are still not working, ping in #bugs and we now have logs to diagnose with.",
          "DA · To-i-én hardening-pass. (1) Sikkerhed #517: Discord webhook URLs var public-readable via Supabases anon-rolle — enhver kunne trække hele webhook-listen inklusive den hemmelige URL. Public-read-policy på discord_settings er droppet (verificeret: anon ser nu 0 rows). Admin-UI for Discord-webhooks går nu gennem nye backend-endpoints under /api/admin/discord-settings, og frontend modtager kun en maskeret URL (sidste 8 tegn) til visning — fuld URL forlader aldrig serveren. HANDLING KRÆVET FRA ADMIN: rotér eksisterende Discord webhook URLs i Discord (Server Settings → Integrations → Webhooks → regenerate), da de gamle URLs var eksponeret i leak-vinduet. (2) Bug #449: Discord-DM ved overbud holdt op silent omkring 11. maj. Root cause ikke 100% bekræftet (sandsynligvis relateret til Supabase-rotation/redeploy 11. maj), men vi fandt en klasse af silent fail-patterns i notifikations-pipelinen: sendDM returnerede uden at logge når DISCORD_BOT_TOKEN manglede, og 5 .catch(() => {})-kald slugte alle DM-send-fejl. Alle logger nu strukturerede warnings/errors så Railway-logs viser den faktiske fejl næste gang. Hvis dine DM'er stadig ikke virker, ping i #bugs og vi har nu logs at diagnostisere med.",
        ],
      },
    ],
  },
  {
    version: "3.88",
    date: "2026-05-22",
    label: "Beta",
    changes: [
      {
        category: "Sæson · Loop-incident rest-cleanup: ghost-renter på lån fjernet (zero-sum-justering)",
        items: [
          "EN · Forensic deep-dive after the v3.86 rollback revealed the original cleanup only removed ghost finance_transactions and reset team balances using SUM(ghost-tx.amount). But processLoanInterest writes a finance_transactions row with amount=-interest as audit, while the actual debit happens by increasing loans.amount_remaining (the loan grows by the interest), NOT by deducting from teams.balance. The original rollback therefore subtracted ghost loan_interest amounts from balance even though they were never in the balance to begin with — and left loans.amount_remaining pumped up by 3 extra ghost interest cycles. Net effect: 8 teams with loans had 1.09M CZ$ of phantom money on their balance, AND their loans had 1.09M CZ$ of phantom debt (perfect 1:1 correspondence). Rest-cleanup deployed: 10 active loans rolled back via amount_remaining / (1+interest_rate)^3 + seasons_remaining += 3, 8 teams' balances reduced by sum of per-loan overshoot. Manager net-worth (balance − debt) is unchanged per team. All 19 teams now reconcile cleanly against finance_transactions. New doc docs/SEASON_LOOP_FORENSICS.md documents the methodology so the same audit can be redone in the future.",
          "DA · Forensisk dybde-undersøgelse efter v3.86-rollbacken afslørede at den oprindelige cleanup kun fjernede ghost finance_transactions og resatte hold-balancer via SUM(ghost-tx.amount). Men processLoanInterest skriver en finance_transactions-row med amount=-rente som audit, mens den faktiske debet sker ved at lægge renten oven i loans.amount_remaining (gælden vokser), IKKE ved at trække fra teams.balance. Original rollback subtraherede derfor ghost loan_interest-amounts fra balance selvom de aldrig var i balancen — og lod loans.amount_remaining stå pumpet med 3 ekstra ghost-rente-cykler. Net effekt: 8 hold med lån havde 1,09M CZ$ phantom-penge på balancen, OG deres lån havde 1,09M CZ$ phantom-gæld (perfekt 1:1 korrespondance). Rest-cleanup deployed: 10 aktive lån rullet tilbage via amount_remaining / (1+rente)^3 + seasons_remaining += 3, 8 holds balancer reduceret med sum af ghost-overshoot per lån. Manager net-worth (balance − gæld) er uændret per hold. Alle 19 hold matcher nu rekonstruktion fra finance_transactions. Ny doc docs/SEASON_LOOP_FORENSICS.md dokumenterer metodologien så samme audit kan gentages fremover.",
        ],
      },
    ],
  },
  {
    version: "3.87",
    date: "2026-05-22",
    label: "Beta",
    changes: [
      {
        category: "Sæson · Safety-net mod cron-loop bug (forward-guards efter v3.86)",
        items: [
          "EN · Five forward-guards are now active after the v3.86 fix: (1) Discord-broadcast moved into transitionToNextSeason so EVERY transition — both admin-triggered and cron-triggered — posts to Discord (previously cron-fired transitions were silent and took 30 minutes to spot during the incident). (2) SIGTERM-handler in server.js: Railway deploys now wait up to 30 seconds for in-flight cron-ticks to finish before exiting, so a cron mid-season-transition is never interrupted by a redeploy. (3) Sentry alerts on cron failures: every cron-tick is now wrapped with a 'cron:<name>' tag, so any error in the season-transition chain is visible in the Sentry dashboard in real time. (4) Daily season-count safety-net: a new cron runs every 24h, counts season_transition entries in admin_log, and posts a Discord ALERT + Sentry event if more than 1 transition happened per day (a healthy season lasts weeks). (5) New admin checklist at docs/SEASON_TRANSITION_CHECKLIST.md documents the exact admin actions for ending a season + the expected cron-chain timing + abort procedure. Out of scope (parked as GitHub issues #542, #543, #544): refactoring the transfer_windows.status overload to an explicit lifecycle_phase enum, a season_transition_paused admin toggle, and a stricter DB CHECK on closed_at-manipulation. 5 new tests + 708 existing tests all pass.",
          "DA · Fem forward-guards er nu aktive efter v3.86-fixet: (1) Discord-broadcast flyttet ind i transitionToNextSeason så HVER transition — både admin-trigget og cron-trigget — posteres til Discord (tidligere var cron-fyrede transitions silent og tog 30 min at spotte under incidenten). (2) SIGTERM-handler i server.js: Railway-deploy venter nu op til 30 sek på igangværende cron-ticks før exit, så en cron midt i sæson-transition aldrig afbrydes af et redeploy. (3) Sentry-alerts på cron-fejl: hver cron-tick er nu wrappet med 'cron:<navn>'-tag, så enhver fejl i sæson-transition-kæden bliver synlig i Sentry-dashboardet i realtid. (4) Daglig season-count safety-net: ny cron der kører hver 24t, tæller season_transition-entries i admin_log, og poster Discord-ALERT + Sentry-event hvis mere end 1 transition på en dag (en sund sæson varer uger). (5) Ny admin-checklist på docs/SEASON_TRANSITION_CHECKLIST.md dokumenterer de præcise admin-handlinger for at afslutte en sæson + det forventede cron-chain-tidsforløb + abort-procedure. Parkeret som GitHub-issues #542, #543, #544: refactor af transfer_windows.status-overloaden til en eksplicit lifecycle_phase enum, season_transition_paused admin-toggle, og strammere DB CHECK på closed_at-manipulation. 5 nye tests + 708 eksisterende tests består alle.",
        ],
      },
    ],
  },
  {
    version: "3.86",
    date: "2026-05-22",
    label: "Beta",
    changes: [
      {
        category: "Sæson · Auto-transition cron-loop stoppet + rollback til sæson 1",
        items: [
          "EN · After the season 0 → 1 transition completed correctly at 23:15, the auto-transition cron triggered a second transition 10 minutes later, and then kept firing every 5–10 minutes — landing the database on season 4 by midnight. Root cause: the freshly-created next-season transfer_window is inserted with status='closed' (it's a racing window — market is closed during races), but with closed_at=null since it was never actually closed via a deadline. Three crons (deadline-day, squad-enforcement, season auto-transition) filtered only on status='closed' without checking closed_at, so they processed the brand-new racing window as if it were a wrapped deadline-window and triggered yet another transition. The cron loop has been stopped, sessions 2/3/4 + their 144 ghost finance_transactions have been rolled back, and all three crons now filter on closed_at IS NOT NULL so racing-windows can never be matched again. Also fixed: admin_log.admin_user_id is now nullable so cron-initiated transitions get audit entries (previously the INSERT failed silently because cron passes admin_user_id=null against a NOT NULL column). Regression tests cover all three crons.",
          "DA · Efter sæson 0 → 1 transitionen kørte korrekt kl 23:15, fyrede auto-transition cron'en en NY transition 10 minutter senere, og blev så ved hvert 5.-10. minut — så databasen landede på sæson 4 ved midnat. Rod-årsag: det nyoprettede vindue for næste sæson inserts med status='closed' (det er et racing-window — markedet er lukket under løb), men med closed_at=null da det aldrig faktisk blev lukket via en deadline. Tre crons (deadline-day, squad-enforcement, season auto-transition) filtrerede kun på status='closed' uden at tjekke closed_at, så de behandlede det helt nye racing-window som om det var et wrapped deadline-window og triggede endnu en transition. Cron-loopen er stoppet, sæson 2/3/4 + deres 144 ghost finance_transactions er rullet tilbage, og alle tre crons filtrerer nu på closed_at IS NOT NULL så racing-windows aldrig kan matches igen. Også fixet: admin_log.admin_user_id er nu nullable så cron-initierede transitions får audit-entries (tidligere fejlede INSERT'et silently fordi cron sender admin_user_id=null mod en NOT NULL kolonne). Regressionstests dækker alle tre crons.",
        ],
      },
    ],
  },
  {
    version: "3.85",
    date: "2026-05-21",
    label: "Beta",
    changes: [
      {
        category: "Deadline Day · Frosne hold fjernet fra Panic Board + polish",
        items: [
          "EN · The Deadline Day overview (/deadline-day) no longer lists frozen teams, AI teams or unowned teams in the squad-size table. Previously it only filtered out the bank team, so 4 frozen teams (Inuit Cycling + 3 test teams) were shown as 'under minimum' even though they don't participate in the season. Same is_frozen-filter as the v3.83 cron fix, now applied to the UI endpoint as well. The page is also renamed from 'Panic Board' to 'Deadline Day' to match the navigation, banner and route. Other small improvements: real error messages when the backend is unreachable (instead of the misleading 'not active' state), accessibility attributes on the table, horizontal scroll on narrow screens, and an explicit 'all teams over minimum' state.",
          "DA · Deadline Day-oversigten (/deadline-day) viser ikke længere frosne hold, AI-hold eller hold uden manager i trupstørrelse-tabellen. Tidligere filtrerede den kun bank-holdet fra, så 4 frosne hold (Inuit Cycling + 3 test-hold) blev vist som 'under minimum' selv om de ikke deltager i sæsonen. Samme is_frozen-filter som v3.83 cron-fixen, nu også på UI-endpointet. Siden er også omdøbt fra 'Panic Board' til 'Deadline Day' så den matcher navigationen, banneret og ruten. Øvrige små forbedringer: rigtige fejlmeddelelser når backend ikke kan nås (i stedet for den misvisende 'ikke aktiv'-tilstand), tilgængelighedsattributter på tabellen, vandret scroll på smalle skærme, og en eksplicit 'alle hold over minimum'-tilstand.",
        ],
      },
    ],
  },
  {
    version: "3.84",
    date: "2026-05-21",
    label: "Beta",
    changes: [
      {
        category: "Discord · Final Whistle inkluderer nu ai-pool auktioner + viser største auktion og største transfer separat",
        items: [
          "EN · The Final Whistle Discord embed (posted automatically when a transfer window closes) now counts ALL completed auctions during the window, including purchases from the free agent / AI rider pool. Previously only manager-to-manager auctions were counted, which made the report misleading in early seasons where most deals are from the open pool — e.g. season 0 had 111 completed auctions, but only 9 would have shown. The embed also splits 'Biggest deal' into two separate fields: 🏆 Biggest auction and 💸 Biggest transfer, so manager-vs-manager moves don't get hidden when an AI-pool buy happens to be larger. Auctions with no seller (pool buys) show as 'fri pulje' instead of '–'. Panic-handler flag still requires a real seller team, so AI-pool auctions can never be panic deals.",
          "DA · Final Whistle Discord-embed (sendes automatisk når et transfervindue lukker) tæller nu ALLE gennemførte auktioner i vinduet, inklusive køb fra fri-agent-puljen / AI-rytter-puljen. Tidligere blev kun manager-til-manager auktioner talt med, hvilket gjorde rapporten misvisende i tidlige sæsoner hvor de fleste handler er fra den åbne pulje — fx havde sæson 0 111 gennemførte auktioner, men kun 9 ville være vist. Embeddet splitter også 'Største handel' i to separate felter: 🏆 Største auktion og 💸 Største transfer, så manager-vs-manager træk ikke skjules når et AI-pool-køb tilfældigvis er større. Auktioner uden sælger (pulje-køb) vises som 'fri pulje' i stedet for '–'. Panik-handler-flag kræver stadig et faktisk sælger-hold, så AI-pool auktioner kan aldrig være panik-handler.",
        ],
      },
    ],
  },
  {
    version: "3.83",
    date: "2026-05-21",
    label: "Beta",
    changes: [
      {
        category: "Sæson · Frosne hold ekskluderet fra deadline-cron + squad enforcement + debt warnings",
        items: [
          "EN · Frozen teams are now correctly skipped by three background jobs that previously treated them as active managers: (1) squad-size enforcement no longer force-buys riders or fines frozen teams when a transfer window closes, (2) deadline-day notifications (24h/2h/30min reminders + final whistle) are no longer sent to frozen managers, and (3) negative-balance interest warnings skip frozen teams. Previously these jobs only filtered out AI and bank teams, so frozen human teams could be hit with forced auto-purchases at 150% market value plus 100K CZ$ fines plus 200 penalty points per missing rider. Reason: ahead of the season 0 → 1 transition tonight, 4 frozen teams (Inuit Cycling + 3 test teams) had 0 riders, which would have triggered 32 forced purchases and ~3.2M CZ$ in fines if the cron had run. New regression tests lock the is_frozen skip-path on both the per-team helper and the cron loader.",
          "DA · Frosne hold springes nu korrekt over af tre baggrundsjobs der tidligere behandlede dem som aktive managers: (1) trupstørrelse-håndhævelse tvinger ikke længere køb af ryttere eller bøder på frosne hold når et transfervindue lukker, (2) deadline-day notifikationer (24h/2h/30min advarsler + final whistle) sendes ikke længere til frosne managers, og (3) negativ-saldo-advarsler skipper frosne hold. Tidligere filtrerede disse jobs kun AI- og bank-hold fra, så frosne human-hold kunne blive ramt af tvungne auto-køb til 150% market value plus 100K CZ$ bøder plus 200 fradragspoint per manglende rytter. Begrundelse: før sæson 0 → 1 transitionen i aften havde 4 frosne hold (Inuit Cycling + 3 test-hold) 0 ryttere, hvilket ville have udløst 32 tvungne køb og ~3,2M CZ$ i bøder hvis cron'en havde kørt. Nye regressionstests låser is_frozen skip-stien på både per-hold-helperen og cron-loaderen.",
        ],
      },
    ],
  },
  {
    version: "3.82",
    date: "2026-05-21",
    label: "Beta",
    changes: [
      {
        category: "Dokumentation · Sæsonstart-rækkefølge klargjort overalt",
        items: [
          "EN · Help texts, FAQ, finance hints and admin dialogs now consistently describe the v3.78 cash-flow order: at season start sponsor is credited to ALL teams first, then loan interest is deducted, then salaries are deducted, and only if balance is still short does the system take an emergency loan. Several pages still said 'salaries are deducted at season end' — that was outdated since v3.78. No behaviour change; the engine has worked this way since 2026-05-21 morning. A new regression test locks the invariant so the order cannot regress unnoticed.",
          "DA · Hjælpetekster, FAQ, finance-hints og admin-dialoger beskriver nu konsekvent v3.78-cashflowet: ved sæsonstart krediteres sponsor til ALLE hold først, dernæst trækkes lånerenter, så lønninger, og kun hvis balance stadig er negativ optager systemet et nødlån. Flere sider sagde stadig 'løn trækkes ved sæsonslut' — det var forældet siden v3.78. Ingen adfærdsændring; engine'n har kørt sådan siden morgenen 2026-05-21. Ny regressionstest låser invariant, så rækkefølgen ikke kan smutte uden vi opdager det.",
        ],
      },
    ],
  },
  {
    version: "3.81",
    date: "2026-05-21",
    label: "Beta",
    changes: [
      {
        category: "Sæson · Ingen op/nedrykninger i sæson 1 og 2",
        items: [
          "EN · Promotion and relegation between divisions is paused for the rest of season 1 and all of season 2. When season 1 and season 2 end, no teams will move between Division 1, 2 and 3 based on the final standings. Division bonuses, board evaluation and rider value recalculation still run as normal — only the division-shuffle is skipped. Reason: with open beta still finding its footing and an uneven team-count per division, we want time to design a healthy long-term distribution before we start moving teams around. Promotion/relegation re-enables automatically when season 2 ends (i.e. starting with the season 2 → 3 transition), unless we change the rules again before then.",
          "DA · Op- og nedrykning mellem divisioner er sat på pause for resten af sæson 1 og hele sæson 2. Når sæson 1 og sæson 2 slutter, flytter ingen hold mellem Division 1, 2 og 3 baseret på den endelige stilling. Divisionsbonusser, bestyrelses-evaluering og rytter-værdi-recalc kører stadig normalt — kun selve division-skiftet springes over. Begrundelse: open beta er stadig ved at finde sin form og hold-fordelingen per division er ujævn, så vi vil have tid til at designe en sund langtidsfordeling før vi begynder at flytte rundt på hold. Op/nedrykning genaktiveres automatisk når sæson 2 slutter (dvs. ved sæson 2 → 3-transitionen), medmindre vi ændrer reglerne igen inden da.",
        ],
      },
    ],
  },
  {
    version: "3.80",
    date: "2026-05-21",
    label: "Beta",
    changes: [
      {
        category: "Admin · Frys/optø manager-hold (Refs #452)",
        items: [
          "EN · Admins can now freeze a manager team from /admin/economy → Overview. A frozen team is hidden from public standings, the team list, hall of fame, head-to-head search and the season-preview, and is automatically skipped by sponsor payouts, season-end processing, board flows, sequential negotiation and beta-reset jobs. The team's balance, riders and user account are fully preserved — the manager can still log in, and an admin can unfreeze later from the same row. Built for inactive managers who never bought riders and shouldn't take up a Division 3 slot until they come back. The first real team to be frozen with this tool is Inuit Cycling — they can be re-activated any time via the new \"Optø\" button.",
          "DA · Admins kan nu fryse et manager-hold fra /admin/economy → Overblik. Et frosset hold skjules fra offentlige standings, holdlisten, hall of fame, head-to-head-søgningen og sæson-previewet, og springes automatisk over af sponsor-payouts, sæson-slut, bestyrelses-flow, sekventiel forhandling og beta-reset-jobs. Holdets balance, ryttere og bruger-konto bevares fuldstændigt — manageren kan stadig logge ind, og en admin kan optø igen fra samme række. Bygget til inaktive managers der aldrig har købt ryttere og ikke skal tage en Division 3-plads op indtil de kommer tilbage. Det første rigtige hold der fryses med værktøjet er Inuit Cycling — de kan reaktiveres når som helst via den nye \"Optø\"-knap.",
        ],
      },
    ],
  },
  {
    version: "3.79",
    date: "2026-05-21",
    label: "Beta",
    changes: [
      {
        category: "Admin · Sæson-transition preview omformuleret til v3.78-cashflow",
        items: [
          "EN · The admin /admin/season preview table is renamed from \"Sæsonafslutnings-preview\" to \"Sæson-transition preview (næste sæson-start)\" and reordered to match the v3.78 cashflow order: balance + sponsor − interest − salary = balance after start. The columns are now Balance | + Sponsor (start) | − Interest | − Salary | Balance after start | Emergency loan? | Satisfaction | Rank. The underlying calculation also now includes sponsor income, so the emergency-loan flag matches what processSeasonStart actually does — teams that have low cash but enough sponsor to cover salary no longer falsely show as needing an emergency loan. The disclaimer now points at the \"Udfør sæsonskifte\" button in the Season cycle section instead of the deprecated ⏹ End button.",
          "DA · Admin /admin/season preview-tabellen er omdøbt fra \"Sæsonafslutnings-preview\" til \"Sæson-transition preview (næste sæson-start)\" og kolonnerne er omarrangeret efter v3.78-rækkefølgen: balance + sponsor − renter − løn = balance efter start. Kolonnerne er nu Balance | + Sponsor (start) | − Renter | − Løn | Balance efter start | Nødlån? | Tilfredshed | Rang. Den underliggende beregning inkluderer nu også sponsor-indtægt, så nødlån-flaget stemmer med hvad processSeasonStart faktisk gør — hold med lav cash men nok sponsor til at dække løn flagges ikke længere fejlagtigt som nødlåns-kandidater. Disclaimer'en peger nu på \"Udfør sæsonskifte\"-knappen i Sæson-cyklus-sektionen i stedet for den deprecated ⏹ Afslut-knap.",
        ],
      },
    ],
  },
  {
    version: "3.78",
    date: "2026-05-21",
    label: "Beta",
    changes: [
      {
        category: "Økonomi · Løn betales nu ved sæson-START i stedet for sæson-slut",
        items: [
          "EN · Rider salaries, loan interest, emergency loans and negative-balance interest now hit your balance at the START of each season (right when sponsor money lands), instead of at the end. You see one combined cashflow event per season instead of getting hit with a big bill when the season closes. Your forecast and accounting becomes simpler — what you see at season start is your real budget. No retroactive effect: season 0 stays untouched, season 1 starts with the new model when the season transition button is clicked tonight.",
          "DA · Rytterlønninger, lånerenter, nødlån og negativ-balance-rente trækkes nu fra din balance ved STARTEN af hver sæson (samtidig med sponsorindkomst), i stedet for ved sæsonens slut. Du ser én samlet pengestrøm pr. sæson i stedet for at få regningen ved sæson-slut. Din prognose og bogføring bliver simplere — det du ser ved sæson-start er dit reelle budget. Ingen tilbagevirkende effekt: sæson 0 forbliver urørt, sæson 1 starter med den nye model når sæson-skifte-knappen trykkes i aften.",
        ],
      },
      {
        category: "Prognose · Se op til 5 sæsoner frem (estimater fra sæson 2+)",
        items: [
          "EN · Finance forecast on /finance now supports a 1-5 season horizon via a dropdown. Season +1 is precise (based on actual roster, standings and active loans). Seasons +2 through +5 are estimates using a 'status quo' assumption: same roster, same sponsor formula, and 25%-per-season loan-amortization decay. The table shows sponsor, prize, salary, interest, net cashflow, ending balance and risk tier per season, plus a total row across the full horizon. Helps you stress-test 3yr/5yr board plans before you commit to them.",
          "DA · Finansprognosen på /finance understøtter nu en 1-5 sæsoners horisont via en dropdown. Sæson +1 er præcis (baseret på din faktiske trup, placering og aktive lån). Sæson +2 til +5 er estimater under 'status quo'-antagelsen: samme trup, samme sponsor-formel, og 25% lån-afdrag per sæson som proxy. Tabellen viser sponsor, præmie, løn, rente, netto-cashflow, slut-saldo og risiko-tier per sæson plus en total-række. Hjælper dig med at stress-teste 3-årige/5-årige bestyrelsesplaner inden du forpligter dig.",
        ],
      },
      {
        category: "Drift · 3 test-hold frosset ud af gameplay",
        items: [
          "EN · The three test accounts (test-a, test-b, test-seller) have been set to is_frozen=true. They no longer appear in sponsor payouts, season-end processing, board flows, sequential negotiation or beta-reset queries. Their balance and ownership records are preserved so the data can be unfrozen later if test access is needed again. Cleans up your standings, dashboards and rankings.",
          "DA · De tre test-konti (test-a, test-b, test-seller) er sat til is_frozen=true. De vises ikke længere i sponsor-payouts, sæson-slut-behandling, bestyrelses-flows, sekventiel forhandling eller beta-reset-queries. Deres balance og ejer-relationer bevares så data kan optos igen senere hvis test-adgang er nødvendig. Rydder op i ranglister, dashboards og standings.",
        ],
      },
    ],
  },
  {
    version: "3.77",
    date: "2026-05-21",
    label: "Beta",
    changes: [
      {
        category: "Sæson-cyklus · Sikrere transition fra sæson 0 til sæson 1",
        items: [
          "EN · The admin Season transition engine now correctly activates a season that was pre-created with status 'upcoming' (instead of silently skipping it). This was a contract bug that would have left season 1 in 'upcoming' state after the transition button was clicked, even though the confirmation dialog promised 'active'. No visible UI change for managers. Backend-only fix to backend/lib/seasonTransition.js + 2 new unit tests (676 backend tests still green).",
          "DA · Admin sæson-skifte-motoren aktiverer nu korrekt en sæson der er pre-created med status 'upcoming' (i stedet for at skippe den). Det var en kontrakt-bug der ville efterlade sæson 1 i 'upcoming' efter klik på sæson-skifte-knappen, selv om confirm-dialogen lover 'active'. Ingen synlig UI-ændring for managers. Backend-only fix i backend/lib/seasonTransition.js + 2 nye unit-tests (676 backend-tests stadig grønne).",
        ],
      },
    ],
  },
  {
    version: "3.76",
    date: "2026-05-21",
    label: "Beta",
    changes: [
      {
        category: "Admin · Tab-based navigation re-applied — clean rollout (Refs #529)",
        items: [
          "EN · The /admin panel is now split into 5 tabs with their own URLs: /admin/season, /admin/economy, /admin/users, /admin/data, /admin/system. You can bookmark or share a link straight to a tab. Old /admin bookmarks redirect to /admin/season. This is the clean re-apply of the work that v3.75 rolled back — same scope, now committed properly via a reviewed PR instead of a pre-commit sweep. Beta-test reset tools are hidden in production (only visible in dev mode). No backend changes. The original AdminPage will be removed in a later phase once everything is verified on prod.",
          "DA · /admin-panelet er nu opdelt i 5 faner med egne URLs: /admin/season, /admin/economy, /admin/users, /admin/data, /admin/system. Du kan bookmarke eller dele et link direkte til en fane. Gamle /admin-bookmarks redirecter til /admin/season. Dette er den rene re-apply af det arbejde v3.75 rullede tilbage — samme scope, nu committet ordentligt via en reviewed PR i stedet for et pre-commit sweep. Beta-test-nulstillingsværktøjer er skjult i prod (kun synlige i dev-tilstand). Ingen backend-ændringer. Den oprindelige AdminPage fjernes i en senere fase når alt er verificeret på prod.",
        ],
      },
    ],
  },
  {
    version: "3.75",
    date: "2026-05-20",
    label: "Beta",
    changes: [
      {
        category: "Admin · Tab-based navigation midlertidigt rullet tilbage",
        items: [
          "EN · The tab-based /admin layout introduced briefly in v3.74 has been rolled back to the previous single-page layout. The new tabs were committed accidentally before they were ready, so URLs like /admin/season currently 404 in production. The full tab rewrite will return in an upcoming patch once the new admin panel is complete. No data was affected and no admin actions are blocked.",
          "DA · Den tab-baserede /admin-layout der kort kom i v3.74 er rullet tilbage til det tidligere single-page-layout. De nye faner blev committet ved en fejl før de var klar, så URLs som /admin/season 404'er lige nu i produktion. Hele tab-omskrivningen kommer tilbage i en kommende patch når det nye admin-panel er færdigt. Ingen data er påvirket og ingen admin-handlinger er blokeret.",
        ],
      },
    ],
  },
  {
    version: "3.74",
    date: "2026-05-20",
    label: "Beta",
    changes: [
      {
        category: "Admin · Tab-based navigation kom kort frem (utilsigtet, rullet tilbage i v3.75)",
        items: [
          "EN · The 5-tab /admin layout (Sæson & Løb, Økonomi, Brugere, Data/Import, System & Debug) first appeared here, but it was committed before it was ready and the new tab URLs returned 404. It was rolled back the same evening (see v3.75) and re-applied cleanly in v3.76. No data was affected and no admin actions were blocked.",
          "DA · Det 5-fanede /admin-layout (Sæson & Løb, Økonomi, Brugere, Data/Import, System & Debug) dukkede først op her, men blev committet før det var klar, og de nye fane-URLs returnerede 404. Det blev rullet tilbage samme aften (se v3.75) og re-applied rent i v3.76. Ingen data blev påvirket og ingen admin-handlinger var blokeret.",
        ],
      },
    ],
  },
  {
    version: "3.73",
    date: "2026-05-20",
    label: "Beta",
    changes: [
      {
        category: "Backend · Database security hardening fase A (Refs #516, #525)",
        items: [
          "EN · Internal database hardening. No visible UI change. Removed an unused legacy economy function (increment_balance) that bypassed the audited balance flow, locked down execute permissions on database-internal functions so they can no longer be called from the browser, and rebuilt three admin inspector views so they no longer bypass row-level security. The current audited economy path (increment_balance_with_audit) is unchanged and continues to be the only way balances move.",
          "DA · Intern database-hærdning. Ingen synlig UI-ændring. Fjernede en ubrugt legacy økonomi-funktion (increment_balance) der omgik den auditerede balance-vej, strammede execute-rettigheder på database-interne funktioner så de ikke længere kan kaldes fra browseren, og genopbyggede tre admin inspector-views så de ikke længere omgår row-level-security. Den nuværende auditerede økonomi-vej (increment_balance_with_audit) er uændret og fortsætter med at være den eneste måde balancer flyttes.",
        ],
      },
    ],
  },
  {
    version: "3.72",
    date: "2026-05-20",
    label: "Beta",
    changes: [
      {
        category: "Admin · Race-katalog edit (årgang/navn/klasse) gemmer nu rigtigt (Refs #515)",
        items: [
          "EN · /admin → Løbskalender → ✏ Rediger now actually saves your changes. The old editor silently dropped name, class, type, stages and edition_year edits — the UI showed 'Løb gemt' but the database was unchanged. Cause: the frontend wrote straight to the races table from the browser, and the row-level security policy only allows reads. Saves now go through a new admin-gated backend endpoint that applies the update server-side and records before/after values to the admin audit log.",
          "EN · Unblocks the pre-season-1 workflow of filling edition_year on the 26 season-1 races (needed before season 1 starts Thu 2026-05-21 23:00). If you previously typed an edition_year and it appeared blank afterwards, just open the row, retype it and click Gem — it now sticks.",
          "DA · /admin → Løbskalender → ✏ Rediger gemmer nu rigtigt dine ændringer. Den gamle editor smed lydløst navn, klasse, type, etaper og løbsudgave-ændringer væk — UI'et viste 'Løb gemt' men databasen var uændret. Årsag: frontend skrev direkte til races-tabellen fra browseren, men row-level security-policy'en tillader kun læsning. Gem går nu gennem et nyt admin-gated backend-endpoint der laver ændringen server-side og logger før/efter-værdier til admin-audit-log.",
          "DA · Fjerner blokeringen for pre-sæson-1-flowet med at udfylde edition_year på de 26 sæson 1-løb (skal være på plads inden sæson 1 starter Thu 2026-05-21 23:00). Hvis du tidligere har tastet et edition_year og det stod blankt bagefter, så åbn rækken, skriv det igen og klik Gem — det bliver gemt nu.",
        ],
      },
    ],
  },
  {
    version: "3.71",
    date: "2026-05-20",
    label: "Beta",
    changes: [
      {
        category: "Admin · Race-katalog autocomplete i \"Tilføj nyt løb\"",
        items: [
          "EN · /admin → Løbskalender → 'Tilføj nyt løb' now searches the race-catalog (race_pool) as you type. Pick a race from the dropdown and the name, class, type and stages auto-fill from the pool entry — you only need to type the edition_year. Removes the previous risk of typos that didn't match a pool name and let you skip the manual class/type/stages lookup. The free-text entry mode still works if you need a race that isn't in the catalog. Each pool match shows the class, stages, country and PCM real-world date; entries already added to the selected season show an 'allerede i sæson' marker so you don't double up.",
          "DA · /admin → Løbskalender → 'Tilføj nyt løb' søger nu i race-kataloget (race_pool) mens du skriver. Vælg et løb i dropdown'en og navn, klasse, type og etaper auto-udfyldes fra pool-rækken — du skal kun taste edition_year selv. Fjerner risikoen for stavefejl der ikke matcher et pool-navn og sparer dig for manuel klasse/type/etaper-opslag. Frihåndsindtastning virker stadig hvis du har brug for et løb der ikke er i kataloget. Hver pool-match viser klasse, etaper, land og PCM-rigtig-verdens-dato; løb der allerede er tilføjet til den valgte sæson markeres med 'allerede i sæson' så du ikke dublerer.",
        ],
      },
    ],
  },
  {
    version: "3.70",
    date: "2026-05-20",
    label: "Beta",
    changes: [
      {
        category: "Admin · Løbskalender 'Udgave'-kolonne synlig på mobil",
        items: [
          "EN · The race calendar in /admin used to have a column titled 'Dato' that actually showed the edition year ('2024-udgave'), and it was hidden on screens narrower than 768px. The column is now titled 'Udgave' and visible at every screen size, so the edition_year you just typed is immediately confirmed after save — no more wondering if it stuck.",
          "DA · Løbskalenderen i /admin havde en kolonne kaldet 'Dato', der faktisk viste løbsudgavens årstal ('2024-udgave'), og den var skjult på skærme smallere end 768px. Kolonnen hedder nu 'Udgave' og vises på alle skærmstørrelser, så det edition_year du lige har skrevet bekræftes med det samme efter gem — ingen tvivl om at det blev gemt.",
        ],
      },
    ],
  },
  {
    version: "3.69",
    date: "2026-05-20",
    label: "Beta",
    changes: [
      {
        category: "UCI-points · Fix translit-mismatch for 45 ryttere (Refs #508)",
        items: [
          "EN · 45 riders had their UCI points stuck at the minimum (5) because the weekly sync from ProCyclingStats couldn't match their database name to the published name. The cause: transliteration drift on Slavic / Arabic / Asian / Latin-American names — e.g. PCS publishes 'BOLDYREV Matvei' while the database stored 'Matvey Boldyrev', or 'JANG Kyung-Gu' vs 'Kyunggu Jang'. The token-set match used by the sync requires exact spelling, so it silently fell back to the minimum.",
          "EN · Largest corrections (uci_points before → after): Tegshbayar Batsaikhan (MN, pop 21) 5→196; Mohammad Al Mutaiwei (AE) 5→153; Alfie George (GB) 5→138; Edinson Alejandro Callejas (CO) 5→115; Nahom Zerai (ER) and Finlay Walsh (AU) 5→110 each; Cristofer Robin Jurado (PA) 5→101; Matvey Boldyrev (RU) 5→78; plus 37 more (full list in Refs #508).",
          "EN · Manager-economy impact: each restored rider's salary jumped accordingly — Batsaikhan's CZ$ value went 2,000 → 78,400, Boldyrev's 2,000 → 31,200. If you had any of these riders on your team you'll see the new salaries on the next refresh.",
          "EN · Forward fix: the 45 verified name-variants are now in the scraper's UCI_NAME_OVERRIDE map, so next Wednesday's cron won't re-break them. A new GitHub Actions workflow ('UCI Translit Audit') can be run ad-hoc to surface any future translit drift before it bites.",
          "DA · 45 ryttere stod fast på UCI-minimum (5 point) fordi den ugentlige sync fra ProCyclingStats ikke kunne matche deres database-navn til det offentliggjorte navn. Årsagen: transliteration-drift på slaviske/arabiske/asiatiske/latinamerikanske navne — fx PCS skriver 'BOLDYREV Matvei' mens databasen havde 'Matvey Boldyrev', eller 'JANG Kyung-Gu' vs 'Kyunggu Jang'. Token-set-matchet kræver præcis stavning og faldt derfor lydløst tilbage til minimum.",
          "DA · Største rettelser (uci_points før → efter): Tegshbayar Batsaikhan (MN, pop 21) 5→196; Mohammad Al Mutaiwei (AE) 5→153; Alfie George (GB) 5→138; Edinson Alejandro Callejas (CO) 5→115; Nahom Zerai (ER) og Finlay Walsh (AU) 5→110 hver; Cristofer Robin Jurado (PA) 5→101; Matvey Boldyrev (RU) 5→78; plus 37 til (komplet liste i Refs #508).",
          "DA · Manager-økonomi-effekt: hver genoprettet rytters CZ$-værdi steg tilsvarende — Batsaikhan gik 2.000 → 78.400, Boldyrev 2.000 → 31.200. Har du nogle af disse ryttere på holdet, ser du de nye lønninger ved næste refresh.",
          "DA · Forward-fix: de 45 verificerede navn-varianter ligger nu i scraperens UCI_NAME_OVERRIDE-map, så onsdagens cron ikke knækker dem igen. En ny GitHub Actions-workflow ('UCI Translit Audit') kan køres ad hoc og finde fremtidig translit-drift før den bider.",
        ],
      },
    ],
  },
  {
    version: "3.68",
    date: "2026-05-20",
    label: "Beta",
    changes: [
      {
        category: "Admin · Race-points editor med audit-log (Refs #505)",
        items: [
          "EN · Admin can now edit UCI race points (the per-classification, per-rank points awarded for race results) directly in /admin → Pointtabel per løbsklasse, with every edit logged to the admin audit trail. Replaces the older direct-write editor that bypassed audit logging and was missing the per-day jersey result_types added in v3.66.",
          "EN · New per-row 'Reset til baseline' button restores the UCI default for a result type in one click. A sticky save bar collects pending edits and commits them as a batch — no more accidental saves on click-away.",
          "EN · Backend: 3 new endpoints (GET /admin/race-points, GET /admin/race-points/baseline, PUT /admin/race-points/:id) all guarded by requireAdmin + rate-limited. Each PUT writes a race_points_edited row to admin_log with before/after values, race_class, result_type and rank.",
          "DA · Admin kan nu redigere UCI race-points (point per klassifikation × placering) direkte i /admin → Pointtabel per løbsklasse, med audit-log på hver ændring. Erstatter den gamle direkte editor der gik uden om audit-trail og manglede de per-dag jersey-typer fra v3.66.",
          "DA · Ny per-række 'Reset til baseline'-knap fører UCI-default tilbage med ét klik. En sticky save-bar samler ventende ændringer og commiter dem batch-vis — ingen flere uheld med save-on-click-away.",
          "DA · Backend: 3 nye endpoints (GET /admin/race-points, GET /admin/race-points/baseline, PUT /admin/race-points/:id) auth-gated via requireAdmin + rate-limit. Hver PUT skriver en race_points_edited-række til admin_log med før/efter-værdier, race_class, result_type og rank.",
        ],
      },
    ],
  },
  {
    version: "3.67",
    date: "2026-05-20",
    label: "Beta",
    changes: [
      {
        category: "Display · Forventet præmie-badges på race-cards (Refs #504)",
        items: [
          "EN · Every upcoming race in the calendar now shows a live-computed 'Forventet pulje ~X CZ$' label so you can size up the payout before deciding which riders to send. The number is recalculated from race-class points × stages × 1500 CZ$/point, so it stays in sync if admin tunes race_points later.",
          "EN · The season overview page (Sæson-snapshot) adds the same per-race label and shows a 'Total forventet pulje for sæsonen' header above the calendar. For season 1 that totals ~55,3M CZ$ across the 26 ProSeries races.",
          "EN · Pure display feature: no database changes, no rider stats, no transfer-window effects. The badge is hidden if a race has no race_class set yet.",
          "DA · Hvert kommende løb i kalenderen viser nu en live-beregnet 'Forventet pulje ~X CZ$'-label, så du kan vurdere udbetalingen før du beslutter hvilke ryttere du sender. Tallet genberegnes fra race-class point × etaper × 1500 CZ$/point, så det følger med hvis admin justerer race_points senere.",
          "DA · Sæson-snapshot-siden tilføjer samme label per løb og viser en 'Total forventet pulje for sæsonen' over kalenderen. For sæson 1 lander det på ~55,3M CZ$ fordelt på de 26 ProSeries-løb.",
          "DA · Ren display-feature: ingen database-ændringer, ingen rider-stats, ingen effekt på transfer-vinduer. Badgen er skjult hvis et løb ikke har race_class sat endnu.",
        ],
      },
    ],
  },
  {
    version: "3.66",
    date: "2026-05-20",
    label: "Beta",
    changes: [
      {
        category: "Race-points · Komplet jersey-system + sheet-sync bug fix (Refs #503)",
        items: [
          "EN · Race points are now seeded for every classification on every race class. Before this update only Tour, Giro and Vuelta awarded points for the mountain and points jerseys, and the white (young rider) jersey, team classification and per-day points for holding the mountain/points/young jerseys were missing entirely. Now every stage race awards points for: leader jersey per stage (existing), holding the mountain jersey per stage (new), holding the points jersey per stage (new), holding the white jersey per stage (new), final top-3 for mountain/points/young, and the team classification. One-day races award team-classification points too. Tour-level numbers are unchanged from real UCI values; lower tiers use derived scales (~16/12/8% of GC rank 1 for jersey finals, ~60% of leader-jersey for per-day holding).",
          "EN · Bug fix: the Google Sheets results import was writing race_points directly into the prize_money column without multiplying by 1500 CZ$/point. Effect: any race imported via the sheet path would pay out 1500× too little. The path is now consistent with the admin XLSX import and the pending-results flow. No production data was corrupted (verified: no season 1 results exist yet).",
          "EN · New sheet input columns: 'Bjergtrøje per dag', 'Pointtrøje per dag', 'Ungdomstrøje per dag' (one row per stage at rank 1). The existing 'Førertrøje' column for the leader jersey is unchanged.",
          "EN · Season 1 forventet total prize-pool: ~55.3M CZ$ across 26 races (9 stage races + 17 one-day races, all ProSeries). Baseline audit committed to docs/metrics/season-1-prize-audit.json.",
          "DA · Race-points er nu seedet for hver klassifikation på hver løbsklasse. Før denne opdatering tildelte kun Tour, Giro og Vuelta point for bjerg- og pointtrøjen, og ungdomstrøje, holdklassement samt per-dag-point for at HOLDE bjerg/point/ungdomstrøjen manglede helt. Nu tildeler hvert etapeløb point for: førertrøjen per etape (eksisterende), at holde bjergtrøjen per etape (ny), at holde pointtrøjen per etape (ny), at holde ungdomstrøjen per etape (ny), final top-3 for bjerg/point/ungdoms, og holdklassementet. Endagsløb tildeler også holdklassement-point. Tour-niveau-tal er uændrede fra ægte UCI-værdier; lavere tiers bruger derived skalaer (~16/12/8% af GC-rank-1 for jersey-finals, ~60% af førertrøje for per-dag).",
          "DA · Bug-fix: Google Sheets-importen skrev race_points direkte ind i prize_money-kolonnen uden at multiplicere med 1500 CZ$/point. Effekt: ethvert løb importeret via sheet-pathen ville udbetale 1500× for lidt. Pathen er nu konsistent med admin XLSX-importen og pending-results-flowet. Ingen produktionsdata blev korrupteret (verificeret: ingen sæson 1-resultater eksisterer endnu).",
          "DA · Nye sheet-input-kolonner: 'Bjergtrøje per dag', 'Pointtrøje per dag', 'Ungdomstrøje per dag' (én række per etape ved rank 1). Den eksisterende 'Førertrøje'-kolonne er uændret.",
          "DA · Sæson 1 forventet total præmiepulje: ~55,3M CZ$ fordelt på 26 løb (9 etapeløb + 17 endagsløb, alle ProSeries). Baseline-audit committet i docs/metrics/season-1-prize-audit.json.",
        ],
      },
    ],
  },
  {
    version: "3.65",
    date: "2026-05-20",
    label: "Beta",
    changes: [
      {
        category: "Race-skema · Løbsudgave + ryddet up i metadata (Refs #168, #502)",
        items: [
          "EN · Admin can now tag each race with the edition year it represents — e.g. 'Tour de France 2024' — via a new 'Løbsudgave (årstal)' input on the race create/edit form. The year appears on race cards in the calendar, the dashboard 'next races' panel, and on each historic edition in race history. Optional field — existing races start blank and you fill them in over time.",
          "EN · The 'Startdato' and 'Præmiepulje' fields are removed from races. We don't know which day a race will run inside our game, and prize money is already determined by race class (race_points × 1500 CZ$) — the per-race override served no purpose. Race calendars now sort by the real-life PCM date (e.g. '20/5 - 24/5') from the race pool instead.",
          "EN · Season 0 (open beta) is now permanently locked at 0 races via a database CHECK constraint. Any code path that tries to add a race to season 0 fails with a clear 400 error instead of silently writing.",
          "DA · Admin kan nu mærke hvert løb med hvilken udgave/årgang det repræsenterer — fx 'Tour de France 2024' — via et nyt 'Løbsudgave (årstal)'-felt på opret/rediger-formularen. Årstallet vises på løbs-cards i kalenderen, dashboard-panelet 'kommende løb' og på hver historisk udgave i løbshistorik. Frivilligt felt — eksisterende løb starter blanke og du fylder dem ind over tid.",
          "DA · Felterne 'Startdato' og 'Præmiepulje' er fjernet fra løb. Vi ved ikke hvilken dag et løb køres inde i spillet, og præmiepenge er allerede defineret af løbsklasse (race_points × 1500 CZ$) — per-løb override gjorde ingenting. Løbskalender sorterer nu efter den virkelige PCM-dato (fx '20/5 - 24/5') fra race-poolen i stedet.",
          "DA · Sæson 0 (open beta) er nu permanent låst til 0 løb via en database CHECK-constraint. Enhver kodevej der prøver at tilføje løb til sæson 0 fejler med en klar 400-fejl i stedet for at skrive stille.",
        ],
      },
    ],
  },
  {
    version: "3.64",
    date: "2026-05-19",
    label: "Beta",
    changes: [
      {
        category: "Copy · Founder waitlist naming + fair premium tone (Refs #500)",
        items: [
          "EN · The /founder-supporter landing page, waitlist form and social meta tags now use the locked Session B naming. The 49 DKK tier is called Premium (not Supporter), the early-signup status is called Founder (not Founder Supporter), and the page tells you 'back the project' instead of 'support' it. The promise is the same: the game must be fair for everyone. You cannot pay for better riders, faster training, or better results.",
          "EN · Submitted waitlist values are unchanged in the database, so anyone who already signed up keeps their record. Only the labels you see were renamed.",
          "DA · Landing page /founder-supporter, waitlist-form og social meta-tags følger nu Session B-naming. 49 DKK-tieren hedder Premium (ikke Supporter), early-signup-status hedder Founder (ikke Founder Supporter), og siden skriver 'bak projektet op' i stedet for 'støt'. Løftet er det samme: spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater.",
          "DA · Indsendte waitlist-værdier er uændrede i databasen, så alle der allerede har skrevet sig på, beholder deres tilmelding. Kun de labels du ser er omdøbt.",
        ],
      },
    ],
  },
  {
    version: "3.63",
    date: "2026-05-19",
    label: "Beta",
    changes: [
      {
        category: "Admin · Per-sæson prioritets-lister (variation over sæsoner)",
        items: [
          "EN · The race priority whitelists (stage race quota + single race boost) are now stored per season instead of being hardcoded. Each season starts with empty lists and falls back to alphabetic ordering when nothing is set. Use this to vary which races land in season 1, 2, 3 etc. so the same prestigious tours don't recur every year.",
          "EN · New admin section 'Prioritets-lister (per sæson)' in Race-katalog with drag-and-drop ordering. Add stage races from a dropdown, drag to reorder, remove with the ✕ button. Same flow for the single race boost list. Hit 'Gem prioritets-lister' to persist.",
          "EN · Backend: seasons.stage_race_priority + seasons.single_race_boost (uuid[]) columns; new PUT /api/admin/seasons/:id/race-priority endpoint validates race_type consistency. Preview endpoint reads from DB unless body overrides — that lets the admin preview unsaved whitelist changes before committing.",
          "DA · Race priority whitelists (etape-quota + single boost) er nu gemt per sæson i stedet for hardcoded. Hver sæson starter med tomme lister og falder tilbage til alfabetisk når intet er sat. Brug det til at variere hvilke løb der lander i sæson 1, 2, 3 osv. så de samme prestigious tours ikke gentager hvert år.",
          "DA · Ny admin-sektion 'Prioritets-lister (per sæson)' i Race-katalog med drag-and-drop. Tilføj etapeløb fra dropdown, træk for at omarrangere, fjern med ✕-knap. Samme flow for single race boost. Tryk 'Gem prioritets-lister' for at persistere.",
          "DA · Backend: seasons.stage_race_priority + seasons.single_race_boost (uuid[]) felter; ny PUT /api/admin/seasons/:id/race-priority endpoint validerer race_type-konsistens. Preview-endpoint læser fra DB med mindre body overrider — det lader admin preview unsaved whitelist-ændringer før gem.",
        ],
      },
    ],
  },
  {
    version: "3.62",
    date: "2026-05-19",
    label: "Beta",
    changes: [
      {
        category: "Admin · Sæson 1 kalender-balancering (stage race quota)",
        items: [
          "EN · The race calendar generator now guarantees a minimum number of stage races so that GC riders (climbers, time-trialists, all-rounders) have meaningful action across a season. Previously the alphabetic sort pushed most stage races out — for season 1 only 6 of 26 available stage races were picked.",
          "EN · A curated priority list ensures the prestigious Continental-Circuit stage races land first (Tour of Oman, Volta ao Algarve, Tour of the Alps, Vuelta a Burgos, Tour of Slovenia, Tour of Britain, etc.) before the algorithm fills the rest. Italian/Asian autumn one-day classics (Tre Valli Varesine, Trofeo Laigueglia, Veneto Classic, Japan Cup) also get a guaranteed boost.",
          "EN · Admin · Race-katalog has a new input 'Min. etapeløb (garanteret)', default 8. Set 0 to fall back to the old alphabetic behaviour. Pure backend change to selectSeasonRaces() — fully backward compatible.",
          "DA · Løbskalender-generatoren garanterer nu et minimum antal etapeløb, så GC-ryttere (bjergryttere, enkeltstart-folk, all-roundere) har relevant action gennem en sæson. Tidligere skubbede alfabetisk sortering de fleste etapeløb ud — sæson 1 fik kun 6 ud af 26 mulige.",
          "DA · En kurateret prioritets-liste sikrer at de prestigious Continental-Circuit etapeløb lander først (Tour of Oman, Volta ao Algarve, Tour of the Alps, Vuelta a Burgos, Tour of Slovenia, Tour of Britain, m.fl.) før resten af kalenderen fyldes. Italienske/asiatiske efterårsklassikere (Tre Valli Varesine, Trofeo Laigueglia, Veneto Classic, Japan Cup) får også garanteret plads.",
          "DA · Admin · Race-katalog har et nyt felt 'Min. etapeløb (garanteret)', default 8. Sæt 0 for at falde tilbage til den gamle alfabetiske adfærd. Ren backend-ændring i selectSeasonRaces() — fuldt backward kompatibel.",
        ],
      },
    ],
  },
  {
    version: "3.61",
    date: "2026-05-19",
    label: "Beta",
    changes: [
      {
        category: "Feature · Deadline Day automation + admin readiness tools",
        items: [
          "EN · The transfer window now auto-closes when the close time hits (no admin needed in the middle of the night). Within 10-15 minutes after close: Final Whistle posts in Discord, squad enforcement runs (auto-buy/sell + fine if outside division min/max), season 1 starts and sponsor 240,000 CZ$ lands on every team.",
          "EN · Season 0 → 1 is a special transition: no salary deduction and no interest charges (there's no season 0 to settle). Sponsor money is the only cash flow. Normal cycle resumes from season 1.",
          "EN · New 'Klar til deadline?' panel on the admin page shows live: is closes_at set, who is outside min/max, how many active auctions/transfers/swaps/loans, and whether season 1's calendar is ready. Refresh button + dry-run preview of the season transition with sponsor breakdown per team.",
          "EN · Race calendar generator extended with race-type filter (single/stage), an 'add back from omitted' panel and an opt-in 'replace existing races' mode for re-generating without leaving duplicates.",
          "EN · Four new help articles: season 0 → 1 specials, deadline timeline, squad enforcement, season 1 race calendar.",
          "DA · Transfervinduet lukker nu automatisk når lukketiden rammer (ingen admin behov om natten). Inden for 10-15 minutter efter lukning: Final Whistle poster i Discord, squad enforcement kører (auto-køb/-salg + bøde hvis udenfor divisions min/max), sæson 1 starter og sponsor 240.000 CZ$ lander på alle hold.",
          "DA · Sæson 0 → 1 er en speciel overgang: ingen lønnedtræk og ingen renter (der er ingen sæson 0 at lave op for). Sponsor er det eneste pengeflow. Normal cyklus starter fra sæson 1.",
          "DA · Nyt 'Klar til deadline?'-panel på admin-siden viser live: er closes_at sat, hvem er udenfor min/max, hvor mange aktive auktioner/transfers/byttehandler/lejeaftaler, og om sæson 1's kalender er klar. Refresh-knap + dry-run preview af sæson-skifte med sponsor-breakdown per hold.",
          "DA · Løbskalender-generator udvidet med race-type-filter (endags/etape), 'tilføj fra sprungede løb'-panel og en opt-in 'erstat eksisterende løb'-tilstand til at re-generere uden duplikater.",
          "DA · Fire nye hjælpe-artikler: sæson 0 → 1 specialer, deadline-tidslinje, squad enforcement, sæson 1 løbskalender.",
        ],
      },
    ],
  },
  {
    version: "3.60",
    date: "2026-05-19",
    label: "Beta",
    changes: [
      {
        category: "Infra · Bundle-split for public landing pages (Refs #479)",
        items: [
          "Layout-component + Microsoft Clarity SDK + Vercel Analytics + Vercel Speed Insights flyttet fra main bundle til lazy chunks. Public routes (/founder-supporter, /login, /privacy-*) loader nu ikke app-shell eller analytics-vendor-kode i den render-blocking entry-bundle.",
          "Main bundle: 765.6 KB → 737.3 KB (-28 KB raw, -7.8 KB gzipped). Nye lazy chunks: Layout 19.6 KB, vercelAnalyticsIntegration 2.8 KB, speedInsightsIntegration 2.5 KB, clarityIntegration 1.1 KB, clarity SDK 0.7 KB.",
          "Delvis fremskridt mod #479 mobile Lighthouse Performance ≥ 90 target (baseline 78). Fuld opnåelse kræver yderligere skridt (i18n provider lazy-load for public routes, standalone /founder-supporter entry-point) som tages i separat session.",
          "Ingen brugersynlig UI-ændring. Brugerverifikation: Lighthouse mobile på prod /founder-supporter efter Vercel-deploy. Desktop Performance skal forblive 90+ uden regression.",
        ],
      },
    ],
  },
  {
    version: "3.59",
    date: "2026-05-19",
    label: "Beta",
    changes: [
      {
        category: "Update · A fair premium conversation / En fair premium-samtale (#366)",
        items: [
          "EN · CyclingZone has been free since the start, and the competitive game will stay free. I am now asking players whether there is a fair way to make the project sustainable long-term.",
          "EN · The promise: the game must be fair for everyone. You cannot pay for better riders, faster training, or better results.",
          "EN · If premium happens later, it would be for identity, convenience, analytics and ways to back development. It would not include stronger riders, transfer advantages, better scouting odds, hidden power or restricted core gameplay.",
          "EN · Over the next few weeks, I will ask for feedback through Discord, a short survey and a non-binding Founder waitlist. No payment is live now, and I am not building Stripe or gating the free game before the community has helped shape the direction.",
          "EN · Join the conversation in Discord: https://discord.gg/ykysBrWUyC",
          "DA · CyclingZone har været gratis siden starten, og det konkurrencemæssige spil forbliver gratis. Jeg spørger nu spillerne, om der findes en fair måde at gøre projektet bæredygtigt på lang sigt.",
          "DA · Løftet: spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater.",
          "DA · Hvis premium kommer senere, skal det handle om identitet, bekvemmelighed, analyser og måder at bakke udviklingen op. Det skal ikke give stærkere ryttere, transfer-fordele, bedre scout-odds, skjult magt eller begrænse core-spillet for gratis spillere.",
          "DA · I de næste uger beder jeg om feedback via Discord, en kort survey og en uforpligtende Founder-waitlist. Betaling er ikke live nu, og jeg bygger ikke Stripe eller lukker dele af det gratis spil, før communityet har været med til at forme retningen.",
          "DA · Join samtalen i Discord: https://discord.gg/ykysBrWUyC",
        ],
      },
    ],
  },
  {
    version: "3.58",
    date: "2026-05-19",
    label: "Beta",
    changes: [
      {
        category: "Infra · i18n Fase 3.5 — BoardPage på EN/DA (#484)",
        items: [
          "Feature · Hele Bestyrelse-siden kører nu på begge sprog: sidetitlen, baseline-sæson observation-kort, klub-DNA-valg (3 forslag + badge), bonus-tilbud-card, konsekvens-panel (lønloft, signing-restriktion, tvunget salg, sponsor-pull-out), board-feed, auto-accept countdown og tilfredshedsforklaring.",
          "Feature · DashboardPlanPanel: 3-panel grid (5yr/3yr/1yr) oversat fuldt ud inkl. fokus-label, mål-progress, plan-timeline, halvvejsevaluering, sæsonhistorik-tabel, kumulative stats og bestyrelsens vurdering med personality-tags (Lav/Moderat/Høj ambition × Forsigtig/Balanceret/Aggressiv økonomi × Svag/Moderat/Stærk identitet).",
          "Feature · Plan-forhandlings-wizard (3 trin: Strategi / Forhandling / Underskrift): alle krav-kort, status-badges (I fare / At risk, Tæt på / Close, På sporet / On track, Hold øje / Watch), board-request-outcomes (Godkendt / Approved, Delvist / Partial, Tradeoff, Afvist / Rejected) plus multi-plan renewal-flow og setup-onboarding-headers følger sproget.",
          "Feature · BoardEmptyState (managers uden plan): \"Mød din bestyrelse / Meet your board\"-kort med 1yr/3yr/5yr-forklaring, satisfaction→sponsor-modifier-skala og KPI-kategorier (Resultater, Økonomi, Identitet, Rangering) oversat. Tour-trin matcher BoardPage's `buildBoardTourSteps(t)` så onboarding-overlay følger sproget.",
          "Tone · Em-dash systematisk renset i alle nye player-facing strenge jf. tone-of-voice-guide. Erstattet med komma, kolon, parentes eller punktum afhængigt af kontekst.",
          "Infra · Nyt `board`-namespace (~110 keys/sprog) inline-bundlet i `i18n/index.js` (matcher help-pattern fra Fase 3d) for FOUC-fri first paint. Helper-functions: `getBoardGoalLabel(t, goal)`, `getPlanLabel(t, planType)`, `getFocusLabel(t, focus)`, `getGoalStatusMeta(t, status)`, `buildBoardTourSteps(t)`, `describeConsequence(t, c)`. Style-only constants (farver, emoji, severity) adskilt fra label-data så stylingen kan deles på tværs af sprog.",
          "Infra · `FOCUS_LABELS`-konstant fjernet fra `lib/boardUtils.js` (nu kun i `focus.*`-keys i board-namespace). `formatCash` skifter fra hardcoded `da-DK`-locale til i18next-locale-aware `formatNumber` fra `lib/intl.js`, så 1.500.000 CZ$ formatteres korrekt på begge sprog.",
          "Scope · Backend-leverede strenge (board-member labels, goal labels fra API, DNA-beskrivelser, request-tekster, identity-profile summary, outlook-feedback) bevarer backend-sproget. Backend-localization tages som separat slice — alle frontend-konstruerede strings er nu locale-aware.",
        ],
      },
    ],
  },
  {
    version: "3.57",
    date: "2026-05-18",
    label: "Beta",
    changes: [
      {
        category: "Infra · i18n Fase 3d — Help på EN/DA (#412)",
        items: [
          "Feature · Hele Hjælp & Regler-siden kører nu på begge sprog: sidetitlen, søgeboks, sidebar med 14 sektioner (Kom i gang / Getting started, Bestyrelse / Board, Auktioner / Auctions, Transfers, Manager & Profil / Manager & Profile, Discord DMs, Achievements, Talentspejder / Watchlist, Min Aktivitet / My Activity, Sæson / Season, Præmier / Prizes, Divisioner / Divisions, Ryttere / Riders, Aktivitetsfeed / Activity feed) og FAQ med 53 spørgsmål-svar.",
          "Feature · Alle ~80 indholds-blokke (titel + tekst, step-lister og tabeller) oversat fuldt ud. Tabeller bevarer struktur (Konsekvens-tier, Discord DMs, Achievement-kategorier, Divisionsbonus, Præmie-eksempler, Holdstørrelse, Aktivitetsfeed-events). Search filtrerer på tværs af sektion-labels, blok-titler, blok-tekst og FAQ Q/A på det aktive sprog.",
          "Tone · Em-dash systematisk renset i begge sprog jf. tone-of-voice-guide (2026-05-18). Erstattet med komma, kolon, parentes eller punktum afhængigt af kontekst. Ingen player-facing em-dash tilbage i Hjælp & Regler.",
          "Infra · Nyt `help`-namespace (~520 keys/sprog) inline-bundlet i `i18n/index.js` (matcher common/auth/errors/auctions/transfers/dashboard/banners-pattern) for FOUC-fri first paint. SECTIONS-array og FAQ-array refaktoreret fra hardcoded datastrukturer til `buildSections(t)` + `buildFaq(t)` hjælpefunktioner med stabile semantic keys (`sections.<area>.<block>.title|text|steps|rows`, `faq.<id>.q|a`).",
          "Scope-justering · AdminPage forbliver dansk-only by design — alle 23 sektioner er internal admin-tools (race-katalog, økonomi, sæsoner, manuel override, discord webhooks, beta-reset osv.) bag admin-role gating. Ingen publik-facing flader. Issue #412 acceptance opdateret tilsvarende.",
          "Næste · #412 lukkes når alle Fase-3-sider er live og verificeret.",
        ],
      },
    ],
  },
  {
    version: "3.56",
    date: "2026-05-18",
    label: "Beta",
    changes: [
      {
        category: "Infra · Revert: Google Fonts async loading (negativ effekt på Performance)",
        items: [
          "Reverteret commit f166f87 (font-async eksperiment). Loadcss-pattern (`rel=\"preload\" as=\"style\" onload=\"this.rel='stylesheet'\"`) reducerede ikke FCP som forventet og introducerede CLS 0 → 0.092 fra FOUT-swap. Mobile Performance: 78 → 74-75 (-3 til -4 point). Tilbage til render-blocking `<link rel=\"stylesheet\">` indtil bundle-perf battle gribes med bedre pattern (font-display: optional + size-adjust fallback). Learning dokumenteret i #479 follow-up.",
        ],
      },
    ],
  },
  {
    version: "3.55",
    date: "2026-05-18",
    label: "Beta",
    changes: [
      {
        category: "Fix · Lighthouse SEO + A11y polish på Founder Supporter waitlist (#361)",
        items: [
          "Fix · robots.txt manglede (returnerede SPA-fallback index.html) — Google og andre crawlere kunne ikke korrekt indeksere /founder-supporter waitlist-siden. Ny `public/robots.txt` med Allow-all + sitemap-pointer. Score: SEO robots-txt audit 0 → 100.",
          "Fix · Canonical link var statisk `https://cycling-zone.vercel.app/` i index.html, men /founder-supporter rapporterede 'invalid canonical' fordi den pegede væk fra current route. FounderSupporterPage opdaterer nu `<link rel=\"canonical\">` dynamisk via useEffect til den faktiske URL. Score: SEO canonical audit 0 → 100.",
          "Fix · Hero-badges (Open beta / Fair freemium / GDPR-compliant) brugte `text-cz-3` (#9896b0 mod #f0ede6 baggrund = 3.4:1 kontrast) — under WCAG AA's 4.5:1 minimum for normal text. Skiftet til `text-cz-2` (#66637a = ~6:1). Score: A11y color-contrast audit 0 → 100.",
          "Fix · Privatlivspolitik-link i samtykke-checkbox + andre `text-cz-accent`-links i waitlist-formularen brugte `hover:underline` (kun synlig underline ved hover). Lighthouse `link-in-text-block` fanger dette som 'links rely on color to be distinguishable'. Skiftet til altid-`underline`. Score: A11y link-in-text-block audit 0 → 100.",
          "Verifikation · Desktop Lighthouse: Performance 94 / A11y 96 / SEO 100 / Best Practices 100 (alle over #361's acceptance criteria 90+/95+/90+). Mobile-Performance 78 er ikke i acceptance criteria — bundle-optimization tages som separat polish-batch (#479).",
        ],
      },
    ],
  },
  {
    version: "3.54",
    date: "2026-05-17",
    label: "Beta",
    changes: [
      {
        category: "Fix · Dashboard rå i18n-keys (#470)",
        items: [
          "Fix · Dashboard viste ~20 rå i18n-keys i UI'et på både DA og EN (`STATS.BALANCE`, `cards.transfers.empty`, `forecast.tier.yellow.label`, ...). Manglende inline-bundling af `dashboard` + `banners`-namespaces i `i18n/index.js` betød at HttpBackend lazy-loade'd disse efter første render — med `useSuspense: false` returnerede `t()` raw key indtil fetch landede.",
          "Fix · Bundle-ændring: `dashboard.json` + `banners.json` (begge sprog) importeret direkte og tilføjet til `resources`-blokken. Samme pattern som `auctions` (#466) og `transfers` (#468). Bundle-overhead ~3KB gzipped per sprog.",
          "Infra · NY CI-guard `scripts/i18n-check-namespace-inline.mjs` (REQUIRED i `.github/workflows/i18n-check.yml`) parser `useTranslation(...)`-kald og `t(\"ns:key\")` på tværs af `frontend/src/**` og fejler hvis et brugt namespace ikke er inlinet i `i18n/index.js`. Forhindrer at samme bug-klasse rammer i fremtidige i18n-faser. Postmortem: `.claude/learnings/2026-05-17-i18n-namespace-inline-missing.md`.",
          "Dev · `window.__i18n` eksponeret i dev-bundle (kun `import.meta.env.DEV`) så fremtidig i18n-debugging kan ske direkte fra DevTools uden fuld login-flow.",
        ],
      },
    ],
  },
  {
    version: "3.53",
    date: "2026-05-17",
    label: "Beta",
    changes: [
      {
        category: "Infra · i18n Fase 3c — Transfers på EN/DA (#412)",
        items: [
          "Feature · Hele Transfers-siden kører nu på begge sprog: sidetitlen (Transfers), balance-card, transfervindue-banner (åbent/lukket), de 6 tabs (Modtagne / Received offers, Sendte / Sent offers, Historik / History, Byttehandler / Swaps, Lejeaftaler / Loans, Marked / Market).",
          "Feature · ReceivedOfferCard + SentOfferCard: alle status-badges (Afventer svar / Awaiting response, Modbud sendt / Counter sent, Aftalt — afventer vindue / Agreed — awaiting window, Accepteret / Accepted, Afvist / Rejected, Trukket tilbage / Withdrawn) plus alle handlings-knapper (Accepter, Modbud, Afvis, Bekræft handel, Annuller handel, Arkivér) oversat.",
          "Feature · SwapCard + NewSwapForm: bytte-handler oversat fuldt ud inkl. \"Du tilbyder / De tilbyder\" / \"You offer / They offer\", kontantbetaling-labels, ren-bytte-badge og bytteforslag-formular.",
          "Feature · LoanCard + NewLoanForm: lejeaftaler oversat inkl. status (Aktiv / Active, Købt / Bought, Annulleret / Cancelled), sæson-formattering (Sæson 3 / Season 3), lejegebyr/sæson, købsoption og udnyt-knap. Den bindende note (\"Aktive lejeaftaler er bindende\" / \"Active loans are binding\") følger sproget.",
          "Feature · TransferCard (marked): \"Til salg siden 3. jul\" / \"Listed since Jul 3\" bruger locale-aware dato. Send tilbud-knap, fjern-listing-bekræftelse og BidConfirmModal (mode=transfer) viser alle korrekt sprog.",
          "Feature · TeamTransferHistoryTab: transferhistorik på begge sprog — kolonne-headers (Dato/Type/Retning/Rytter/Modpart/Beløb), type-labels (Auktion/Transfer/Swap/Lån → Auction/Transfer/Swap/Loan), retning (Køb/Salg/Bytte → Buy/Sell/Swap), sæson-filter og (AI)/(lån)-tags.",
          "Feature · Toast-beskeder oversat for hele flow: tilbud sendt, accepteret af køber/sælger, bekræftet, annulleret, modbud sendt, nyt bud, trukket tilbage, arkiveret — separate tekster for transfers, swaps og loans. Confetti-celebrations (Transfer gennemført / Transfer complete, Byttehandel gennemført / Swap complete, Rytter købt / Rider bought) følger sproget.",
          "Feature · timeAgo-helper konverteret til hook `useTimeAgo()` der renderer \"Lige nu / Just now\", \"15m siden / 15m ago\" osv. på korrekt sprog.",
          "Infra · ~30 hardcoded `toLocaleString(\"da-DK\")`-kald i TransfersPage + TeamTransferHistoryTab erstattet med `formatNumber(...)` fra `lib/intl.js`. Datoer bruger `formatDate(...)`.",
          "Infra · `transfers`-namespace tilføjet (~150 keys/sprog) og inline-bundlet i `i18n/index.js` (matcher common/auth/errors/auctions-pattern) for FOUC-fri first paint.",
          "Næste · Fase 3d: HelpPage + AdminPage publik-facing dele (#412 fortsætter).",
        ],
      },
    ],
  },
  {
    version: "3.52",
    date: "2026-05-17",
    label: "Beta",
    changes: [
      {
        category: "Infra · i18n Fase 3b — Auctions på EN/DA (#412)",
        items: [
          "Feature · Hele auktions-flowet kører nu på begge sprog: sidetitlen \"Auktioner / Auctions\", 3 filter-tabs (Min situation / My situation, Alle / All, Andre managers / Other managers), Ønskeliste-toggle og Aktive / Historik-navigation.",
          "Feature · Alle stat-cards (Balance, Reserveret i bud / Reserved in bids, Ryttere nu / Riders now, Projektion / Projection) bruger nu locale-aware tal-formatering — \"1.500 CZ$\" på dansk, \"1,500 CZ$\" på engelsk.",
          "Feature · Auktions-tabel + mobil-kort: alle kolonne-headers (Rytter/Højeste bud/Tid tilbage/Alder/Løn/Potentiale/Sælger/Byd), badges (Vinder, Sælger, Din, Ext, Flash), countdown-timer (\"2t 15m\" / \"2h 15m\") og bid-knapperne (Byd/Hæv/Fejl) følger nu sproget.",
          "Feature · Autobud-loft (proxy): hele UX-flowet — opsætning, redigering, fjernelse, fejlbeskeder — oversat på begge sprog inkl. \"Autobud: max 15.000 CZ$\" / \"Auto-bid: max 15,000 CZ$\".",
          "Feature · BidConfirmModal: bekræftelses-dialogen for bud, autobud og transferbud viser nu titel, action-verb og knap-tekst på det valgte sprog.",
          "Feature · Live-elementer er oversat: aktivitets-tickeren (\"3 nye bud i sidste 30s\" med ICU plural), sidebar-feed (\"Du bød / You bid\", \"Modbud / Counter bid\", relative tidsstempler), overbid-toasts og first-bid hint-banneret.",
          "Feature · Empty-states og My situation-sektioner (🟢 Du leder / You're leading, 🔴 Du er overbudt / You've been outbid, 🔵 Du sælger / You're selling) er fuldt oversat med kontekstuelle hjælpe-tekster.",
          "Infra · ~16 hardcoded `toLocaleString(\"da-DK\")`-kald i AuctionsPage og 3 components erstattet med `formatNumber(...)` fra `lib/intl.js` — tal følger nu user's sprog-præference.",
          "Infra · `AUCTIONS_TOUR_STEPS` konverteret fra modul-konstant til `getAuctionsTourSteps(t)`-funktion så onboarding-tour rendres med korrekt sprog.",
          "Næste · Fase 3c: Transfers + transfer-historik (#412 fortsætter).",
        ],
      },
    ],
  },
  {
    version: "3.51",
    date: "2026-05-17",
    label: "Beta",
    changes: [
      {
        category: "Infra · i18n Fase 3a — Dashboard på EN/DA (#412)",
        items: [
          "Feature · Dashboard er nu fuldt oversat på begge sprog: header (Division + rytter-count + ind/ud/leje-deltas), squad-warning, Discord-DM-nudge, Deadline Day-banner, Sæson-banner, alle 4 stat-cards og alle 5 indholds-kort (Aktive Auktioner, Transfers & Tilbud, Kommende Løb, Division-Stilling, Bestyrelsens Status).",
          "Feature · Finance-forecast-kortet (\"Næste sæson — prognose\") og dets badge er oversat — inkl. de tre tier-labels (Grøn/Gul/Rød / Green/Yellow/Red) og hele cashflow-tabellen.",
          "Feature · Onboarding-progress-kortet (\"Kom i gang\") og completion-kortet (\"Du er klar\") med deres step-labels og CTA-links følger nu sproget.",
          "Feature · Tal og datoer på Dashboard formateres locale-aware (dansk \"1.234\" / engelsk \"1,234\"; løbsdatoer \"3. jul\" / \"Jul 3\") via `Intl.NumberFormat`/`DateTimeFormat`-wrappers i `lib/intl.js`.",
          "Infra · `dashboardSquadStats.warning` returnerer nu pure data (`{type, count, limit, division}`) i stedet for en hardcoded DK-streng — UI'et bygger beskeden via ICU plurals så \"Sælg 1 rytter\" og \"Sell 2 riders\" begge er korrekte.",
          "Infra · `formatDate(date, null, {day,month})` understøtter nu fine-grained Intl-options uden at klashe med `dateStyle`.",
          "Note · Bestyrelses-feedback-blokken (headline/summary/score-categories) kommer fra `/api/board/status` og er stadig DK-only — backend-i18n følger i en separat fase.",
          "Næste · Fase 3b: Auctions + bid-modal + Transfers (#412 fortsætter).",
        ],
      },
    ],
  },
  {
    version: "3.50",
    date: "2026-05-16",
    label: "Beta",
    changes: [
      {
        category: "Bug-bash · Tier 1-batch (#252, #258, #268, #446, #447)",
        items: [
          "Signup · Bootstrap fejler ikke længere stille på langsomt netværk. Vi venter nu op til 5 sek på Supabase-session (mod tidligere 1 sek) og logger fejl synligt; sidebar viser ikke længere 'Division undefined' / 'undefined CZ$' under den korte race-window før wizard popper op (#446).",
          "Mobil auktioner · Live bud-feed for dine egne auktioner vises nu under auktion-listen på mobil (tidligere kun desktop-sidebar). Du kan nu se modbud-aktivitet uden at åbne rytter-profilen (#258).",
          "Rytter-data · 'João Luis Almeida' (pcm_id 18428, fake duplikat med kopieret UCI-score) er pensioneret. Den ægte João Almeida (UAE Team Emirates, født 1998) er uberørt (#252, reported af friisisch på Discord).",
          "Auth · 'Privatlivspolitik / Privacy policy'-footer på login- og reset-password-siderne følger nu valgt sprog (én lokaliseret link i stedet for to hardcodede). EN-locale viser nu korrekt 'Privacy policy' (#447).",
          "Backend · `getTeamMarketState` returnerer nu et `future_count`-felt der trækker pending-out-ryttere fra capacity-baselinen, så squad-cap-checks bruger samme 'fremtidens hold-størrelse' som dashboard-tælleren. `total_count` bevaret som legacy felt; alle squadCapDiscipline-tests grønne (#268, follow-up til #250).",
        ],
      },
    ],
  },
  {
    version: "3.49",
    date: "2026-05-17",
    label: "Beta",
    changes: [
      {
        category: "Admin · Sprint-metrics dashboard (#365)",
        items: [
          "Admin · Ny rute `/admin/sprint-metrics` viser DAU/WAU/MAU/D7-retention/avg-session-length + top 5 features live mod Supabase. Erstatter den manuelle SQL-træk-rutine i sprint-dashboardet.",
          "Admin · Trend-pile pr. KPI sammenligner med samme vindue 7 dage tilbage; tids-vælger (24t/7d/30d/sprint-periode) styrer top-features og 'aktive i vindue'-kort.",
          "Admin · CSV-eksport formatterer rækkerne så de kan kopieres direkte ind i `docs/SPRINT_DASHBOARD.md` 'Game-metrics'-tabellen. Auto-refresh hver 5 min for at undgå over-polling.",
          "Backend · RPC `get_sprint_metrics(p_window)` er admin-only via `is_admin()`-gate og returnerer alle KPI'er i én jsonb-payload. Ikke-admin får 403.",
          "Note · Tilgængelig fra sidebar under Admin-gruppen kun for users med `role='admin'`.",
        ],
      },
    ],
  },
  {
    version: "3.48",
    date: "2026-05-16",
    label: "Beta",
    changes: [
      {
        category: "Infra · AI-workflow hooks + memory audit (#73, #75, #76, #77, #154, #380)",
        items: [
          "Infra · Nye PreToolUse-hooks beskytter mod token-spild og drift: `gh issue`-kommandoer uden filtre giver nu en warning, edits der ville sprænge `docs/NOW.md`'s 30-linjers grænse blokeres, og skriv til `docs/archive/**` blokeres med forklaring.",
          "Infra · Stop-hook auto-arkiverer overflødige linjer i `docs/NOW.md` til `docs/archive/NOW-YYYY-MM-DD.md` ved session-slut og minder om manglende `Refs #N`-issue-kommentar når seneste main-commit refererer et issue uden close-out.",
          "Infra · Ny `node scripts/audit-memory-dir.mjs` scanner WARM-tier memory for stale entries, frontmatter-rot og duplikater; planlægges som ugentligt scheduled-task. `check-agent-token-hygiene.ps1` advarer nu hvis memory-dir vokser >10 % siden sidste baseline.",
          "Infra · PatchNotes version-collision-checken (`scripts/check-patch-notes-version.js`) er nu LIVE som blokerende CI-step — verificeret efter #154 close-out.",
          "Note · Ingen brugerrettet UI-ændring i denne version; alle ændringer er på dev-workflow-laget.",
        ],
      },
    ],
  },
  {
    version: "3.47",
    date: "2026-05-16",
    label: "Beta",
    changes: [
      {
        category: "Infra · i18n Fase 2 — Login + onboarding på EN/DA (#411)",
        items: [
          "Feature · Login + signup + glemt-password er nu fuldt oversat på både engelsk og dansk. Skift sprog live med 🇩🇰/🇬🇧-knappen øverst til højre på login-siden — også før du logger ind.",
          "Feature · Reset-password-siden, setup-wizarden (\"navngiv dit hold\") og første-gang-velkomst-modalet er ligeledes oversat.",
          "Feature · Onboarding-tour-knapper (\"Næste\", \"Spring over\", \"Færdig\") tilpasser sig sproget.",
          "Feature · Sidebar viser nu \"Balance\" + division + online-tæller på dit valgte sprog. Sidebar-tal formateres efter sprog (dansk \"1.234\" / engelsk \"1,234\").",
          "Feature · Nye signups gemmer dit valgte sprog automatisk — du behøver ikke skifte igen efter første login.",
          "Infra · Fejlbeskeder fra Supabase auth (forkert password, allerede registreret email, rate-limit m.fl.) oversættes via ny `mapSupabaseAuthError`-helper.",
          "Infra · `auth.json` + `errors.json` bundles inline ligesom `common.json` — ingen flash af raw key-strings ved første sidevisning på login.",
          "Docs · Glossary udvidet med 13 nye termer (Team name, Manager name, Password, Reset link, Division, League m.fl.).",
          "Næste · Fase 3 oversætter Dashboard, riders/auctions-sider og rolige toasts (#411 fortsætter mod Dashboard scope).",
        ],
      },
    ],
  },
  {
    version: "3.46",
    date: "2026-05-16",
    label: "Beta",
    changes: [
      {
        category: "Infra · i18n foundation — EN/DA sprog-switcher (#410)",
        items: [
          "Feature · Ny 🇩🇰/🇬🇧 sprog-dropdown i sidebar-bunden (desktop) + mobile topbar. Lever-skift uden reload — vælg sprog én gang og det huskes både i din profil (DB) og lokalt i browseren.",
          "Feature · Eksisterende brugere er backfilled til dansk (du ser ingen ændring). Nye signups starter på engelsk som default.",
          "Infra · `users.language`-kolonne tilføjet med EN/DA-validering + sync-trigger til Supabase auth-metadata (klar til at email-templates og Edge Functions kan læse sproget).",
          "Infra · `react-i18next` + `ICU MessageFormat` (plural-håndtering) + HTTP backend (lazy-loaded namespaces). Common-strings (NavBar + switcher) bundles inline → ingen flash ved første sidevisning.",
          "Infra · `Intl.NumberFormat` / `DateTimeFormat`-wrappers i `lib/intl.js` så valuta og datoer formateres efter brugerens sprog (fx \"1.500,00 kr.\" på dansk, \"DKK 1,500.00\" på engelsk).",
          "Dev · Pseudo-locale `en-XA` aktiveres med `?pseudo=1` i URL'en — alle tekster wrappes i `[...]` så hardcoded strings (der endnu ikke er oversat) bliver synlige under udvikling.",
          "Docs · `docs/i18n/GLOSSARY.md` med 20+ domæne-termer (Squad, Bid, Manager, Patch Notes, CZ$, ...). CI-check fejler PR'er hvis en/da har forskellige nøgler.",
          "Næste · Fase 2 (#411) oversætter Login + onboarding-tekster, så hele appen ikke kun NavBar er flersproget.",
        ],
      },
    ],
  },
  {
    version: "3.45",
    date: "2026-05-16",
    label: "Beta",
    changes: [
      {
        category: "Sprint-validation · Founder Supporter landing page (#361)",
        items: [
          "Feature · `/founder-supporter` er nu en fuld landing page i stedet for kun en form-side. Hero med tagline + non-pay-to-win-løfte øverst, fair-premium-løftet i fremhævet boks, 4-tier pris-sammenligning (Free/Supporter/Pro Analyst/Patron) og separat \"hvad må sælges vs IKKE sælges\"-tabel direkte fra brand-løftet.",
          "Feature · Founder Supporter benefits-sektion (badge, Discord-rolle, profil-tema, Founder Wall, dev-opdateringer, roadmap-stemmer på non-balance) + FAQ med 6 spørgsmål (pay-to-win, free-konkurrence, betaling-live osv.).",
          "Feature · Sprog-toggle øverst (DA/EN) — synkroniseres med `?lang=en` i URL'en så delte links bevarer sproget. Hele siden + waitlist-formen oversættes inkl. radio-options, country-dropdown, fejlbeskeder og success-state.",
          "Feature · `?variant=A|B|C` (kombineret med `utm_campaign=launch_29dkk|49dkk|69dkk`) ændrer Supporter-prisen direkte i pris-sammenligningen — så 3 landing-varianter kan dele samme URL men vise forskellige priser. Annual-pris (490 DKK/år) udregnes nu dynamisk fra månedlig × 10 i stedet for hardcoded.",
          "SEO · OpenGraph + Twitter Card-metadata tilføjet i `index.html` (title, description, og:image på 1200×630 SVG, canonical URL). Discord/Slack/Twitter viser nu pænt preview-kort når landing-URL'en deles.",
          "Tests · 2 nye unit-tests for `validateForm(state, lang)` + `mapInsertError(error, lang)` — verificerer at engelske brugere får engelske fejlbeskeder. Backwards-compat: default `lang=\"da\"` så eksisterende kald uden lang-param fortsætter på dansk. 35/35 grønne.",
          "Sprint-validation unblocker #3 af 3 — #361 lukker sammen med #362 (form) + #363 (admin-dashboard), så Monetization Validation Sprint kan starte 2026-05-18 med fuld stack.",
        ],
      },
    ],
  },
  {
    version: "3.44",
    date: "2026-05-16",
    label: "Beta",
    changes: [
      {
        category: "Sprint-validation · Founder Supporter waitlist-form (#362)",
        items: [
          "Feature · Ny offentlig side `/founder-supporter` med waitlist-form: kontakt (email og/eller Discord-handle), interesseniveau, foretrukken tier (49/89/490 DKK eller kun gratis), valgfri benefits-prioritering, fritekst-grunde og land. GDPR-consent IKKE pre-tjekket; link til privatlivspolitik åbner i ny fane.",
          "Feature · UTM-tracking auto-capturer `utm_source`, `utm_campaign` og `utm_medium` fra URL — driver Option B price-variant-test (3 landing-varianter sender forskellige campaign-tags så vi kan måle hvilken pris der konverterer bedst).",
          "Feature · Honeypot-felt mod bot-spam; submit-button disables under indsendelse; dubletter behandles som soft-success (\"Du står allerede på listen\") så bots ikke kan recon hvilke emails der findes.",
          "Feature · Success-state takker brugeren og peger på Discord-invite (kommer med #415) + email-opfølgning. Fejl-state mapper Supabase RLS/network/unknown til danske beskeder.",
          "Infra · DB-migration tilføjer `country` (ISO-2 m. CHECK-constraint), `utm_campaign` og `utm_medium` til `founder_supporter_waitlist`. Indsending bruger `Prefer: return=minimal` (UDEN `.select()`) så anon-RLS ikke fejler på RETURNING.",
          "Admin · CSV-eksport på `/admin/waitlist` udvidet med de 3 nye kolonner (country/utm_campaign/utm_medium) — eksisterende dashboard og filtre uændrede.",
          "Tests · 24 nye unit-tests for form-helpers (UTM-parsing, validering, error-mapping, payload-builder); #359 RLS-regression (7/7) verificeret efter migration.",
        ],
      },
    ],
  },
  {
    version: "3.43",
    date: "2026-05-16",
    label: "Beta",
    changes: [
      {
        category: "Admin · Founder Supporter waitlist-dashboard (#363)",
        items: [
          "Admin · Ny rute `/admin/waitlist` (kun admin) viser alle waitlist-signups med sortering, filtrering på interesseniveau, tier, kilde, score-bucket og status.",
          "Admin · KPI-kort øverst: total signups, high-intent (intent_score ≥ 4), % der vil betale, % Pro Analyst-interesse (89+ DKK) og top 3 kilder.",
          "Admin · CSV-eksport af filtreret data (alle 16 kolonner inkl. PII) til lead-prioritering uden for app'en. Filnavn dato-stemplet.",
          "Admin · Intent-score-formel synlig som tooltip på score-kolonnen (Manus' 1-5-skala: interesse × tier-vægt + follow-up-bonus).",
          "Infra · Manuel refresh-knap; non-admin redirectes til `/dashboard` (klient-side gate + RLS-håndhævelse i DB).",
        ],
      },
    ],
  },
  {
    version: "3.42",
    date: "2026-05-16",
    label: "Beta",
    changes: [
      {
        category: "Privatliv · Vercel Web Analytics consent-gated (#372)",
        items: [
          "Privatliv · Vercel Web Analytics aktiveres nu kun hvis du har givet samtykke til `analytics` i cookie-banneret. Vælger du \"Kun nødvendige\", indlæses analytics-scriptet ikke — på linje med Microsoft Clarity og Vercel Speed Insights.",
          "Bugfix · Tidligere kørte analytics-scriptet ubetinget før consent-banneret nåede at resolve (regression fra auto-genereret Vercel-bot-PR #371). Default-deny respekteres nu fra første render.",
        ],
      },
    ],
  },
  {
    version: "3.41",
    date: "2026-05-15",
    label: "Beta",
    changes: [
      {
        category: "Privatlivspolitik · GDPR + Founder Supporter-waitlist (#360)",
        items: [
          "Docs · Privatlivspolitikken er udvidet med dedikeret sektion om Founder Supporter-waitlisten: hvilke data der gemmes (e-mail/Discord-handle, interesseniveau, foretrukken tier, opfølgnings-samtykke, attribution, samtykke-tidsstempel), formål, opbevaring (24 mdr. inaktivitet), tredjeparter, og at en tilmelding er uforpligtende.",
          "Feature · Engelsk version af privatlivspolitikken tilgængelig på `/privacy-policy`. Sprog-switcher i toppen af begge sider; footer-link på Login + Reset-password til både DK og EN.",
          "Docs · Dataansvarlig opdateret til `Cycling Zone v/ Nicolai Dolmer Mikkelsen` (enkeltmandsvirksomhed under registrering). Rettigheds-listen er nu eksplicit (indsigt, berigtigelse, sletning, dataportabilitet, indsigelse, tilbagetrækning, Datatilsynet-klage).",
          "Infra · `WaitlistConsentText`-komponent klar til embed i waitlist-form (#362) — IKKE pre-tjekket checkbox, link til privatlivspolitik åbner i ny fane.",
        ],
      },
    ],
  },
  {
    version: "3.40",
    date: "2026-05-15",
    label: "Beta",
    changes: [
      {
        category: "Feature · Transferhistorik på holdbasis (#25)",
        items: [
          "Feature · Hold-profilen (`/teams/:id`) og dit eget hold (`/team`) har nu en `Transferhistorik`-tab der viser alle køb og salg for holdet: auktioner, direct transfers, swap-handler og lejeaftaler i én samlet, kronologisk tabel.",
          "Feature · Tabellen er filtrerbar på sæson (default: denne sæson) og sortérbar på dato eller beløb. Swap-handler vises med begge involverede ryttere og evt. cash-justering; lejeaftaler markeres med `(lån)`.",
          "Feature · AI-hold-modparter inkluderes så det fulde finansielle billede er synligt; private statuses (pending/rejected/cancelled) ekskluderes ifølge eksisterende privacy-kontrakt (#105).",
        ],
      },
    ],
  },
  {
    version: "3.39",
    date: "2026-05-15",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Bestyrelsen — dublet-snapshots i Sæsonhistorik (#30)",
        items: [
          "Bugfix · Sæsonhistorik på Bestyrelse-siden kunne i sjældne tilfælde vise to rækker for samme sæson med forskellige rangs og tilfredshed-deltas (sket hvis sæson-slut-cron'en blev kørt mere end én gang for samme sæson). Database-constraint sikrer nu at hver plan kun kan have ét snapshot pr. sæson, og cron'en er gjort idempotent.",
        ],
      },
    ],
  },
  {
    version: "3.38",
    date: "2026-05-15",
    label: "Beta",
    changes: [
      {
        category: "UX · Indbakke aggregerer overbud-notifikationer (#312)",
        items: [
          "Feature · Flere `Du er blevet overbudt!`-notifikationer på samme auktion stables nu til én boble med tæller (`Du er blevet overbudt! (×17)`) i stedet for at fylde indbakken med 17 separate rækker. Boblen viser både første og seneste tidspunkt, bumpes til toppen ved nyt overbud, og forbliver ulæst indtil mindst ét klik.",
          "Feature · Klik på aggregat-boblen folder historikken ud (kronologisk liste af alle bud) og markerer alle som læst. `Vis auktion →`-knap dyb-linker til auktionssiden.",
          "Feature · Når auktionen afsluttes (`auction_won`/`auction_lost`) skjules outbid-aggregatet automatisk i UI'et, så kun afslutnings-notifikationen står tilbage. Underliggende rækker bevares i databasen.",
          "Infra · Aggregering sker client-side i [`groupNotifications.js`](frontend/src/lib/groupNotifications.js) med 12 unit-tests. Ingen DB-migration eller backend-ændringer — eksisterende 24-timers dedup-vindue i `notificationService.js` påvirkes ikke.",
        ],
      },
    ],
  },
  {
    version: "3.37",
    date: "2026-05-15",
    label: "Beta",
    changes: [
      {
        category: "Hold · Manager-navn synligt på holdsiden (#255)",
        items: [
          "Feature · Holdoversigten og Mit Hold viser nu manager-navnet som undertekst under holdnavnet, så det er nemt at se hvem der manager hvert hold.",
        ],
      },
    ],
  },
  {
    version: "3.36",
    date: "2026-05-15",
    label: "Beta",
    changes: [
      {
        category: "UX · Ryttere-filtre huskes ved navigation (#8)",
        items: [
          "UX · Filtrene på /ryttere nulstilles ikke længere når man klikker ind på en rytter og tilbage. Filtrene gemmes i URL'en (delbar) og i sessionStorage som fallback, så tilbage-navigation via topmenuen også genskaber dine valg.",
        ],
      },
    ],
  },
  {
    version: "3.35",
    date: "2026-05-15",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Hall of Fame (#223)",
        items: [
          "Managers-fanen i Hall of Fame viser nu manager-/holdnavnet i stedet for det login-username, som man oprettede sig med. Hvis manager-navn og holdnavn er forskellige, vises holdnavnet under som undertekst, og rækken linker til holdets profil.",
        ],
      },
    ],
  },
  {
    version: "3.34",
    date: "2026-05-15",
    label: "Beta",
    changes: [
      {
        category: "UX · Indstillinger flyttet til bunden af sidebaren (#308)",
        items: [
          "UX · Indstillinger ligger nu nederst i sidebaren sammen med Hjælp & Regler og Patch Notes, så Klubhus-gruppen kun indeholder de daglige klubhus-funktioner. Indholdet på selve siden er uændret.",
        ],
      },
    ],
  },
  {
    version: "3.33",
    date: "2026-05-15",
    label: "Beta",
    changes: [
      {
        category: "Infra · Scaling Fase 3 — in-process response cache (#334)",
        items: [
          "Infra · `/api/riders` (60s TTL), `/api/races`, `/api/race-pool` og `/api/race-points` (10 min TTL) cacher nu responsen i backend-processen og rammer Supabase langt sjældnere ved gentagne reads. Ingen ekstra infra eller cost — Upstash Redis defer'es til når en anden backend-instans bliver relevant (#330).",
          "Infra · Cache invalideres automatisk når en handling ændrer state (auction-finalize, transfer-bekræftelse, swap-bekræftelse, lejeaftalens buyout, race-resultat-godkendelse, admin override/retirement/race-creation/race-pool-import). Aggressivt kort TTL på ryttere holder evt. resterende stale-vindue under 60 sekunder.",
          "Infra · Sentry breadcrumbs i `endpoint-timing`-kategorien giver P50/P95-baseline pr. endpoint så cache-effekten kan måles. Admin-endpoint `GET /api/admin/cache-stats` viser hit/miss/invalidations pr. namespace. `RESPONSE_CACHE_DISABLED=1` er break-glass.",
          "Bugfix · Cache-key normaliserer nu query-parametre sikkert, coalescer samtidige første reads, og forhindrer at en ældre in-flight miss kan genindføre stale data efter en invalidation.",
        ],
      },
    ],
  },
  {
    version: "3.31",
    date: "2026-05-13",
    label: "Beta",
    changes: [
      {
        category: "Infra · Zero-known-error hardening",
        items: [
          "Infra · Drift Monitor, audit-diagnoser, Quality Inbox, lint warning-budget og Sentry error tracking er nu koblet sammen, så kendte errors/warnings bliver synlige og nye warnings ikke kan snige sig ind over baseline.",
          "Bugfix · Achievements-syncen tåler nu manglende public user-row ved login-streak check, så `/api/achievements/check` ikke fejler med Supabase `multiple (or no) rows returned` i den situation.",
        ],
      },
    ],
  },
  {
    version: "3.30",
    date: "2026-05-13",
    label: "Beta",
    changes: [
      {
        category: "Data · UCI-navneoverrides",
        items: [
          "Infra · Fire godkendte UCI-navnevarianter matches nu eksplicit i scraperen (Benjamí Prades, Bjoern Koerdt, Joe Blackmore, Natnael Tesfazion), og to godkendte ikke-fundne ryttere kan nu sættes til minimum i stedet for at blive high-value-beskyttet. Ukendte navne bliver fortsat ikke gættet.",
        ],
      },
    ],
  },
  {
    version: "3.29",
    date: "2026-05-13",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · UCI-sync opdaterer hele rytterdatabasen",
        items: [
          "Infra · UCI-syncen henter nu alle ryttere fra databasen i paginerede batches i stedet for kun Supabase REST-defaulten på 1000 rækker. Det betyder at hele rytterdatabasen får korrekt UCI-point, værdi og løn ved den ugentlige sync.",
        ],
      },
    ],
  },
  {
    version: "3.28",
    date: "2026-05-13",
    label: "Beta",
    changes: [
      {
        category: "Drift · UCI Rankings Sync hardening",
        items: [
          "Infra · Den ugentlige UCI-sync flyttes fra minut 00 til 06:17 UTC onsdag morgen, så GitHub Actions ikke rammer top-of-hour load hvor scheduled jobs kan blive forsinket eller droppet.",
          "Infra · Efterberegningen af rytterlønninger efter UCI-sync bruger nu eksplicit WebSocket-transport i Supabase-klienten, så workflowet kan gennemføre på Node 20 efter scraperen har opdateret Google Sheets og Supabase.",
        ],
      },
    ],
  },
  {
    version: "3.27",
    date: "2026-05-13",
    label: "Beta",
    changes: [
      {
        category: "QA · Playwright smoke og visuel regression (#329)",
        items: [
          "Infra · Login, Dashboard, Ryttere, Auktioner, Mit Hold, Finanser, Bestyrelse, Sæson-snapshot og Indbakke har nu en Playwright-smoke med mockede Supabase/backend-svar og desktop/mobile screenshots som let visuel regression. PR-checken kræver ingen live secrets og skriver ikke til produktion.",
        ],
      },
    ],
  },
  {
    version: "3.26",
    date: "2026-05-13",
    label: "Beta",
    changes: [
      {
        category: "Sikkerhed · Backend rate limiting (#328)",
        items: [
          "Infra · Bud-, transfer-, board- og admin-endpoints er nu beskyttet mod misbrug og trafikspikes via per-bruger throttling på backend. Ingen synlig ændring for managers i normal brug — du kan i sjældne tilfælde se en `For mange handlinger på kort tid`-besked hvis et script eller hurtige klik overstiger grænserne. Cron- og baggrunds-flows er ikke påvirket.",
        ],
      },
    ],
  },
  {
    version: "3.25",
    date: "2026-05-12",
    label: "Beta",
    changes: [
      {
        category: "Infra · AI-Autopilot Fase 2 (#Scaling)",
        items: [
          "AI · CI-workflows opdateret med spec-reportere for bedre AI-læsbarhed og fejlfinding.",
          "AI · Manus formaliseret som orkestrator for Auto-PR-review (Loop D) og subagent-loops (Loop F).",
          "AI · Etablering af world-class AI-standard for projekt-skalering og automatiseret test-disciplin.",
        ],
      },
    ],
  },
  {
    version: "3.24",
    date: "2026-05-12",
    label: "Beta",
    changes: [
      {
        category: "UI · Ryttersammenligning er nu opdagelig (#63)",
        items: [
          "Manager · Værktøjet til at sammenligne op til 3 ryttere side-by-side (`/compare`) bor nu der hvor du tager rytterbeslutningen: en `⇄ Sammenlign`-knap på rytterprofilen åbner sammenligning med rytteren forudvalgt, og i rytterdatabasen + på ønskelisten kan du markere 2-3 ryttere via en ny ⇄-kolonne og åbne dem alle i sammenligningen via den flydende bjælke i bunden. URL'en `/compare?ids=...` er nu deep-link-bar og kan deles.",
        ],
      },
    ],
  },
  {
    version: "3.23",
    date: "2026-05-12",
    label: "Beta",
    changes: [
      {
        category: "UI · Klikbare holdnavne overalt (#316)",
        items: [
          "Manager · Holdnavne er nu klikbare links på alle sider: Rangliste, Auktionshistorik, Rytterstatistik (holdnavn, bud-historik, handelshistorik), Indbakke/Ligaen-feed, Hall of Fame, Rytterrangliste, Løbshistorik (vinderhold) og Transfermarked (sælger + Fra/Til-mønstrene). Klik på et holdnavn navigerer direkte til holdets side.",
        ],
      },
    ],
  },
  {
    version: "3.22",
    date: "2026-05-12",
    label: "Beta",
    changes: [
      {
        category: "Sikkerhed · Gitleaks som required check (#303)",
        items: [
          "Infra · `gitleaks` secret-scanner er nu en *required* status check på `main` (efter 6 grønne PR-runs siden 2026-05-11). En PR kan ikke længere merges hvis gitleaks finder en hardcoded API-nøgle eller token. Ingen synlig ændring for managers — det er et ekstra net under enhver kode-ændring.",
        ],
      },
    ],
  },
  {
    version: "3.21",
    date: "2026-05-11",
    label: "Beta",
    changes: [
      {
        category: "Auth · Password-reset og uventede logouts (#35)",
        items: [
          "Manager · \"Glemt password\"-reset-mailen kunne lande på en intern Vercel-login-side i stedet for spillet, fordi reset-linket fulgte den URL du startede fra — herunder Vercel's auto-genererede preview/team-domæner som var SSO-beskyttede. Reset-link peger nu altid på `https://cycling-zone.vercel.app/reset-password`, uanset hvilken vercel-URL du tilgår spillet fra.",
          "Manager · De to ekstra `*.vercel.app`-domæner som Vercel auto-genererede til projektet er nu offentligt tilgængelige (Vercel Authentication slået fra). Hvis du bookmarkede et af dem, virker det fra nu af også — du behøver ikke logge ind med en Vercel-konto.",
          "Manager · Hvis du blev logget ud i går aftes/i morges efter sikkerhedsopdateringen (#296 Supabase key-rotation), så log bare ind igen — det er en engangs-effekt.",
        ],
      },
    ],
  },
  {
    version: "3.20",
    date: "2026-05-11",
    label: "Beta",
    changes: [
      {
        category: "Observabilitet · Event-logging baseline (#137)",
        items: [
          "Manager · Hvis du har accepteret Analyse-kategorien, registreres nu 10 anonyme handlinger pr. spiller: log-ins, auktionsvisninger, bud, transfertilbud, notifikations-klik samt 5 \"feature-impressions\" (Udvikling-fanen, Hall of Fame, Finance forecast, Board-konsekvenser, Admin-auktionsregler). Vi ser kun aggregeret data — RLS sikrer at du kun kan se dine egne events.",
          "Manager · Hvis du har afslået Analyse, logges intet — samme gate som Microsoft Clarity (#297).",
          "DB · Ny `player_events`-tabel (team_id, user_id, event_name, event_data, created_at) med RLS-policies så managers kun ser egne rækker.",
          "Backwards-audit · Ny Detector E i `audit-feature-liveness` finder \"deployed feature med 0 impressions sidste 30 dage\" — generaliserer slice 14 / #279-mønstret til frontend-only features hvor Detector A (backend-write) ikke kan se noget. Workflow kører ugentligt mandage 04:00 UTC og åbner tracking-issue ved fund.",
        ],
      },
    ],
  },
  {
    version: "3.19",
    date: "2026-05-11",
    label: "Beta",
    changes: [
      {
        category: "Sikkerhed · Supabase service-nøgle roteret (#296)",
        items: [
          "Backend · Den service_role API-nøgle der gav fuld adgang til databasen er udskiftet til Supabase's nye `sb_secret_...` system. Per-nøgle revokering betyder at hvis en nøgle eksponeres i fremtiden, behøver vi ikke længere rotere fælles JWT-secret.",
          "Backend · Den gamle nøgle (commiteret offentligt i `setup.py` i Initial commit 2026-04-17) er nu deaktiveret. Ingen kendt misbrug før rotation.",
          "Repo · `setup.py` læser nu nøgler fra miljøvariabler i stedet for hardcoded værdier — fremtidige clones skal selv sætte env vars.",
          "Drift · Ingen brugerrettet ændring; backend redeployet uden mærkbar nedetid.",
        ],
      },
    ],
  },
  {
    version: "3.18",
    date: "2026-05-11",
    label: "Beta",
    changes: [
      {
        category: "Privatliv · Samtykke-banner og privatlivspolitik (#297, #52)",
        items: [
          "Alle besøgende · Første gang du åbner spillet, vælger du nu om vi må indsamle Analyse-, Marketing- og E-mail-data. Nødvendige cookies (login, tema, samtykke) er altid på. Du kan altid skifte valg under Profil → Privatliv.",
          "Manager · Microsoft Clarity-analytics indlæses kun hvis du har accepteret Analyse-kategorien. Vi gætter ikke længere på UX-problemer; med samtykke kan vi se hvor brugere klikker forgæves og rette det.",
          "Manager · Ny side `/privatlivspolitik` med fuld disclosure af hvilke data vi behandler, hvor de opbevares (Supabase EU, Vercel, Railway, Clarity) og dine rettigheder under GDPR.",
          "Backend · `users.consent_preferences` JSONB-kolonne gemmer dine valg på tværs af enheder; pre-login valg gemmes i localStorage og migreres til kontoen ved login.",
          "Hver eksisterende manager ser banneret én gang ved næste besøg.",
        ],
      },
    ],
  },
  {
    version: "3.17",
    date: "2026-05-11",
    label: "Beta",
    changes: [
      {
        category: "Admin · Økonomi-panel taler dansk nu",
        items: [
          "Admin · Felterne `Reason code`, `Actor type`, `Source path` og `Action type` vises som danske labels (fx \"Sponsorindtægt (sæsonstart)\" i stedet for `season_start_sponsor`, \"Automatisk job\" i stedet for `cron`, \"Auktion — udbetaling til sælger\" i stedet for `auctionFinalization.finalizeAuctionRecord.seller`).",
          "Admin · Detalje-modalen er omdøbt: `Reason code` → Begivenhed, `Actor type` → Hvem udløste, `Source path` → Kilde i koden, `Idempotency key` → Sikrings-nøgle. Den tekniske enum-værdi vises stadig i parentes så devs kan korrelere med kode/logs.",
          "Admin · Kolonneoverskrifter (`Reason`, `Actor`, `Source path`, `Action`) er omdøbt til Begivenhed, Udløst af, Kilde i koden, Handling.",
          "Ingen DB- eller API-ændringer — kun visning.",
        ],
      },
    ],
  },
  {
    version: "3.16",
    date: "2026-05-11",
    label: "Beta",
    changes: [
      {
        category: "Admin · Pensionerede ryttere kan skjules og låses",
        items: [
          "Admin · Manuel override på `/admin` kan nu markere en rytter som pensioneret eller aktivere rytteren igen. Pensionerede ryttere bliver i databasen, så historik kan bygges på samme rytter-id senere.",
          "Manager · Pensionerede ryttere skjules fra rytterdatabasen og handelssøgninger, og rytterprofilen viser en låst status i stedet for auktions-/transferknapper.",
          "Backend · Nye auktioner, transferlistinger, direkte tilbud, byttehandler og lejeaftaler afvises server-side hvis en involveret rytter er pensioneret.",
        ],
      },
    ],
  },
  {
    version: "3.15",
    date: "2026-05-11",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Nye hold får korrekt startøkonomi",
        items: [
          "Manager · Nye hold får nu 800.000 CZ$ i startbalance og 240.000 CZ$ i årlig intro-sponsor. Et live-signup edge case kunne oprette et placeholder-hold med testøkonomi (`balance=500`, `sponsor_income=100/500`) før backend-setup kørte.",
          "Manager · De berørte live-hold uden finance-transaktioner bliver normaliseret til de korrekte værdier. Fremtidige signup-placeholder-rækker repareres også automatisk, når holdsetup gemmes.",
          "Backend · Signup-trigger/defaults låses igen til den kanoniske økonomikontrakt, og `teamProfileEngine` reparerer kun kendte placeholder-værdier uden at overskrive reelle eksisterende balances/sponsorbeløb.",
        ],
      },
    ],
  },
  {
    version: "3.14",
    date: "2026-05-11",
    label: "Beta",
    changes: [
      {
        category: "Hardening · Upload-fejl håndteres kontrolleret (#295 follow-up)",
        items: [
          "Admin · Hvis en resultatfil er over 10 MB, svarer backend nu med kontrolleret JSON-fejl (`upload_file_too_large`) i stedet for at lade multer/Express sende en generisk parser-fejl. Det gør fejlen lettere at vise og debugge i admin-flowet.",
          "Backend · Multipart-regressionstesten dækker nu også upload-limit edge casen oven på `file`, `race_id`, `stage_number`, `.xls` accept og non-Excel rejection. Backend-testpakken er nu 581/581 grøn.",
        ],
      },
    ],
  },
  {
    version: "3.13",
    date: "2026-05-11",
    label: "Beta",
    changes: [
      {
        category: "Security · Admin-resultatupload bruger nu multer 2.x (#295)",
        items: [
          "Admin · Excel-upload til løbsresultater er opgraderet til `multer@2.1.1`, som lukker de åbne high Dependabot-alerts på upload-parseren uden at ændre admin-flowet: vælg løb, etape og upload fil som før.",
          "Admin · Backend accepterer nu eksplicit både `.xlsx` og legacy `.xls` fra admin-UI'et og holder fortsat filen i memory med 10 MB upload-loft, før resultaterne parses og sendes gennem den eksisterende raceResultsEngine.",
          "Backend · Upload-konfigurationen er flyttet til et testbart `adminImportUpload`-modul med multipart regressionstest, der verificerer `file`, `race_id`, `stage_number`, MIME-filter og kontrolleret JSON-fejl ved for stor fil gennem rigtig Express/multer middleware på multer 2.x.",
        ],
      },
    ],
  },
  {
    version: "3.12",
    date: "2026-05-11",
    label: "Beta",
    changes: [
      {
        category: "Feature · Sponsor følger resultater fra sæson 2 (#84)",
        items: [
          "Manager · Sponsor er nu sportsligt fra sæson 2: 200.000 CZ$ fast base + 0-150.000 CZ$ variabel del baseret på forrige sæsons point og placering i divisionen. Sæson 1 forbliver fast 240.000 CZ$ som introsæson.",
          "Manager · Finanser-prognosen viser nu sponsor-breakdown, så du kan se om næste sæsons sponsor er intro, fallback eller variabel baseret på sidste sæsons rang/point. Board-modifier og sponsor-pullout lægges stadig ovenpå den samme base.",
          "Backend · Ny delt `sponsorEngine` bruges af sæsonstart, season-transition preview og finance forecast, så admin-preview, faktisk payout og manager-UI beregner sponsor fra samme kontrakt. Variabel sponsor har hårdt loft på 350.000 CZ$ før modifier og gulv på 200.000 CZ$ før modifier.",
        ],
      },
    ],
  },
  {
    version: "3.11",
    date: "2026-05-10",
    label: "Beta",
    changes: [
      {
        category: "Drift · UCI-point synkroniseres nu om onsdagen i stedet for mandagen",
        items: [
          "Manager · Den ugentlige UCI-point-opdatering fra ProCyclingStats (top 3000 ryttere → rytter-værdi/løn) flyttes fra mandag morgen 06:00 UTC til onsdag morgen 06:00 UTC. Dine ryttere får derfor friske UCI-point én gang om ugen onsdag i stedet for mandag — alle safety-gates fra v2.27 (compound-surname-match, høj-værdi-beskyttelse, mass-downgrade-loft) er uændrede.",
          "Internt · `.github/workflows/uci_sync.yml` cron ændret fra `0 6 * * 1` til `0 6 * * 3`. 21/21 unit tests grønne; sidste schedule-run mandag 2026-05-04 verificeret success (3000 ryttere, 4/100 downgrades, ingen safety-trip).",
        ],
      },
    ],
  },
  {
    version: "3.10",
    date: "2026-05-10",
    label: "Beta",
    changes: [
      {
        category: "Quality · Backwards-audit fanger 'deployed kode + 0 data / 0 brugere'-mønstret (#287)",
        items: [
          "Internt · Nyt audit-script `backend/scripts/audit-feature-liveness.js` med 4 detector-klasser kører ugentligt cron + på alle PRs der rører schema/routes/frontend: (A) tabeller hvor backend skriver men der er 0 rows, (B) backend-endpoints uden frontend-caller, (C) migration committed men ikke applied, (D) prod-tabel uden CREATE TABLE i repo. Generaliserer slice 14 / #279-mønstret til flere drift-klasser.",
          "Internt · Workflow `feature-liveness-audit.yml` blokerer PR-merge ved nye findings og opretter auto-tracking-issue (label `quality-drift`) ved cron-drift. Helper-RPCs i ny migration. Agent-doctor.ps1 kører samme check lokalt før push.",
          "Internt · Første run mod main bekræftede #284: 3 board-tabeller (board_consequences/board_request_log/team_board_members) er milestone-gated tomme — ikke broken — som dokumenteret i b53d831. Detector D afslører desuden 15 Studio-oprettede legacy-tabeller fra før migration-workflow (separat backfill-issue følger).",
        ],
      },
    ],
  },
  {
    version: "3.09",
    date: "2026-05-10",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Rytter kan ikke længere sættes til salg flere gange (#247)",
        items: [
          "Manager · Du kan nu kun have ÉN aktiv 'til salg'-listing pr. rytter ad gangen. Tidligere kunne du fejlbruge 'Sæt til salg' flere gange og oprette parallelle listings med forskellige priser, hvilket gav forvirrende dobbelt-visning i markedet og åbnede for at flere købere kunne lægge tilbud på samme rytter via forskellige listings.",
          "Manager · Hvis du prøver at oprette en ny listing på en rytter du allerede har til salg, får du nu en venlig fejl ('Rytteren er allerede til salg på transfermarkedet'). Vil du ændre prisen, fjern den eksisterende listing først via '🗑️ Fjern fra transferlisten' i markedsoversigten.",
          "Backend · `POST /api/transfers` har nu både SELECT-pre-check og DB-niveau partial unique index (`uniq_transfer_listings_one_active_per_rider WHERE status IN ('open','negotiating')`). Race-vinduer ved dobbeltklik fanges af unique-constraint og mappes til 409 — samme mønster som auctions har haft siden 2026-05-06 (#69).",
        ],
      },
    ],
  },
  {
    version: "3.08",
    date: "2026-05-10",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Auktionshistorik — 'Købt'-fane viser alle (#246) + selv-køb tydeliggjort (#244)",
        items: [
          "Manager · 'Købt' og 'Solgt'-fanerne under Auktioner → Historik viser nu alle dine vundne/solgte auktioner uanset hvor mange sider historikken er på. Tidligere blev fanerne filtreret klient-side EFTER pagination, så hvis dine 5 vundne auktioner lå spredt over 10 historik-sider, kunne 'Købt'-fanen vise 0-1 rytter på den side du var på, og 'Næste'-knappen hoppede ofte til en tom side.",
          "Manager · Stats-tællerne (Købt/Solgt/Brugt/Tjent) er nu korrekte for hele din historik, ikke kun den side du står på.",
          "Manager · Når du selv vinder en auktion på din egen rytter (kan ske ved garanteret salg + afslutter du selv som leder), markeres rækken nu med en 'Selv'-badge og prisen vises neutralt uden minus/plus-prefix. Tidligere viste rækken 'Købt'+'Solgt'-badges med rødt minus-tegn på prisen, hvilket fejlagtigt antydede at du havde tabt penge — i virkeligheden er der intet nettoflow ved et selv-køb. Stats ekskluderer også selv-køb fra Brugt/Tjent.",
          "Backend · `AuctionHistoryPage.jsx` filtrerer nu på server-siden (`current_bidder_id`/`seller_team_id`) i stedet for klient-side, og kører separat aggregat-query for stats. Self-purchase detekteres i ny pure-helper `isSelfPurchase`. Pagination resettes til side 1 ved fane-skift så man ikke lander på tom side.",
        ],
      },
    ],
  },
  {
    version: "3.07",
    date: "2026-05-10",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Fjern-knappen virker nu rigtigt (#270 follow-up)",
        items: [
          "Manager · '🗑️ Fjern fra transferlisten'-knappen virker nu reelt — tidligere klikkede knappen, viste en grøn 'fjernet'-toast, men listingen forblev i markedet. Bag kulisserne fejlede DB-skrivningen lydløst, og frontend troede den var lykkedes.",
          "Backend · Endpointet skrev `status='closed'` til `transfer_listings`, men kolonnens CHECK-constraint tillader kun `open|negotiating|sold|withdrawn` — så UPDATE'en blev afvist af Postgres uden at backend tjekkede returkoden. Nu bruges `'withdrawn'` (samme værdi som transfer_offers/swap_offers withdraw-flows) og UPDATE-fejl propageres som 500 i stedet for at blive ignoreret.",
        ],
      },
    ],
  },
  {
    version: "3.06",
    date: "2026-05-10",
    label: "Beta",
    changes: [
      {
        category: "UX · Banken hedder nu AI (#14)",
        items: [
          "Manager · Holdet 'Banken' er omdøbt til 'AI' i hele spillet — det var hele tiden samme hold som AI-/free-agent-poolen (samme team-record med både `is_ai=true` og `is_bank=true`), men de to navne forvirrede. Nu er det ét konsistent navn alle steder: rytter-profiler, hjælpetekster, auktionshistorik og finance-beskrivelser.",
          "Manager · Garanteret salg fungerer præcis som før — startpris 50% af Værdi, AI køber rytteren hvis ingen manager byder højere. Kun ordlyden er ændret: 'Sælg til bank' → 'Garanteret salg', 'Bankryttere kan ikke modtage tilbud' → 'AI-ryttere kan ikke modtage tilbud'.",
          "Backend · Team-rækken med `is_bank=true` har fået `name='AI'` i prod. `is_bank`-flaget bevares som intern routing-markør for guaranteed-sale-flowet (uændret kode-path i `auctionFinalization.js`). Ingen funktionel ændring — kun strenge i `api.js`, `auctionFinalization.js`, `HelpPage`, `TeamPage`, `RiderStatsPage`, `AdminPage` og docs.",
          "Cleanup · Bug #245 (rytter fjernes fra hold ved auktion på pending-incoming) blev allerede fikset 2026-05-09 i commit `814b5dc` via `getAuctionStartIssue`-gate der returnerer 409 hvis `pending_team_id` er sat. Verificeret: 0 ryttere i prod har pending_team_id sat, og POST /api/auctions afviser tilstanden ved kilden.",
        ],
      },
    ],
  },
  {
    version: "3.05",
    date: "2026-05-10",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Fjern rytter fra transferlisten igen (#270)",
        items: [
          "Manager · Du kan nu fjerne en rytter fra transferlisten igen efter du har sat den til salg. Knappen '🗑️ Fjern fra transferlisten' vises på din egen listing under Transfers → Marked. Klik → bekræft → listingen lukkes og rytteren forsvinder fra markedet med det samme.",
          "Manager · Aktive tilbud på rytteren forbliver i deres state — købere kan stadig trække tilbage og du kan stadig afvise dem via det normale tilbuds-flow. Hvis du vil have dem helt af bordet, skal du afvise dem separat under Modtagne tilbud.",
          "Manager · Virker både i åbent og lukket transfervindue, så du kan rydde op i gamle listings uanset hvor i sæsonen du er.",
          "Backend · Endpoint `DELETE /api/transfers/:id` har eksisteret siden start, men UI-knappen var aldrig blevet bygget — kun statisk 'Din listing'-tekst blev vist på egne rækker. Ny pure-funktion `getListingCancelIssue` i `transferExecution.js` parallel til `getTransferCancelIssue`/`getSwapCancelIssue`/`getLoanCancelIssue` håndhæver ejer-check + status-gating (open/negotiating tilladt, closed/sold afvises som 400). 570/570 backend-tests grønne (+1 ny dækker not_found, not_owner, already_closed og happy path).",
        ],
      },
    ],
  },
  {
    version: "3.04",
    date: "2026-05-10",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Bud kan ikke længere sniges igennem efter auktionen er udløbet (#269)",
        items: [
          "Manager · Bud der lander efter auktionens sluttidspunkt afvises nu konsekvent med 'Auktionen er udløbet'. Tidligere var der et race-vindue på 100-500 ms mellem at serveren tjekkede 'er auktionen udløbet?' og at buddet blev gemt — i den korridor kunne et bud klikket meget tæt på (eller lige efter) sluttidspunktet stadig blive accepteret og forlænge auktionen yderligere.",
          "Manager · Konkret eksempel fra Axel Zingle's auktion 2026-05-10: et bud landede 308 ms EFTER calculated_end og udløste forlængelse #4, som muliggjorde forlængelse #5. Auktionen levede 11+ minutter ekstra. Med fixet kunne ingen af de to forlængelser være sket.",
          "Backend · DB-håndhævet via `BEFORE INSERT` trigger på `auction_bids` (migration `2026-05-10-reject-late-auction-bid-trigger.sql`). Triggeren afviser inserts hvor `bid_time >= auctions.calculated_end` eller status ≠ 'active'/'extended', uanset om buddet kommer fra POST /bid, PATCH /proxy openingBid eller cascade-proxy-counter. App-laget oversætter Postgres-fejlen (`P0001 auction_expired_at_insert`) til en venlig 400 i stedet for 500. 569/569 backend-tests grønne (+8 nye dækker trigger-error matcher + cascade-break ved late-bid + andre INSERT-fejl propageres).",
        ],
      },
    ],
  },
  {
    version: "3.03",
    date: "2026-05-10",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Auktioner forlænges kun ved reelt overbud (#257)",
        items: [
          "Manager · En auktion bliver nu KUN forlænget hvis bud reelt skifter hvem der fører. Tidligere udløste ethvert bud i de sidste 10 minutter en forlængelse — også når et autobud-loft straks bød op igen og holdt den oprindelige leder. Det betød at et 1-CZ$-bud kunne strække auktioner i det uendelige.",
          "Manager · Eksempel: Auktionen står på 20.000 CZ$ og du leder med autobud-loft 25.000. En anden manager byder 21.000. Dit autobud counter automatisk til 21.001 og du fortsætter som leder. Auktionen bliver IKKE forlænget — buddet flyttede ikke føringen.",
          "Manager · Hvis nogen byder OVER dit autobud-loft og overtager føringen, bliver auktionen stadig forlænget med 10 minutter (eller skubbet ud i grace-zonen / rullet over til næste døgn efter de eksisterende regler fra v2.87).",
          "Backend · Ny `applyLeaderShiftExtension`-helper i `auctionEngine.js` kaldes efter cascade af proxy-counter-bud er resolved; den sammenligner final leder med leder-før-bud og anvender kun forlængelsen ved skift. Cascaden selv extender ikke længere. 555/555 backend-tests grønne (+6 nye dækker spam-1-CZ-scenarie, leader-skift A→B, previousLeader=null, extension_count-bump fra eksisterende værdi, bid udenfor extension-vindue).",
        ],
      },
    ],
  },
  {
    version: "3.02",
    date: "2026-05-10",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Forsidens squad-tæller tager nu højde for transfers (#250)",
        items: [
          "Manager · Forsidens 'Ryttere'-tæller og squad-warning forudsiger nu fremtidens hold-størrelse efter vinduet lukker (ejede MINUS pending-out PLUS pending-in PLUS aktive lån) i stedet for kun at tælle nuværende ejede. Tidligere kunne advarslen vise falsk 'for stort' hvis du var ved at sælge en rytter, eller falsk 'for lille' hvis du havde vundet auktioner i sæson 0 der venter på vinduet — begge dele er væk nu.",
          "Manager · Header viser breakdown når der er bevægelse i holdet: 'Division 3 · 8 ryttere +2 ind −1 ud +1 leje', så du kan se på et øjeblik hvilke transfers der er undervejs. Stat-kortet 'Ryttere' viser fremtidens størrelse som primær tal og nuværende som sub.",
          "Refactor · Ny pure-funktion `computeDashboardSquadStats` i `frontend/src/lib/` med 11 unit-tests dækker alle hjørner: pending-in, pending-out, self-pending edge-case, deadline-day med både pending-in+pending-out, aktive lån, divisions-skalering. Sætter fundament for at samme regel kan genbruges på SeasonEnd, Finance og admin-overblik når de skal forudsige squad-status.",
        ],
      },
    ],
  },
  {
    version: "3.01",
    date: "2026-05-10",
    label: "Beta",
    changes: [
      {
        category: "Feature · Byd direkte fra rytter-profilen (#254)",
        items: [
          "Manager · Når en rytter har en igangværende auktion, kan du nu byde på den direkte fra rytter-profilen — uden at gå omvejen via Auktioner-listen. Bud-panelet ligger lige under rytter-headeren og viser højeste bud, tid tilbage, sælger og status-badges (Du leder · Du er overbudt · Du sælger · ⚡ Forlænget · ⚡ Flash).",
          "Manager · Fuld feature-parity med /auktioner — du kan både afgive almindelige bud, sætte/ændre/fjerne autobud-loft og bekræfte via samme bud-confirm-modal. Race-confirm-modal vises hvis prisen er ændret mens du forberedte dit bud (#194), og confetti popper når du vinder.",
          "Manager · Live-opdatering på rytter-profilen — pris-cellen blinker når andre overbyder dig, og en toast siger 'Du er overbudt på X' så du kan reagere uden at refresh'e siden. Samme realtime-channel som /auktioner.",
          "Refactor · Bid + autobud-state-machinen er trukket ud i en delt `useAuctionBidding`-hook + `auctionLogic`-modul, så AuctionsPage's tabel-row, mobile card og rytter-profilens bid-panel deler ÉN kilde til sandhed. Når der fixes en bug i bud-flowet fremover, bliver alle tre steder rettet på én gang.",
        ],
      },
    ],
  },
  {
    version: "3.00",
    date: "2026-05-10",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Auktion-vindere afvist i døren ved division-cap (#267)",
        items: [
          "Manager · Du må nu gå +2 over division-cap MIDT i et åbent transfervindue (D1 → 32, D2 → 22, D3 → 12). Squad-cap'en bliver først hard-håndhævet når transfervinduet lukker (squad-enforcement-cron auto-sælger ned til cap og fakturerer 100K CZ$ + 200 fradragspoint pr. afvigende rytter). Tidligere blev auktion-vindere afvist i døren hvis køberen var nået division-cap, selvom buddet var afgivet i god tro — nu lander rytteren på holdet og du kan sælge ned til cap inden sæsonstart.",
          "Manager · Samme regel gælder også på transfertilbud, byttehandler og lejeaftaler. UI-fejlbesked opdateret til 'Dit hold er fyldt (12 ryttere — Div 3 cap 10 + 2 buffer i transfervinduet)' så det er tydeligt hvor langt du må gå.",
          "Retroaktivt fix · Roman Ermakov og Harrison Wood blev fejlafvist på Vega - Vitalcare - Dynateks holdkonto 2026-05-09 grundet den her bug. Begge ryttere er nu blevet overdraget (60.000 CZ$ trukket fra balance, finance-audit + win-notifikation skrevet med samme rytternavne+priser som de oprindelige bud).",
          "Backend · Ny `softCapBuffer`-option på `getIncomingSquadViolation` + ny `TRANSFER_WINDOW_SOFT_CAP_BUFFER`-konstant (=2). `auctionFinalization.js` slår transfer-window-state op før squad-checket og sætter buffer=2 når vinduet er åbent. 5 user-initiated callsites (transfer-offer accept × 2, loan-proposal, loan-accept, transfer-execution) har soft-cap aktivt fordi endpointet allerede har gated på open-window. 545/545 backend-tests grønne (+5 nye for soft-cap, hard-cap og divisions-skalering).",
        ],
      },
    ],
  },
  {
    version: "2.99",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Admin · Race-katalog (Slice 09)",
        items: [
          "Admin · Ny '🏁 Race-katalog'-sektion på admin-panelet med verdens-kalenderen (97 løb i alt på tværs af 7 klasser) og en wizard til at sammensætte sæsonens kalender. Vælg klasser via checkbox-grid, sæt race-dage-mål (default 60), klik 'Generér forslag' for at få en pre-checked liste, justér ved at af-vælge enkelte løb, og gem som sæsonens kalender. WorldTour-klasser er ekskluderet by-default for sæson 1 (per beslutning 2026-05-09 om gradvis opskalering).",
          "Manager · Ny '🌍 Verdens-kalender'-tab på Løb-siden viser hele kataloget over tilgængelige løb. Klik en klasse for at filtrere; tabellen viser navn, klasse, type (Endags/Etape), antal etaper og dato. Read-only — udvælgelse til specifikke sæsoner sker via admin-panelet.",
          "Backend · Ny race_pool-tabel som katalog (separeret fra eksisterende races-tabel som nu er sæson-instans af et pool-løb via FK pool_race_id). race_class bruger frontend's 9-key-taksonomi (TourFrance, GiroVuelta, Monuments, OtherWorldTourA/B/C, ProSeries, Class1, Class2). 4 nye admin-endpoints: GET /api/admin/race-pool (overblik), POST /api/admin/race-pool/import-csv (idempotent re-upload), POST /api/admin/seasons/:id/race-selection/preview (forslag uden writes), POST /api/admin/seasons/:id/race-selection (gem som races-rows). Plus public GET /api/race-pool. Pure-funktioner: parseRacePoolCsv (deterministisk external_id via SHA-256 af navn+dato → idempotent re-import) + selectSeasonRaces (filter på klasser + race-dage-mål + overshoot-tolerance). 499/499 backend-tests grønne (+22 nye).",
        ],
      },
    ],
  },
  {
    version: "2.98",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Admin · Sæson-cyklus (Slice 08)",
        items: [
          "Admin · Ny '🔄 Sæson-cyklus'-sektion på admin-panelet lader dig udføre sæsonskifte med ét klik: lukker den aktive sæson (status='completed', end_date=nu), opretter næste sæson (status='active', start_date=nu), lukker det åbne transfervindue og opretter et lukket transfervindue til den nye sæson, udbetaler sponsor-penge til alle managers og logger handlingen i admin-loggen. Forhåndsvisning viser nøjagtigt hvad der sker (hvilke hold påvirkes, total sponsor-udbetaling, sponsor pr. hold) før du bekræfter.",
          "Manager · 93 ventende ryttere fra åbne-beta-fasens auktioner blev flyttet til deres rigtige hold med det samme, så holdene står korrekt inden sæson 1 starter. Fremover ved sæsonskifte 0→1 sker dette automatisk for alle ventende ryttere. Sæson 0 er nu dokumenteret som åbent transfervindue i databasen, hvilket gør at fremtidige auktioner i åbne-beta-fasen overdrager rytteren direkte (uden 'venter'-mellemtilstand).",
          "Backend · Ny pure-funktion `transitionToNextSeason` (12 unit-tests inkl. dry-run, idempotent re-run efter delvis fejl, fuld idempotens, UUID-helpers). Sæsonskiftet er checkpoint-baseret: hver fase tjekker om den allerede er udført og springer over hvis ja, så re-run efter en transient fejl er sikkert. Sæson 1 er fredet for sponsor-modifier (×1.0) by-design — bestyrelsens budget_modifier træder først i kraft fra sæson 2.",
          "Backend · To nye admin-endpoints bag requireAdmin: `GET /api/admin/season-transition/preview` (returnerer plan uden writes) og `POST /api/admin/season-transition` (udfører skiftet). Action-type 'season_transition' tilføjet til admin_log CHECK-constraint i database/2026-05-09-season-transition-admin-action.sql. 477/477 backend-tests grønne (+14 nye).",
        ],
      },
    ],
  },
  {
    version: "2.97",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Manager · Sæson-finansrapport (07h)",
        items: [
          "Manager · Ny dedikeret finansrapport per sæson: åbnes via 📊 Sæsonsrapport-knap på Finanser-siden eller via 📊 Finansrapport-knap på sæson-snapshot-siden (/seasons). Rapporten viser hero-kort med totalt indtægt/udgift/net cashflow, to donut-diagrammer over hvor pengene kommer fra (sponsor, præmiepenge, auktion-salg, ...) og hvor de går hen (auktion-køb, løn, lånerenter, ...), top-3 transaktioner i hver retning og en oversigt over aktive lån med næste sæsons forventede rente. Rapporten er privat per hold — ingen kan se andres økonomi.",
          "Backend · Ny migration seeder sæson 0 (open beta transfervindue, 2026-05-08 18:00 UTC). Backfill'er alle 82 eksisterende finance_transactions med season_id og reason_code så donut-aggregeringen virker fra dag 1. Database-trigger auto-stamper season_id på fremtidige transaktioner — ingen callsite-ændringer nødvendige. Spillere mærker intet bortset fra rapportens nye data.",
          "Backend · Ny pure-function `buildSeasonFinanceReport` (15 unit-tests dækker hero-aggregering, donut-fordeling, top-N-extraction, loan-summary + privatlivs-test der verificerer audit-internals ikke lækker til public output). Endpoint `GET /api/teams/:teamId/finance-report?seasonId=` har auth-gate: kun team-owner ELLER admin kan tilgå et hold's rapport. Sponsor-modifier-kurve placeholder vist når board_plan_snapshots er tom (dvs. før første afsluttede sæson) — vi viser ikke fake data.",
        ],
      },
    ],
  },
  {
    version: "2.96",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Manager · Næste sæsons forecast + 🟢/🟡/🔴 risk-tier (07g)",
        items: [
          "Manager · Ny prognose-sektion på Finanser-siden viser forventet cashflow næste sæson: sponsor + præmie − løn − lånerenter − lejegebyr = projected_net. Spændet (±20% på præmie-estimatet) viser usikkerheden, og en 🟢 grøn / 🟡 gul / 🔴 rød badge fortæller med ét blik om holdet er sundt, presset eller konkurs-tæt. Tærskler matcher 07g-spec: grøn = net ≥ +50K og gæld < 50% af loftet, gul = net mellem ±50K eller gæld 50-80%, rød = net < -50K eller gæld > 80% eller hvis underskuddet pejler mod gældsloftet inden for 2 sæsoner.",
          "Manager · Lille forecast-widget på Dashboard under squad-warning viser projected_net + risk-tier-badge så manageren kan måle finansiel sundhed uden først at klikke til Finanser-siden. Linker direkte til /finance for fuld breakdown.",
          "Manager · Kontekstuelle warnings rapporterer specifikke trusler: 'Forventet underskud', 'Gæld nær loftet (X%)', 'Med det nuværende underskud rammer du gældsloftet inden for 2 sæsoner — handl nu', 'Løn overstiger sponsor — rolig drift dækker ikke længere lønnen'. Hver warning er actionable (sælg en rytter, reducér lån, forhandl bedre sponsor).",
          "Backend · Ny pure-function `computeFinanceForecast` i backend/lib/financeForecast.js (11 unit-tests dækker 4 manager-arketyper + 7 edge cases inkl. risk-tier-grænser, sponsor-pullout, lejegebyr-vinduer). Endpoint `GET /api/me/finance-forecast` aggregerer team + roster + active loans + loan_agreements + boards + sponsor-pullouts + debt_ceiling og kalder pure-funktionen — UI er en tynd render af responsen. 448/448 backend-tests grønne (op fra 437).",
          "Hjælp · Ny FAQ 'Hvordan beregnes prognosen for næste sæson?' i Hjælp & Regler forklarer alle fem inputs (sponsor × board-modifier, prize_earnings_bonus, riders.salary, lån-renter, lejegebyr) plus risk-tier-tærsklerne og hvorfor præmie-estimatet er den variable komponent.",
        ],
      },
    ],
  },
  {
    version: "2.95",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Auktionsside viste '—' i Løn-kolonnen",
        items: [
          "Frontend · AuctionsPage Supabase-select hentede ikke `salary` for auktionerede ryttere, så Løn-kolonnen (både desktop-row og mobile-card) faldt tilbage til '—' selvom GENERATED salary-kolonnen var korrekt udfyldt i DB. Tilføjet til select-listen. Regression-test (readFileSync+regex på AuctionsPage.jsx) holder os ærlige hvis nogen fjerner et af de fire UI-renderede felter (salary, birthdate, nationality_code, potentiale) igen.",
        ],
      },
    ],
  },
  {
    version: "2.94",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Admin · Økonomi-dashboard udvidet med admin-feed + cron-korrelering (07e Fase B)",
        items: [
          "Admin · Ny 'Admin-handlinger'-sub-tab på Økonomi-sektionen viser et paginated feed af admin_log med filter på action_type (24 godkendte typer), admin user, target hold/rytter og dato-range. Klik på en row åbner en modal der pretty-printer den fulde meta-JSON, så du kan se nøjagtig hvilke felter en admin-handling påvirkede.",
          "Admin · Ny 'Korrelering'-sub-tab grupperer finance_transactions per (actor_id, source_path) med ±5s tidsvindue og lister cron-runs nyeste først med tx-count, Σ-beløb, antal hold ramt og reason-codes. Klik en run for at drille direkte ned i Transaktioner-view med pre-fyldte filtre — rydder hurtigt mistænkeligt store cron-batches.",
          "Backend · To nye admin-endpoints bag requireAdmin: `GET /api/admin/admin-log` (paginated + filtreret) og `GET /api/admin/cron-runs` (gruppe-aggregeret med konfigurerbart tidsvindue). Pure helper `groupCronRuns` i backend/lib/cronRunCorrelation.js holder grouping-logikken testbar uden HTTP/DB. CSV-bulk-export bevidst droppet fra scope — kører SQL direkte i Supabase Studio når ad hoc-eksport en sjælden gang skulle blive aktuelt.",
          "Backend · 12 nye unit-tests for cron-grouping + 4 nye route-ownership-assertions (admin-log + cron-runs admin-protection, default 7-dages vindue, NULL-actor-filter). 437/437 backend-tests grønne.",
        ],
      },
    ],
  },
  {
    version: "2.93",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Admin · Økonomi-dashboard (07e Fase A)",
        items: [
          "Admin · Ny 'Økonomi'-sektion i admin-panelet med tre sub-views der bygger på 07d's audit-trail-fundament: Sundhed (audit-population + balance-drift watchdog som live health-widgets), Overblik (per-hold tabel med balance, sponsor, gæld, gældsloft, ratio og 🟢/🟡/🔴 sustainability-badge filtreret per division), og Transaktioner (paginated finance_transactions-historik med filter på actor_type, reason_code, type, hold, sæson, source_path-substring, dato-range og beløbs-range).",
          "Admin · Klik på en transaktions-row åbner en drill-down-modal der viser alle 9 audit-kolonner inkl. kontrol af before/after-balance-invarianten (after − before = amount). Audit-leak detekteres automatisk og lyser rødt hvis nye finance_transactions skulle slippe igennem uden actor_type efter 07d Fase B-deploy.",
          "Backend · Tre nye admin-endpoints (`GET /api/admin/economy-overview`, `GET /api/admin/finance-transactions`, `GET /api/admin/economy-health`) bag requireAdmin-middleware. Pagination clamper limit til max 200 så drill-down-queries ikke kan trække hele rækken på én gang. 8 nye unit-tests + route-ownership-assertions, 423/423 backend-tests grønne.",
        ],
      },
    ],
  },
  {
    version: "2.92",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Backend · Komplet audit-trail på alle penge-bevægelser (07d Fase B)",
        items: [
          "Backend · Alle 26 callsites der mutere holdets balance via increment_balance_with_audit-RPC populerer nu actor_type (cron/api/admin), source_path, reason_code, related_entity_type/_id og — for cron-paths — en idempotency_key. Hver finance_transactions-row kan nu trace 'hvem ændrede saldo og hvorfor' uden at læse engine-koden.",
          "Backend · Cron-paths (sponsor, salary, divisionsbonus, lejegebyr, præmiepenge) får UNIQUE-håndhævet idempotency_key så uniq_finance_idempotency_key giver en ekstra sikkerhedsspær oven på de eksisterende partial UNIQUE indices fra 07b — cron-retries kan ikke længere double-credit.",
          "Backend · 5 nye reason-codes i FINANCE_REASON (auction_guaranteed_bank_sale, squad_auto_purchase/_sale, squad_violation_fine, board_bonus_accepted) dækker manglende økonomi-paths så alle write-paths har en eksplicit årsag.",
          "Backend · Per-callsite audit-coverage tests verificerer at hver write sender korrekt actor_type + source_path + reason_code. 415/415 backend-tests grønne (op fra 410). Fundament for 07e admin økonomi-dashboard #83.",
        ],
      },
    ],
  },
  {
    version: "2.91",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Backend · Atomic balance-RPC eliminerer tabte penge-mutationer (07c)",
        items: [
          "Backend · Alle ~22 callsites der opdaterer holdets balance — auktion-køb/-salg, transfer-køb/-salg, byttehandel-kontant, præmiepenge, lejegebyr og lejegebyr-refusion, lån (oprettelse, afdrag, nødlån, købsoption), sponsor-payout, sæson-løn, divisionsbonus, negativ-balance-rente, trupstørrelse-auto-køb/-salg/-bøde, board-bonus-tilbud og admin-balance-justering — kører nu via én Postgres-funktion `increment_balance_with_audit(team_id, delta, payload)` der atomic UPDATE'er teams.balance OG INSERT'er finance_transactions i én DB-transaktion pr. team.",
          "Backend · Lost-update-races elimineret: pg_advisory_xact_lock(team_id) serialiserer concurrent calls på samme hold, så to samtidige finansoperationer ikke længere kan overskrive hinandens balance-ændring. Mellem-state hvor balance er ændret men finance_transactions mangler kan ikke længere opstå (rolled back atomic).",
          "Backend · Hver finance-row får nu automatisk udfyldt before_balance + after_balance fra RPC'en — fundament for 07d Fase B's fulde audit-trail-population af de øvrige 7 audit-felter (actor_type, source_path, reason_code m.fl.).",
          "Backend · 8 nye unit-tests i balanceAtomicity.test.js + live race-test mod prod (10 deltas, audit-invariant after = before + amount holder for alle rows). 410/410 backend-tests grønne.",
        ],
      },
    ],
  },
  {
    version: "2.90",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Backend · Audit-fundament for økonomi-historik (07d Fase A)",
        items: [
          "Admin · admin_log fik 4 nye indices (admin_user_id, action_type, target_team_id, created_at) og en CHECK-constraint der håndhæver de 24 godkendte action_types — utilsigtede typoer fanges nu på databaseniveau i stedet for at blive lukket stille gennem.",
          "Admin · auctionCancellation skriver nu admin_log med højlydt fejl i stedet for best-effort try/catch, så annullering ikke kan ske uden audit-spor.",
          "Backend · finance_transactions udvidet med 9 audit-kolonner (actor_type, actor_id, source_path, reason_code, before_balance, after_balance, related_entity_type, related_entity_id, idempotency_key) — alle nullable og NULL-default for eksisterende rows, så ingen historik mistes. Population følger i 07d Fase B sammen med 07c atomic balance RPC.",
          "Backend · Nye enum-konstanter (ADMIN_ACTION_TYPE, FINANCE_ACTOR_TYPE, FINANCE_RELATED_ENTITY, FINANCE_REASON) i economyConstants.js erstatter hardkodede strings i 11 admin-routes. 7 nye unit-tests håndhæver at enum-values matcher DB CHECK-constraints så afvigelser fanges af CI før prod.",
        ],
      },
    ],
  },
  {
    version: "2.89",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Auktioner · Lås rytter under afventende overførsel",
        items: [
          "Auktioner · Når en rytter har vundet en auktion men endnu ikke er overført til vinderens hold (fordi transfervinduet er lukket og rytteren står som 'indgående'), kan ingen nu starte en ny auktion på rytteren. Tidligere kunne andre managere flash-auktionere rytteren væk fra den retmæssige vinder, hvilket fik den oprindelige finalisering til at annullere overførslen — bud bundet, ingen rytter til nogen.",
          "Rytter-profil · Profilen viser nu en lås-besked '🔒 Rytteren er vundet på auktion og afventer overførsel' og skjuler 'Start auktion'-, transferbud-, byttehandel- og lejeaftale-knapperne så længe rytteren er i transit.",
          "Backend · POST /api/auctions returnerer 409 'Rytteren er vundet på en auktion og afventer overførsel' hvis nogen forsøger at omgå UI-låsen. Ny pure-funktion `getAuctionStartIssue` med 2 unit-tests.",
        ],
      },
    ],
  },
  {
    version: "2.88",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Admin · Marked-pause kill switch",
        items: [
          "Admin · Ny 'Marked-pause'-sektion i admin-panelet med to nødstop-niveauer: 'Frys auktioner' (blokerer nye bud, autobud-loft og nye auktioner) og 'Frys hele markedet' (samme + transfertilbud, byttehandler, lejeaftaler og bank-lån).",
          "Auktioner forlænges automatisk ved genoptagelse — calculated_end skubbes frem med pause-varigheden, så bydere får samme resterende tid som de havde da pausen blev slået til. Cron pauser finalisering mens markedet er frosset, så ingen auktioner finaliseres bag scenen.",
          "Cleanup-handlinger (annullér eget bud, afvis modbud, træk lejeforslag tilbage) virker stadig under pause, så managere kan rydde op i pending tilbud uden admin-indblanding.",
          "Spilleruvendt fejlmeddelelse: 'Auktioner/Markedet er midlertidigt pauset af admin' med valgfri årsag — vises som 503-svar når en blokeret handling forsøges.",
        ],
      },
    ],
  },
  {
    version: "2.87",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Auktioner · Forlængelse over døgnskifte",
        items: [
          "Auktioner · Bud i de sidste 10 minutter kan nu forlænge auktionen op til 1 time efter dagens vindueslukning (hverdage til 23:00, weekend til 00:00). Tidligere blev forlængelsen kappet præcist ved lukningstidspunktet — fx et bud kl. 21:55 hverdag rundede ned til 22:00 i stedet for at give de fulde 10 minutter.",
          "Auktioner · Hvis et bud sent i grace-timen ville skubbe slutningen længere, ruller den resterende tid over til næste vindues åbning. Eksempel: fredag bud kl. 22:55 → auktionen slutter lørdag kl. 08:05 (5 min overflow). Reglen er nu beskrevet i Hjælp-siden.",
        ],
      },
    ],
  },
  {
    version: "2.86",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Auktioner · Ønskeliste-filter",
        items: [
          "Auktioner · Ny 'Kun ønskeliste'-knap ved siden af filter-tabsene — slå til for at se kun aktive auktioner på ryttere du har stjernemarkeret. Kombineres oven på den aktive tab (Min situation / Alle / Andre managers).",
          "Valget huskes på tværs af sessions, så hvis du primært jagter et udvalg af ryttere, behøver du ikke slå filteret til hver gang du åbner siden.",
        ],
      },
    ],
  },
  {
    version: "2.85",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Lejeaftale · Kontraktintegritet",
        items: [
          "Lejeaftale · Aktive lejeaftaler kan ikke længere annulleres ensidigt — bruger ser nu kun købsoption-knappen (hvis den findes) plus en note om at admin skal kontaktes for annullering. Tidligere kunne enten part bryde en indgået aftale uden modpartens accept (#156).",
          "Pending lejeforslag kan stadig trækkes tilbage frit (lender har ikke accepteret endnu), så loop'et 'foreslå → fortryd' fungerer som før.",
          "Admin · Nyt endpoint `POST /api/admin/loans/:id/cancel` til nødannulleringer; refunderer betalt lejegebyr automatisk til lejer og trækker fra udlejer, og logger handlingen i admin_log med begrundelse.",
        ],
      },
    ],
  },
  {
    version: "2.84",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Transfer · Byttehandel & Lejeaftale",
        items: [
          "Rytter-profil · Du kan nu foreslå byttehandel og lejeaftale direkte fra en anden managers rytter-profil — ligesom transferbud (#158). Knapperne 'Foreslå byttehandel' og 'Foreslå lejeaftale' vises under transferbud-knappen.",
          "Byttehandel · Forhandlings-loop virker nu korrekt: du kan sende modbud igen og igen til den anden part accepterer eller trækker sig. Tidligere stoppede loop'et efter første modbud (#159).",
          "Lejeaftale · Lejeaftaler kan kun oprettes for 1 sæson ad gangen (spilleregel). Formularen beder nu kun om ét sæsonnummer, og backend afviser forsøg på lejer i flere sæsoner (#160).",
        ],
      },
    ],
  },
  {
    version: "2.83",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Rytter-profil · Mobile polish",
        items: [
          "Evner-bar · Stat-rækkerne har nu kortere label-bredde på mobil, så progress-bar'en bliver synligt længere og lettere at læse på 360px-skærme.",
          "Sæsonhistorik & Løbsresultater · Tabellerne scroller nu pænt horisontalt på mobil i stedet for at presse layoutet, hvis løbsnavne eller præmier er lange (#163).",
          "Flash Auktion-label · 'Deadline Day'-forklaringen brækker nu på en ny linje på mobil i stedet for at flyde ud over viewport.",
          "Beløbs- og besked-felter · Input-felter til transfertilbud og auktions-startpris bruger nu 16px font på mobil, så iOS Safari ikke længere zoomer ind når du tapper feltet.",
          "Action-knapper · 'Send transfertilbud', 'Send tilbud' og 'Start auktion' har nu 44px touch-target (Apple HIG) i stedet for ~36px, så de er nemmere at ramme på telefon (#163).",
        ],
      },
    ],
  },
  {
    version: "2.82",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Mobile polish · 360px touch-targets",
        items: [
          "Onboarding-banner og overbudt-toast · × close-knapperne på 'Sådan virker auktioner'-banneret og 'Du er overbudt'-toasten har nu 44×44px tap-target (Apple HIG) i stedet for et lille kryds, der var svært at ramme på telefon.",
          "Filter-chips · Aktive filtre på rytter- og auktionssiden er nu klikbare i hele deres bredde — tryk hvor som helst på chip'en for at fjerne filteret. Tidligere skulle du ramme det lille × præcist (#181).",
          "Stats-popover · 'Vis stats'-menuen på auktionssiden har max-bredde der respekterer viewport, så menuen ikke længere kan flyde ud over kanten på 360px-skærme (#181).",
          "Holdside · 'Sælg / Auktion'-knappen i Squad-tabellen har nu 44px touch-target i stedet for et lille tryk-felt, så den er nemmere at ramme på mobil (#181).",
        ],
      },
    ],
  },
  {
    version: "2.81",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Auktioner · Stort overblik-overhaul",
        items: [
          "Min situation · Ny default-tab på /auctions samler alle auktioner du er involveret i — opdelt i tre scanbare sektioner: 🟢 Du leder, 🔴 Du er overbudt, 🔵 Du sælger. Tomme sektioner skjules automatisk. Erstatter 'Mine'- og 'Vinder'-tabs.",
          "Stats-toggle · Default vises ingen evne-kolonner i tabellen — det giver markant bedre overblik. Tryk 'Vis stats' øverst for at slå alle 14 evner til, eller vælg enkelt-evner via popover-menuen. Valget huskes på tværs af sessions (også på mobil-cards).",
          "Wishlist-stjerne · Ⓘ-knappen er flyttet ind i rytter-cellen på auktionssiden — du kan tilføje/fjerne ryttere til din ønskeliste direkte fra auktioner uden at gå over på rytter-siden.",
          "Løn vises i stedet for Værdi · Auktionssiden viser nu rytternes løn (relevant for dine økonomi-beslutninger) i stedet for markedsværdi. Værdi er stadig synlig på Ryttere-siden og rytter-profilen.",
          "Kolonner omarrangeret · Ny rækkefølge på desktop: Rytter (sticky venstre) | Højeste bud | Tid tilbage | Alder | Løn | Potentiale | Sælger | Stats | Byd (sticky højre). Rytter-navnet bliver synligt selv når du scroller horisontalt gennem evner.",
          "Pris-filter · Nyt min/max-felt på 'Højeste bud CZ$' i filter-baren — find fx kun ryttere under 100.000 CZ$ i auktionspris.",
          "Bekræftelses-popup · Alle bud (auktion, autobud-loft, transferbud) viser nu en 'Er du sikker?'-dialog inden de afgives, så du ikke kommer til at sende et bud ved et uheld.",
        ],
      },
    ],
  },
  {
    version: "2.79",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Auktioner · BYD-kolonnen på desktop har nu solid baggrund, også når rækken er markeret som vundet, så statistik og tekst ikke skinner igennem under den sticky bud-celle.",
          "Autobud · '+ Autobud loft' er gjort tydeligere, og når du sætter autobud på en auktion du ikke fører, placerer systemet nu samtidig minimumsbuddet. Autobud fungerer dermed som et rigtigt første bud — du behøver ikke byde manuelt først.",
        ],
      },
    ],
  },
  {
    version: "2.78",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Mobile auktioner · Bedre tap-targets og scroll-håndtering: alle bud-, autobud- og annuller-knapper på telefon er nu mindst 44×44px (Apple HIG-standard for komfortabel berøring) og bud-felter bruger 16px-skrift, så iOS ikke længere zoomer ind når du fokuserer feltet. Skærmlæsere får nu konkrete labels på alle knapper og indlæsnings-spinneren (#197).",
        ],
      },
    ],
  },
  {
    version: "2.77",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Intern infrastruktur · Dependabot-hærdning pre-launch",
        items: [
          "Dependabot kan ikke længere auto-merge afhængigheds-bumps (heller ikke patch/minor med grøn CI). Workflow'en kommenterer nu kun klassifikation og risiko-vurdering — manuel `auto-merge` label kræves for hver PR. Pre-launch beskyttelse mod runtime-regressioner og supply-chain-overraskelser.",
          "Vercel preview-builds skippes på `dependabot/*` branches (sparer build minutes og forhindrer kø-stuvning som blokerede main-deploys 2026-05-08).",
          "`react-router-dom` v7 og `@vitejs/plugin-react` v6 tilføjet til ignore-listen — major-bumps åbnes ikke som PRs igen før manuel un-ignore.",
        ],
      },
    ],
  },
  {
    version: "2.76",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Auktioner · Live bud-feed på desktop: ny sidebar viser bud i realtid på de auktioner du selv deltager i (manuelt bud eller autobud). Andre managers' moves på fremmede auktioner forbliver private — kun \"din side af bordet\" feeder din skærm (#196).",
          "Auktioner · Pris-cellen pulser kort i guld når current_price ændrer sig — så du kan se hvilken auktion lige fik et bud uden at skanne hele tabellen.",
          "Auktioner · Du får nu en toast i hjørnet \"Du er overbudt på X\" når en anden manager overhaler dig — også hvis du allerede ser auktionen. Toasten fyrer aldrig på dit eget bud eller på dit autobuds eskalering.",
          "Auktioner · Aggregat-ticker i header viser \"X nye bud i sidste 30s\" — uden navne eller beløb. Et hurtigt puls-tjek på markedet uden at lække andre managers' specifikke moves.",
        ],
      },
    ],
  },
  {
    version: "2.75",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Rytterprofil · Ny \"Bud-historik\"-fane viser live bud-timeline mens en auktion kører (manager + beløb + tidspunkt + Autobud-mærkat). Nye bud popper ind realtid uden refresh. Når auktionen slutter, kollapser fanen til \"Solgt til X for Y CZ$\". Autobud-loft eksponeres aldrig — strategi forbliver privat (#195).",
        ],
      },
    ],
  },
  {
    version: "2.74",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Autobud · Hvis dit autobud-loft afvises (fx ved forsøg på egen rytter, for lavt loft eller utilstrækkelig balance), vises nu en konkret dansk fejlbesked under Gem-knappen — ikke længere bare en tom \"Fejl\"-knap (#174).",
          "Autobud · Når du byder manuelt over dit eget autobud-loft, slettes det stale loft nu fra dit auktions-overblik. Tidligere blev \"Autobud max ...\"-mærkatet hængende selvom autobud reelt var udmattet (#183).",
        ],
      },
    ],
  },
  {
    version: "2.73",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Auktioner · Aldrig flere annullerede auktioner pga. utilstrækkelig balance: alle bud, autobud og auto-eskaleringer tjekker nu mod tilgængelig balance (raw balance minus eksisterende auktions-forpligtelser). Penge låst i auktioner kan heller ikke bruges til at betale gæld eller acceptere transfers/lejegebyrer. Du kan ikke længere vinde en auktion du ikke har råd til (#44).",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Auktionssiden · Balance-tile viser nu \"X tilgængelig\" når noget er reserveret i bud, og separat \"Reserveret i bud\"-tile viser worst-case forpligtelse hvis alle dine autobud trigger fuldt.",
          "Finansside · Balance-tile viser \"X tilgængelig\" og \"Y låst i bud\" så det er klart hvor meget der kan bruges på lån og transfers. Lån-rate-input klamper også til tilgængelig.",
        ],
      },
    ],
  },
  {
    version: "2.72",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Auktioner · Race-beskyttelse: hvis prisen stiger mens du sender dit bud, viser vi nu en confirm-dialog med ny pris og nyt min-bud så du kan vælge at byde igen eller annullere — slut med at miste auktioner uden at vide hvorfor (#194).",
        ],
      },
    ],
  },
  {
    version: "2.71",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Autobud · Du kan nu sætte autobud max-loft uden at have budt manuelt først — fix'ede en fejl hvor man kun kunne oprette autobud hvis man allerede var højestbydende (#172).",
        ],
      },
    ],
  },
  {
    version: "2.70",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Indbakke · Ulæste-tælleren i headeren opdateres nu straks når du sletter beskeder — ingen F5 nødvendig (#176).",
        ],
      },
    ],
  },
  {
    version: "2.69",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Auktioner · Historik er nu en tydelig fane øverst på Auktioner-siden — ikke længere et lille tekstlink i hjørnet. Du kan skifte mellem Aktive og Historik fra begge sider (#59).",
        ],
      },
    ],
  },
  {
    version: "2.68",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Autobud · Resolveren følger nu altid med op når en modstander byder markant over — fixede en edge case hvor et stale eget proxy-loft (sat lavt, derefter manuelt budet over) fik resolveren til at give op uden at place counter-bid (#171).",
        ],
      },
      {
        category: "Hvorfor",
        items: [
          "Pre-fix: hvis du satte autobud max 60K og senere manuelt bød 80K, troede resolveren stadig dit loft var 60K og lod modstandere lede uden modbud — selvom de andres autobud max var højere end deres bud. Resolveren behandler nu et udtømt eget loft som 'ingen aktiv proxy', så challengers' autobud altid byder mindst minimum over.",
        ],
      },
    ],
  },
  {
    version: "2.67",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Autobud · Discord DM sendes nu også når et autobud overbyder dig — før kom DM'en kun ved manuelle bud, så managers fik kun in-app-notifikationen ved auto-overbud (#155).",
          "Autobud · Sælger får nu også besked når et autobud bliver afgivet på deres rytter — mirror'er flowet for manuelle bud.",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Autobud · DM'en markerer eksplicit at det er et autobud (\"Autobud fra X\") og angiver om dit eget max-loft blev nået.",
        ],
      },
    ],
  },
  {
    version: "2.66",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Auktioner · Min-bud er nu blot **1 CZ$ over** det aktuelle bud — 10%-overbudsregel og 1.000-afrunding er fjernet. Du kan også matche asking-prisen på et garanteret salg uden bud endnu (#175).",
          "Autobud · Resolveren bruger samme +1-step, så proxy-bidding følger korrekt med op uanset hvor markant en modstander byder over (#171, #173).",
        ],
      },
      {
        category: "Hvorfor",
        items: [
          "10%-reglen blev oprindeligt indført for at undgå \"+1\"-spam, men proxy-bidding (#10, v2.64) løser det problem indirekte — sæt et max-loft og lad systemet håndtere stepningen. Reglen skabte derfor mere friction end nytte og kolliderede med autobud-resolveren. Drop'et fjerner en hel klasse af bugs i én bevægelse (#178 polish-sprint).",
        ],
      },
    ],
  },
  {
    version: "2.65",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Mit hold · Klik på rytter-rækker åbner nu rytter-detaljesiden — manglede helt før (#157).",
          "Transfers · Klik på rytternavn i tilbud, byttehandler og lejeaftaler navigerer nu til rytter-profilen (#157).",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Højreklik på rytter-rækker viser nu \"Åbn link i ny fane\" — virker også med Cmd/Ctrl-klik og museknap-3 (#166). Gælder /riders, /team, /transfers, /auctions og alle steder hvor rytter-navne vises.",
        ],
      },
    ],
  },
  {
    version: "2.64",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Auktioner · Autobud med max-loft (proxy-bidding): sæt et max-loft på en auktion, og systemet byder automatisk +10% over modbudene op til dit loft (#10). Aktiveres via '+ Autobud loft' under bud-feltet.",
          "Autobud stopper automatisk når loftet er nået eller du vinder — du får en notifikation i indbakken hvis du er overbudt over dit max.",
          "Opdatér eller fjern dit max-loft når som helst mens auktionen er aktiv via 'Ændr' / 'Fjern' knapperne.",
        ],
      },
    ],
  },
  {
    version: "2.63",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Deadline Day · Tickeren viser nu kun events fra det aktuelle Deadline Day-vindue (de 24 timer op til transferfristens udløb) i stedet for de seneste 24 timer fra browserens aktuelle tidspunkt — feedet starter ikke længere midt i en normal hverdagsdag (#51).",
          "Deadline Day · Events i tickeren vises nu i kronologisk rækkefølge (ældste → nyeste) så budhistorien opbygges naturligt mod salgshændelsen, fremfor at vise konklusionen (salg) før opbygningen (bud) (#51).",
        ],
      },
    ],
  },
  {
    version: "2.62",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Bestyrelsesside + Dashboard: al UI-copy bruger nu konsekvent danske labels — 'Board Request' er erstattet med 'Bestyrelsesforespørgsel', 'boardet' med 'bestyrelsen', og bestyrelsesfokus vises nu med de samme danske labels (Balanceret / Ungdomsudvikling / Stjernesignering) som på Bestyrelsessiden fremfor rå enum-værdier (#65).",
          "Hjælp: 'Board-siden' hedder nu 'Bestyrelsessiden', og 'board request' er oversat til 'bestyrelsesforespørgsel' overalt i FAQ-teksten (#65).",
        ],
      },
    ],
  },
  {
    version: "2.61",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Auktioner · Fejlbesked ved for lavt bud er nu på dansk og angiver præcist minimumsbuddet: 'Bud skal være mindst X CZ$' (#16).",
          "Auktioner · Fejlbesked ved utilstrækkelig disponibel balance viser nu det konkrete restbeløb: 'Du har X CZ$ tilbage efter eksisterende bud' (#16).",
          "Auktioner · Tabelvisning viser nu 'Min. X CZ$' under bud-feltet (som mobilvisningen allerede gjorde), så managere kan se minimumsbuddet uden at gætte (#16).",
        ],
      },
    ],
  },
  {
    version: "2.60",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Tidszone-fix: Auktionsvinduerne (hverdage 16–22, weekend 08–23) beregnes nu eksplicit i Europe/Copenhagen og håndterer CEST/CET korrekt — auktioner slutter på de forventede tidspunkter uanset hvilken tidszone serveren kører i (#7).",
          "Auktioner · Countdown viser nu det absolutte sluttidspunkt med tidszone-label (f.eks. '21:00 CEST') under nedtællingen, så managere kan se præcist hvornår auktionen slutter (#7).",
        ],
      },
    ],
  },
  {
    version: "2.59",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Mobil quick-nav: fast bundmenu på mobil med direkte adgang til Dashboard, Indbakke, Marked, Ryttere og Mit Hold (#66).",
          "Menuen skifter automatisk position når DeadlineDayTicker er aktiv, så den aldrig dækker tickeren.",
          "Aktiv destination fremhæves med accent-farven (guld) og fungerer i lys og mørk tema.",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Auktion-bud: Bud-feltet kan nu ryddes uden at hoppe tilbage til minimum-budet, og Byd-knappen forbliver disabled indtil et gyldigt bud er indtastet (#18).",
        ],
      },
    ],
  },
  {
    version: "2.58",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Onboarding-modal kan nu lukkes (#107)",
        items: [
          "Tilføjet synligt × i øverste højre hjørne så modalen tydeligt kan lukkes.",
          "ESC-tast lukker nu modalen.",
          "Klik uden for modalen lukker den.",
          "Modalen scroller på små skærme (vinduet kan ikke længere blokere brugen af spillet).",
          "Knappen 'Kom i gang' omdøbt til 'Forstået' for at matche dismiss-handlingen.",
        ],
      },
      {
        category: "Alder-visning og -filter er nu konsistente (#108)",
        items: [
          "RiderStatsPage viste tidligere alder ud fra eksakt fødselsdag (24 år for rytter født juni 2001), mens filter og U25-logik bruger 'racing-age' (årstals-aritmetik = 25 år).",
          "Visningen er nu rettet ind så alder altid beregnes som indeværende år minus fødselsår — samme konvention som filter, U25 og U23-toggles.",
          "Filter på 'Alder ≤ 25' returnerer fortsat ryttere født 2001 eller senere; nu matcher alder vist på rytter-profilen.",
        ],
      },
    ],
  },
  {
    version: "2.57",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Auktioner · Balance + rytterstatus synlig i auktion-tabben (#48)",
        items: [
          "Ny stats-bar øverst på /auctions: 'Balance', 'Sum af aktive bud', 'Ryttere nu' og 'Projektion'.",
          "Projektion viser hvor mange ryttere man ville have hvis alle aktive auktioner sluttede med nuværende ledere — tæller +ryttere man vinder og -ryttere man er ved at sælge.",
          "Aktive bud-felt viser summen af de bud man aktuelt er ledende på, med antal auktioner angivet underneden.",
          "Balance hentes fra eksisterende teams-query (ingen ny datakilde). Rider-count hentes via count-query på riders-tabellen. Division-felt tilføjet til teams-select.",
        ],
      },
    ],
  },
  {
    version: "2.56",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "UX · Manager-online-status på holdprofil (#106)",
        items: [
          "Bugfix ([TeamProfilePage.jsx](frontend/src/pages/TeamProfilePage.jsx)): tidligere viste hold-profilen en grøn 'Vindue åbent'-pille ved siden af manager-navnet — det indikerede transfervinduets status, men placeringen tæt på 'Manager: ...' fik flere til at læse den som manager-online-status (rapporteret af jeppek, Discord 2026-05-06). Transfervindue-status fjernet fra holdprofil (vises stadig på Dashboard, Mit hold og Transfers).",
          "I stedet vises nu en korrekt online-prik + 'Online nu / X min siden' efter manager-navnet, baseret på samme `users.last_seen`-felt som ManagerProfilePage allerede bruger (5-min-tærskel matcher backend).",
          "Refaktor: OnlineBadge ekstraheret fra ManagerProfilePage til delt komponent ([OnlineBadge.jsx](frontend/src/components/OnlineBadge.jsx)), så begge sider deler én implementation.",
        ],
      },
    ],
  },
  {
    version: "2.55",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Auktioner · Squad-cap er nu warning, ikke block (#29)",
        items: [
          "Bugfix ([auctionRules.js](backend/lib/auctionRules.js), [api.js](backend/routes/api.js)): manager med 10 ryttere + 1 garanteret salg blev tidligere blokeret fra at byde på andre auktioner — fordi bud-validering ignorerede pending salg ved beregning af 'tilgængelig trupplads'. Reglen i Cycling Zone tillader allerede at gå over/under min/max MIDT i transfervinduet (squadEnforcement-cron auto-sælger + bøder kun ved vindue-luk hvis stadig over max), så hard-blokken på squad-cap modsagde gameplay.",
          "Konsekvens: bud + start-auktion er ikke længere blokeret af aktuel trupstørrelse. I stedet vises en warning i UI'en når bud/auktion ville bringe manager over max: 'OBS: leder nu auktioner svarende til 11 ryttere (max 10). Hvis du stadig er 1 over ved vindue-luk: auto-salg + 100.000 CZ$ bøde + 200 fradrag-points.' Manager træffer informeret valg.",
          "Backend ([auctionRules.js](backend/lib/auctionRules.js)): ny `getAuctionBidWarnings()` returnerer non-blocking advarsler; `getAuctionBidIssue` håndterer nu kun hard blocks (bid_below_minimum, insufficient_available_balance). Squad-cap-checks fjernet fra både POST `/api/auctions` (creation) og POST `/api/auctions/:id/bid` (bid placement). Warnings inkluderes i 200-respons.",
          "Frontend: AuctionsPage.jsx (table + card layout), RiderStatsPage.jsx og WatchlistPage.jsx læser `warnings`-felt og viser dem inline efter bud (~10 sek) eller som alert ved auction creation. Disse var de tre frontend-callsites til POST /api/auctions; TeamPage's egne-rytter-flows udløser ikke warning (initialBidderId=null).",
          "Test: 8/8 auctionRules.test.js grønne (3 nye warnings-tests, 1 ny non-block-regression). 315/315 backend-tests fortsat grønne. Frontend build grøn.",
        ],
      },
    ],
  },
  {
    version: "2.54",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Admin · Ny knap: Nulstil rytter-historik (#104)",
        items: [
          "Bugfix: Tidligere reset-flow rensede ikke completed auktioner og completed/buyout leje-aftaler — så alpha-historik forblev synlig på rytter-profiler. Ny knap 'Nulstil rytter-historik' under Admin → Beta-testværktøjer wiper ALL handelshistorik (auktioner inkl. bud, transfers, swaps, leje-aftaler) på ALLE ryttere så spillet kan starte uden alpha-støj.",
          "Bevarer ønskelister, ryttere, hold, balancer, finance-historik, sæsoner, race-resultater og manager-progress — kun event-historikken på rytter-siden ryddes.",
          "Tilføjet til 'Fuld nulstilling' så fremtidige reset altid rydder rytter-historik som en del af suiten.",
        ],
      },
    ],
  },
  {
    version: "2.53",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "UX · Præmiestruktur synlig i Hjælp & Regler (#100)",
        items: [
          "Ny sektion 'Præmier' tilføjet i Hjælp & Regler med præmieformlen (1 UCI-point = 1.500 CZ$), eksempler på konkrete beløb (Tour de France-sejr: 1.950.000 CZ$, Monument: 1.200.000 CZ$, osv.), forklaring af udbetaling og et direkte link til den fulde pointtabel under Sæson → Løb → Point & præmier.",
          "Disclaimer tilføjet i hjælpesektionen: præmiebeløb kan justeres frem til sæson 1 afsluttes.",
          "Lille hjælp-ikon (?) tilføjet øverst på Point & præmier-siden med direkte link til Hjælp & Regler.",
        ],
      },
    ],
  },
  {
    version: "2.52",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Intern infrastruktur · Dependabot + CodeQL (DX Lag 7)",
        items: [
          "Ingen brugerrettet ændring. Dependabot konfigureret til automatiske dependency-PRs (npm + github-actions, ugentligt). CodeQL-workflow tilføjet til automatisk sikkerhedsscanning på hvert push til main + ugentlig schedule. Manuel aktivering i GitHub Settings → Code security and analysis udestår.",
        ],
      },
    ],
  },
  {
    version: "2.51",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Robusthed · TOCTOU-fixes + idempotency-keys for cron-payouts (slice 07b)",
        items: [
          "Bugfix ([loanEngine.js](backend/lib/loanEngine.js)): `createLoan` brugte SELECT-then-INSERT til at validere divisions-gældsloftet — to parallelle requests (fx dobbeltklik på 'Optag lån') kunne begge passere tjekket og oprette to lån som tilsammen overstiger loftet. Ny Postgres-funktion `create_loan_atomic` serialiserer concurrent requests på team-niveau via `pg_advisory_xact_lock` så ceiling-tjek + INSERT kører i samme transaktion.",
          "Idempotency på cron-payouts ([economyEngine.js](backend/lib/economyEngine.js), [loanEngine.js](backend/lib/loanEngine.js)): sponsor (sæson-start), løn + division-bonus + lånerenter (sæson-end) havde ingen DB-håndhævet uniqueness. Hvis en cron timeout'ede og blev retried — eller hvis admin kørte sæson-end-repair efter en delvis kørsel — kunne managere få samme udbetaling/opkrævning to gange. Ny migration ([2026-05-07-economy-idempotency.sql](database/2026-05-07-economy-idempotency.sql)) tilføjer 4 partial UNIQUE indices på `finance_transactions` så DB afviser dubletter; backend fanger `unique_violation` (PG 23505) og skipper stille i stedet for at crashe hele cron-kørslen.",
          "Renter sporbare per lån: `finance_transactions` får ny kolonne `related_loan_id`, og `processLoanInterest` skriver nu både team-id OG lån-id pr. rente-row. Det betyder dels at idempotency-indexet kan kræve unique-per-(loan, season), dels at FinancePage på sigt kan vise rente-fordeling per individuelt lån.",
          "Light konkurs-mekanik (lag 1): `createEmergencyLoan` foretager nu et SOFT debt_ceiling-tjek. Hvis et nødlån presser holdets samlede gæld over divisions-loftet, oprettes lånet alligevel (status quo bevaret), men manageren får en `emergency_loan_breach`-notifikation: '🚨 Gældsloft overskredet — du kan stadig drive klubben videre, men du SKAL reducere udgifterne (sælg ryttere, fyr stjernekontrakter) inden næste sæsonslut for at undgå spiral.' Ingen automatiseret konsekvens i denne sæson-cyklus — vi lytter til live-data først.",
          "Test-disciplin: ny test-fil ([economyInvariants.test.js](backend/lib/economyInvariants.test.js)) med 7 cases skrevet FØR fixen for at validere at race-conditions er reelle, ikke teoretiske. 5 fejlede mod uændret kode, 2 passerede; alle 7 grønne efter fix. Eksisterende 25 backend-tests fortsat grønne.",
        ],
      },
    ],
  },
  {
    version: "2.50",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Robusthed · Stale fallbacks fjernet, sponsor-default normaliseret til 240K (slice 07a)",
        items: [
          "Bugfix ([teamProfileEngine.js](backend/lib/teamProfileEngine.js)): nye hold blev oprettet med hardkodet `sponsor_income: 260000` mens DB-default + alle 5 v2.49-fix-callsites brugte 240K. Drift stammede fra v1.76 (30. april) hvor in-code default blev hævet uden ledsagende DB-migration. Prod-DB-snapshot 2026-05-07: alle 19 hold står med 240K, så ingen tilbage-kompensering var nødvendig.",
          "Konsolidering ([economyConstants.js](backend/lib/economyConstants.js) · ny fil): 7 økonomi-konstanter samlet ét sted som single source of truth — SPONSOR_INCOME_BASE (240K), INITIAL_BALANCE (800K), MARKET_VALUE_MULTIPLIER (4000), MIN_UCI_POINTS_FOR_VALUE (5), PRIZE_PER_POINT (1500), NEGATIVE_BALANCE_INTEREST_RATE (0.10) og DEBT_CEILING_BY_DIVISION (1.2M/900K/600K). Alle matcher database/schema.sql-defaults. Importeres af teamProfileEngine, economyEngine, boardGoals og api.js.",
          "Fail-fast i [loanEngine.js](backend/lib/loanEngine.js): `createEmergencyLoan` kastede tidligere et stille `?? 0.15`-fallback hvis `loan_config` manglede emergency-row for en division. Prod-tjek bekræftede alle 3 divisioner har korrekte rows; men hvis en seed-fejl opstår fremover, fejler vi nu eksplicit med 'loan_config mangler emergency-row' i stedet for at oprette lån med forkerte rater. Ny regression-test låser adfærden.",
          "Stragglers fixet: 3 callsites brugte `team.sponsor_income ?? 0` i stedet for at falde tilbage til base-konstanten (api.js board-outlook for både negotiation- og preview-stien, boardGoals.js sponsor_growth-evaluering). Alle ændret til `?? SPONSOR_INCOME_BASE` så board-tilfredshedsvurdering ikke længere fejlrapporterer 0% sponsor-vækst hvis et team-objekt midlertidigt mangler feltet.",
          "Doc-drift ryddet op: [FEATURE_STATUS.md](docs/FEATURE_STATUS.md) + finance-onboarding-hint havde 260K-referencer, alle korrigeret til 240K. `DEFAULT_SPONSOR_INCOME` re-eksporteres fra economyEngine som alias for SPONSOR_INCOME_BASE i ét release for backward compat (deprecate i 07b). 299/299 backend-tests grønne, frontend build + lint grøn.",
        ],
      },
    ],
  },
  {
    version: "2.49",
    date: "2026-05-06",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Sponsor-fallback brugte stale 100 CZ$ i stedet for 240K",
        items: [
          "Bugfix ([economyEngine.js](backend/lib/economyEngine.js), [betaResetService.js](backend/lib/betaResetService.js), [boardAutoAccept.js](backend/lib/boardAutoAccept.js), [api.js](backend/routes/api.js)): 5 steder i kode-base brugte `team.sponsor_income ?? 100` som fallback når `teams.sponsor_income` var null/undefined. Værdien 100 var en stale default fra pre-skalerings-æraen (før ×4000-multiplier i april). Mindst én manager (Above & Beyond Cancer Cycling, oprettet 3. maj) endte med `sponsor_income = 100` i DB og fik kun 100 CZ$ udbetalt ved sæson-start i stedet for 240.000 CZ$.",
          "Fix: ny eksporteret konstant `DEFAULT_SPONSOR_INCOME = 240000` i economyEngine.js (matcher DB-default i schema.sql). Alle 5 fallbacks skifter fra `?? 100` til `?? DEFAULT_SPONSOR_INCOME`. Hvis `teams.sponsor_income` af en eller anden grund mangler, vil fremtidige sæson-start payouts og board-plan-baselines bruge 240K i stedet for 100.",
          "Manuel kompensering: Above & Beyond Cancer Cycling fik `sponsor_income` opdateret til 240.000 og balance krediteret med 239.900 CZ$ (forskellen mellem hvad han fik og hvad han skulle have fået). Kompenseringen vises som en `sponsor`-transaktion i hans Finanser-historik med beskrivelsen 'Kompensering: manglende sponsor-payout'.",
        ],
      },
    ],
  },
  {
    version: "2.48",
    date: "2026-05-06",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Gældsloft kunne overskrides med oprettelses-gebyrets størrelse",
        items: [
          "Bugfix ([loanEngine.js](backend/lib/loanEngine.js)): `createLoan` tjekkede om `currentDebt + principal` oversteg divisionens gældsloft, men det beløb der blev lagt på `loans.amount_remaining` var `principal + origination_fee`. Det betød at hvert lån kunne presse total-gælden lidt over loftet — præcis fee-beløbet (5% for kort/langt, 10% for nødlån). En manager i D3 fandt mønstret og pressede sin gæld til 600.054 CZ$ (54 over D3-loftet på 600.000) ved at stable mange små lån oven på et stort.",
          "Fix: fee beregnes nu FØR ceiling-tjekket og tjekket bruger `principal + fee` i stedet for kun principal. To regression-tests i [loanEngine.test.js](backend/lib/loanEngine.test.js) verificerer dels at et lån der ville overskride loftet med præcis fee-beløbet afvises, dels at et lån der præcis fylder headroom op (inkl. fee) stadig accepteres.",
          "Eksisterende prod-data (en manager 54 CZ$ over loft) ikke rørt — næste sæsons rente vil under alle omstændigheder ændre tallet, og loft-tjekket gælder kun nye lån, ikke renteperiodisering.",
        ],
      },
    ],
  },
  {
    version: "2.47",
    date: "2026-05-06",
    label: "Beta",
    changes: [
      {
        category: "QoL · Refresh på Min aktivitet + bedre Head-to-Head-søgning",
        items: [
          "Min aktivitet ([ActivityPage.jsx](frontend/src/pages/ActivityPage.jsx)) får en 'Opdater'-knap i toppen, så du kan hente seneste auktioner, tilbud og lån uden at refreshe browseren. Tidsstemplet 'Sidst opdateret HH:MM' viser hvor friske data er — vises i sidens header på desktop.",
          "Head-to-Head ([HeadToHeadPage.jsx](frontend/src/pages/HeadToHeadPage.jsx)): begge holdsøgefelter viser nu hold-forslag automatisk ved fokus (før kun det højre felt). Når søgningen ikke giver hits vises 'Ingen hold fundet for X' i stedet for at dropdown skjules tavst.",
          "Bugfix · Head-to-Head viste evig spinner hvis bare ét af de fire bagvedliggende queries fejlede (`Promise.all` uden try/catch). Fejl fanges nu og viser 'Prøv igen'-knap i stedet.",
          "Bugfix · Stille fejl-skjul i Min aktivitet — `/api/transfers/my-offers` og `/api/loans` faldt tilbage til tomme lister hvis de fejlede, uden at logge noget. Fejl logges nu i devtools så det kan diagnosticeres.",
        ],
      },
    ],
  },
  {
    version: "2.46",
    date: "2026-05-06",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Umuligt at starte to auktioner på samme rytter (race condition)",
        items: [
          "Bugfix ([api.js](backend/routes/api.js)): POST /api/auctions tjekkede 'no active auction for rider' med en SELECT, hvor en parallel request (typisk dobbeltklik på 'Start auktion') kunne smutte forbi inden vores INSERT — TOCTOU race. 5. maj fik én manager 3 auktioner på Gianni Moscon og 2 hver på Silvan Dillier + Morné van Niekerk inden for sub-sekund vinduer.",
          "Ny migration ([2026-05-06-auctions-unique-active-rider.sql](database/2026-05-06-auctions-unique-active-rider.sql)) tilføjer unique partial index `uniq_auctions_one_active_per_rider ON auctions(rider_id) WHERE status IN ('active','extended')` — DB-niveau guard der gør det fysisk umuligt at have to aktive auktioner på samme rytter. Anden parallel INSERT fejler med 23505 og backend mapper det til samme 409 'Rider already has an active auction' som det eksisterende SELECT-tjek.",
          "Cleanup: de 4 duplikat-rows i prod sat til `cancelled` (Gianni Moscon's auktion med rigtigt bud bevaret, ældste auktion bevaret for Silvan Dillier + Morné van Niekerk). Ingen pengebevægelse — seed-buddene var fra sælger på egen rytter og udløste ingen reservation.",
          "Regression-test ([auctionSchemaContract.test.js](backend/lib/auctionSchemaContract.test.js)) verificerer at det unique partial index findes i schema.sql, supabase_setup.sql og setup.py — så friske setups ikke kan deploye uden DB-guarden.",
        ],
      },
    ],
  },
  {
    version: "2.45",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Ønskeliste-auktioner åbner Auktioner fra Indbakken",
        items: [
          "Indbakke-notifikationen 'Ønskeliste-rytter til auktion' linker nu til Auktioner i stedet for Transfers. Backend bruger en ny notification-type `watchlist_rider_auction`, så auktioner og transferlistinger ikke længere deler routing-kontrakt.",
          "Gamle allerede-sendte ønskeliste-auktionsnotifikationer genkendes på titel/besked og får samme `/auctions`-link, så eksisterende indbakke-elementer også åbner korrekt.",
          "Migration ([2026-05-05-watchlist-auction-notification-type.sql](database/2026-05-05-watchlist-auction-notification-type.sql)) udvider `notifications_type_check`, og kontrakt-testen er opdateret med den nye type.",
        ],
      },
    ],
  },
  {
    version: "2.44",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "UI · Venstremenuen samlet i fire mentale rum",
        items: [
          "Venstremenuen er omstruktureret fra de gamle grupper til fire tydeligere områder: Klubhus, Marked, Sæson & Resultater og Liga. Målet er at gøre de vigtigste daglige handlinger lettere at finde: hold, bestyrelse, økonomi og indbakke ligger nu samlet i Klubhus, mens løb er flyttet ind sammen med sæson- og resultatvisninger.",
          "Panic Board er omdøbt til Deadline Day i menuen, så navnet matcher den faktiske funktion og undgår engelsk event-sprog i den faste navigation. Profil & Indstillinger er kortet ned til Indstillinger, og Finanser hedder nu Økonomi i menuen.",
          "HelpPage er opdateret med de nye menustier, blandt andet Liga → Head-to-Head og Sæson & Resultater → Løb. Direkte åbning af egen managerprofil åbner nu også Klubhus-gruppen i sidebaren, så den aktive side ikke skjules.",
        ],
      },
    ],
  },
  {
    version: "2.43",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "Admin-fix · 'Nulstil sæsoner' blokeret af finance_transactions",
        items: [
          "Bugfix ([betaResetService.js](backend/lib/betaResetService.js)): admin-knappen 'Nulstil sæsoner' (og 'Fuld nulstilling') fejlede med FK-violation, fordi `finance_transactions.season_id` har `ON DELETE NO ACTION` og 307 rows i produktion holdt sæsonerne fast. `resetBetaSeasons` nuller nu `season_id` på ALLE finance_transactions (manager + AI + bank) før `DELETE FROM seasons` — historikken bevares, kun sæson-koblingen ryger",
          "Regression-test tilføjet ([betaResetService.test.js](backend/lib/betaResetService.test.js)) der verificerer at både manager- og AI-finance-rows får `season_id = null` før delete. 294/294 grønne",
        ],
      },
    ],
  },
  {
    version: "2.42",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02j · Polish — onboarding-tour, HelpPage bestyrelse-sektion, doc-drift sweep",
        items: [
          "Onboarding-tour på BoardPage ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx)) opdateret efter S-02h wizard-redesign: de tre tour-trin beskriver nu det nye 3-panel-dashboard (side-om-side visning, klik-mål-mini-dialog, konsekvens-tier) og nævner navngivne bestyrelsesmedlemmer og klub-DNA som eksisterende features manageren vil møde. Tour peger fortsat på BoardEmptyState-sektionerne i onboarding-fasen (inden første plan forhandles).",
          "HelpPage ([HelpPage.jsx](frontend/src/pages/HelpPage.jsx)) har nu en dedikeret 'Bestyrelse'-sektion (◧) med 9 indholds-blokke: Hvad gør bestyrelsen, Sæson 1 baseline, Sekventiel onboarding sæson 2 (trin-liste), Det strategiske dashboard, Navngivne bestyrelsesmedlemmer (9 arketyper + formand-logik + replacement-trigger), Klub-DNA (5 arketyper + 3 effekter), Konsekvens-tier (6-rækket tabel lag 1–6), Board requests + drej-låsninger og Mid-season check. Sektionen er placeret som andet punkt i sidebaren (efter 'Kom i gang') da bestyrelsen er et af spillets primære systemer.",
          "Doc-drift sweep: FEATURE_STATUS.md opdateret med S-02h og S-02i leverancer (wizard-redesign, bug-fix-pass + 293/293 tests). BOARD_TOUR_STEPS-kommentar i BoardPage.jsx rettet til at afspejle S-02h-konteksten korrekt.",
        ],
      },
    ],
  },
  {
    version: "2.41",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02i · Bug-fix-pass + regression-tests",
        items: [
          "Bugfix ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx)): multi-plan-fornyelse starter nu altid med den længste udløbne plan uanset hvilken plan manageren klikker 'Forhandl ny plan →' på — Q-batch 1C Q19 specificerer eksplicit '5yr eller 3yr forhandles først'. Tidligere kunne klik på 1yr-panelet give forkert rækkefølge (1yr → 5yr i stedet for 5yr → 1yr)",
          "processReplacementTrigger og evaluateAndApplyConsequences gjort deps-injectable i processTeamSeasonEnd ([economyEngine.js](backend/lib/economyEngine.js)) — følger det etablerede mønster for processLoanInterest/createEmergencyLoan og muliggør præcis unit-test af S-02c/S-02e paths",
          "7 nye regression-tests for processSeasonEnd ([economyEngine.test.js](backend/lib/economyEngine.test.js)): processReplacementTrigger kaldt ved plan-completion, skippet ved mid-cycle, replacement-notifikation sendt ved replaced=true, triggerDoublePlanLapse (consecutiveLowExpirations=2 vs 0), fejl-isolation, u25_stat_sum + u25_count i snapshot. 293/293 tests grønne",
        ],
      },
    ],
  },
  {
    version: "2.40",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02h · Wizard-redesign — Hybrid B+A (strategisk dashboard + modal wizard)",
        items: [
          "BoardPage ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx)) redesignet til 3-kolonne dashboard: 5yr / 3yr / 1yr vises side om side på desktop (mobile: vertikal stack). Hvert panel viser tilfredshed%, sponsor×-modifier, mål-progress-bar og top 3 mål med status-ikoner (✓/!/~/○ fra GOAL_STATUS_META) — compact info-tæthed pr. Q-batch 1C Q17",
          "GoalMiniDialog: klik på et mål i dashboard-panelet åbner en modal med fulde mål-detaljer (fremgang, kumulativt progress-bar, importance, tradeoff-stramning, identity-badge) + dominerende board-member-portræt og reaktions-citat. Giver immersion uden at fylde dashboard (Q-batch 1C Q17)",
          "Wizard redesignet fra full-page takeover til modal overlay — dashboard forbliver synligt i baggrunden. WizardStep1/2/3 (strategi → forhandling → underskrift) er uændrede internt. Trin-indikator og satisfaction-meter bevaret. Lukkes med '← Tilbage til oversigt' (renewal) eller auto-lukkes ved sign (setup)",
          "Multi-plan-fornyelse (Q-batch 1C Q19): når 2+ planer er udløbet samme sæson bygges en renewalQueue[] sorted by PLAN_SEQUENCE (5yr → 3yr → 1yr). Første plan åbner wizarden, efter sign åbner næste plan automatisk. Modal-header viser 'Planfornyelse 1/2 — 3-årsplan' + 'Derefter fortsættes med 1-årsplan'. '← Tilbage til 3-årsplan'-knap vises fra trin 2+",
          "DashboardPlanPanel: ny kompakt komponent med expand-toggle '↓ Vis detaljer'. Detalje-sektionen inkluderer fulde GoalCards, PlanTimelineBar, SeasonSnapshotGrid, outlook/feedback, MemberReactionPanel og BoardRequestPanel — al eksisterende funktionalitet bevaret under fold",
        ],
      },
    ],
  },
  {
    version: "2.39",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02g · Manager-konkurrence + mid-season + drej-låsninger",
        items: [
          "Mid-season auto-banner ([boardMidSeason.js](backend/lib/boardMidSeason.js)): når race_days_completed krydser midpoint (= floor(race_days_total/2)) tjekker en ny cron hver human team. Hvis tilfredshed <50% ELLER ≥50% af målbare plan-mål ligger 'behind'-status → fyrer `board_critical`-notif til Indbakke 'Skal handles'-tier (Q-batch 1B Q15 + Q-batch 1C Q21). Idempotent via per-board-per-season notif-dedupe — én fire pr. board pr. sæson",
          "`relative_rank`-mål går live på BoardPage ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx)): GoalCard renderer nu rich detail 'Du staar #4 af 8 managers i divisionen — slaar 4 (maal: 3 ✓)' baseret på `season_standings.rank_in_division` + antal humane managers i din division (Q-batch 1B Q12). Skalerer fra ~19 til 100+ managers uden cross-division-støj",
          "Tradeoff-låsninger ([boardRequests.js](backend/lib/boardRequests.js)) introducerer deferred konsekvenser af approved board requests: `lower_results_pressure` → +1 til min_u25_riders/min_national_riders i næste plan-renewal. `ease_identity_requirements` → +5pp på sponsor_growth-target. Stramningen markeres med '🔒 Strammet'-badge på det modificerede mål og forsvinder efter ÉN sæson (Q-batch 1B Q16). Hardkodet pr. request-type for forudsigelighed",
          "MAJOR pivot cool-down: én MAJOR focus-skift pr. plan-livscyklus (Q-batch 1A Q3). MAJOR = krydsninger mellem extremer (more_youth_focus FRA star_signing eller more_results_focus FRA youth_development) — pivots til/fra balanced er ikke MAJOR og kan gentages. Stempel sidder på `board_profiles.major_pivot_used_at` og nulstilles ved plan-renewal (frisk plan = frisk cool-down)",
          "Window-blokering: requests umulige i sidste 5 race-days af sæsonen. Bestyrelsen vil ikke have planen drejet umiddelbart før evaluering. Mid-cycle-låsning: 5yr/3yr-planer kræver ≥50% gennemført ELLER >30% absolut satisfaction-delta før de kan drejes — forhindrer impulsive flip-flops på langtidsplaner. 1yr-planer har ingen mid-cycle-lås (Q-batch 1A Q3, Appendix beslutning 3a/c)",
          "Migration ([2026-05-05-board-tradeoff-pivot.sql](database/2026-05-05-board-tradeoff-pivot.sql)) tilføjer `board_profiles.tradeoff_active_until_season_id` (FK til seasons), `tradeoff_payload` (JSONB med stramnings-detaljer) og `major_pivot_used_at` (timestamp). Indexes for hurtig lookup ved plan-renewal. Cron integration i [cron.js](backend/cron.js) kører mid-season-review hver 30 min med immediate run on startup",
          "buildBoardProposal accepterer nu `tradeoffPayload`-param og applyTradeoffTighteningToGoals ([boardGoals.js](backend/lib/boardGoals.js)) anvender stramning som sidste step i goal-pipeline. /api/board/proposal + /api/board/sign læser tradeoff fra eksisterende board og clearer ved sign-time. Beta-reset wiper alle 3 nye felter via DELETE board_profiles ([betaResetService.js](backend/lib/betaResetService.js))",
          "36 nye backend-tests (286/286 grønne total) i [boardMidSeason.test.js](backend/lib/boardMidSeason.test.js): applyTradeoffTighteningToGoals (2 kinds + null + ikke-matchende type), isMajorPivotRequest (4 kombinationer), tradeoff/pivot-persistens i resolveBoardRequest, F4/F5/F6 availability-guards (4 mid-cycle-cases × plan_type-variationer + window-block + MAJOR-block), buildBoardProposal tradeoff-integration, evaluateMidSeasonTrigger (low_satisfaction + many_behind + ingen-trigger), processMidSeasonReviewCron (trigger ved midpoint, skip pre-midpoint, skip baseline/onboarding-fasen, idempotent replay, AI/bank/frozen-skip, pending-board-skip)",
        ],
      },
    ],
  },
  {
    version: "2.38",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02f · Klub-DNA — manageren vælger klubbens identitet i sæson 2",
        items: [
          "5 håndlavede klub-DNA-arketyper introduceret ([boardClubDna.js](backend/lib/boardClubDna.js)): 🌲 Skandinavisk udviklingshold (ungdom + nordisk arv), 🪨 Italiensk klassiker-traditionalist (forår + monumenter), ⚡ Sprint-fokuseret kommerciel (sprint + sponsorvækst), ⛰️ Fransk klatrer-arv (Tour-bjerge + national kerne), 🎯 Britisk all-rounder (bredde + datadrevet). Hver DNA har 8 policy-akser, member_alignment_bonus til 1-4 board-arketyper og en signature klub-tradition-mål",
          "Ved sæson-2-onboarding (efter sæson 1's identity er observeret) viser BoardPage et `ClubDnaSelectionCard` med 3 algoritmisk-foreslåede DNA: ét national-match (mod `season_1_identity_basis.national_core`), ét specialization-match (mod `primary_specialization`) og ét wildcard. Manageren vælger frit fra de tre — ingen påtvunget valg, men forslagene føles 'set' pga. data-grunding ([api.js](backend/routes/api.js))",
          "DNA påvirker board-medlems-tildeling: ved chairman-replacement i senere sæsoner tipper DNA-bonus alignment-scoren mod arketyper der matcher klubbens identitet. Eksempel: italiensk_klassiker giver +4 til klassiker_purist og -2 til gc_elsker, så formandsvalget reflekterer DNA'et ([boardMembers.js](backend/lib/boardMembers.js))",
          "5-årsplaners forslag får et ekstra DNA-tradition-mål injiceret som bonus (italiensk_klassiker → 'mindst ét Monument-podie pr. plan-cyklus', sprint_kommerciel → 'min. 2 etape-trøjer/sæson'). Plus DNA-vægtning multiplicerer satisfaction_bonus + _penalty på matchende mål-typer (italiensk_klassiker × 1.6 på monument_podium), så DNA føles igennem evaluering uden at ændre mål-targets ([boardGoals.js](backend/lib/boardGoals.js))",
          "Migration ([2026-05-05-board-club-dna.sql](database/2026-05-05-board-club-dna.sql)) seedet `team_dna`-reference-tabel med alle 5 arketyper + tilføjer `teams.team_dna_key` (FK til team_dna) + `teams.team_dna_chosen_at`. To nye routes: `GET /api/board/dna-suggestions` (3 forslag) og `POST /api/board/dna-choose` (commit-valg). AI/bank/frozen får aldrig DNA — manager-only per Q-batch 1A Q8",
          "Beta-reset ([betaResetService.js](backend/lib/betaResetService.js)) nulstiller `team_dna_key` + `team_dna_chosen_at` så næste sæson 2-onboarding gentager valget. DNA er 'final indtil drift' i denne slice — gradvis udvikling over 5 sæsoner kommer i opfølgnings-slice (S-02f.1)",
          "18 nye backend-tests (250/250 grønne total) i [boardClubDna.test.js](backend/lib/boardClubDna.test.js) dækker konstanter (5 DNA × shape), suggestion-determinisme + national/spec-slot-matching, alignment-bias der tipper klassiker_purist højere med italiensk DNA, mål-vægtning (1.6× monument_podium for italiensk), tradition-goal injection i 5yr (med dedup mod base-pakken og kun 5yr) og fallback til defaults uden identityBasis",
        ],
      },
    ],
  },
  {
    version: "2.37",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02e · Konsekvens-tier — bestyrelsen reagerer gradueret på lav (og høj) tilfredshed",
        items: [
          "6-lags konsekvens-system ([boardConsequences.js](backend/lib/boardConsequences.js)) der gradvis hæver presset jo lavere tilfredsheden falder — og belønner overpræstation. Ingen automatisk fyring (Q-batch 1A #4): Lag 1 (passiv sponsor-modifier ±20%, eksisterende), Lag 2 (lønloft ved <40%), Lag 3 (signing-restriktion >300K kræver godkendelse ved <30%), Lag 4 (tvunget salg ved <15%), Lag 5 (sponsor-pull-out ved <10% ELLER 2× plan-udløb under 30%), Lag 6 (bonus-tilbud +200K mod ekstra-mål ved >75%)",
          "Hard-blocks i transfer/auction-flow ([api.js](backend/routes/api.js)): nye køb ramler ind i `assertSigningAllowed` på `POST /api/auctions/:id/bid`, `POST /api/transfers/offer` og `accept_counter`-action. Returner 403 med `code='board_signing_restriction'` eller `code='board_salary_cap'` så frontend kan rendere klar fejlbesked. Lag 2 frosser holdets samlede løn ved trigger-tidspunktet — manageren kan stadig handle med rytter-rotation, bare ikke vækst",
          "Tvunget salg (lag 4) auto-lister rytteren med laveste market_value ved sæson-end. Beskytter pop≥70 OR uci_points≥100 (parallel til UCI-sync auto-protection) så bestyrelsen ikke smider stjernen. Inserter `transfer_listings`-row direkte + sender 'Skal handles'-notif. Sponsor-pull-out (lag 5) stacker multiplikativt med budget_modifier ind i næste sæson-starts sponsor-payment og auto-expirer derefter",
          "Bonus-tilbud (lag 6) er positiv konsekvens — fyrer 1×/sæson når satisfaction >75% OG ≥75% af mål er nået. Tilbyder +200K mod 1 ekstra-mål: signature_rider ved star_signing-fokus, ellers monument_podium. Manager accepterer eller afviser i ny BonusOfferCard på BoardPage; accept krediterer balance + tilføjer mål til 1yr-board's current_goals. To nye routes `/api/board/bonus-offer/{accept,decline}`",
          "Migration ([2026-05-05-board-consequences.sql](database/2026-05-05-board-consequences.sql)) tilføjer `board_consequences`-tabel med unique-active-index på (team_id, layer) der enforcer 1 aktiv pr. lag. Status-flow active → accepted/declined (lag 6) ELLER active → expired (lag 5 ved sæson-start) ELLER active → fulfilled (lag 4 når listing sælges). Notif-routing låst i Q-batch 1C Q21: lag 4-6 → `type='board_critical'` (Skal handles), lag 2-3 silent på BoardPage warning-panel",
          "Frontend ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx)): nye `BoardConsequencesPanel` (lag 2-5 warning-cards, gul for lag 2-3, rød for lag 4-5) og `BonusOfferCard` (grøn med Acceptér/Afvis-knapper). Begge vises kun udenfor baseline-fasen. Beta-reset ([betaResetService.js](backend/lib/betaResetService.js)) clearer `board_consequences` så næste cyklus starter rent",
          "41 nye backend-tests (232/232 grønne total) i [boardConsequences.test.js](backend/lib/boardConsequences.test.js) dækker tærskel-trigger pr. lag, idempotency-replay, hard-block-flow med både salary-cap- og restriction-prioritet, forced-listing-rytter-valg med star-protection, sponsor-pullout-stack + season-scoped expiration, og bonus-offer accept/decline + 1×/sæson-guardrail",
        ],
      },
    ],
  },
  {
    version: "2.36",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02d · Udvidede mål-typer — bestyrelsen kan nu kræve monumenter, trøjer, stjerner og udvikling",
        items: [
          "7 nye mål-typer tilføjet til bestyrelsens repertoire ([boardGoals.js](backend/lib/boardGoals.js)): `monument_podium` (top-3 i Monuments-løb cumulative over plan), `jersey_wins` (point/bjerg/young-trøje pr. etapeløb), `signature_rider` (≥1 rytter med popularity ≥75), `profitable_transfers` (netto transfer-balance ≥200K cumulative), `u25_development_delta` (gnsn. ≥3 stat-points/sæson på U25-ryttere), `relative_rank` (slut foran ≥N andre managers i divisionen), `domestic_dominance` (skeleton — aktiveres i S-02g)",
          "3 af de nye typer integreres med det samme i auto-genererede focus-pakker som 5. mål: `youth_development` får `u25_development_delta` (måler om dine U25-ryttere faktisk udvikler sig), `star_signing` får `signature_rider` (tvinger dig til at signe en stjerne), `balanced` får `relative_rank` (du skal slå over halvdelen i divisionen). De 4 øvrige typer (monument/jersey/profit/domestic) er klar i motoren men venter på S-02f (klub-DNA) eller S-02g (manager-konkurrence) for at blive valgt",
          "Migration ([2026-05-05-board-goal-types.sql](database/2026-05-05-board-goal-types.sql)) tilføjer `u25_stat_sum` + `u25_count`-kolonner på `board_plan_snapshots`. processSeasonEnd snapshotter U25-stat-sum hver sæson, så `u25_development_delta` kan beregne udvikling fra plan-start-baseline. Pattern matcher eksisterende cumulative_stage_wins/gc_wins ([economyEngine.js](backend/lib/economyEngine.js))",
          "Ny shared kontekst-loader [boardGoalContext.js](backend/lib/boardGoalContext.js) henter cumulativeMonumentPodiums, cumulativeJerseyWins, seasonJerseyWins, cumulativeTransferBalance, planStartU25StatSum/Count og divisionManagerCount fra DB. Kaldes både fra processSeasonEnd (sæson-evaluering) og /api/board/status (live BoardPage-outlook) — samme query-pattern, ingen drift",
          "buildNegotiatedGoal udvidet for alle 7 typer: jersey_wins/profitable_transfers/u25_development_delta/relative_rank/domestic_dominance kan lempes på target (-1 hhv. -50K), monument_podium/signature_rider er allerede minimum (target=1) men halverer satisfaction_penalty. buildGoalLabel skriver danske labels for alle 7",
          "27 nye backend-tests (191/191 grønne total) i [boardGoalTypes.test.js](backend/lib/boardGoalTypes.test.js): hver type får true-case + false-case + null/awaiting_data-edge-case. Plus integration-tests der bekræfter at de 3 nye 5. mål dukker op i `generateBoardGoals` med korrekt category-metadata",
        ],
      },
    ],
  },
  {
    version: "2.35",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02c · Navngivne board-medlemmer — bestyrelsen får ansigter og stemmer",
        items: [
          "Bestyrelsen er ikke længere en abstrakt enhed. 9 håndlavede arketyper (Sponsoraten 💰, Traditionalisten 🎩, Talentspejderen 🔭, Resultatjægeren 🏆, Pragmatikeren ⚖️, Ungdoms-idealisten 🌱, Nationalist-purist 🏳️, Klassiker-purist 🪨, GC-elsker ⛰️) udgør pool'en. Hvert hold får 5 medlemmer tildelt ved sæson-1-slut: 3 matchet til holdets identitet (`identity_basis`) + 2 wildcards der ikke modsiger de første ([boardArchetypes.js](backend/lib/boardArchetypes.js))",
          "Avatar-grid på BoardPage viser de 5 medlemmer med emoji, navn, kort beskrivelse og 'Formand'-mærke (★) på den med højeste alignment til dit hold. Wildcards markeres så du kan se hvem der bringer kontrast frem for ekko-kammer ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx))",
          "Bestyrelsens vurdering på hver plan får nu en stemme: et citat fra det medlem der ejer feedback-kategorien (resultater → Resultatjægeren, økonomi → Sponsoraten, identitet → Traditionalisten/Nationalist-purist, etc.). Ved tvivl falder valget på formanden. 270 reaktions-templates total (30 pr. arketype, fordelt på 6 buckets: positive/warning/negative feedback + goal-proposal/achievement/failure)",
          "Hver mål-kort har nu en 'X reagerer'-knap der expand'er et citat fra det medlem der ejer mål-kategorien — fx ★ Sponsoraten ved et 'no_outstanding_debt'-mål der bløder. Genbruger samme expand-pattern som S-02b's identity-badge ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx))",
          "Replacement-trigger live: 2× plan-udløb i træk under 30% tilfredshed → bestyrelsen udskifter formanden. Ny formand vælges fra de 4 ikke-tildelte arketyper baseret på alignment + non-conflict. Counter sidder per-team på `teams.consecutive_low_satisfaction_expirations`, resetes ved tilfredshed ≥30. Notif: \"Bestyrelsen har valgt en ny formand: {arketype-navn}\" ([economyEngine.js](backend/lib/economyEngine.js), [boardMembers.js](backend/lib/boardMembers.js))",
          "Conflict-detection beskytter mod modsigende holdninger: 3 'friction-akser' (debt_aversion, youth_focus, results_pressure) tjekkes ved wildcard-valg. Algoritmen tillader fallback når non-conflicting pool er tom (sjælden edge case som meget youth-tunge hold), men foretrækker altid harmoni hvis muligt — Q2-præmis 'Må dog ikke være modsigende, hvis muligt'",
          "Migration ([2026-05-05-board-members.sql](database/2026-05-05-board-members.sql)) tilføjer `team_board_members`-tabel + `teams.consecutive_low_satisfaction_expirations`-counter. Beta-reset clearer alle members + nulstiller counter + identity_basis så næste sæson 1 starter fra ren tavle ([betaResetService.js](backend/lib/betaResetService.js))",
          "16 nye backend-tests (164/164 grønne total) dækker arketype-shape (9 × 30 templates), conflict-detection, alignment-scoring, non-conflicting wildcard-valg + fallback edge case, deterministisk re-replay, idempotent assignment, dominant-member-selection (kategori + chairman-fallback), reaction-sampling pr. tone/status, replacement-counter increment/reset/trigger, AI/bank skip, og end-to-end startSequentialNegotiation med member-tildeling",
        ],
      },
    ],
  },
  {
    version: "2.34",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02b · 1yr-auto-gen + identity-feeding + auto-accept — bestyrelsen kender dit hold",
        items: [
          "Bestyrelsen \"ser\" nu hvem du er. Ved sæson-1-slut tager den et frosset snapshot af dit hold (national kerne, U25-andel, primær specialisering, stjerneprofil) og persisterer det på `teams.season_1_identity_basis`. Snapshottet er *narrativets fundament* — selv hvis dit hold ændrer sig i sæson 2+, husker bestyrelsen hvad den så ([boardIdentity.js](backend/lib/boardIdentity.js))",
          "5-årsmål viser nu inline-badges der forklarer *hvorfor* målet eksisterer: \"★ Bygger paa din FR-kerne (5/8 ryttere)\" eller \"★ Bygger paa dit ungdomsaftryk (50% U25 i sæson 1)\". Klik badgen → fuld forklaring expand med hvilke data fra sæson 1 der gjorde målet relevant. Implementeret som data-lag (`identity_basis_rationale` på goal-objektet) så fremtidige UI-redesigns kan genbruge det ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx), [boardGoals.js](backend/lib/boardGoals.js))",
          "Ny auto-accept-cron tager over når manageren glemmer at handle. Tre tærskler styret af `seasons.race_days_completed` ([boardAutoAccept.js](backend/lib/boardAutoAccept.js)): T-3 (race-day 2) → info-reminder i Bestyrelse-feed (`board_update`); T-1 (race-day 4) → kritisk \"Skal handles\"-notif (`board_critical`); T-0 (race-day 5+) → bestyrelsen vælger selv en plan baseret på dit holds identitet og signer den. Notif-dedup (24h) gør cron idempotent",
          "Auto-accept's default-fokus afledes fra `season_1_identity_basis`: høj U25-andel → ungdomsudvikling, elite-stjerneprofil → stjernesignering, GC/sprint/klassiker-spec → stjernesignering, ellers balanceret. Ingen blind \"balanced\"-fallback — selv hvis bestyrelsen tager over, matcher valget den retning, holdet allerede peger",
          "Ny countdown-banner på BoardPage: \"Bestyrelsen venter paa din forhandling — N race-days tilbage\". Skifter til kritisk farve ved T-1. Ny Bestyrelse-feed-sektion samler alle board-relaterede notifs (`board_update` + `board_critical`) ét sted så manageren har overblik uden at gå ind i Indbakken",
          "Migration ([2026-05-05-board-1yr-autogen.sql](database/2026-05-05-board-1yr-autogen.sql)) tilføjer `teams.season_1_identity_basis JSONB` + udvider `notifications_type_check` med `board_critical`. Migration kører automatisk ved push — ingen manuel handling",
          "Bagved-kulisserne: ny `boardGoals.generate1YrFromLongerPlans` returnerer to varianter (Stabil + Resultatfokus nu) klar til wizard-redesign i S-02h. 15 nye backend-tests dækker computeSeasonOneIdentity, identity-feeding-annotation, auto-accept-tærsklerne og idempotent replay (146/146 grønne)",
        ],
      },
    ],
  },
  {
    version: "2.33",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02a · Bestyrelse-redesign foundation — sæson 1 = baseline, sæson 2+ åbner sekventielt",
        items: [
          "Sæson 1 er nu en baseline-sæson hvor bestyrelsen *observerer* dit hold uden krav. Ingen mål, ingen tilfredsheds-evaluering, sponsor-modifier låst på 1.0× — du har en hel sæson til at finde din retning før forhandlingerne starter. Bestyrelsesside ([BoardPage](frontend/src/pages/BoardPage.jsx)) viser et nyt observations-banner i baseline-fasen i stedet for tomme plan-kort",
          "Når sæson 1 slutter, åbner sekventiel onboarding automatisk: 5-årsplan først, derefter 3-årsplan, derefter 1-årsplan. Trigger sker inline i `processSeasonEnd` — ingen separat cron, ingen race conditions ([economyEngine.js](backend/lib/economyEngine.js))",
          "Migration ([2026-05-05-board-foundation.sql](database/2026-05-05-board-foundation.sql)) tilføjer `board_profiles.is_baseline` + nyt `plan_type='baseline'` samt `transfer_windows.board_negotiation_state` (global onboarding-fase-lås: `locked` → `pending_5yr` → `complete`). Per-team-fremdrift udledes stadig af eksisterende rows i `board_profiles` — window-state låser kun globalt hvad der må forhandles",
          "Beta-reset opretter nu *én* baseline-row pr. team i stedet for tre plan-rows ([betaResetService.js](backend/lib/betaResetService.js)) — fuld reset af alle eksisterende managers' board-data godkendt i Q-batch 1A Q6 (vision-lock). Næste reset starter alle hold i frisk observations-sæson",
          "Ny `boardEngine.startSequentialNegotiation` ([boardSequentialNegotiation.js](backend/lib/boardSequentialNegotiation.js)) sletter baseline-rows og åbner window i `pending_5yr` ved sæson-1-slut. `transfer-window/open` arver state fra forrige window så onboarding-fasen ikke nulstilles ved sæson-skift",
          "Foundation for ~10-12 sub-slices i S-02 master-roadmap. S-02b (1yr-auto-gen + identity-feeding + auto-accept) eller S-02c (navngivne board-medlemmer) kan startes næste session — begge har kun S-02a som dep",
        ],
      },
    ],
  },
  {
    version: "2.32",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Ønskeliste-stjerne flyttet ud — én konsistent placering på tværs af sider",
        items: [
          "Ønskeliste-stjernen sad i sidste kolonne på rytteroversigten — langt til højre forbi alle 14 stat-kolonner. Du skulle scrolle vandret for at finde den, og på ønskeliste-siden var fjern-handlingen en separat \"★ Fjern\"-knap i en \"Handling\"-kolonne, mens tilføj-handlingen kun fandtes på rytteroversigten. To forskellige interaktioner for samme funktion",
          "Stjernen sidder nu i sin egen kolonne lige til højre for rytter-navnet på alle rytteroversigter — rytteroversigten ([RidersPage](frontend/src/pages/RidersPage.jsx)), ønskelisten ([WatchlistPage](frontend/src/pages/WatchlistPage.jsx)) og aktivitets-sidens ønskeliste-tab ([ActivityPage](frontend/src/pages/ActivityPage.jsx)). På ønskelisten er den fyldte stjerne (★) nok til at fjerne — \"★ Fjern\"-knappen er væk; \"Handling\"-kolonnen bruges nu kun til \"Start auktion\" hos fri agents",
          "Ny delt komponent [WatchlistStar.jsx](frontend/src/components/WatchlistStar.jsx) sikrer at stjernen ser ens ud og opfører sig ens overalt — samme stopPropagation-håndtering så klik på stjernen ikke trigger row-navigation, samme tooltip og hover-effekt",
        ],
      },
    ],
  },
  {
    version: "2.31",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Ønskeliste — paginering, fryst header og fuld bredde",
        items: [
          "Ønskelisten viste hele din watchlist i én lang liste på en smal centreret container — på en bred skærm var der >40% tom plads i siderne, og hvis du havde mange ryttere skulle du scrolle tilbage til toppen for at se kolonnenavne. Nu matcher den ryttersidens layout: tabellen fylder fuld bredde (max-w-full) og kolonne-headeren er sticky så den følger med når du scroller vertikalt",
          "Client-side paginering: 50 ryttere ad gangen med Forrige/Næste-knapper nederst og \"Viser X–Y af N\" status. Page resettes til 1 når du ændrer et filter eller en sortering, så du ikke ender på en tom side hvis filteret krymper resultatet",
          "Ryttersiden på mobil er skiftet fra kort-layout til samme tabel som desktop. Tabellen scroller vandret på små skærme i stedet for at gemme kolonner — konsistent oplevelse på tværs af platforme. Død kode (`RiderCard`-komponent, `MOBILE_STATS`-array, isMobile-state og resize-listener) er fjernet",
        ],
      },
    ],
  },
  {
    version: "2.30",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Indbakke — nyt \"Skal handles\"-tab samler pending decisions (S-05)",
        items: [
          "Indbakken havde tabs for personlige notifikationer (\"Mine\") og liga-aktivitet (\"Ligaen\"), men der var ingen FM-stil oversigt over tilbud/byttehandler/lånetilbud du SKAL tage stilling til lige nu. Du måtte hoppe ind på Transfers-siden for at se om nogen ventede på dit svar. Det var sidste P0-slice fra pre-launch roadmap (S-05 Indbakke-unification)",
          "Nyt tab \"Skal handles\" (mellem Mine og Ligaen) viser præcis de tilbud hvor DU er den part der skal beslutte: pending tilbud du har modtaget som sælger, modbud du har modtaget som køber, awaiting_confirmation hvor din bekræftelse mangler, og pending lånetilbud sendt til dit hold. Tab-knappen får en gul badge med antallet — så du kan se i ét blik om der er noget at handle på",
          "Hvert item viser rytter, modpart, pris/cash-justering og hvilken handling der ventes (\"Acceptér / afvis tilbud\", \"Bekræft handel\", \"Svar på modbud\"). Klik fører til /transfers hvor du kan accept/reject/counter/confirm. Realtime-subscription på `transfer_offers`, `swap_offers` og `loan_agreements` opdaterer listen instant når en modpart eller du selv ændrer state",
          "Auctions er IKKE inkluderet i \"Skal handles\" — at være current_bidder er ikke en stillestående beslutning (du KAN bidde højere men er ikke under tidskrav). Outbid-events kommer fortsat som notifikationer i \"Mine\". Backend: ny `inboxPending.js` lib + `GET /api/inbox/pending` (10/10 unit tests grønne for role-classification + aggregation + edge cases)",
          "Drift-fix: `activity_feed`-tabellen har levet som runtime-only siden v2.x — nu committed til [schema.sql](database/schema.sql) + idempotent migration (`database/2026-05-04-activity-feed-schema-commit.sql`). Ingen data-migration; 467 historiske rows er bevaret intakt. Orphan side `ActivityFeedPage.jsx` slettet (allerede redirected til /notifications siden v2.x — selve filen ryddet op)",
        ],
      },
    ],
  },
  {
    version: "2.29",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Trupstørrelse håndhæves automatisk ved vinduesluk (S-03)",
        items: [
          "Hidtil har der ikke været en konsekvens for at gå i sæson med ulovlig trup. Squad-grænser (D1 20-30, D2 14-20, D3 8-10) er en dokumenteret invariant, men håndhævelse manglede helt — managers kunne starte sæsonen med fx 5 ryttere i D3 og bare scoor færre point. Det fjernede al deadline-day-pres og var sidste P0 i pre-launch roadmap der kunne lade en manager rage launch-balancen",
          "Når et transfervindue lukker, fyrer cron én gang pr. lukket vindue (atomic claim på `transfer_windows.squad_enforcement_completed_at` — samme idempotency-mønster som Final Whistle-rapporten). Hvert human-team tjekkes mod sine division-grænser og auto-justeres: under min → cheapeste tilgængelige fri-/AI-rytter købes til 150% × market_value (nødlån oprettes hvis balancen ikke rækker); over max → seneste-erhvervede ejede rytter sælges tilbage til ai_team_id med fuld market_value som kredit",
          "Bøde + point-fradrag pr. afvigende rytter: 100.000 CZ$ + 200 point (begge retninger). Bøden bogføres som `squad_violation_fine` i finance_transactions; fradraget akkumuleres i en ny `season_standings.penalty_points`-kolonne der ikke overskrives af `updateStandings`-recompute fra race_results. Ranking i ranglisten bruger effektive points (`total_points − penalty_points`) så fradraget faktisk koster placering",
          "Rangliste-UI viser nu fradraget eksplicit: \"1.500 (−200)\" med tooltip der forklarer både optjente og fradragne points. Ingen visuel støj for hold uden fradrag — notationen vises kun når penalty_points > 0",
          "Ny `riders.acquired_at`-kolonne sporer hvornår en rytter blev erhvervet, så over_max-salg går efter senest-tilkomne. Backfill brugte `created_at` som rimeligt udgangspunkt. Live-opdatering tilføjet til alle 6 write-paths: auktions-finalisering (vinder + bank-køb), direkte transfer, byttehandel (begge retninger + revert-path), lån-buyout, admin-override, samt window-open flush af pending-team-id",
          "Migration: `database/2026-05-04-squad-enforcement.sql` — tilføjer `riders.acquired_at`, `transfer_windows.squad_enforcement_completed_at`, `season_standings.penalty_points`, plus tre finance-types (`auto_squad_purchase`, `auto_squad_sale`, `squad_violation_fine`) og notification-type `squad_enforced`. 7/7 unit tests grønne for `enforceTeamSquadCompliance` (within-limits no-op, auto-purchase med bøde, auto-sale med bøde, nødlån-fallback, AI-skip) + idempotency-test for cron-claim",
        ],
      },
    ],
  },
  {
    version: "2.28",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Admin — Discord webhook-test viser nu konkret status pr. webhook (S-06)",
        items: [
          "Test-knappen i Discord webhooks-sektionen viste tidligere kun en global toast (\"✅ Testbesked sendt\") uden at sige hvilken webhook der svarede hvad. Hvis testen fejlede, fik admin en generisk fejl-tekst og måtte gætte om det var URL'en, token'et eller netværket. Det gjorde smoke-verifikation upålidelig — man kunne ikke vide om en \"stille død\" webhook var i live eller ej",
          "Resultatet vises nu inline pr. webhook-row med tidsstempel: \"✅ leveret (204) · 14:23:05\" ved succes, eller en konkret diagnose ved fejl: 404 → \"webhook ikke fundet (slettet på Discord?)\", 401/403 → \"adgang afvist (token revoket?)\", 429 → \"rate-limited\", 0 → netværksfejl med detail. Resten vises med rå Discord-status + fejl-tekst (op til 80 tegn)",
          "Backend `sendTestEmbed` returnerer nu `{ ok, status, error }` i stedet for at kaste — så routen kan returnere struktureret data og frontend kan vise konkret diagnose. Loading-state nøgles på webhook-id i stedet for URL (mere stabilt hvis URL'en redigeres). Ingen schema-ændring; ingen invariant ændret",
          "Smoke-værktøjet er hermed launch-klar (S-06 P0 lukket): admin klikker Test pr. webhook → ser status med det samme → fixer eventuelle 404/401-cases ved at opdatere URL'en. Health-check cron er flyttet til P1 \"Drift-monitor\" hvor den hører hjemme",
        ],
      },
    ],
  },
  {
    version: "2.27",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "UCI-sync fanger nu compound surnames — ingen flere Tobias Lund Andresen-fejl",
        items: [
          "Mandags-cron'en (uci_scraper.py) downgradede 14 ryttere til 5 UCI-points pga. name-mismatch — bl.a. Tobias Lund Andresen (skulle være 2.514), Tobias Halland Johannessen (2.393) og Sakarias Koller Løland (319). Root cause: scraperen matchede DB-navne mod UCI-CSV som rene strings, så DB-rytteren \"Tobias\" + \"Lund Andresen\" matchede ikke UCI-formatet \"ANDRESEN Tobias Lund\" pga. ordrækkefølgen, og blev derfor sat til fallback-værdien 5",
          "Match-logikken er omskrevet til **token-set-baseret**: \"Tobias\" + \"Lund Andresen\" og \"ANDRESEN Tobias Lund\" har samme tokens {ANDRESEN, LUND, TOBIAS} og matches nu uafhængigt af ordrækkefølge. Subset-matching håndterer også middle names der findes på den ene side men ikke den anden (\"HONORÉ Mikkel Frølich\" ↔ \"Mikkel Honoré\")",
          "Normalisering håndterer nu **æ/ø/å eksplicit** (æ→ae, ø→oe, å→aa) — tidligere blev de fjernet helt af ASCII-strip, så \"Mørkøv\" blev til \"MRKV\". Bindestreger, apostroffer og punktummer normaliseres også til mellemrum (\"Lund-Andresen\" og \"O'Connor\" tokeniseres ens på begge sider)",
          "**Safety-gate** tilføjet: ryttere med popularity ≥ 70 ELLER nuværende uci_points ≥ 100 vil aldrig blive auto-downgraded til 5 igen pga. matching-fejl. Hvis matching slår fejl for en sådan rytter, bevares den nuværende værdi og der logges en warning til admin",
          "Backend's manuelle sync-knap (sheetsSync.js) er opdateret med præcis samme normaliseringslogik som mandags-cron'en, så de to paths ikke kan drive fra hinanden. Migration: `database/2026-05-04-fix-uci-points-token-mismatch.sql` (anvendt). 21/21 unit tests passerer for normalize/match/safety-gate",
        ],
      },
    ],
  },
  {
    version: "2.26",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Admin — annullér aktive auktioner med ét klik",
        items: [
          "Live-drift har manglet et undo-værktøj: hvis en auktion blev oprettet ved fejl eller med forkert pris, var den eneste vej ud direkte DB-manipulation. Det har holdt admin-drift afhængig af manuelle SQL-kald og var en launch-blocker (S-04 i pre-launch roadmap)",
          "Ny `Aktive auktioner`-sektion i Admin-panelet lister alle aktive og forlængede auktioner med rytter, sælger, pris, antal unikke budgivere og sluttidspunkt. Per-auktion `Annullér`-knap åbner confirm-modal, kører backend-cancel og opdaterer listen",
          "Backend: nyt `auctionCancellation.js`-modul kører atomar status-transition `active|extended → cancelled` (race-safe mod parallel cron-finalizer — hvis finalizer vinder, returneres 409). Bud frigives automatisk fordi balance-reservation beregnes ved query-time fra aktive auktioner — der er ingen fysisk balance at refundere",
          "Notifikationer: ny `auction_cancelled`-type sendes til alle unikke budgivere + sælger (hvis ikke allerede budgivet). Inbox + Discord DM dækker begge kanaler. Admin-handling logges i `admin_log` med rytter-id, bidder-count og auktions-pris",
          "Migration: `auctions.cancelled_at` + `auctions.cancelled_by_user_id` tilføjet til audit-spor. `'cancelled'` var allerede gyldig status i CHECK-constraint",
        ],
      },
    ],
  },
  {
    version: "2.25",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Økonomi — rytter-løn beregnes nu udelukkende af databasen",
        items: [
          "Indtil nu havde to forskellige kode-paths hver sin løn-formel: økonomi-cron og sæson-end skrev 10% af markedsværdien (canonical), mens auktioner, transfers og lån-buyouts skrev 15% (afvigende). Den samme rytter kunne derfor have løn 80.000 mandag (efter cron) og 120.000 onsdag (efter en transfer) — og tilbage til 80.000 næste mandag. Det forvirrede økonomi-rapporter og gjorde sponsor-budgetter upålidelige",
          "Fix: `riders.salary` er nu en GENERATED STORED column i Postgres med formlen `max(1, round((max(5, uci_points) * 4000 + prize_earnings_bonus) * 0.10))`. Ingen application-path kan længere skrive direkte til kolonnen — DB beregner den automatisk når `uci_points` eller `prize_earnings_bonus` opdateres",
          "5 write-paths fjernet: `auctionFinalization.js` (vinder-tildeling + bank-salg), `transferExecution.js` (transfer-confirm), `routes/api.js` (lån-buyout), `economyEngine.js` (UCI-cron) og `scripts/import_riders.py`. Funktionerne `calculateMarketSalary` og `calculateAuctionSalary` er slettet (15%-formel forsvinder helt fra kodebasen)",
          "Migration kører som en del af release: `database/2026-05-04-salary-generated-column.sql` drop+add'er kolonnen, og DB udfylder alle 8.699 ryttere med korrekt 10%-værdi øjeblikkeligt. Fra dette punkt kan rytter-løn IKKE komme ud af sync med uci_points",
        ],
      },
    ],
  },
  {
    version: "2.24.1",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Tech debt — lint-baseline ryddet",
        items: [
          "Frontend lint stod på 0 errors / 41 warnings i flere måneder, hvor ~24 af dem var ren død kode (ubrugte imports, dead state, dead funktioner) efterladt fra refactors. Hver ship-rapport måtte verificere \"samme baseline\" i stedet for \"0/0\", hvilket gjorde det svært at opdage hvis en ny warning sneg sig ind",
          "Ryddet alle 24 unused-vars warnings: fjernet dead `ProfileRedirect` (App), `FormBadge` (Standings), `formatSignalDelta` (Board), gammel `prizes`-state + `savePrize` + `prizeGroups` + `prize_tables`-load (Admin), `myStanding`/`isNewUser` (Dashboard), `myUserId`/`myTeamId` (HallOfFame), `uploadedRows` duplikat-state (Races) og 10 andre dead identifiers",
          "Baseline er nu 0 errors / 17 warnings — alle resterende er bevidste `react-hooks/exhaustive-deps` på load-once mønstre der ville kræve case-by-case analyse for at \"fixe\" sikkert. Build uændret (8.46s)",
        ],
      },
    ],
  },
  {
    version: "2.24",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Admin — Forhåndsvisning før import af løbsresultater",
        items: [
          "Sheets-import havde indtil nu ingen synlig matchrapport: når admin trykkede `Importer`, blev resultater committet med det samme — uden at vise hvilke ryttere/hold der matchede, hvilke der blev droppet, eller hvilke løb der ikke fandtes i DB. Det førte til Sæson 6-fejlen hvor forkerte sæsondata blev indlæst og måtte rulles tilbage manuelt",
          "Ny flow: `Forhåndsvis`-knap kalder backend i dry-run mode (ingen DB writes) og viser per-løb tabel med: sæson-nummer, sheet-navn vs. DB-navn, antal rækker, matched/unmatched ryttere (✓/⚠), matched/unmatched hold, total points der ville blive tildelt. Hover over ⚠-tal viser de konkrete navne der ikke kunne resolves",
          "`Bekræft import`-knap (grøn) kører den rigtige import; `Annullér` rydder forhåndsvisningen. Skipped løb (race-navne uden DB-match) vises som separat advarsel øverst i preview",
          "Backend: `POST /api/admin/import-results-sheets` accepterer nu `dry_run: true` i body. Dry-run springer alle DB-writes over (`race_results.delete/insert`, `races.update`, `import_log.insert`, standings-recompute) og returnerer kun `preview`-array. Singular execution path bevares — kun ét nyt parameter, ingen ny endpoint",
        ],
      },
    ],
  },
  {
    version: "2.23.1",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Sæson-snapshot — tomme vinder-kort er nu ikke-klikbare",
        items: [
          "Da Sæson 1 stadig er igangværende uden afsluttede løb, viser de 4 vinder-kort på `/seasons/:seasonId` tom-state (\"Ingen præmier endnu\" / \"Ingen transfers\" / \"Ingen handler\" / \"Ingen etaper kørt\"). Kortene rendrede dog stadig som klikbare buttons med hover-ring — klik gjorde dog intet, hvilket var forvirrende",
          "Fix: tomme vinder-kort har nu `cursor: default`, ingen hover-effekt og er `disabled`. Når data dukker op (efter første løb afsluttes), bliver kortene automatisk klikbare igen og linker til hold-/rytter-profil",
        ],
      },
    ],
  },
  {
    version: "2.23",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Sæson-snapshot — én side svarer på \"Hvad skete der i sæson N?\"",
        items: [
          "Ny deelbar URL `/seasons/:seasonId` samler kalender, slutstilling og sæsonens vindere på ét skærmbillede. Eksisterende `SeasonEndPage` udvidet (ikke ny side) — bevarer slutstilling pr. division, op/ned-rykning og pointudviklings-charts uændret",
          "Nyt: 4 vinder-kort øverst — 💰 Præmie-leader (mest CZ$ tjent fra løb), 💸 Største enkelt-transfer (køb/salg), 🔄 Mest aktive transfer-marked-hold, 🚴 Stage-king (flest etapesejre). Klikbare → hold-/rytter-profil",
          "Nyt: Kalender-sektion lister alle løb i sæsonen med dato, type, præmiepulje og status (afsluttet/igang/kommende). Klik åbner løbets historikside",
          "Sidebar: `Resultater → Sæsonresultater` omdøbt til `Sæson-snapshot` og peger nu på `/seasons` (auto-vælger aktiv eller seneste). Den gamle URL `/season-end` redirecter automatisk",
          "Bibliotek-tab: `Sæson N`-cellen er nu en klikbar genvej til snapshot-siden — drill-down fra et konkret løb til \"hvilken sæson-kontekst spillede dette i?\"",
          "Dropdown-skift opdaterer URL så snapshottet kan deles via link, og siden er forudsigelig deeplinkbar",
        ],
      },
    ],
  },
  {
    version: "2.22",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Løb — Konsolideret hub med Bibliotek og Point & præmier",
        items: [
          "Tre overlappende race-sider (`/races`, `/race-archive`, `/race-points`) er konsolideret til ét hub `/races` med tabs: Kalender · Bibliotek · Point & præmier",
          "Nyt: Bibliotek-tab viser alle løb på tværs af alle sæsoner med filtre (sæson, klasse, status, fritekst-søgning). Klik på en række åbner løbets historikside med tidligere udgaver og top-ryttere",
          "Nyt: Point & præmier-tab samler præmieformlen (1 UCI-point = 1.500 CZ$) og fulde pointtabeller for alle 9 løbsklasser direkte i hubben",
          "IA: Sidebaren viser nu kun ét race-link — `Liga → Løb`. `Resultater → Løbsarkiv` er fjernet (den gamle URL `/race-archive` redirecter til Bibliotek-tabben). `Resultater`-overbliksiden linker direkte til de relevante tabs",
          "Backend: ny `GET /api/races?season=&class=&q=&status=` for programmatisk adgang (auth-required, returnerer race-rows + season-relation)",
        ],
      },
    ],
  },
  {
    version: "2.21",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Under motorhjelmen — Subtile alert-tints og hover-effekter virker nu på tværs af appen",
        items: [
          "Alert-cards på Notifikationer, Bestyrelse, Admin, Marked, Auktioner, Transfers m.fl. brugte gennemsigtige farve-varianter (fx 8% rød tint på outbid-alerts, 30% grøn hover på dashboard-knapper) der silently rendrede transparent pga. en pre-eks. opacity-bug i color-tokens — Tailwinds `/N`-syntax virker ikke med plain `var()` farver, og 3 opacity-trin (3%, 8%, 12%) brugt 30+ steder var slet ikke defineret",
          "Fix: alle status-farver (`cz-success`, `cz-danger`, `cz-warning`, `cz-info`, deres `-bg0` aliases samt `cz-accent`/`cz-accent-t`) konverteret til channel-format med `<alpha-value>` placeholder, og opacity-trin 3/8/12 tilføjet til Tailwind theme",
          "Verificeret runtime via Claude Preview: 35 opacity-klasser tester nu korrekt — fx `bg-cz-info-bg0/20` = `rgba(29, 78, 216, 0.2)` (var transparent før). Dark mode `cz-*-bg` (uden -0) bevarer sin bevidste rgba 12% tint urørt",
          "Visuel impact: subtile bg-tints på alert-cards, hover-feedback på CTA-knapper, status-baggrunde og badge-chips er nu synlige som designet — ikke kritisk regression, men polish",
        ],
      },
    ],
  },
  {
    version: "2.20",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Under motorhjelmen — Deadline Day banner-fase pressure-dot fix",
        items: [
          "Banneret øverst i siden under Deadline Day havde en bug i 'pressure'-fasen (sidste timer): den røde indikator-prik var transparent fordi en CSS-token (`cz-danger-bg0`) brugt 20+ steder ikke var defineret i tailwind config — silently dropped",
          "Fix: tilføjet 4 aliases i `tailwind.config.js` for de 4 status-farve-varianter (`cz-{danger,success,warning,info}-bg0` → peger på base-farven). Lukker også samme typo på Notifikationer, Bestyrelse, Admin og flere andre alert-cards",
          "Verificeret runtime via Claude Preview: pressure-dot er nu `rgb(185, 28, 28)` (rød) som forventet. Final Whistle Discord-embed format auto-testet mod Discord limits — alle felter inden for spec",
        ],
      },
    ],
  },
  {
    version: "2.19",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Onboarding v2 — tour-knap på empty-states + completion-celebration",
        items: [
          "Marked, Auktioner og Bestyrelse: empty-state-kortene har nu en 'Vis mig rundt'-knap — managers der lander direkte på siden via menuen får nu tour-tilbuddet uanset om de gik via Dashboard eller ej (før virkede tour kun via 'Vis mig hvordan' på kom-i-gang-kortet)",
          "Dashboard: nyt celebration-kort vises engang når alle 4 grundtrin er gennemført — 'Du er klar' + tre quick-links til næste fase (Deadline Day, Bestyrelse, Hjælp & regler). Lukker post-onboarding-cliff'et hvor kortet før bare forsvandt",
          "Eksisterende managers der har dismisset progress-kortet ser stadig completion-kortet første gang efter denne deploy — derefter er begge kort skjult permanent indtil localStorage ryddes",
        ],
      },
    ],
  },
  {
    version: "2.18",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Flag virker nu korrekt i alle browsere (også Chrome på Windows)",
        items: [
          "Tidligere: flag blev rendret som Unicode-emoji — virker fint på macOS/iOS/Android og Firefox, men Chrome på Windows viste landekoder som tekst (DK, FR, ES) i stedet for flag, fordi Windows ikke har flag-emoji indbygget",
          "Nu: ny <Flag>-komponent baseret på flag-icons (SVG-sprite) — viser rigtige flag på tværs af alle browsere og OS, scalerer crisp ved enhver størrelse, virker offline",
          "22 callsites opdateret — Auktioner, Auktionshistorik, Transfers, Ryttere, Watchlist, Holdside, Hold-profil, Race-historik, Resultater, Rytterrangliste, Rytter-sammenligning, Rytter-stats, Head-to-Head, Bestyrelse",
          "Land-filter dropdown viser nu kun landenavn (uden emoji-prefix) — chip-visning og rytter-detaljer viser SVG-flag",
        ],
      },
    ],
  },
  {
    version: "2.17",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Fix: Korrekt sponsor- og løntiming i økonomi-explainer",
        items: [
          "Økonomi-explainer på /finance sagde fejlagtigt at sponsor udbetales 'månedligt' og løn trækkes 'løbende' — runtime udbetaler i virkeligheden begge som engangsbeløb (sponsor ved sæsonstart, løn ved sæsonafslutning)",
          "Hint-kort og tour-tekster opdateret så managers får et retvisende billede af hvornår pengene bevæger sig — hjælper til bedre planlægning af transferspidser og lånevalg",
        ],
      },
    ],
  },
  {
    version: "2.16",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Onboarding v2 — økonomi-explainer på /finance",
        items: [
          "Finanser: nyt explainer-kort ved første besøg forklarer de fire pengestrømme — sponsor (260K base × bestyrelses-modifier, link direkte til /board), løn (10% af rytterværdien pr. sæson), gældsloft pr. division (D1 1.200K · D2 900K · D3 600K), og forskellen på kort vs. langt lån",
          "'Vis mig rundt'-knap starter en kort tour med 3 peg-pil-tooltips: balance-kortet, gældsloft-indikatoren på Total gæld-kortet, og transaktionshistorikken hvor sponsor og løn løbende tikker ind",
          "Hint kan skjules permanent med × eller 'Spring over' — efter første dismiss vises explaineren ikke igen (gemt lokalt i din browser)",
        ],
      },
    ],
  },
  {
    version: "2.15",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Onboarding v2 — bestyrelse-explainer",
        items: [
          "Bestyrelse: nyt explainer-kort øverst på /board for managers uden plan — forklarer kort hvad bestyrelsen er, hvordan 1yr/3yr/5yr-strukturen virker, og hvilke KPI'er de vurderer på (resultater, økonomi, identitet, rangering)",
          "Tilfredshed → sponsor-modifier-tabellen vises i empty-state så du forstår hvordan din indsats slår igennem på indkomsten allerede inden første forhandling",
          "CTA 'Forhandl din første plan med bestyrelsen' åbner wizardens 5-årsplan-trin — og første gangs setup tvinger ikke længere wizarden op før du har set explaineren",
          "Kom-i-gang-kortets 'Vis mig hvordan' fungerer nu også på det fjerde trin (vælg bestyrelsesplan) — touren peger på de tre planer, sponsor-modifier og KPI-listen",
        ],
      },
    ],
  },
  {
    version: "2.14",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Under motorhjelmen — Deadline Day Flash Auction sikret mod fresh-setup-fejl",
        items: [
          "Database-opsætningen har manglet kolonnen som markerer en auktion som 'Flash Auction' (de 30-min-auktioner der kun kan startes under aktivt Deadline Day) — den var tilføjet manuelt i live-databasen, men ikke i de scripts der bruges når serveren sættes op fra bunden",
          "Tilføjet både som ny migration og direkte i schema-filer, plus en automatisk test der fanger det hvis kolonnen forsvinder igen — ingen synlig ændring for dig som manager, men fjerner risikoen for at Flash Auctions fejler hvis databasen genopsættes",
        ],
      },
    ],
  },
  {
    version: "2.13",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Onboarding v2 — guided squad-builder",
        items: [
          "Marked: nyt empty-state-kort øverst på rytter-listen for managers uden ryttere — forklarer filtre, viser balance + division-minimum, og knappen 'Find din første rytter' filtrerer automatisk listen til ryttere du har råd til",
          "Auktioner: engangs-banner forklarer +10%-overbud-reglen og 10-min auto-forlængelse første gang du besøger siden uden at have afgivet bud — kan skjules permanent med ×",
          "Kom-i-gang-kortet på Dashboard har nu en 'Vis mig hvordan'-knap der starter en kort tour med 2-3 peg-pil-tooltips på næste-trin-siden (Marked eller Auktioner)",
          "Touren peger på filtrene, rytter-listen og ønskelisten på Marked — og på bud-feltet og tid-tilbage-kolonnen på Auktioner — med 'Næste'/'Spring over' kontrol og automatisk scroll-til-element",
        ],
      },
    ],
  },
  {
    version: "2.12",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Onboarding v2 — kom-i-gang-kort på Dashboard",
        items: [
          "Nyt fremskridt-kort på Dashboard viser fire trin du har gennemført (eller mangler at gennemføre) for at få en god start: navngiv hold + manager, køb din første rytter, afgiv dit første bud og vælg en bestyrelsesplan",
          "Næste trin fremhæves med et direkte CTA-link så du ikke skal gætte hvor du skal hen",
          "Kortet kan skjules permanent med × — og forsvinder automatisk når alle fire trin er ✓",
          "Eksisterende managers ser kun de trin der ikke allerede er gennemført — har du fx alle tre indstillinger på plads, vises kortet slet ikke",
        ],
      },
    ],
  },
  {
    version: "2.11",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Kodekvalitet — react-rules på alle .jsx",
        items: [
          "ESLint react-regelsæt løftet fra .js-only til .{js,jsx} efter saneringspass af 71 pre-eksisterende issues — nye .jsx-filer fanger nu fejl ved samme niveau som .js",
          "Layout: NavItem og SidebarContent flyttet ud som top-level komponenter (rettede react-hooks/static-components — undgår at remounte sidebaren ved hver render)",
          "ConfettiModal: konfetti-partiklers borderRadius låst ved mount (rettede react-hooks/purity — Math.random kunne ellers ændre form ved hver render)",
          "BoardPage: ubrugt initial-værdi til nextNegotiationOptions fjernet",
          "22 sider: useEffect-blokke flyttet ned under deres data-loader-funktioner (rettede react-hooks/immutability — eliminerer reference-mismatch hvor effect kaldte funktion før den var declared)",
          "JSX-tekst med citationstegn escapet til &quot;/&apos; på 6 sider (rettede react/no-unescaped-entities)",
          "8 tomme catch-blokke fået kort begrundelse i stedet for at være helt tomme",
        ],
      },
    ],
  },
  {
    version: "2.10",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Tema — beskyttelse mod lyst-tema bugs",
        items: [
          "Lint-guard udvidet så hardcoded dark-only tekst- og kant-farver (text-white/N og border-white/N opacity-classes) ikke længere kan slippe gennem til prod — hullet der gjorde Panic Board ulæselig i lyst tema er nu lukket på rule-level",
          "Sidste tilbageværende dark-only opacity-class (TEST-label på Deadline Day banner ved override) ryddet samtidig",
        ],
      },
    ],
  },
  {
    version: "2.09",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Panic Board — synlighed og læsbarhed",
        items: [
          "Panic Board ligger nu i venstremenuen under Marked → så du kan finde den uden at gætte URL'en",
          "Siden er gjort læsbar i lyst tema — al tekst, kanter og status-farver bruger nu temasystemet i stedet for hardcodede dark-mode farver",
        ],
      },
    ],
  },
  {
    version: "2.08",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Tema — finpudsning",
        items: [
          "Potentiale-stjerner og rytter-statistik viser nu korrekt dæmpet tekst i begge temaer (PotentialeStars og statBg-fallback brugte tidligere en hardcoded grå der ikke fulgte temaet)",
        ],
      },
    ],
  },
  {
    version: "2.07",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Discord — privatliv",
        items: [
          "Privat info bliver privat. Overbud, vundne auktioner, modtagne transfertilbud og svar på dine egne tilbud sendes nu kun som DM — ikke længere som @mention i den fælles kanal hvor alle kan læse med",
          "Den offentlige kanal viser fortsat broadcasts (nye auktioner, gennemførte handler, byttehandler, sæson-events) men ingen person-rettet info",
        ],
      },
    ],
  },
  {
    version: "2.06",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Tema",
        items: [
          "Dark mode S2 — alle resterende sider og komponenter er nu fuldt tokeniseret. Transfers, Standings, Board, Notifikationer, Watchlist, Hall of Fame, Løb, Admin, Rytterstatistik og alle øvrige sider understøtter nu mørkt tema korrekt",
          "Komponenter opdateret: ConfettiModal, DeadlineDayBanner, DeadlineDayTicker, OnboardingModal, RiderDevelopmentTab, RiderFilters og SetupWizardModal",
        ],
      },
    ],
  },
  {
    version: "2.05",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Discord",
        items: [
          "Discord DM — push til hvor du allerede er. Når en bot er konfigureret på serveren, modtager du direkte beskeder ved overbud, vundne auktioner og transfer-tilbud/-svar",
          "Tilføj dit Discord bruger-ID under Profil → Discord Integration. Status-badge viser om DMs virker, og du kan sende en test-DM",
          "Opt-out: slå DM'er fra hvis du foretrækker kun @mention i kanalen — du kan altid skifte tilbage",
          "Dashboard-nudge til managers uden Discord-ID (kan dismisses med ×)",
        ],
      },
    ],
  },
  {
    version: "2.04",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Tema",
        items: [
          "Dark mode — nyt mørkt tema kan nu vælges under Profil & Indstillinger → Udseende",
          "Tre valgmuligheder: 'Følg system' (auto), 'Lyst', 'Mørkt'. Standard er 'Følg system'",
          "Sidebaren forbliver mørk i begge temaer for visuel konsistens. Dashboard, Mit Hold, Auktioner, Ryttere, Finanser, Login og Profil er fuldt understøttet — øvrige sider tokeniseres løbende",
        ],
      },
    ],
  },
  {
    version: "2.03",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Deadline Day",
        items: [
          "Planlagte advarsler — alle aktive managers får en notifikation 24 timer, 2 timer og 30 minutter før transfervinduet lukker",
          "Final Whistle-rapport — automatisk Discord-opsummering ved vinduesluk: største handel, mest aktive manager, antal panikhandler",
        ],
      },
    ],
  },
  {
    version: "2.02",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Deadline Day",
        items: [
          "Flash Auktion (30 min) — ny auktionstype tilgængelig under Deadline Day. Afsluttes præcis 30 minutter efter start, uanset aktivt vindue",
          "Hastebudsignal — 🚨-badge på transfertilbud når sælgerholdet er under eller på divisions-minimum. Vises hos sælger (modtagne tilbud) og køber (sendte tilbud)",
        ],
      },
    ],
  },
  {
    version: "2.01",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Deadline Day",
        items: [
          "Live Ticker — horisontal nyhedsstribe i bunden af alle sider under Deadline Day med seneste bud, salg og transfers",
          "Panic Board (/deadline-day) — overblik over alle holds truppestørrelse vs. divisions-minimum med grøn/gul/rød status",
          "Automatisk opdatering hvert 10. sekund (ticker) og 30. sekund (Panic Board)",
        ],
      },
    ],
  },
  {
    version: "2.00",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Deadline Day",
        items: [
          "Deadline Day-banner — fase-bevidst countdown (anticipation/pressure/chaos) med dynamisk farve og puls",
          "Admin: toggle til at aktivere/deaktivere Deadline Day manuelt + input til lukketidspunkt for transfervinduet",
        ],
      },
      {
        category: "Teknisk",
        items: [
          "Supabase-klient opgraderet til fuld TypeScript-typesikkerhed via genereret Database-type",
        ],
      },
    ],
  },
  {
    version: "1.99",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Teknisk",
        items: [
          "Bugfix: auktionsbud-svar returnerede nu korrekt ISO-tidsformat ved forlængelse",
          "Intern kodekvalitet: automatisk lint-tjek (ESLint) og formatering (Prettier) tilføjet til begge frontend og backend",
          "Databasetyper genereret direkte fra live schema — reducerer risiko for fremtidige fejl ved DB-ændringer",
          "Nyt invariant-tjek: 6 domæne-regler verificeres automatisk mod live data efter hvert deploy",
        ],
      },
    ],
  },
  {
    version: "1.98",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Præmieudbetaling adskilt fra løbsresultat-import — resultater kan nu re-importeres uden at påvirke allerede udbetalte præmier",
          "Ny admin-sektion 'Præmieudbetaling': se hvad der er udbetalt og hvad der mangler for hele sæsonen",
          "Knap til at udbetale alle udestående præmier på én gang med komplet løb-for-løb oversigt",
          "Præmier udbetales kun når admin godkender — aldrig automatisk ved import",
        ],
      },
    ],
  },
  {
    version: "1.97",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Teknisk",
        items: [
          "Sikkerhedsopdatering: Excel-bibliotek opgraderet til patchet version (CVE-2023-30533)",
          "PCM-filimport understøtter nu både .xlsx og .xls",
        ],
      },
    ],
  },
  {
    version: "1.96",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Auktioner",
        items: [
          "Ny tidsregel: auktioner løber i 6 aktive timer — nattimer tæller ikke med (hverdage 22-16, weekender 23-8)",
          "Eksempel: auktion startet tirsdag 19:40 udløber onsdag 19:40 — auktion startet lørdag 19:40 udløber søndag 10:40",
          "Forlængelsesregel: bud inden for de sidste 10 minutter forlænger auktionen med 10 minutter fra budtidspunktet",
          "Admin: ny sektion 'Auktionsregler' i admin-panelet — rediger varighed, aktive vinduer og forlængelsesfrist",
        ],
      },
    ],
  },
  {
    version: "1.95",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Økonomi",
        items: [
          "Fix: Præmieformlen rettet til 1 UCI-point = 1.500 CZ$ (var fejlagtigt sat til 15.000 CZ$)",
          "Alle fremtidige løbsresultater beregnes med den korrekte faktor",
        ],
      },
    ],
  },
  {
    version: "1.94",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Resultater",
        items: [
          "Ny side: Pointtabel — vis UCI-point og præmier pr. løbsklasse (Tour de France, Giro/Vuelta, Monuments, WorldTour A/B/C, ProSeries, Klasse 1/2)",
          "Præmieformlen fremhævet med konkrete eksempler: 1 UCI-point = 1.500 CZ$",
          "Tilgængelig via Resultater → Pointtabel",
        ],
      },
    ],
  },
  {
    version: "1.93",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Ryttere",
        items: [
          "Masseopdatering: 1.138 ryttere rettet fra minimumsværdi til korrekte UCI-points — heriblandt João Almeida (14M CZ$), Thomas Silva, Chris Hamilton og hundredvis af andre der manglede i gammel top-1000 CSV",
          "Alle påvirkede rytteres løn er synkroniseret automatisk",
        ],
      },
    ],
  },
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
          "Præmiepenge fra løb er nu adskilt fra sæsonpoint: UCI-point bestemmer ranglisten, og præmiepenge = UCI-point × 1.500 CZ$ udbetales direkte til holdbalancen ved resultatimport",
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
        <h1 className="text-xl font-bold text-cz-1">Patch Notes</h1>
        <p className="text-cz-3 text-sm">Opdateringshistorik for Cycling Zone Manager</p>
      </div>

      <div className="flex flex-col gap-3">
        {PATCHES.map((patch) => {
          const isOpen = expanded === patch.version;
          return (
            <div key={patch.version}
              className={`bg-cz-card border rounded-xl overflow-hidden transition-all
                ${isOpen ? "border-cz-accent/30" : "border-cz-border"}`}>
              <button
                onClick={() => setExpanded(isOpen ? null : patch.version)}
                className="w-full flex items-center justify-between px-5 py-4 text-left">
                <div className="flex items-center gap-3">
                  <span className="text-cz-1 font-bold text-sm">v{patch.version}</span>
                  <span className="text-[9px] uppercase bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 px-2 py-0.5 rounded-full">
                    {patch.label}
                  </span>
                  <span className="text-cz-3 text-xs">{patch.date}</span>
                </div>
                <span className={`text-cz-3 text-xs transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 border-t border-cz-border pt-4 space-y-4">
                  {patch.changes.map((section, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0
                          ${section.category === "Nyt" ? "bg-green-400" :
                            section.category === "Forbedringer" ? "bg-blue-400" :
                            section.category === "Fejlrettelser" ? "bg-red-400" :
                            "bg-cz-accent"}`} />
                        <span className="text-cz-2 text-xs font-semibold uppercase tracking-wider">
                          {section.category}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-1.5 ms-3.5">
                        {section.items.map((item, j) => (
                          <li key={j} className="flex items-start gap-2">
                            <div className={`w-1 h-1 rounded-full flex-shrink-0 mt-1.5
                              ${section.category === "Nyt" ? "bg-green-400" :
                                section.category === "Forbedringer" ? "bg-blue-400" :
                                section.category === "Fejlrettelser" ? "bg-red-400" :
                                "bg-cz-accent"}`} />
                            <span className="text-cz-2 text-sm leading-relaxed">{item}</span>
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
