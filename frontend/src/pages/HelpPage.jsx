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
          "Opret en konto — dit holdnavn vælges ved oprettelse og kan ikke ændres.",
          "Du starter med 500 CZ$ i balance og er placeret i Division 3.",
          "Gå til Ryttere og find ryttere du vil byde på. Klik på en rytter og start en auktion.",
          "Vind auktioner for at fylde dit hold op. Du skal have mindst 8 ryttere for at deltage i løb.",
          "Følg med på Dashboard og Auktioner for at holde øje med aktive bud.",
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
        text: "Al økonomi i spillet foregår i CZ$. Din balance vises øverst til venstre i menuen og er kun synlig for dig selv og admin.",
      },
      {
        title: "Startbalance",
        text: "Alle holds starter med 500 CZ$.",
      },
      {
        title: "Sponsorindtægt",
        text: "Hvert hold modtager 100 CZ$ i sponsorindtægt pr. sæson. Dette udbetales automatisk når admin starter en ny sæson.",
      },
      {
        title: "Lønninger",
        text: "Hver rytter på dit hold koster 10% af hans UCI-pris i løn pr. sæson. En rytter med 1.000 UCI-point koster altså 100 CZ$ i løn. Lønninger trækkes automatisk ved sæsonstart og genberegnes baseret på rytterens aktuelle UCI-pris.",
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
        title: "Sådan starter du en auktion",
        steps: [
          "Gå til Ryttere og find en fri rytter (markeret 'Fri rytter').",
          "Klik på rytterens navn for at åbne statistiksiden.",
          "Sæt en startpris og klik 'Start auktion'.",
          "Auktionen er nu synlig for alle managers under Auktioner.",
        ],
      },
      {
        title: "Hvornår kører auktioner?",
        text: "Auktioner kører på alle tidspunkter. Sluttidspunktet beregnes automatisk baseret på hvornår auktionen startes.",
      },
      {
        title: "10-minutters forlængelse",
        text: "Hvis der afgives et bud inden for de sidste 10 minutter af en auktion, forlænges auktionen automatisk med 10 minutter. Dette fortsætter indtil der ikke afgives bud i de sidste 10 minutter.",
      },
      {
        title: "Byde på fri rytter vs. holdets ryttere",
        text: "Du kan byde på alle frie ryttere — også auktioner du selv har startet. Du kan ikke byde på ryttere der tilhører en anden managers hold via auktion, men du kan sende et transfertilbud.",
      },
      {
        title: "Holdstørrelse og auktioner",
        text: "Hvis du vinder en auktion men dit hold allerede er fuldt (se holdgrænser under Divisioner), annulleres overdragelsen og du får besked.",
      },
      {
        title: "Transfervindue",
        text: "Ryttere skifter kun hold fysisk når transfervinduet er åbent. Hvis vinduet er lukket, registreres handler men ryttere vises som 'indgående' eller 'udgående' transfers indtil vinduet åbnes. På dit hold kan du til- og frakoble visning af indgående og udgående transfers.",
      },
    ],
  },
  {
    key: "transfers",
    label: "Transfers",
    icon: "↔",
    content: [
      {
        title: "Transfermarkedet",
        text: "Du kan sætte dine egne ryttere til salg på transfermarkedet med en fast pris. Andre managers kan sende tilbud på din udbudspris eller lavere.",
      },
      {
        title: "Tilbud og modbud",
        steps: [
          "Find en rytter på Transfermarkedet og send et tilbud.",
          "Sælger kan acceptere, afvise eller sende et modbud.",
          "Hvis sælger sender modbud, kan du acceptere eller afvise.",
          "Ved accept overdrages rytteren — enten straks (åbent vindue) eller ved næste vindue (lukket vindue).",
        ],
      },
      {
        title: "Transfervindue",
        text: "Der er ét transfervindue per sæson. Admin åbner og lukker vinduet manuelt. Handler kan indgås hele sæsonen, men ryttere skifter kun hold fysisk når vinduet er åbent.",
      },
      {
        title: "Løn ved transfer",
        text: "Når du køber en rytter via auktion sættes lønnen automatisk til 10% af auktionsprisen. Ved transfermarked overføres den eksisterende løn.",
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
          "Ved sæsonstart: ventende transfers behandles, lønninger genberegnes, sponsorpenge udbetales.",
          "Løb køres i Pro Cycling Manager og resultaterne importeres af admin.",
          "Ved sæsonafslutning: point tælles op, op/nedrykning afgøres, lønninger trækkes, gældsrenter tilskrives.",
        ],
      },
      {
        title: "Løb og point",
        text: "Point optjenes baseret på dine rytteres placeringer i løb. Præmiepenge tildeles automatisk når admin importerer resultater fra PCM.",
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
        text: "Spillet har 3 divisioner. Division 1 er den højeste. Alle starts i Division 3.",
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
        text: "Du skal have mindst 8 ryttere på dit hold for at deltage i løb. Hvis du er under minimum vises en advarsel på 'Mit Hold'.",
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
        title: "U25 ryttere",
        text: "Ryttere under 25 år er markeret med 'U25'. Du kan filtrere på U25 i rytterdatabasen.",
      },
      {
        title: "Lønninger",
        text: "Rytterens løn sættes til 10% af UCI-prisen ved køb og genberegnes ved hver sæsonstart.",
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
        title: "Mål og tilfredshed",
        text: "Bestyrelsen sætter typisk mål som: top 4 i divisionen, mindst 8 ryttere, mindst 1 etapesejr. Opfylder du målene stiger tilfredsheden — gør du ikke falder den.",
      },
      {
        title: "Budget-multiplikator",
        text: "En høj bestyrelsestilfredshed giver en multiplikator over 1.0 på sponsorindtægten. Lav tilfredshed kan reducere sponsorindtægten.",
      },
    ],
  },
];

