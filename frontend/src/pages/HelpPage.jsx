import { useState } from "react";
import { Link } from "react-router-dom";

const SECTIONS = [
  {
    key: "start",
    label: "Kom i gang",
    icon: "🚀",
    content: [
      {
        title: "Hvad er Cycling Zone Manager?",
        text: "Cycling Zone Manager er et fantasy-cykelmanagerspil hvor du bygger og leder et cykelhold. Du køber ryttere på auktion, forhandler transfers med andre managers, opfylder bestyrelsens mål og konkurrerer om at klatre i divisionerne.",
      },
      {
        title: "Første skridt",
        steps: [
          "Opret en konto og log ind.",
          "Vælg holdnavn og managernavn i velkomst-wizarden — du skal udfylde begge felter for at fortsætte.",
          "Velkomstmodalen vises automatisk første gang og gennemgår de tre vigtigste funktioner: Marked, Auktioner og Bestyrelse. Den linker direkte til Hjælp & Regler.",
          "Du starter i Division 3 med et startbudget på 800.000 CZ$.",
          "Gå til Ryttere og find frie ryttere du vil byde på.",
          "Start en auktion på en rytter — vind auktionen og rytteren er din.",
          "Byg et hold på mindst 8 ryttere for at deltage i løb.",
        ],
      },
    ],
  },
  {
    key: "board",
    label: "Bestyrelse",
    icon: "◧",
    content: [
      {
        title: "Hvad gør bestyrelsen?",
        text: "Bestyrelsen sætter mål for dit hold og evaluerer dig ved sæsonens slutning. Tilfredsheden bestemmer din sponsor-modifier — dvs. hvor meget du får udbetalt af sponsorindtægten. Du kan ikke blive fyret; konsekvenserne er graduerede og altid forudsigelige.",
      },
      {
        title: "Sæson 1: Baseline — ingen krav",
        text: "Din første sæson er en ren observations-sæson. Bestyrelsen stiller ingen mål, evaluerer ikke tilfredshed og holder sponsor-modifier på 1.0×. Den læser i stedet dit hold — national kerne, U25-andel, specialisering og stjerneprofil — og gemmer et permanent identity-snapshot der bruges som fundament for sæson 2's 5-årsplan-forslag.",
      },
      {
        title: "Sekventiel onboarding i sæson 2",
        steps: [
          "Når sæson 1 slutter, åbner bestyrelsen sekventielt: 5-årsplan → 3-årsplan → 1-årsplan.",
          "Vælg en fokus-retning (Balanceret, Ungdomsudvikling, Stjernesignering) og forhandl hvert mål én gang i wizard'en.",
          "I sæson 2 vælger du også dit Klub-DNA — én af 5 arketyper der farver mål-forslag og bestyrelsens sammensætning.",
          "Glemmer du at forhandle inden race-day 5, tager bestyrelsen over og vælger en plan med default-fokus afledt af dit identity-snapshot.",
          "Derefter fornyes 1yr-planen hvert år, 3yr-planen hvert 3. år og 5yr-planen hvert 5. år — aldrig alle tre på én gang igen.",
        ],
      },
      {
        title: "Det strategiske dashboard",
        text: "Bestyrelse-siden viser de tre planer side om side (desktop) eller stablet (mobil). Hvert panel viser tilfredshed-%, sponsor×-modifier, fremdrift pr. mål og status-ikoner (✓ opfyldt · ! i fare · ~ tæt på · ○ neutral). Klik et mål for at åbne en mini-dialog med fulde detaljer, kumulativt fremdrifts-bar og en reaktion fra det bestyrelsesmedlem der ejer den kategori.",
      },
      {
        title: "Navngivne bestyrelsesmedlemmer",
        text: "Dit hold har 5 navngivne bestyrelsesmedlemmer fra en pool på 9 arketyper: Sponsoraten 💰, Traditionalisten 🎩, Talentspejderen 🔭, Resultatjægeren 🏆, Pragmatikeren ⚖️, Ungdoms-idealisten 🌱, Nationalist-purist 🏳️, Klassiker-purist 🪨 og GC-elsker ⛰️. Tre matches til dit holds sæson-1-identitet, to er wildcards der bringer kontrast. Medlemmet med højeste alignment er formand (★) og taler ved tvivl. 2× plan-udløb under 30% tilfredshed i træk → formanden udskiftes.",
      },
      {
        title: "Klub-DNA",
        text: "I sæson 2 vælger du én af 5 klub-DNA-arketyper: 🌲 Skandinavisk udviklingshold, 🪨 Italiensk klassiker-traditionalist, ⚡ Sprint-fokuseret kommerciel, ⛰️ Fransk klatrer-arv, 🎯 Britisk all-rounder. DNA påvirker tre ting: (1) 5-årsplaner får et ekstra tradition-mål (fx monumenter for italiensk_klassiker), (2) mål der matcher DNA-prioriteter får boosted satisfaction-bonus og -penalty, (3) ved fremtidige formandsskifter tipper DNA alignment-scoren mod passende arketyper.",
      },
      {
        title: "Konsekvens-tier (6 lag)",
        rows: [
          ["Lag", "Trigger", "Effekt"],
          ["1", "Tilfredshed-baseret", "Sponsor-modifier ±20% (passiv)"],
          ["2", "Tilfredshed <40%", "Lønloft — total løn frosses, ingen vækst"],
          ["3", "Tilfredshed <30%", "Signing-restriktion — køb >300K blokeres"],
          ["4", "Tilfredshed <15%", "Tvunget salg — én rytter auto-listes (pop≥70 og uci≥100 beskyttede)"],
          ["5", "<10% eller 2× plan-udløb under 30%", "Sponsor-pull-out: −10% sponsor én sæson"],
          ["6 (positiv)", ">75% tilfredshed + ≥75% mål nået", "Bonus-tilbud: +200K mod ét ekstra-mål"],
        ],
      },
      {
        title: "Board requests og drej-låsninger",
        text: "Én gang pr. sæson kan du sende en board request for at dreje din plan (fx 'mere stjernefokus'). Svaret er godkendt, delvist, afvist eller godkendt med tradeoff. MAJOR pivots (ungdom ↔ stjerne) tillades kun én gang pr. plan-livscyklus. 5yr/3yr-planer kan ikke drejes de første 50% af løbetiden medmindre tilfredsheden er ændret >30 point. I de sidste 5 race-days af en sæson er alle requests blokeret.",
      },
      {
        title: "Mid-season check",
        text: "Midt i sæsonen (halvdelen af race-days gennemført) tjekker bestyrelsen automatisk din plan-status. Hvis tilfredshed <50% eller mindst halvdelen af målbare mål er 'behind', modtager du en 'Skal handles'-notif i Indbakken. Notiffen er informativ — bestyrelsen handler ikke automatisk, men du bør reagere via board request eller de eksisterende økonomi-flows.",
      },
    ],
  },
  {
    key: "auctions",
    label: "Auktioner",
    icon: "⚡",
    content: [
      {
        title: "Hvad er auktioner?",
        text: "Auktioner bruges primært til at købe frie ryttere (ryttere uden hold). Du sætter en rytter til auktion, alle managers kan byde, og højeste bud vinder. Du kan også sætte dine egne ryttere til auktion. Starter du en auktion på en fri eller AI-ejet rytter, er du kun initiator af auktionen — du får ikke salgsprovenuet, medmindre rytteren faktisk var på dit hold.",
      },
      {
        title: "Sådan starter du en auktion",
        steps: [
          "Gå til Ryttere og find en fri eller AI-rytter.",
          "Klik på rytterens navn for at åbne statistiksiden.",
          "Klik 'Start auktion' og sæt en startpris — minimum svarer til rytterens Værdi.",
          "På fri og AI-ryttere er startprisen dit første bud, så du fører auktionen med det samme.",
          "Auktionen er nu synlig for alle under Auktioner.",
        ],
      },
      {
        title: "Garanteret salg",
        text: "Garanteret salg er en særlig auktionstype du kun kan bruge på dine egne ryttere. Startprisen sættes automatisk til 50% af Værdi, og auktionen fungerer derefter som en normal auktion. Garanteret salg er den eneste undtagelse fra minimumsprisen.",
      },
      {
        title: "Byde på auktioner",
        text: "Gå til Auktioner og find en auktion du vil byde på. Indtast dit bud og klik 'Byd'. Du kan se om du vinder (🏆 Vinder) eller om du har budt men er overbudt (⚡ Du har budt). Minimumsbuddet er 1 CZ$ over nuværende pris (eller match af asking-pris hvis ingen har budt endnu).",
      },
      {
        title: "Autobud loft",
        text: "Autobud loft lader dig sætte dit private maksimum. Hvis du ikke allerede fører auktionen, placerer autobud samtidig minimumsbuddet for dig, så du kan tage føringen uden først at byde manuelt. Systemet byder derefter automatisk videre op til dit loft, hvis andre managers overbyder.",
      },
      {
        title: "Hvornår udløber en auktion?",
        text: "En auktion løber i 6 aktive timer — nattimer tæller ikke med. Det aktive vindue er hverdage (man–fre) kl. 16–22 og weekender (lør–søn) kl. 08–23. Byder du kl. 19:40 en tirsdag, slutter auktionen onsdag kl. 19:40 (2t20m tirsdag + 3t40m onsdag). Byder du kl. 19:40 en lørdag, slutter den søndag kl. 10:40 (3t20m lørdag + 2t40m søndag).",
      },
      {
        title: "Flash Auktion (Deadline Day)",
        text: "Under Deadline Day kan du vælge Flash Auktion når du starter en auktion. En Flash Auktion varer præcis 30 minutter fra starttidspunktet — uanset aktive vinduer. Muligheden vises kun på rytterens statistikside når Deadline Day er aktivt.",
      },
      {
        title: "10-minutters forlængelse",
        text: "Hvis der afgives et bud inden for de sidste 10 minutter af en auktion, forlænges auktionen automatisk med 10 minutter fra budtidspunktet. Dette fortsætter, indtil der ikke afgives bud i de sidste 10 minutter. Forlængelsen må overskride dagens vindueslukning med op til 1 time — så fx en hverdag (close 22:00) kan auktionen forlænges helt op til 23:00. Hvis et bud i den ekstra time ville skubbe slutningen længere, ruller de resterende minutter over til næste vindues åbning (fx fredag bud kl. 22:55 → auktionen slutter lørdag kl. 08:05).",
      },
      {
        title: "Holdstørrelse og auktioner",
        text: "Holdgrænser gælder stadig per division. Aktive auktioner hvor du fører, reserverer både balance og en mulig trupplads, så du ikke kan føre flere auktioner end dit hold kan rumme. Hvis transfervinduet er lukket ved afslutning, bliver rytteren markeret til næste vindueåbning i stedet for at skifte med det samme.",
      },
    ],
  },
  {
    key: "transfers",
    label: "Transfers",
    icon: "↔",
    content: [
      {
        title: "Hvad er transfersystemet?",
        text: "Transfersystemet lader dig forhandle direkte med andre managers om at købe eller sælge ryttere — ligesom i Football Manager. Du kan sende et tilbud på enhver rytter, uanset om den er sat til salg eller ej.",
      },
      {
        title: "Send et tilbud",
        steps: [
          "Find rytteren du vil købe under Ryttere og klik på hans navn.",
          "Klik '↔ Send transfertilbud' nederst på siden.",
          "Indtast dit tilbud i CZ$ og en valgfri besked.",
          "Klik 'Send tilbud' — sælger modtager en notifikation.",
          "AI-ryttere kan ikke modtage direkte tilbud; de skal købes via auktion.",
        ],
      },
      {
        title: "Modtage og besvare tilbud",
        text: "Gå til Transfers → Modtagne tilbud. Her ser du alle tilbud på dine ryttere. Du kan acceptere (✓), afvise (✕) eller sende et modbud (↔) med din egen pris.",
      },
      {
        title: "Endelig bekræftelse",
        text: "Når et tilbud eller modbud accepteres, går handlen i en kort bekræftelsesfase. Begge managers skal bekræfte den endelige aftale, og systemet tjekker igen ejerskab, saldo og holdgrænser lige før handlen gennemføres.",
      },
      {
        title: "Forhandling frem og tilbage",
        text: "Forhandlingen kan fortsætte ubegrænset. Sælger sender modbud → køber kan acceptere modbud, sende nyt bud eller trække sig. Runde-tælleren viser hvor langt I er i forhandlingen.",
      },
      {
        title: "Privathed",
        text: "Tilbud er private — kun du og sælger kan se jeres forhandling. Andre managers kan ikke se hvem der har budt på samme rytter.",
      },
      {
        title: "Transfervindue",
        text: "Du kan forhandle og bekræfte direkte transfers og byttehandler, selv når transfervinduet er lukket. Når begge parter har accepteret, parkeres handlen som 'Aftalt — afventer vindue' og gennemføres automatisk når admin åbner transfervinduet. En parkeret handel kan ikke annulleres af manager, men systemet tjekker stadig ejerskab, saldo og holdgrænser før den gennemføres.",
      },
      {
        title: "Lejeaftaler og holdgrænser",
        text: "Lejede ryttere tæller med i din holdstørrelse på samme måde som egne ryttere og indgående handler. Systemet tjekker derfor både når du foreslår en lejeaftale, når udlejeren aktiverer den, og når andre handler afsluttes, at dit hold stadig holder sig inden for divisionens min/max-grænser. Første sæsons lejegebyr betales når aftalen aktiveres, og hvis aftalen dækker flere sæsoner bliver næste sæsoners gebyrer opkrævet automatisk ved sæsonstart.",
      },
      {
        title: "Arkivér afsluttede tilbud",
        text: "Tilbud der er afvist, trukket tilbage eller på anden vis afsluttet kan arkiveres fra Transfers-siden. Arkivering fjerner dem fra aktive lister, så igangværende forhandlinger altid er nemme at finde.",
      },
    ],
  },
  {
    key: "managers",
    label: "Manager & Profil",
    icon: "👤",
    content: [
      {
        title: "Manager-profil",
        text: "Hver manager har en offentlig profilside. Klik på et holdnavn i ranglisten, holdlisten eller transfers for at se deres profil. Profilen viser hold og ryttere, sæsonhistorik, achievements og transferaktivitet.",
      },
      {
        title: "Holdnavn og managernavn",
        text: "På Min Profil kan du gemme eller rette både holdnavn og managernavn. Hvis din konto tidligere blev oprettet uden et rigtigt hold, kan du også initialisere holdet herfra ved at gemme holdinfo.",
      },
      {
        title: "Tema (lyst / mørkt)",
        text: "Under Indstillinger → Udseende kan du vælge mellem 'Følg system' (auto efter din enhed), 'Lyst' og 'Mørkt'. Valget gemmes lokalt i din browser. Sidebaren forbliver mørk i begge temaer for konsistens.",
      },
      {
        title: "Glemt password",
        text: "Hvis du ikke kan logge ind, kan du fra login-siden vælge 'Glemt password?'. Systemet sender et reset-link til din email, og linket åbner en dedikeret side hvor du kan vælge en ny adgangskode.",
      },
      {
        title: "Indbakke",
        text: "Indbakken (under Klubhus) samler alle systemhændelser: bud, auktioner, transfertilbud, sæsonstart, økonomi og achievements. Klik på en besked for at gå direkte til den relevante side. Ulæste beskeder vises med et gult tal ved 🔔-ikonet.",
      },
      {
        title: "Online status",
        text: "En grøn prik ved en managers navn betyder de er aktive lige nu (sidst set inden for 5 minutter). En grå prik med tekst viser hvornår de sidst var online, f.eks. '3t siden'. Du kan se dette på managerprofiler og i holdlisten.",
      },
      {
        title: "Antal managers online",
        text: "På Dashboard kan du se hvor mange managers der er aktive i spillet lige nu. Dette opdateres automatisk.",
      },
      {
        title: "Login-streak",
        text: "Din 🔥 streak tæller hvor mange dage i træk du har logget ind. Streaken nulstilles hvis du springer en dag over. Høje streaks låser hemmelige achievements op. Du kan se din streak på din manager-profil.",
      },
      {
        title: "XP og niveau",
        text: "Du optjener XP for aktivitet i spillet: byde på auktioner, vinde auktioner, gennemføre transfers osv. Når du samler nok XP stiger du i niveau fra Rookie til Legende. Dit niveau vises i Hall of Fame.",
      },
      {
        title: "Head-to-Head",
        text: "Under Liga → Head-to-Head kan du sammenligne to holds historik direkte: sæsonpoint, etape- og GC-sejre, transferhistorik imellem holdene og begges nuværende top-5 ryttere. Hold A er automatisk dit eget hold. Klik i Hold B-feltet for at se forslag med det samme — ingen typing nødvendig.",
      },
    ],
  },
  {
    key: "discord",
    label: "Discord DMs",
    icon: "D",
    content: [
      {
        title: "Hvorfor Discord-DMs?",
        text: "Cycling Zone sender notifikationer (overbud, vundne auktioner, transfer-tilbud og -svar) som private beskeder direkte til dig på Discord — så du ikke skal have app'en åben for at fange en hastesituation. Det erstatter ikke in-app notifikationerne; det supplerer dem.",
      },
      {
        title: "Sådan får du DMs",
        steps: [
          "I Discord: Indstillinger → Avanceret → Aktivér Udviklertilstand.",
          "Højreklik på dit eget navn et sted i Discord og vælg \"Kopiér bruger-ID\".",
          "I Cycling Zone: gå til Profil → Discord Integration og indsæt dit ID i feltet. Klik 'Gem Discord ID'.",
          "Sørg for at du deler en server med Cycling Zone-botten, og at \"Tillad direkte beskeder fra serverens medlemmer\" er slået til på den server.",
          "Klik 'Send test-DM' for at verificere at det virker.",
        ],
      },
      {
        title: "Slå DMs fra (opt-out)",
        text: "Hvis du ikke vil have private beskeder fra botten, kan du slå \"Modtag DMs ved person-rettede events\" fra under Profil → Discord Integration. In-app notifikationerne bliver ved med at virke. Person-rettet info (overbud, vundne auktioner, transfer-tilbud/-svar) postes ikke i den fælles kanal — den er forbeholdt broadcasts.",
      },
      {
        title: "Hvornår sendes der DMs?",
        rows: [
          ["Event", "DM"],
          ["Du overbydes på en auktion", "Ja"],
          ["Du vinder en auktion", "Ja"],
          ["Du modtager et transfer-tilbud", "Ja"],
          ["Dit transfer-tilbud accepteres / afvises / får modbud", "Ja"],
          ["En ny auktion oprettes (alle managers)", "Nej — kun kanal"],
          ["Transfer fuldført (alle managers)", "Nej — kun kanal"],
          ["Sæsonstart / sæsonslut", "Nej — kun kanal"],
        ],
      },
    ],
  },
  {
    key: "achievements",
    label: "Achievements",
    icon: "🏆",
    content: [
      {
        title: "Hvad er achievements?",
        text: "Achievements er belønninger du låser op ved at nå bestemte milepæle i spillet. Der er 45 achievements fordelt på 5 kategorier: Auktioner, Transfers, Hold, Sæson og Hemmelige.",
      },
      {
        title: "Kategorier",
        rows: [
          ["Kategori", "Eksempler"],
          ["⚡ Auktioner", "Første bud, Sniper, High Roller, 50 vundne auktioner"],
          ["↔ Transfers", "Første handel, Forhandler, Kuppet, 30 transfers"],
          ["◈ Hold", "Fuldt hold, Ungdomshold, Stjerneholdet, Oprykket!"],
          ["🏁 Sæson", "Divisionsvinder, Podium, Bestyrelsens yndling, Veteran"],
          ["🔒 Hemmelige", "Låses op ved uventede hændelser — beskrives ikke på forhånd"],
        ],
      },
      {
        title: "Hemmelige achievements",
        text: "Hemmelige achievements vises som 🔒 med titlen '???' indtil du låser dem op. Beskrivelsen afsløres først bagefter. De låses op ved at gøre uventede eller sjove ting i spillet.",
      },
      {
        title: "Achievement-notifikationer",
        text: "Når du låser et achievement op, modtager du en besked i Indbakken med achievement-ikonet og titlen. Dine låste achievements vises på din manager-profil.",
      },
    ],
  },
  {
    key: "watchlist",
    label: "Talentspejder",
    icon: "⭐",
    content: [
      {
        title: "Hvad er Talentspejder?",
        text: "Talentspejder er din private ønskeliste over ryttere du følger med i. Listen er kun synlig for dig.",
      },
      {
        title: "Sådan tilføjer du en rytter",
        steps: [
          "Find en rytter i Rytterdatabasen eller på en rytters statistikside.",
          "Klik på ☆ stjernen ved siden af rytterens navn.",
          "Stjernen bliver gul (★) og rytteren er nu på din liste.",
          "Gå til Talentspejder i menuen for at se din fulde liste.",
        ],
      },
      {
        title: "Notifikation ved salg",
        text: "Hvis en rytter på din ønskeliste sættes til salg via transferlisten eller sættes til auktion, modtager du automatisk en notifikation i Indbakken. Du holder dig dermed opdateret på dine favoritter uden aktivt at tjekke markedet.",
      },
      {
        title: "Watchlist-tæller",
        text: "På en rytters statistikside kan du se '👁 X managers følger denne rytter'. Dette viser det samlede antal managers der har rytteren på deres ønskeliste — uden at afsløre hvem. Brug dette som et signal om efterspørgsel.",
      },
      {
        title: "Funktioner i Talentspejder",
        text: "Du kan sortere og filtrere dine gemte ryttere på alle stats, Værdi, løn, alder, U25/U23 og fri agent. Du kan tilføje private noter til hver rytter. På fri agents kan du starte en auktion direkte fra ønskelisten.",
      },
    ],
  },
  {
    key: "activity",
    label: "Min Aktivitet",
    icon: "◎",
    content: [
      {
        title: "Hvad er Min Aktivitet?",
        text: "Min Aktivitet er din personlige markedsarbejdsflade under Marked. Den samler alle dine markedshandlinger — auktioner, transfers, lån og ønskeliste — ét sted, adskilt fra den globale Indbakke.",
      },
      {
        title: "Fanerne",
        steps: [
          "Kræver handling: Tilbud du skal svare på, modbud du har modtaget, aftaler der afventer din bekræftelse, lejeforslag og auktioner der slutter inden for 1 time. Åbnes som standard.",
          "Auktioner: Alle aktive auktioner hvor du er sælger eller byder.",
          "Transfers: Tilbud du har modtaget og tilbud du har sendt, der stadig er aktive.",
          "Lån: Aktive og afventende lejeaftaler — ryttere du udlåner og ryttere du låner.",
          "Ønskeliste: Kompakt visning af dine gemte ryttere med markedsstatus. Klik → for fuld ønskeliste.",
          "Historik: Afsluttede auktioner, lukkede transfers og færdige lejeaftaler.",
        ],
      },
      {
        title: "Deep-links",
        text: "Klik på en række i Min Aktivitet fører dig direkte til den relevante side — auktioner, transfers eller rytterens statistikside. Klik på rytternavnet inden for en række åbner rytterens statistikside.",
      },
    ],
  },
  {
    key: "season",
    label: "Sæson",
    icon: "🏁",
    content: [
      {
        title: "Sæsonforløb",
        steps: [
          "Admin lukker transfervinduet og starter ny sæson.",
        "Ved sæsonstart: ventende transfers behandles, lønninger følger den aktuelle markedsværdi, og sponsorpenge udbetales.",
          "Løb køres i Pro Cycling Manager og resultaterne indberettes af en manager og godkendes af admin.",
          "Ved sæsonafslutning: divisionsbonus udbetales, point tælles op, op/nedrykning afgøres, lønninger trækkes, gældsrenter tilskrives.",
        ],
      },
      {
        title: "Løb og resultater",
        text: "Alle managers kan indberette løbsresultater fra PCM via Sæson & Resultater → Løb → Indberét resultater. Upload en Excel-fil, match navne og indsend til admin-godkendelse. Præmiepenge beregnes automatisk når admin finaliserer resultaterne, og sæsonstillingen opdateres gennem den samme backend-path uanset om admin godkender en pending submission eller importerer resultater direkte.",
      },
      {
        title: "Præmiepenge fra løb",
        text: "Hvert resultat der tilhører en rytter på dit hold genererer præmiepenge: UCI-point for placeringen × 1.500 CZ$. Præmiepengene udbetales automatisk til dit holds balance når admin finaliserer resultaterne og vises som 'prize'-transaktion i din finance-log. Point til sæsonranglisten og præmier beregnes separat — UCI-point bestemmer ranglisten, mens CZ$-præmien kun påvirker din balance. Løb uden løbsklasse genererer ingen præmiepenge. Se den fulde pointtabel under Sæson & Resultater → Løb → Point & præmier.",
      },
      {
        title: "Divisionsbonus ved sæsonafslutning",
        rows: [
          ["Division", "Plads 1", "Plads 2", "Plads 3", "Plads 4–5"],
          ["Division 1", "300.000 CZ$", "200.000 CZ$", "100.000 CZ$", "50.000 CZ$"],
          ["Division 2", "150.000 CZ$", "100.000 CZ$", "50.000 CZ$", "25.000 CZ$"],
          ["Division 3", "75.000 CZ$", "50.000 CZ$", "25.000 CZ$", "—"],
        ],
      },
      {
        title: "Løbsbibliotek",
        text: "Under Sæson & Resultater → Løb → Bibliotek kan du søge og filtrere alle løb på tværs af sæsoner (sæson, klasse, status, navn). Klik på et løb for at åbne dets historikside med tidligere udgaver, vinderen af hver sæson og en akkumuleret oversigt over de ryttere der historisk har klaret sig bedst i netop det løb.",
      },
      {
        title: "Op- og nedrykning",
        text: "Top 2 i Division 2 og 3 rykker op. Bund 2 i Division 1 og 2 rykker ned. Afgøres automatisk ved sæsonafslutning baseret på sæsonpoint.",
      },
      {
        title: "Hvornår kan en sæson afsluttes?",
        text: "Admin kan først afslutte en sæson når afventende løbsresultater for sæsonens løb er behandlet. Så længe der ligger indberetninger og venter på godkendelse eller afvisning, stopper sæsonafslutningen.",
      },
      {
        title: "Admin: genberegn standings ved drift",
        text: "Hvis en aktiv eller afsluttet sæson mangler stilling pga. ældre data-drift, kan admin bruge knappen '↻ Standings' på Admin-siden. Den genberegner tabellen ud fra de gemte `race_results`, opretter de manglende standings-rækker og opdaterer divisionens interne rang, som bestyrelsen bruger ved sæsonafslutning.",
      },
      {
        title: "Admin: beta-reset",
        text: "Under Admin → Beta-testværktøjer kan admin køre del-reset eller fuld test-reset. Suiten kan annullere åbne markedsaktiviteter, returnere manager-ryttere til AI/fri pulje, nulstille balancer, divisioner, bestyrelser, løbskalender, sæsoner, XP/level og achievement unlocks. AI-hold, bank-hold og frosne hold påvirkes ikke af manager-resettene.",
      },
    ],
  },
  {
    key: "prizes",
    label: "Præmier",
    icon: "🏅",
    content: [
      {
        title: "Præmieformlen",
        text: "Præmiepenge beregnes direkte fra UCI-point: 1 UCI-point = 1.500 CZ$. Kun løb med en løbsklasse (Tour de France, Giro/Vuelta, Monumenter, WorldTour, ProSeries, Klasse 1, Klasse 2) genererer præmiepenge — løb uden klasse giver 0 CZ$.",
      },
      {
        title: "Eksempler på præmiebeløb",
        rows: [
          ["Sejr", "UCI-point", "Præmie"],
          ["Tour de France-sejr", "1.300", "1.950.000 CZ$"],
          ["Monument-sejr", "800", "1.200.000 CZ$"],
          ["Etapesejr (Tour de France)", "210", "315.000 CZ$"],
          ["ProSeries-sejr", "200", "300.000 CZ$"],
          ["Klasse 1-sejr", "125", "187.500 CZ$"],
          ["Klasse 2-sejr", "40", "60.000 CZ$"],
        ],
      },
      {
        title: "Udbetaling",
        text: "Præmiepenge udbetales automatisk til din balance når admin finaliserer løbsresultaterne og vises som 'prize'-transaktion i din finance-log. Point til sæsonranglisten og præmier beregnes separat — UCI-point bestemmer ranglisten, mens CZ$-præmien kun påvirker din balance.",
      },
      {
        title: "Den fulde pointtabel",
        text: "Under Sæson & Resultater → Løb → Point & præmier finder du alle løbsklassers komplette point- og præmieskala med alle pladser.",
        cta: { label: "Åbn Point & præmier →", to: "/races?tab=points" },
        disclaimer: "Præmiebeløb kan justeres frem til sæson 1 afsluttes.",
      },
    ],
  },
  {
    key: "divisions",
    label: "Divisioner",
    icon: "◉",
    content: [
      {
        title: "Divisionsoversigt",
        text: "Spillet har 3 divisioner. Division 1 er den højeste. Alle starter i Division 3.",
      },
      {
        title: "Holdstørrelse per division",
        rows: [
          ["Division", "Minimum ryttere", "Maksimum ryttere"],
          ["Division 1", "20", "30"],
          ["Division 2", "14", "20"],
          ["Division 3", "8", "10"],
        ],
      },
      {
        title: "Op- og nedrykning",
        text: "Top 2 rykker op, bund 2 rykker ned i hver division. Rykningsafgørelse sker automatisk ved sæsonafslutning.",
      },
    ],
  },
  {
    key: "riders",
    label: "Ryttere",
    icon: "🚴",
    content: [
      {
        title: "Værdi og pris",
        text: "En rytters markedsværdi er baseværdien (minimum 5 UCI-point × 4.000 CZ$) plus gennemsnittet af rytterens præmiepenge i de seneste op til 3 afsluttede sæsoner. Startprisen på en auktion skal minimum svare til rytterens Værdi. Eneste undtagelse er Garanteret salg, som låser startprisen til 50% af Værdi.",
      },
      {
        title: "Løn",
        text: "Hver rytters årsløn er ca. 10% af markedsværdien og sættes ved købet eller ved den planlagte løngenberegning. Lønnen er synlig som en separat kolonne i Rytterdatabasen og på ønskelisten. Lønninger betales automatisk ved sæsonafslutning. Kan din balance ikke dække lønningerne, optager systemet automatisk et nødlån.",
      },
      {
        title: "Rytterstatistik",
        text: "Hver rytter har 14 stats: FL (Flad), BJ (Bjerg), KB (Mellembjerg), BK (Bakke), TT (Enkeltstart), PRL (Prolog), BRO (Brosten), SP (Sprint), ACC (Acceleration), NED (Nedkørsel), UDH (Udholdenhed), MOD (Modstandsdygtighed), RES (Restituering), FTR (Fighter).",
      },
      {
        title: "Udvikling over tid",
        text: "På en rytters statistikside ligger fanen 'Udvikling'. Her kan du se UCI-point over tid, vælge en af de 14 stats og følge stat-udviklingen som graf, samt se de seneste historiske datapunkter. Hvis fanen er tom, er der endnu ikke opsamlet historik fra de ugentlige syncs.",
      },
      {
        title: "U25 og U23 ryttere",
        text: "Ryttere under 25 og 23 år er markeret. Du kan filtrere på U25/U23 i rytterdatabasen og ønskelisten.",
      },
    ],
  },
  {
    key: "activityfeed",
    label: "Aktivitetsfeed",
    icon: "◉",
    content: [
      {
        title: "Hvad er Aktivitetsfeed?",
        text: "Aktivitetsfeed er en offentlig strøm af hvad der sker i spillet. Du kan se hvem der vinder auktioner, gennemfører transfers og hvornår sæsoner starter og slutter. Feedet opdateres i realtid.",
      },
      {
        title: "Hvad vises i feedet?",
        rows: [
          ["Hændelse", "Beskrivelse"],
          ["🏆 Auktion vundet", "Hold vandt en auktion — viser rytter og pris"],
          ["⚡ Auktion startet", "Et hold har sat en rytter til auktion"],
          ["↔ Transfer gennemført", "En transfer mellem to managers er accepteret"],
          ["🚀 Sæson startet", "Admin har startet en ny sæson"],
          ["🏅 Resultater godkendt", "Admin har godkendt løbsresultater"],
        ],
      },
      {
        title: "Transferrygter",
        text: "Hvis en manager kigger på en af dine ryttere, modtager du en anonym notifikation: 'En manager holder øje med din rytter X'. Du får maksimalt én notifikation per rytter per time for at undgå spam.",
      },
    ],
  },
];

