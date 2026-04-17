import { useState, useMemo } from "react";

const SECTIONS = [
  {
    key: "intro",
    label: "Introduktion",
    icon: "🚴",
    content: [
      {
        title: "Hvad er Cycling Zone?",
        text: "Cycling Zone er et multiplayer cykelmanagerspil, hvor du bygger og leder dit eget cykelhold. Du køber ryttere via auktioner og transfermarkedet, deltager i løb kørt i Pro Cycling Manager, og konkurrerer mod andre managers i din division. Målet er at klatre op gennem divisionerne ved at score flest point i løb.",
      },
      {
        title: "Sådan kommer du i gang",
        steps: [
          "Opret en konto — dit holdnavn vælges ved oprettelse.",
          "Du starter med 500 CZ$ i balance og er placeret i Division 3.",
          "Gå til Ryttere og find ryttere du vil byde på. Klik på en rytter og start en auktion.",
          "Vind auktioner for at fylde dit hold op. Du skal have mindst 8 ryttere for at deltage i løb.",
          "Følg med på Dashboard for overblik over balance, auktioner og transfers.",
        ],
      },
    ],
  },
  {
    key: "economy",
    label: "Økonomi",
    icon: "💰",
    content: [
      {
        title: "Valuta — CZ$",
        text: "Al økonomi i spillet foregår i CZ$. Din balance vises øverst i sidebaren og er kun synlig for dig selv og admin.",
      },
      {
        title: "Startbalance",
        text: "Alle holds starter med 500 CZ$.",
      },
      {
        title: "Sponsorindtægt",
        text: "Hvert hold modtager 100 CZ$ i sponsorindtægt pr. sæson, modificeret af bestyrelsens tilfredshedsmultiplikator. En tilfredsstillelse på over 70% giver mere end 100 CZ$, under 40% giver mindre.",
      },
      {
        title: "Lønninger",
        text: "Hver rytter koster 10% af hans UCI-pris i løn pr. sæson. En rytter med 1.000 UCI-point koster 100 CZ$ i løn. Lønninger trækkes automatisk ved sæsonstart og genberegnes baseret på rytterens aktuelle UCI-pris.",
      },
      {
        title: "Præmiepenge",
        text: "Holdene modtager præmiepenge baseret på deres rytteres placeringer i løb. Præmierne er de samme uanset division. Præmietabellen kan ses i Admin-panelet.",
      },
      {
        title: "Gæld og renter",
        text: "Hvis din balance er negativ ved sæsonafslutning, tilskrives 10% renter. Eksempel: -500 CZ$ giver 50 CZ$ i renter, så din gæld stiger til -550 CZ$.",
      },
    ],
  },
  {
    key: "auctions",
    label: "Auktioner",
    icon: "⚡",
    content: [
      {
        title: "Hvad bruges auktioner til?",
        text: "Auktioner bruges primært til at købe frie ryttere (ryttere uden hold). Du sætter en rytter til auktion, alle managers kan byde, og højeste bud vinder. Du kan også sætte dine egne ryttere til auktion.",
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
        title: "Frie ryttere vs. andre managers ryttere",
        text: "Du kan byde på frie ryttere via auktion — også auktioner du selv har startet. Vil du købe en rytter fra en anden manager, bruger du transfersystemet i stedet (se Transfers).",
      },
      {
        title: "Holdstørrelse og auktioner",
        text: "Hvis du vinder en auktion men dit hold allerede er fuldt (se holdgrænser under Divisioner), annulleres overdragelsen og du får besked.",
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
        title: "Forhandling frem og tilbage",
        text: "Forhandlingen kan fortsætte ubegrænset. Sælger sender modbud → køber kan acceptere modbud, sende nyt bud eller trække sig. Runde-tælleren viser hvor langt I er i forhandlingen.",
      },
      {
        title: "Privathed",
        text: "Tilbud er private — kun du og sælger kan se jeres forhandling. Andre managers kan ikke se hvem der har budt på samme rytter.",
      },
      {
        title: "Transfervindue",
        text: "Du kan forhandle hele sæsonen, men rytteren skifter kun hold fysisk når transfervinduet åbner. Admin åbner og lukker vinduet manuelt.",
      },
      {
        title: "Sæt en rytter til salg",
        text: "Du kan også sætte en rytter på transfermarkedet med en fast udbudspris under Transfers → Marked. Andre managers kan derefter sende tilbud på udbudsprisen.",
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
        text: "Alle managers kan indberette løbsresultater fra PCM via Løbskalender → Indberét resultater. Upload en Excel-fil, match navne og indsend til admin-godkendelse. Præmiepenge beregnes automatisk når admin godkender.",
      },
      {
        title: "Op- og nedrykning",
        text: "Top 2 i Division 2 og 3 rykker op. Bund 2 i Division 1 og 2 rykker ned. Afgøres automatisk ved sæsonafslutning baseret på sæsonpoint.",
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
        title: "Minimumsryttere for løb",
        text: "Du skal have mindst 8 ryttere på dit hold for at deltage i løb. Hvis du er under minimum vises en advarsel på Dashboard og Mit Hold.",
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
        text: "Hver rytter har 14 stats: FL (Flad), BJ (Bjerg), KB (Mellembjerg), BK (Bakke), TT (Enkeltstart), PRL (Prolog), Bro (Brosten), SP (Sprint), ACC (Acceleration), NED (Nedkørsel), UDH (Udholdenhed), MOD (Modstandsdygtighed), RES (Restituering), FTR (Fighter).",
      },
      {
        title: "U25 og U23 ryttere",
        text: "Ryttere under 25 og 23 år er markeret. Du kan filtrere på U25/U23 i rytterdatabasen og ønskelisten.",
      },
      {
        title: "Filtrering og sortering",
        text: "I rytterdatabasen kan du filtrere på navn, UCI-pris (min/max), alder (min/max), hold, U25, U23 og fri agent. Du kan sortere på alle stats og UCI-pris. Det samme filterpanel er tilgængeligt på Mit Hold, Auktioner, Transfers og Ønskeliste.",
      },
    ],
  },
  {
    key: "races",
    label: "Løb & Resultater",
    icon: "🏁",
    content: [
      {
        title: "Løbskalender",
        text: "Under Løbskalender kan du se alle løb i den aktive sæson. Klik på et løb for at se detaljer, præmiepulje og resultater når de er importeret.",
      },
      {
        title: "Indberét resultater fra PCM",
        steps: [
          "Gå til Løbskalender → Indberét resultater.",
          "Vælg løb, etapenummer og type (etape, samlet osv.).",
          "Upload en Excel-fil fra PCM med kolonner: Placering (A) og Rytternavn (B).",
          "Klik 'Auto-match navne' for at matche navne til databasen.",
          "Ret eventuelle fejlmatchninger manuelt.",
          "Klik 'Indsend til godkendelse' — admin godkender inden det er officielt.",
        ],
      },
      {
        title: "Admin godkendelse",
        text: "Alle indberetninger skal godkendes af admin inden de træder i kraft. Når admin godkender, beregnes og udbetales præmiepenge automatisk.",
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
          ["📋 Rytter til salg", "Et hold har sat en rytter på transfermarkedet"],
          ["🚀 Sæson startet", "Admin har startet en ny sæson"],
          ["🏅 Resultater godkendt", "Admin har godkendt løbsresultater"],
        ],
      },
      {
        title: "Transferrygter",
        text: "Hvis en manager kigger på en af dine ryttere, modtager du en anonym notifikation: 'En manager holder øje med din rytter X'. Du får maksimalt én notifikation per rytter per time for at undgå spam. Dette giver dig et tip om at en rytter er efterspurgt.",
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
        title: "Funktioner i Talentspejder",
        text: "Du kan sortere og filtrere dine gemte ryttere på alle stats, UCI-pris, alder, U25/U23 og fri agent. Du kan tilføje private noter til hver rytter. På fri agents kan du starte en auktion direkte fra ønskelisten.",
      },
    ],
  },
  {
    key: "manager",
    label: "Manager Niveau",
    icon: "👤",
    content: [
      {
        title: "XP og niveau",
        text: "Du optjener XP for aktivitet i spillet. Når du samler nok XP stiger du i niveau. Dit niveau og din titel vises i Hall of Fame.",
      },
      {
        title: "XP-belønninger",
        rows: [
          ["Handling", "XP"],
          ["Bud afgivet på auktion", "+2 XP"],
          ["Auktion vundet", "+15 XP"],
          ["Auktion solgt", "+10 XP"],
          ["Transfer tilbud sendt", "+3 XP"],
          ["Transfer accepteret", "+10 XP"],
        ],
      },
      {
        title: "Manager titler",
        rows: [
          ["Niveau", "Titel"],
          ["1–4", "Rookie"],
          ["5–9", "Amateur"],
          ["10–14", "Continental"],
          ["15–19", "Pro"],
          ["20–24", "Pro Team"],
          ["25–29", "WorldTour"],
          ["30–34", "Monument"],
          ["35–39", "GC Contender"],
          ["40–44", "Grand Tour"],
          ["45–50", "Legende"],
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
        title: "Bestyrelsens rolle",
        text: "Din bestyrelse sætter mål for dit hold og evaluerer din præstation. Tilfredshed påvirker din sponsorindtægt via en multiplikator.",
      },
      {
        title: "Tilfredshedsniveauer",
        rows: [
          ["Tilfredshed", "Effekt"],
          ["70–100%", "Sponsor × > 1.0 — ekstra indtægt"],
          ["40–69%", "Sponsor × 1.0 — normal indtægt"],
          ["0–39%", "Sponsor × < 1.0 — reduceret indtægt"],
        ],
      },
      {
        title: "Mål og plan",
        text: "Du kan vælge fokus (offensiv, balanceret, ungdomsudvikling osv.) og tidshorisont (1-, 3- eller 5-årsplan). Bestyrelsen sætter mål baseret på dit valg. Opfylder du målene stiger tilfredsheden — gør du ikke, falder den.",
      },
    ],
  },
  { q: "Hvad er Aktivitetsfeed?", a: "En offentlig strøm af alle vigtige hændelser i spillet — auktionsvindere, gennemførte transfers, sæsonstart og løbsresultater. Opdateres i realtid." },
  { q: "Hvad er et transferrygte?", a: "Hvis en manager kigger på en af dine ryttere, får du en anonym notifikation. Du kan ikke se hvem der kigger — kun at nogen er interesseret." },
  { q: "Hvad er Deadline Day?", a: "Når transfervinduet lukker inden for 48 timer, vises et rødt countdown-banner på dit Dashboard. Det minder dig om at handle inden vinduet lukker." },
  { q: "Hvad er onboarding-guiden?", a: "Første gang du logger ind og ikke har nogen ryttere, vises en kort guide med 3 trin til at komme i gang. Den forsvinder permanent når du lukker den." },
];