const FAQ = [
  { q: "Hvad sker der hvis jeg ikke har råd til lønninger?", a: "Din balance går i minus. Du kan stadig spille, men du betaler 10% renter på gælden ved hver sæsonafslutning." },
  { q: "Kan jeg fjerne en rytter fra mit hold uden at sælge den?", a: "Nej, du skal enten sætte rytteren til auktion eller på transfermarkedet." },
  { q: "Hvornår skifter ryttere hold efter en handel?", a: "Ryttere skifter kun hold fysisk når transfervinduet er åbent. Lukkede handler vises som 'indgående' eller 'udgående' transfers." },
  { q: "Kan jeg byde på en auktion jeg selv har startet?", a: "Ja — når du sætter en fri/AI-rytter til auktion kan du godt byde på den selv. Du kan ikke byde på dine egne ryttere fra dit hold." },
  { q: "Hvad er forskellen på en auktion og et transfertilbud?", a: "En auktion er åben for alle og vindes af højeste bud. Et transfertilbud sendes direkte til en sælger og kan forhandles med modbud." },
  { q: "Kan jeg se andre managers balance?", a: "Nej. Din balance er kun synlig for dig selv og admin." },
  { q: "Hvad sker der hvis mit hold er for stort efter en divisionsskifte?", a: "Du får en advarsel og skal sælge ryttere ned til maksimum for din nye division." },
  { q: "Hvornår udbetales præmiepenge?", a: "Præmiepenge udbetales automatisk når admin importerer løbsresultater fra PCM." },
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
        const inRows = item.rows?.flat().some(r => r.toLowerCase().includes(q));
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

      {/* Search */}
      <div className="relative mb-6">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Søg i regler og FAQ..."
          className="w-full bg-[#0f0f18] border border-white/10 rounded-xl px-4 py-3
            text-white placeholder-white/20 focus:outline-none focus:border-[#e8c547]/50
            pl-10"
        />
        <span className="absolute left-3.5 top-3.5 text-white/30">🔍</span>
        {search && (
          <button onClick={() => setSearch("")}
            className="absolute right-3.5 top-3 text-white/30 hover:text-white text-xl">×</button>
        )}
      </div>

      {/* Search results */}
      {search && (
        <div className="mb-6">
          {searchResults.length === 0 ? (
            <p className="text-white/30 text-sm text-center py-6">Ingen resultater for "{search}"</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-white/40 text-xs uppercase tracking-wider">{searchResults.length} resultater</p>
              {searchResults.map((r, i) => (
                <div key={i}
                  className="bg-[#0f0f18] border border-white/5 rounded-xl p-4 cursor-pointer hover:border-white/10"
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
          {/* Sidebar */}
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

          {/* Mobile tabs */}
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

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeSection !== "faq" && activeData && (
              <div>
                <h2 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
                  <span>{activeData.icon}</span>
                  {activeData.label}
                </h2>
                <div className="flex flex-col gap-5">
                  {activeData.content.map((item, i) => (
                    <div key={i} className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
                      <h3 className="text-white font-semibold text-sm mb-3">{item.title}</h3>
                      {item.text && (
                        <p className="text-white/50 text-sm leading-relaxed">{item.text}</p>
                      )}
                      {item.steps && (
                        <ol className="space-y-2">
                          {item.steps.map((step, j) => (
                            <li key={j} className="flex gap-3 text-sm">
                              <span className="w-5 h-5 rounded-full bg-[#e8c547]/20 text-[#e8c547] text-xs
                                flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                                {j + 1}
                              </span>
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
                  {FAQ.map((f, i) => (
                    <FAQItem key={i} q={f.q} a={f.a} />
                  ))}
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