const FAQ = [
  {
    q: "Kan andre se min balance?",
    a: "Nej. Din balance er kun synlig for dig selv.",
  },
  {
    q: "Hvad sker der med mine ryttere hvis jeg ikke logger ind?",
    a: "Dine ryttere forbliver på dit hold. Du mister dog din login-streak hvis du springer en dag over.",
  },
  {
    q: "Hvordan nulstiller jeg min adgangskode?",
    a: "Fra login-siden kan du klikke 'Glemt password?', indtaste din email og følge reset-linket i mailen. Linket åbner en dedikeret reset-side, hvor du vælger en ny adgangskode.",
  },
  {
    q: "Hvornår skifter en rytter hold efter en transfer?",
    a: "Hvis transfervinduet er åbent, gennemføres handlen straks efter begge parter har bekræftet. Hvis vinduet er lukket, parkeres handlen og gennemføres automatisk ved næste vindueåbning.",
  },
  {
    q: "Kan jeg annullere en parkeret transfer?",
    a: "Nej. Når begge parter har accepteret, er handlen låst. Systemet kan stadig annullere den ved vindueåbning, hvis ejerskab, saldo eller holdgrænser ikke længere holder.",
  },
  {
    q: "Kan jeg købe AI-ryttere med direkte tilbud?",
    a: "Nej. AI-ryttere kan ikke modtage direkte transfer- eller byttetilbud. De skal købes via auktion.",
  },
  {
    q: "Hvornår udløber en auktion?",
    a: "En auktion varer 6 aktive timer. Nattimer tæller ikke: hverdage (man–fre) er der aktiv tid kl. 16–22, weekender (lør–søn) kl. 08–23. Eksempel: auktion startet tirsdag 19:40 slutter onsdag 19:40. Auktion startet lørdag 19:40 slutter søndag 10:40.",
  },
  {
    q: "Hvad er en Flash Auktion?",
    a: "Flash Auktioner er en særlig auktionstype der kun er tilgængelig under Deadline Day. De varer præcis 30 minutter fra starttidspunktet — uanset aktivt vindue. Du finder muligheden på rytterens statistikside, når Deadline Day er aktivt.",
  },
  {
    q: "Får jeg besked før transfervinduet lukker?",
    a: "Ja. Når Deadline Day er aktivt, sender systemet automatiske notifikationer 24 timer, 2 timer og 30 minutter før vinduet lukker. Når vinduet lukker, sendes en Final Whistle-rapport til Discord med dagens største handel, mest aktive manager og antal panikhandler.",
  },
  {
    q: "Hvor meget skal jeg byde over i en auktion?",
    a: "Dit bud skal være mindst 1 CZ$ over den nuværende pris. Hvis ingen har budt endnu (fx på et garanteret salg), kan du matche asking-prisen. Aktive auktioner hvor du fører, tæller samtidig som reserveret balance og potentiel trupplads.",
  },
  {
    q: "Tæller lejede ryttere med i holdgrænsen?",
    a: "Ja. Aktive lejeaftaler tæller med i din squad-størrelse, så du kan blive afvist på lån, auktioner eller andre indgående handler hvis holdet allerede er fyldt op.",
  },
  {
    q: "Hvornår trækkes lejegebyret på en lejeaftale?",
    a: "Første dækkede sæson betales når lejeaftalen aktiveres. Hvis aftalen løber over flere sæsoner, bliver de næste sæsoners lejegebyr trukket automatisk ved sæsonstart og bogført i finance-loggen for begge hold.",
  },
  {
    q: "Kan jeg se hvem der har budt på min rytter?",
    a: "Nej. Transferforhandlinger er private — kun køber og sælger kan se dem. Du modtager en anonym notifikation når nogen kigger på din rytter.",
  },
  {
    q: "Hvad er hemmelige achievements?",
    a: "Hemmelige achievements vises som 🔒 og afsløres kun når du låser dem op. De udløses af uventede handlinger i spillet.",
  },
  {
    q: "Hvad er online status?",
    a: "En grøn prik ved en managers navn betyder de har været aktive inden for de sidste 5 minutter. Du kan se dette overalt i spillet.",
  },
  {
    q: "Hvad er login-streak?",
    a: "Din 🔥 streak tæller hvor mange dage i træk du har logget ind. Den nulstilles hvis du springer en dag over.",
  },
  {
    q: "Hvad betyder watchlist-tælleren på en rytterside?",
    a: "Det viser hvor mange managers der har den pågældende rytter på deres ønskeliste. Du kan ikke se hvem — kun det samlede antal.",
  },
  {
    q: "Får jeg besked når en rytter på min ønskeliste sættes til salg?",
    a: "Ja. Hvis en rytter du følger sættes på transferlisten eller sættes til auktion, modtager du automatisk en notifikation i Indbakken med pris og type. Du behøver altså ikke aktivt tjekke markedet for dine favoritter.",
  },
  {
    q: "Hvad er Garanteret salg, og hvornår kan jeg bruge det?",
    a: "Garanteret salg er en særlig auktionsform der kun kan bruges på dine egne ryttere. Startprisen låses til 50% af rytterens Værdi, og auktionen kører derefter normalt. Det er den eneste undtagelse fra reglen om, at startprisen mindst skal svare til rytterens fulde Værdi.",
  },
  {
    q: "Hvordan ser jeg en rytters løn?",
    a: "Løn er en synlig kolonne i Rytterdatabasen og ønskelisten og kan sorteres og filtreres på. Du kan filtrere på løn-interval under 'Løn CZ$ (min–max)' i filterpanelet. Lønnens størrelse afhænger af rytterens markedsværdi, som også inkluderer gennemsnittet af rytterens seneste sæsonpræmiepenge.",
  },
  {
    q: "Hvor kan jeg se om en rytter udvikler sig?",
    a: "Åbn rytterens statistikside og vælg fanen 'Udvikling'. Den viser historiske UCI-point, en valgbar graf for hver stat og de seneste datapunkter fra sync-historikken.",
  },
  {
    q: "Hvad sker der hvis jeg ikke kan betale lønninger?",
    a: "Hvis din balance er negativ ved sæsonafslutning, optager du automatisk et nødlån. Renter tilskrives ved næste sæsonafslutning.",
  },
  {
    q: "Hvad er gældsloftet, og hvornår gælder det?",
    a: "Hver division har et maksimalt gældsbeløb: Division 1: 1.200.000 CZ$, Division 2: 900.000 CZ$, Division 3: 600.000 CZ$. Systemet afviser nødlån der ville overskride loftet. Gældsrenter tilskrives ved sæsonafslutning oveni eksisterende gæld.",
  },
  {
    q: "Hvad er præmiepenge, og hvornår udbetales de?",
    a: "Præmiepenge er en direkte CZ$-belønning for resultater dine ryttere opnår i løbene. Beregningen er: UCI-point for placeringen × 1.500 CZ$. Pengene udbetales automatisk til din balance når admin finaliserer resultaterne og vises som 'prize' i din finance-log. Kun løb med en løbsklasse (Tour de France, WorldTour, ProSeries osv.) genererer præmiepenge — løb uden løbsklasse giver 0.",
  },
  {
    q: "Hvad er divisionsbonus, og hvornår udbetales den?",
    a: "Divisionsbonus er en engangsbonus der udbetales ved sæsonafslutning baseret på dit holds endelige placering i din division. Division 1: 300.000 / 200.000 / 100.000 / 50.000 CZ$ for plads 1–4. Division 2: 150.000 / 100.000 / 50.000 / 25.000 CZ$ for plads 1–4. Division 3: 75.000 / 50.000 / 25.000 CZ$ for plads 1–3. Bonussen bogføres som 'bonus' i din finance-log.",
  },
  {
    q: "Hvornår udbetales sponsorpenge?",
    a: "Sponsorpenge udbetales ved sæsonstart. Beløbet afhænger af bestyrelsens tilfredshed: 80%+ giver 120%, 60-79 giver 110%, 40-59 giver 100%, 20-39 giver 90%, og under 20 giver 80% af basissponsoratet.",
  },
  {
    q: "Hvad viser sæson-finansrapporten, og hvor finder jeg den?",
    a: "Sæson-finansrapporten er en dedikeret side per sæson som viser dit cashflow i den valgte sæson: hero-kortet øverst summer total indtægt + udgift + nettoresultat, to donut-diagrammer fordeler indtægter og udgifter på reason_code (sponsor, præmiepenge, auktion-køb, løn osv.), top-3-listerne fremhæver dine største transaktioner i hver retning, og loan-portfolio-tabellen viser aktive lån med restgæld + næste sæsons forventede rente. Rapporten er privat — du ser kun din egen, og admins ser ét hold ad gangen via team-dropdown. Du åbner rapporten via 📊 Sæsonsrapport-knappen øverst på Finanser-siden eller via 📊 Finansrapport-knappen på sæson-snapshot-siden (/seasons). Sponsor-modifier-kurven og direkte sammenligning med forrige sæson er først tilgængelig fra sæson 2, når der er mindst én lukket sæson at sammenligne mod.",
  },
  {
    q: "Hvordan beregnes prognosen for næste sæson på Finanser-siden?",
    a: "Prognosen viser forventet cashflow for hele næste sæson som sum af: (1) sponsor = basissponsor × bestyrelsens budget-modifier × evt. aktiv sponsor-pullout-faktor, (2) præmiepenge = sum af dine rytteres prize_earnings_bonus (rolling avg af de sidste 1-3 afsluttede sæsoner — så det er rytternes faktiske track record, ikke et gæt), (3) løn = sum af riders.salary (DB-genereret af value + prize_earnings_bonus × 0.10), (4) lånerenter = sum(amount_remaining × interest_rate) på alle aktive lån, og (5) lejegebyr for lejede ryttere som løber ind i næste sæson (modregnet med eventuelle gebyrer du modtager som udlåner). Risk-tier-badgen er 🟢 grøn hvis netto ≥ +50K og gæld < 50% af loftet, 🟡 gul hvis netto er mellem -50K og +50K eller gæld er mellem 50-80% af loftet, og 🔴 rød hvis netto < -50K, gæld > 80% af loftet, eller hvis dit underskud rammer gældsloftet inden for 2 sæsoner. Spændet (±20% på præmie-estimatet) afspejler at præmiepenge er den mest variable input — sponsor, løn og rente er deterministiske. Prognose er ikke kontrakt; tal kan ændre sig hvis du sælger ryttere, optager lån eller forhandler ny bestyrelsesplan.",
  },
  {
    q: "Hvornår opdateres sæsonstillingen?",
    a: "Sæsonstillingen opdateres når admin finaliserer løbsresultaterne. For manager-indsendte filer sker det ved godkendelse, mens admin-importerede resultater opdaterer standings med det samme gennem den samme backend-path.",
  },
  {
    q: "Kan admin afslutte sæsonen mens der mangler løbsgodkendelser?",
    a: "Nej. Afventende løbsresultater skal først godkendes eller afvises, før sæsonafslutningen kan køres.",
  },
  {
    q: "Hvad er bestyrelsestilfredshed?",
    a: "Bestyrelsen vurderer dig på de aftalte mål med en gradvis model, hvor resultater vægter mest, men økonomi, identitet og rangering også tæller. Nye planer bliver skaleret efter din division, din trupbredde og holdets afledte sportslige profil, så kravene passer bedre til virkeligheden. En nær-miss eller stærk fremgang kan derfor stadig give en acceptabel samlet vurdering. En tydelig national kerne giver også lidt identitetsværdi i bestyrelsens læsning af holdet, mens store profiler giver lidt sponsor/prestige men samtidig hæver forventningerne. Høj tilfredshed giver bonussponsorat, mens lav tilfredshed reducerer sponsorudbetalingen og kan føre til strammere krav i næste plan. Du kan ikke blive fyret af bestyrelsen i Cycling Zone.",
  },
  {
      q: "Kan jeg forhandle bestyrelsens krav?",
      a: "Ja. Når du åbner en ny bestyrelsesforhandling genererer systemet kravene på serveren ud fra division, trupstørrelse, U25-andel, national kerne, stjerneprofil og holdets nuværende sportslige profil, og du kan forhandle hvert mål én gang. Et godkendt kompromis sænker kravet lidt og halverer typisk straffen ved manglende opfyldelse. Balancerede hold med en tydelig national kerne kan også få et nationalt identitetskrav som en del af planen. Når planen først er aktiv, kan du derudover sende én bestyrelsesforespørgsel pr. sæson fra Bestyrelsessiden for at bede om en strategisk justering. Svaret kan være godkendt, delvist, afvist eller godkendt med et tradeoff, og direkte skift mellem ungdoms- og stjernespor bliver ofte gjort gradvist via en balanceret mellemstation i stedet for et øjeblikkeligt hard switch. Bestyrelsessiden viser nu også de konkrete fokus- og målændringer fra den seneste forespørgsel, så du kan se præcis hvad bestyrelsen ændrede.",
    },
    {
      q: "Kan jeg skifte direkte mellem ungdomsspor og stjernespor?",
      a: "Som regel kun delvist. Bestyrelsen kan godt acceptere en ny retning, men hvis holdets nuværende identitet peger tydeligt mod ungdom eller store profiler, bliver skiftet ofte lavet som et tradeoff via en mere balanceret plan først. Det gør requests mere forudsigelige og giver friktion i identitetsskift, så holdets DNA ikke skifter helt fra den ene dag til den anden.",
    },
  {
      q: "Hvor ser jeg bestyrelsens aktuelle vurdering?",
      a: "Dashboardet viser et kort bestyrelses-outlook med status og category-scores, mens Bestyrelsessiden viser den mere detaljerede vurdering. Bestyrelsessiden viser også bestyrelsens læsning af holdet med specialisering, U25-andel, national kerne, stjerneprofil og trupstatus, nu med landenavn og flag på den nationale kerne. Derudover forklarer Board-siden nu tydeligere hvorfor bestyrelsen reagerer, ved at vise hvilke kategorier der driver vurderingen, hvad der holder den tilbage, og hvilke signaler fra historik, identitet eller profiler der spiller ind. De to steder læser samme board-data fra backend, så de bruger den samme sandhed.",
    },
    {
      q: "Hvad er sæson 1-baseline, og hvorfor stiller bestyrelsen ikke krav?",
      a: "Sæson 1 er en observations-sæson. Bestyrelsen stiller ingen mål, evaluerer ikke tilfredshed, og sponsor-modifier holdes på 1.0×. I stedet *læser* den dit hold — hvilken nation dominerer, hvor stor er U25-andelen, hvilken specialisering peger holdet mod, og hvor synlige er dine stjerner. Når sæsonen slutter, gemmes dette \"identity-snapshot\" på dit hold permanent og bruges som grundlag for sæson 2's 5-årsplan-forslag. Du har derfor en hel sæson til at finde din retning før forhandlingerne starter for alvor.",
    },
    {
      q: "Hvad betyder 'Bygger paa din kerne'-badgen på 5-årsmål?",
      a: "Det er identity-feeding. Når bestyrelsen foreslår 5-årsmål i sæson 2, annoteres relevante mål med en lille badge der forklarer hvorfor netop dét mål eksisterer. Eksempel: 'Bygger paa din FR-kerne (5/8 ryttere)' når dit sæson-1-hold havde fem franske ryttere ud af otte. Klik badgen for fuld forklaring. Badgen viser den frosne sæson-1-observation — dvs. selv hvis du senere skifter ud, husker bestyrelsen hvilket signal der oprindeligt drev målet.",
    },
    {
      q: "Hvad sker der hvis jeg glemmer at forhandle min plan?",
      a: "Bestyrelsen tager over. Hvis du ikke har signet en ny plan inden race-day 5 er passeret, signer en cron-job automatisk en plan med default-fokus afledt af dit holds identitet (U25-tungt → ungdomsudvikling, stjerneprofil → stjernesignering, ellers balanceret) og standardmål. Du får først en info-reminder ved race-day 2 ('Bestyrelsen venter paa din N-aarsplan'), derefter en 'Skal handles'-notif ved race-day 4 ('Sidste chance'), og derefter er det bestyrelsens valg. Du kan stadig anmode om ændringer via en board request når planen kører. Tjekker du Bestyrelse-siden ofte, ser du også et live countdown-banner med antal race-days tilbage.",
    },
    {
      q: "Hvem er medlemmerne i min bestyrelse?",
      a: "Bestyrelsen består af 5 navngivne medlemmer fra en pool af 9 arketyper: Sponsoraten 💰 (vogter sponsorforhold), Traditionalisten 🎩 (klubbens arv), Talentspejderen 🔭 (langsigtede unge), Resultatjægeren 🏆 (vil vinde nu), Pragmatikeren ⚖️ (balance), Ungdoms-idealisten 🌱 (fremtid frem for nu), Nationalist-purist 🏳️ (hjemlige farver), Klassiker-purist 🪨 (monumenter), GC-elsker ⛰️ (Tour). Tre medlemmer matches til dit holds identitet ved sæson-1-slut, to vælges som wildcards der bringer kontrast — men aldrig direkte modsigelse (en debt-aversion-purist parres ikke med en risiko-rytter). Avatar-grid'et på Bestyrelse-siden viser hvem der er hvem; den med ★ er formanden.",
    },
    {
      q: "Hvad gør bestyrelsesformanden?",
      a: "Formanden er medlemmet med højeste alignment til dit hold. Han taler ved tvivl — hvis bestyrelsens vurdering ikke har en tydelig dominerende kategori, er det formandens stemme du hører. Han er også den der udskiftes hvis bestyrelsen mister tålmodigheden: 2× plan-udløb i træk under 30% tilfredshed → ny formand vælges fra de 4 ikke-tildelte arketyper. Du får en 'Bestyrelsen har valgt en ny formand'-notif når det sker.",
    },
    {
      q: "Hvorfor reagerer forskellige bestyrelsesmedlemmer på forskellige mål?",
      a: "Hver arketype 'ejer' visse kategorier: Sponsoraten ejer økonomi-mål, Resultatjægeren ejer resultater, Traditionalisten/Nationalist-purist ejer identitet, Pragmatikeren rangering. Når du klikker 'X reagerer'-knappen på et mål, vises et citat fra netop det medlem hvis kategori målet falder under. Citaterne er håndlavede pr. arketype og pr. situation (forslag, opfyldt, missed) — så Sponsoraten lyder bekymret ved et bløftende gælds-mål, og Resultatjægeren lyder begejstret ved en sejr.",
    },
    {
      q: "Hvad betyder det nye 'stjerne-rytter'-mål i star_signing-planer?",
      a: "Star_signing-fokus får nu et 5. mål: 'Mindst 1 stjerne-rytter (popularity ≥75)'. Bestyrelsen forventer at en plan om at jagte resultater også manifester sig i form af mindst én rytter med høj profil — uanset om du køber en eksisterende stjerne på markedet eller udvikler en intern. Tjekkes ved evaluerings-tidspunkt, så det er din nuværende trup der tæller. Du kan forhandle målet, men det er allerede minimum (target=1).",
    },
    {
      q: "Hvad er 'U25-stat-gevinst' i ungdomsplaner?",
      a: "Youth_development-fokus får nu et 5. mål: 'Gennemsnitlig U25-stat-gevinst ≥3 stat-points/sæson'. Det måler om dine U25-ryttere faktisk udvikler sig — ikke kun at de er på holdet. Plan-start-baseline snapshottes automatisk ved sæson-slut, og bestyrelsen sammenligner mod nuværende gennemsnit. Et udviklings-program der bare flytter unge ryttere ind men ikke udvikler dem opfylder ikke målet. Bestyrelsen forventer at se faktisk vækst.",
    },
    {
      q: "Hvad er 'slut foran X andre managers' i balanced-planer?",
      a: "Balanced-fokus får nu et 5. mål: 'Slut foran mindst 3 andre managers i divisionen'. Det handler ikke om absolut rangering, men om relativ — du skal slå over halvdelen i din division. Skalerer automatisk når flere managers joiner: hvis der er 5 humane managers i din division og du er rank 1, har du slået 4. Hvis du er rank 4, har du kun slået 1 → målet er ikke opfyldt. Beregnes fra `season_standings.rank_in_division` mod antal humane managers i din division.",
    },
    {
      q: "Hvad sker der når bestyrelsen er meget utilfreds — kan jeg blive fyret?",
      a: "Du kan ikke blive fyret. I stedet reagerer bestyrelsen gradvist gennem 6 lag jo lavere tilfredsheden bliver: ved <40% pålægger den et lønloft (du kan ikke øge holdets samlede løn — sælg en rytter først). Ved <30% kommer en signing-restriktion: køb over 300K CZ$ blokeres. Ved <15% tvangs-listes en rytter på markedet (laveste market_value, stjerner med pop≥70 eller uci≥100 er beskyttede). Ved <10% trækker en hovedsponsor sig — sponsorindtægten reduceres med 10% i den næste sæson. Alle aktive konsekvenser vises i panelet 'Aktive konsekvenser' på Bestyrelse-siden, og lag 4-5 sender også 'Skal handles'-notifs. Tilfredshed der stiger igen expirerer automatisk lag 2-3.",
    },
    {
      q: "Hvad er bonus-tilbuddet jeg lige fik fra bestyrelsen?",
      a: "Når tilfredsheden er over 75% OG mindst 75% af dine plan-mål er nået, kan bestyrelsen tilbyde dig +200K CZ$ til balancen mod ét ekstra-mål. Hvis dit fokus er star_signing, vil målet være 'Sign 1 stjerne (popularity ≥75)'; ellers vil det være 'Top-3 i mindst 1 monument'. Du kan acceptere eller afvise. Acceptér og budgettet krediteres straks via en bonus-finance-tx, og målet tilføjes til din 1-årsplan og evalueres ved sæsonens slutning. Bestyrelsen tilbyder kun ét bonus pr. sæson, så afslår du, kommer chancen først igen næste sæson hvis kriterierne stadig er opfyldt.",
    },
    {
      q: "Hvad er klub-DNA og hvornår vælger jeg det?",
      a: "Klub-DNA er din klubs identitet — én af 5 håndlavede arketyper: 🌲 Skandinavisk udviklingshold, 🪨 Italiensk klassiker-traditionalist, ⚡ Sprint-fokuseret kommerciel, ⛰️ Fransk klatrer-arv eller 🎯 Britisk all-rounder. Du vælger det i sæson 2 — efter sæson 1's identitet er observeret. Bestyrelsen analyserer dit holds national kerne og primære specialisering og foreslår 3 muligheder: ét national-match, ét specialiserings-match og ét wildcard. Du kan vælge frit blandt de tre. DNA'et er final indtil drift-mekanikken kommer (gradvis udvikling over 5 sæsoner — leveres i opfølgningsslice).",
    },
    {
      q: "Hvad gør klub-DNA helt konkret?",
      a: "DNA påvirker tre ting: (1) Dine 5-årsplaner får et ekstra DNA-tradition-mål — fx 'mindst ét Monument-podie' for italiensk_klassiker eller 'min. 2 etape-trøjer/sæson' for sprint_kommerciel — som bonus-mål oven på de focus-baserede mål. (2) Mål der matcher DNA'ets prioriteter får boostet satisfaction-bonus + penalty (italiensk_klassiker × 1.6 på monument_podium-mål — vinder du, jubler bestyrelsen ekstra; misser du, er straffen større). (3) Når formanden udskiftes (efter 2× plan-udløb under 30% tilfredshed), tipper DNA-bonus alignment-scoren mod arketyper der matcher klubbens identitet — italiensk_klassiker giver +4 til klassiker_purist og -2 til gc_elsker, så formanden reflekterer DNA'et over tid.",
    },
    {
      q: "Hvad er mid-season check, og hvorfor får jeg pludselig en 'Skal handles'-notif midt i sæsonen?",
      a: "Når halvdelen af sæsonens race-days er ovre, tjekker bestyrelsen din plan-status. Hvis tilfredsheden er under 50% ELLER mindst halvdelen af dine plan-mål ligger 'bagud' efter halvtid → får du en 'Mid-season check'-notif i Indbakke 'Skal handles'. Notifen er informativ: bestyrelsen er bekymret men handler ikke automatisk. Du kan reagere ved at sende en board request (dreje plan-mål), anmode om budget-lån på Økonomi-siden, eller bare skærpe focus resten af sæsonen. Banneret fyrer kun én gang pr. sæson pr. board.",
    },
    {
      q: "Hvad er drej-cooldown og 'MAJOR pivot'?",
      a: "En MAJOR pivot er en focus-skift mellem extremer — fra ungdomsudvikling til stjernesignering eller omvendt. Dem må du kun gennemføre én gang pr. plan-livscyklus. Når du fx accepterer 'mere stjerner nu' fra et ungdomsspor, registreres et MAJOR-pivot-stempel på din plan, og næste tilsvarende request bliver afvist med 'Bestyrelsen har allerede accepteret en MAJOR drejning'. Stemplet nulstilles når planen bliver fornyet (frisk plan = frisk cool-down). Pivots til/fra balanced er ikke MAJOR — du kan stadig dreje gradvist via balanced-mellemstation.",
    },
    {
      q: "Hvorfor kan jeg ikke sende board requests i sæsonens slutfase?",
      a: "I de sidste 5 race-days af en sæson er alle requests blokeret. Bestyrelsen vil ikke risikere at planen bliver drejet umiddelbart før evalueringen — det ville miste forbindelsen mellem dine valg og resultatet. Når der er mindre end 6 race-days tilbage, ser du 'Saesonens slutfase er begyndt'-besked på alle request-knapper. Window'et åbner igen ved sæson-start. Brug fasen til at score sidste point i stedet.",
    },
    {
      q: "Hvorfor kan jeg ikke dreje min 5-årsplan før den er halvt færdig?",
      a: "5-årsplaner og 3-årsplaner er låst de første halvdel af deres løbetid. Konkret: bestyrelsen accepterer ikke requests på en multi-årsplan før mindst 50% af planen er gennemført ELLER din tilfredshed er ændret med over 30 point siden plan-start. Det forhindrer impulsive flip-flops på langtidsplaner og giver bestyrelsen tid til at se om strategien virker. 1-årsplaner har ingen tilsvarende lås.",
    },
    {
      q: "Hvad betyder '🔒 Strammet' badgen på et mål i min nye plan?",
      a: "Badgen vises når et mål er hævet pga. en tradeoff-låsning fra en tidligere request. Hvis du fx fik godkendt 'Sænk resultatpresset' i forrige sæson, får din nye plans U25- eller national-mål +1 i krav (eller sponsor_growth +5pp ved 'Lemp identitetskrav'). Det er den deferrede konsekvens af at have lempet noget — bestyrelsen forventer at se mere af noget andet til gengæld. Stramningen forsvinder igen efter ÉN sæson.",
    },
    {
      q: "Hvordan virker 'slut foran X andre managers'-mål live?",
      a: "På Bestyrelse-siden viser balanced-planens relative_rank-mål nu live status: 'Du staar #4 af 8 managers i divisionen — slaar 4 (maal: 3 ✓)'. Tallet opdateres efter hver race-day når season_standings er opdateret. Måler relativt til antallet af humane managers i din division — så det skalerer naturligt fra ~19 nu til 100+ managers efter open beta uden cross-division-støj.",
    },
];