const FAQ = [
  { q: "Hvad er forskellen på auktion og transfer?", a: "En auktion er åben for alle managers og vindes af højeste bud — bruges primært til frie ryttere. Et transfertilbud sendes privat direkte til en manager og kan forhandles frem og tilbage." },
  { q: "Kan jeg byde på en rytter der tilhører en anden manager?", a: "Ikke via auktion. Du skal sende et transfertilbud direkte til manageren via rytterens side. Klik på rytteren og brug 'Send transfertilbud' knappen." },
  { q: "Hvornår skifter en rytter hold efter en handel?", a: "Ryttere skifter kun hold fysisk når transfervinduet er åbent. Admin åbner og lukker vinduet. Handler indgået med lukket vindue afventer næste åbning." },
  { q: "Kan flere managers sende tilbud på samme rytter?", a: "Ja — men tilbudene er private. Du kan ikke se hvad andre har budt. Sælger håndterer hvert tilbud separat." },
  { q: "Hvad sker der hvis jeg ikke har råd til lønninger?", a: "Din balance går i minus. Du kan stadig spille, men du betaler 10% renter på gælden ved sæsonafslutning." },
  { q: "Kan jeg fjerne en rytter fra mit hold?", a: "Ja — sæt rytteren til auktion eller på transfermarkedet. Du kan ikke bare frigive en rytter gratis." },
  { q: "Hvad er U25 og U23?", a: "Ryttere under 25 henholdsvis 23 år. Du kan filtrere på disse i rytterdatabasen, ønskelisten og auktioner." },
  { q: "Kan jeg se andre managers balance?", a: "Nej. Din balance er kun synlig for dig selv og admin." },
  { q: "Hvad sker der hvis mit hold er for stort efter en divisionsskifte?", a: "Du får en advarsel og skal sælge ryttere ned til maksimum for din nye division." },
  { q: "Hvornår udbetales præmiepenge?", a: "Præmiepenge udbetales automatisk når admin godkender løbsresultater." },
  { q: "Hvad er Talentspejder?", a: "Din private ønskeliste. Tilføj ryttere med ☆ stjernen. Kun du kan se din liste." },
  { q: "Hvad bruges XP til?", a: "XP giver dig et niveau og en titel der vises i Hall of Fame. Det er et prestige-system uden gameplay-fordele." },
  { q: "Kan jeg sende en besked med mit transfertilbud?", a: "Ja — der er et valgfrit besked-felt på alle tilbud og modbud." },
  { q: "Hvad er et modbud?", a: "Når sælger ikke accepterer dit tilbud direkte, kan han sende et modbud med sin ønskede pris. Du kan acceptere modbud, sende et nyt bud eller trække dit tilbud tilbage." },
];

