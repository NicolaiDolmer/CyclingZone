import { useState } from "react";

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
          "Du starter i Division 3 med et budget på 500 CZ$.",
          "Gå til Ryttere og find frie ryttere du vil byde på.",
          "Start en auktion på en rytter — vind auktionen og rytteren er din.",
          "Byg et hold på mindst 8 ryttere for at deltage i løb.",
        ],
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
          "Gå til Ryttere og find en fri rytter.",
          "Klik på rytterens navn for at åbne statistiksiden.",
          "Klik 'Start auktion' og sæt en startpris.",
          "Auktionen er nu synlig for alle under Auktioner.",
        ],
      },
      {
        title: "Byde på auktioner",
        text: "Gå til Auktioner og find en auktion du vil byde på. Indtast dit bud og klik 'Byd'. Du kan se om du vinder (🏆 Vinder) eller om du har budt men er overbudt (⚡ Du har budt). Minimumsbuddet vises under inputfeltet.",
      },
      {
        title: "10-minutters forlængelse",
        text: "Hvis der afgives et bud inden for de sidste 10 minutter af en auktion, forlænges auktionen automatisk med 10 minutter. Dette fortsætter indtil der ikke afgives bud i de sidste 10 minutter.",
      },
      {
        title: "Holdstørrelse og auktioner",
        text: "Holdgrænser gælder stadig per division. Systemet tjekker ved auktionsafslutning, at vinderen stadig har plads på holdet, og hvis transfervinduet er lukket, bliver rytteren markeret til næste vindueåbning i stedet for at skifte med det samme.",
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
        text: "Transfers, byttehandler og endelige bekræftelser kan kun laves mens transfervinduet er åbent. Admin åbner og lukker vinduet manuelt, og markedshandler der ikke længere opfylder saldo- eller holdkrav bliver annulleret i stedet for at gå igennem.",
      },
      {
        title: "Lejeaftaler og holdgrænser",
        text: "Lejede ryttere tæller med i din holdstørrelse på samme måde som egne ryttere og indgående handler. Systemet tjekker derfor både når du foreslår en lejeaftale, når udlejeren aktiverer den, og når andre handler afsluttes, at dit hold stadig holder sig inden for divisionens min/max-grænser. Første sæsons lejegebyr betales når aftalen aktiveres, og hvis aftalen dækker flere sæsoner bliver næste sæsoners gebyrer opkrævet automatisk ved sæsonstart.",
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
        title: "Online status",
        text: "En grøn prik ved en managers navn betyder de er aktive lige nu (sidst set inden for 5 minutter). En grå prik med tekst viser hvornår de sidst var online, f.eks. '3t siden'. Du kan se dette overalt hvor manager-navne vises.",
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
        title: "Notifikationer",
        text: "Når du låser et achievement op, modtager du en notifikation med achievement-ikonet og titlen. Dine låste achievements vises på din manager-profil.",
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
        title: "Watchlist-tæller",
        text: "På en rytters statistikside kan du se '👁 X managers følger denne rytter'. Dette viser det samlede antal managers der har rytteren på deres ønskeliste — uden at afsløre hvem. Brug dette som et signal om efterspørgsel.",
      },
      {
        title: "Funktioner i Talentspejder",
        text: "Du kan sortere og filtrere dine gemte ryttere på alle stats, UCI-pris, alder, U25/U23 og fri agent. Du kan tilføje private noter til hver rytter. På fri agents kan du starte en auktion direkte fra ønskelisten.",
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
          "Ved sæsonstart: ventende transfers behandles, lønninger genberegnes til 10% af UCI-pris, sponsorpenge udbetales.",
          "Løb køres i Pro Cycling Manager og resultaterne indberettes af en manager og godkendes af admin.",
          "Ved sæsonafslutning: point tælles op, op/nedrykning afgøres, lønninger trækkes, gældsrenter tilskrives.",
        ],
      },
      {
        title: "Løb og resultater",
        text: "Alle managers kan indberette løbsresultater fra PCM via Løbskalender → Indberét resultater. Upload en Excel-fil, match navne og indsend til admin-godkendelse. Præmiepenge beregnes automatisk når admin finaliserer resultaterne, og sæsonstillingen opdateres gennem den samme backend-path uanset om admin godkender en pending submission eller importerer resultater direkte.",
      },
      {
        title: "Op- og nedrykning",
        text: "Top 2 i Division 2 og 3 rykker op. Bund 2 i Division 1 og 2 rykker ned. Afgøres automatisk ved sæsonafslutning baseret på sæsonpoint.",
      },
      {
        title: "Hvornår kan en sæson afsluttes?",
        text: "Admin kan først afslutte en sæson når afventende løbsresultater for sæsonens løb er behandlet. Så længe der ligger indberetninger og venter på godkendelse eller afvisning, stopper sæsonafslutningen.",
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
        title: "UCI-point og pris",
        text: "Alle rytteres startpris er lig med deres UCI-point. En rytter med 5.000 UCI-point starter til minimum 5.000 CZ$ på auktion.",
      },
      {
        title: "Rytterstatistik",
        text: "Hver rytter har 14 stats: FL (Flad), BJ (Bjerg), KB (Mellembjerg), BK (Bakke), TT (Enkeltstart), PRL (Prolog), BRO (Brosten), SP (Sprint), ACC (Acceleration), NED (Nedkørsel), UDH (Udholdenhed), MOD (Modstandsdygtighed), RES (Restituering), FTR (Fighter).",
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
    q: "Hvornår skifter en rytter hold efter en transfer?",
    a: "Rytteren skifter hold ved næste transfervindue-åbning. Forhandlingen kan foregå hele sæsonen.",
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
    q: "Hvad sker der hvis jeg ikke kan betale lønninger?",
    a: "Hvis din balance er negativ ved sæsonafslutning, optager du automatisk et nødlån. Renter tilskrives ved næste sæsonafslutning.",
  },
  {
    q: "Hvornår udbetales sponsorpenge?",
    a: "Sponsorpenge udbetales ved sæsonstart. Beløbet afhænger af bestyrelsens tilfredshed: 80%+ giver 120%, 60-79 giver 110%, 40-59 giver 100%, 20-39 giver 90%, og under 20 giver 80% af basissponsoratet.",
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
    a: "Bestyrelsen vurderer dig på de aftalte mål med en gradvis model, hvor resultater vægter mest, men økonomi, identitet og rangering også tæller. En nær-miss eller stærk fremgang kan derfor stadig give en acceptabel samlet vurdering. Høj tilfredshed giver bonussponsorat, mens lav tilfredshed reducerer sponsorudbetalingen og kan føre til strammere krav i næste plan. Du kan ikke blive fyret af bestyrelsen i Cycling Zone.",
  },
  {
    q: "Kan jeg forhandle bestyrelsens krav?",
    a: "Ja. Når du åbner en ny bestyrelsesforhandling genererer systemet kravene på serveren, og du kan forhandle hvert mål én gang. Et godkendt kompromis sænker kravet lidt og halverer typisk straffen ved manglende opfyldelse. Når planen først er aktiv, kan du derudover sende én board request pr. sæson fra Board-siden for at bede om en strategisk justering. Svaret kan være godkendt, delvist, afvist eller godkendt med et tradeoff.",
  },
  {
    q: "Hvor ser jeg bestyrelsens aktuelle vurdering?",
    a: "Dashboardet viser et kort bestyrelses-outlook med status og category-scores, mens Board-siden viser den mere detaljerede vurdering. De to steder læser nu samme board-data fra backend, så de bruger den samme sandhed.",
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
        <h1 className="text-xl font-bold text-white">Hjælp & Regler</h1>
        <p className="text-white/30 text-sm">Alt du skal vide om Cycling Zone Manager</p>
      </div>

      {/* Search */}
      <div className="mb-5">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Søg i hjælp og FAQ..."
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm
            placeholder-white/20 focus:outline-none focus:border-[#e8c547]/30"
        />
      </div>

      {search ? (
        /* Search results */
        <div className="space-y-4">
          {filteredSections && filteredSections.length > 0 && (
            <div>
              <p className="text-white/30 text-xs uppercase tracking-wider mb-3">Sektioner</p>
              {filteredSections.map(s => (
                <button key={s.key} onClick={() => { setSearch(""); setActiveSection(s.key); }}
                  className="w-full text-left bg-[#0f0f18] border border-white/5 rounded-xl px-4 py-3 mb-2
                    hover:border-white/10 transition-all">
                  <p className="text-white text-sm">{s.icon} {s.label}</p>
                </button>
              ))}
            </div>
          )}
          {filteredFAQ.length > 0 && (
            <div>
              <p className="text-white/30 text-xs uppercase tracking-wider mb-3">FAQ</p>
              {filteredFAQ.map((f, i) => (
                <div key={i} className="bg-[#0f0f18] border border-white/5 rounded-xl px-4 py-3 mb-2">
                  <p className="text-white text-sm font-medium mb-1">{f.q}</p>
                  <p className="text-white/50 text-sm">{f.a}</p>
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
                      ? "bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20"
                      : "text-white/40 hover:text-white hover:bg-white/5"}`}>
                  <span>{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              ))}
              <div className="h-px bg-white/5 my-1" />
              <button onClick={() => setActiveSection("faq")}
                className={`text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center gap-2
                  ${activeSection === "faq"
                    ? "bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20"
                    : "text-white/40 hover:text-white hover:bg-white/5"}`}>
                <span>❓</span>
                <span>FAQ</span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeSection === "faq" ? (
              <div>
                <h2 className="text-white font-bold text-base mb-4">Ofte stillede spørgsmål</h2>
                <div className="flex flex-col gap-2">
                  {FAQ.map((f, i) => (
                    <div key={i} className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
                      <button onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left">
                        <p className="text-white text-sm font-medium">{f.q}</p>
                        <span className={`text-white/30 text-xs ml-3 flex-shrink-0 transition-transform ${faqOpen === i ? "rotate-180" : ""}`}>▾</span>
                      </button>
                      {faqOpen === i && (
                        <div className="px-4 pb-3 border-t border-white/5 pt-3">
                          <p className="text-white/60 text-sm leading-relaxed">{f.a}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : currentSection ? (
              <div>
                <h2 className="text-white font-bold text-base mb-4">
                  {currentSection.icon} {currentSection.label}
                </h2>
                <div className="flex flex-col gap-4">
                  {currentSection.content.map((block, i) => (
                    <div key={i} className="bg-[#0f0f18] border border-white/5 rounded-xl p-4">
                      <h3 className="text-white font-semibold text-sm mb-2">{block.title}</h3>
                      {block.text && (
                        <p className="text-white/50 text-sm leading-relaxed">{block.text}</p>
                      )}
                      {block.steps && (
                        <ol className="flex flex-col gap-1.5 mt-1">
                          {block.steps.map((step, j) => (
                            <li key={j} className="flex items-start gap-2">
                              <span className="text-[#e8c547] text-xs font-bold flex-shrink-0 mt-0.5">{j + 1}.</span>
                              <span className="text-white/50 text-sm leading-relaxed">{step}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                      {block.rows && (
                        <div className="overflow-x-auto mt-2">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/5">
                                {block.rows[0].map((h, j) => (
                                  <th key={j} className="px-3 py-2 text-left text-white/30 text-xs uppercase tracking-wider font-medium">
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {block.rows.slice(1).map((row, j) => (
                                <tr key={j} className="border-b border-white/3 last:border-0">
                                  {row.map((cell, k) => (
                                    <td key={k} className="px-3 py-2 text-white/50">{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
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