export default function HelpPage() {
  const [activeSection, setActiveSection] = useState("start");
  const [search, setSearch] = useState("");
  const [faqOpen, setFaqOpen] = useState(null);

  const currentSection = SECTIONS.find(s => s.key === activeSection);

  const filteredFAQ = FAQ.filter(f =>
    f.q.toLowerCase().includes(search.toLowerCase()) ||
    f.a.toLowerCase().includes(search.toLowerCase())
  );

  const filteredSections = search
    ? SECTIONS.filter(s =>
        s.label.toLowerCase().includes(search.toLowerCase()) ||
        s.content.some(c =>
          c.title.toLowerCase().includes(search.toLowerCase()) ||
          (c.text || "").toLowerCase().includes(search.toLowerCase())
        )
      )
    : null;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">Hjælp & Regler</h1>
        <p className="text-cz-3 text-sm">Alt du skal vide om Cycling Zone Manager</p>
      </div>

      {/* Search */}
      <div className="mb-5">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Søg i hjælp og FAQ..."
          className="w-full bg-cz-subtle border border-cz-border rounded-xl px-4 py-3 text-cz-1 text-sm
            placeholder-cz-3 focus:outline-none focus:border-cz-accent/40"
        />
      </div>

      {search ? (
        /* Search results */
        <div className="space-y-4">
          {filteredSections && filteredSections.length > 0 && (
            <div>
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">Sektioner</p>
              {filteredSections.map(s => (
                <button key={s.key} onClick={() => { setSearch(""); setActiveSection(s.key); }}
                  className="w-full text-left bg-cz-card border border-cz-border rounded-xl px-4 py-3 mb-2
                    hover:border-cz-border transition-all">
                  <p className="text-cz-1 text-sm">{s.icon} {s.label}</p>
                </button>
              ))}
            </div>
          )}
          {filteredFAQ.length > 0 && (
            <div>
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">FAQ</p>
              {filteredFAQ.map((f, i) => (
                <div key={i} className="bg-cz-card border border-cz-border rounded-xl px-4 py-3 mb-2">
                  <p className="text-cz-1 text-sm font-medium mb-1">{f.q}</p>
                  <p className="text-cz-2 text-sm">{f.a}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Sidebar */}
          <div className="w-40 flex-shrink-0">
            <div className="flex flex-col gap-1">
              {SECTIONS.map(s => (
                <button key={s.key} onClick={() => setActiveSection(s.key)}
                  className={`text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center gap-2
                    ${activeSection === s.key
                      ? "bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30"
                      : "text-cz-2 hover:text-cz-1 hover:bg-cz-subtle"}`}>
                  <span>{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              ))}
              <div className="h-px bg-cz-subtle my-1" />
              <button onClick={() => setActiveSection("faq")}
                className={`text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center gap-2
                  ${activeSection === "faq"
                    ? "bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30"
                    : "text-cz-2 hover:text-cz-1 hover:bg-cz-subtle"}`}>
                <span>❓</span>
                <span>FAQ</span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeSection === "faq" ? (
              <div>
                <h2 className="text-cz-1 font-bold text-base mb-4">Ofte stillede spørgsmål</h2>
                <div className="flex flex-col gap-2">
                  {FAQ.map((f, i) => (
                    <div key={i} className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
                      <button onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left">
                        <p className="text-cz-1 text-sm font-medium">{f.q}</p>
                        <span className={`text-cz-3 text-xs ml-3 flex-shrink-0 transition-transform ${faqOpen === i ? "rotate-180" : ""}`}>▾</span>
                      </button>
                      {faqOpen === i && (
                        <div className="px-4 pb-3 border-t border-cz-border pt-3">
                          <p className="text-cz-2 text-sm leading-relaxed">{f.a}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : currentSection ? (
              <div>
                <h2 className="text-cz-1 font-bold text-base mb-4">
                  {currentSection.icon} {currentSection.label}
                </h2>
                <div className="flex flex-col gap-4">
                  {currentSection.content.map((block, i) => (
                    <div key={i} className="bg-cz-card border border-cz-border rounded-xl p-4">
                      <h3 className="text-cz-1 font-semibold text-sm mb-2">{block.title}</h3>
                      {block.text && (
                        <p className="text-cz-2 text-sm leading-relaxed">{block.text}</p>
                      )}
                      {block.steps && (
                        <ol className="flex flex-col gap-1.5 mt-1">
                          {block.steps.map((step, j) => (
                            <li key={j} className="flex items-start gap-2">
                              <span className="text-cz-accent-t text-xs font-bold flex-shrink-0 mt-0.5">{j + 1}.</span>
                              <span className="text-cz-2 text-sm leading-relaxed">{step}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                      {block.rows && (
                        <div className="overflow-x-auto mt-2">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-cz-border">
                                {block.rows[0].map((h, j) => (
                                  <th key={j} className="px-3 py-2 text-left text-cz-3 text-xs uppercase tracking-wider font-medium">
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {block.rows.slice(1).map((row, j) => (
                                <tr key={j} className="border-b border-cz-border last:border-0">
                                  {row.map((cell, k) => (
                                    <td key={k} className="px-3 py-2 text-cz-2">{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {block.cta && (
                        <Link
                          to={block.cta.to}
                          className="mt-3 inline-flex items-center gap-1 text-xs text-cz-accent-t hover:underline font-medium"
                        >
                          {block.cta.label}
                        </Link>
                      )}
                      {block.disclaimer && (
                        <p className="mt-2 text-xs text-cz-3 italic border-l-2 border-cz-border pl-2">
                          {block.disclaimer}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