export default function HelpPage() {
  const [activeSection, setActiveSection] = useState("intro");
  const [search, setSearch] = useState("");

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    const results = [];
    SECTIONS.forEach(section => {
      section.content.forEach(item => {
        const inTitle = item.title?.toLowerCase().includes(q);
        const inText = item.text?.toLowerCase().includes(q);
        const inSteps = item.steps?.some(s => s.toLowerCase().includes(q));
        const inRows = item.rows?.flat().some(r => String(r).toLowerCase().includes(q));
        if (inTitle || inText || inSteps || inRows) {
          results.push({ section: section.label, icon: section.icon, item, sectionKey: section.key });
        }
      });
    });
    FAQ.forEach(f => {
      if (f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q)) {
        results.push({ section: "FAQ", icon: "❓", item: { title: f.q, text: f.a }, sectionKey: "faq" });
      }
    });
    return results;
  }, [search]);

  const activeData = SECTIONS.find(s => s.key === activeSection);

  function highlight(text) {
    if (!search.trim()) return text;
    const parts = text.split(new RegExp(`(${search})`, "gi"));
    return parts.map((p, i) =>
      p.toLowerCase() === search.toLowerCase()
        ? <mark key={i} className="bg-[#e8c547]/30 text-white rounded px-0.5">{p}</mark>
        : p
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Hjælp & Regler</h1>
        <p className="text-white/30 text-sm">Alt du skal vide om Cycling Zone</p>
      </div>

      <div className="relative mb-6">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Søg i regler og FAQ..."
          className="w-full bg-[#0f0f18] border border-white/10 rounded-xl px-4 py-3
            text-white placeholder-white/20 focus:outline-none focus:border-[#e8c547]/50 pl-10" />
        <span className="absolute left-3.5 top-3.5 text-white/30">🔍</span>
        {search && (
          <button onClick={() => setSearch("")}
            className="absolute right-3.5 top-3 text-white/30 hover:text-white text-xl">×</button>
        )}
      </div>

      {search && (
        <div className="mb-6">
          {searchResults.length === 0 ? (
            <p className="text-white/30 text-sm text-center py-6">Ingen resultater for "{search}"</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-white/40 text-xs uppercase tracking-wider">{searchResults.length} resultater</p>
              {searchResults.map((r, i) => (
                <div key={i} className="bg-[#0f0f18] border border-white/5 rounded-xl p-4 cursor-pointer hover:border-white/10"
                  onClick={() => { setActiveSection(r.sectionKey); setSearch(""); }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{r.icon}</span>
                    <span className="text-white/40 text-xs uppercase tracking-wider">{r.section}</span>
                  </div>
                  <p className="text-white font-medium text-sm">{r.item.title}</p>
                  {r.item.text && (
                    <p className="text-white/50 text-xs mt-1 line-clamp-2">{highlight(r.item.text)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!search && (
        <div className="flex gap-4">
          <aside className="w-48 flex-shrink-0 hidden md:block">
            <nav className="flex flex-col gap-1 sticky top-4">
              {SECTIONS.map(s => (
                <button key={s.key} onClick={() => setActiveSection(s.key)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-all
                    ${activeSection === s.key
                      ? "bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20"
                      : "text-white/40 hover:text-white hover:bg-white/5"}`}>
                  <span className="text-base">{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              ))}
              <button onClick={() => setActiveSection("faq")}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-all
                  ${activeSection === "faq"
                    ? "bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20"
                    : "text-white/40 hover:text-white hover:bg-white/5"}`}>
                <span className="text-base">❓</span>
                <span>FAQ</span>
              </button>
            </nav>
          </aside>

          <div className="flex md:hidden gap-2 mb-4 overflow-x-auto pb-1 w-full">
            {[...SECTIONS, { key: "faq", label: "FAQ", icon: "❓" }].map(s => (
              <button key={s.key} onClick={() => setActiveSection(s.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all border flex-shrink-0
                  ${activeSection === s.key
                    ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20"
                    : "text-white/40 border-white/5 hover:text-white"}`}>
                {s.icon} {s.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-0">
            {activeSection !== "faq" && activeData && (
              <div>
                <h2 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
                  <span>{activeData.icon}</span>{activeData.label}
                </h2>
                <div className="flex flex-col gap-5">
                  {activeData.content.map((item, i) => (
                    <div key={i} className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
                      <h3 className="text-white font-semibold text-sm mb-3">{item.title}</h3>
                      {item.text && <p className="text-white/50 text-sm leading-relaxed">{item.text}</p>}
                      {item.steps && (
                        <ol className="space-y-2">
                          {item.steps.map((step, j) => (
                            <li key={j} className="flex gap-3 text-sm">
                              <span className="w-5 h-5 rounded-full bg-[#e8c547]/20 text-[#e8c547] text-xs
                                flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">{j + 1}</span>
                              <span className="text-white/50">{step}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                      {item.rows && (
                        <table className="w-full text-sm mt-1">
                          <thead>
                            <tr className="border-b border-white/10">
                              {item.rows[0].map((h, j) => (
                                <th key={j} className="py-2 text-left text-white/30 font-medium text-xs uppercase tracking-wider pr-4">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {item.rows.slice(1).map((row, j) => (
                              <tr key={j} className="border-b border-white/5">
                                {row.map((cell, k) => (
                                  <td key={k} className={`py-2.5 pr-4 ${k === 0 ? "text-white font-medium" : "text-white/50"}`}>{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeSection === "faq" && (
              <div>
                <h2 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
                  <span>❓</span> Ofte stillede spørgsmål
                </h2>
                <div className="flex flex-col gap-3">
                  {FAQ.map((f, i) => <FAQItem key={i} q={f.q} a={f.a} />)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/3 transition-all">
        <span className="text-white text-sm font-medium pr-4">{q}</span>
        <span className={`text-white/30 text-lg flex-shrink-0 transition-transform ${open ? "rotate-45" : ""}`}>+</span>
      </button>
      {open && (
        <div className="px-5 pb-4 border-t border-white/5">
          <p className="text-white/50 text-sm leading-relaxed pt-3">{a}</p>
        </div>
      )}
    </div>
  );
}
