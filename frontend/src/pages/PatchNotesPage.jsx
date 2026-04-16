import { useState } from "react";

const PATCHES = [
  {
    version: "0.9",
    date: "2026-04-17",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Hall of Fame — rekorder for flest point, etapesejre og Division 1 titler",
          "Sæson Preview — se alle holds styrker og topstjerner inden sæsonen",
          "Head-to-Head — sammenlign to managers statistik og transferhistorik",
          "Rytter sæsonhistorik — holdskifte og sæsonresultater på rytterens side",
          "Manager niveau system — optjen XP og stig i niveau (Rookie → Legende)",
          "Talentspejder / Ønskeliste — gem ryttere privat med stjerne og noter",
          "Hjælp & Regler — komplet regeloversigt med søgefunktion og FAQ",
          "Min Aktivitet — samlet overblik over bud, auktioner og transfers",
          "Discord integration — notifikationer ved ny auktion, overbudt m.m.",
          "Manuel override i admin — flyt ryttere direkte til hold",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Auktionskort opdateres øjeblikkeligt efter bud — ingen genindlæsning nødvendig",
          "Ny fane 'Andre managers' på auktionssiden — se kun ryttere fra andre holds",
          "Holdstørrelsesgrænser per division — advarsel hvis over/under grænsen",
          "Balance skjult for andre managers — kun synlig for dig selv og admin",
          "Sæsonstart lukker automatisk transfervinduet og genberegner lønninger",
          "F5-opdatering virker nu på alle sider",
          "Mobilnavigation forbedret med bundmenu",
          "CZ$ valuta overalt i stedet for 'pts'",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Notifikationer forbliver nu læst efter markering",
          "Admin siden crashede ved load — rettet",
          "404 fejl ved direkte URL-adgang — rettet med SPA rewrite regel",
          "Notification badge opdaterer sig nu korrekt i menuen",
          "Spam-notifikationer ved AI-auktioner fjernet",
        ],
      },
    ],
  },
  {
    version: "0.8",
    date: "2026-04-16",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Transfervindue system — admin åbner/lukker manuelt",
          "FM-stil trup toggle — vis indgående og udgående transfers",
          "Præmiepenge admin panel — klik og rediger præmier direkte",
          "Favicon med CZ logo",
          "Auktionshistorik side",
          "Ryttersammenligning — sammenlign op til 3 ryttere side om side",
          "Hold oversigtsside — se alle managers opdelt per division",
          "Holdprofiler — klik på et hold og se deres trup",
          "Økonomi-fane på Mit Hold — prognose, sæsonfordeling og transaktionshistorik",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Live auktionsopdateringer — ingen genindlæsning nødvendig",
          "Balance-check inden bud — advarsel hvis ikke råd",
          "Mobilkortvisning på rytterlisten",
          "Rangliste med klikbare holdnavne",
        ],
      },
    ],
  },
  {
    version: "0.7",
    date: "2026-04-15",
    label: "Alpha",
    changes: [
      {
        category: "Nyt",
        items: [
          "8.699 ryttere importeret med UCI-points og stats",
          "Auktionssystem med live bud og 10-minutters forlængelse",
          "Transfermarked med tilbud, modbud og accept/afvis",
          "Discord webhook ved ny auktion",
          "Admin panel med sæson, løb og resultatimport",
          "Bestyrelse med mål og tilfredshed",
          "Notifikationssystem",
          "Rytterstatistik-side med løbshistorik",
        ],
      },
      {
        category: "Grundlag",
        items: [
          "Login med automatisk holdoprettelse",
          "Dashboard med balance, kalender og aktive auktioner",
          "Rytterdatabase med filtrering og sortering",
          "Rangliste med divisioner og op/nedrykning",
          "Deployment på Vercel (frontend) og Railway (backend)",
        ],
      },
    ],
  },
];

const CATEGORY_COLORS = {
  "Nyt": "text-green-400 bg-green-500/10 border-green-500/20",
  "Forbedringer": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "Fejlrettelser": "text-red-400 bg-red-500/10 border-red-500/20",
  "Grundlag": "text-[#e8c547] bg-[#e8c547]/10 border-[#e8c547]/20",
};

const LABEL_COLORS = {
  "Beta": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Alpha": "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "Release": "bg-green-500/10 text-green-400 border-green-500/20",
};

export default function PatchNotesPage() {
  const [expanded, setExpanded] = useState({ "0.9": true });

  function toggle(version) {
    setExpanded(prev => ({ ...prev, [version]: !prev[version] }));
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Patch Notes</h1>
        <p className="text-white/30 text-sm">Hvad er nyt og rettet i Cycling Zone</p>
      </div>

      <div className="flex flex-col gap-4">
        {PATCHES.map(patch => (
          <div key={patch.version}
            className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">

            {/* Header */}
            <button
              onClick={() => toggle(patch.version)}
              className="w-full flex items-center justify-between px-5 py-4
                hover:bg-white/3 transition-all text-left">
              <div className="flex items-center gap-3">
                <span className="text-white font-bold text-lg">v{patch.version}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium
                  ${LABEL_COLORS[patch.label] || LABEL_COLORS["Beta"]}`}>
                  {patch.label}
                </span>
                <span className="text-white/30 text-xs">
                  {new Date(patch.date).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-white/20 text-xs">
                  {patch.changes.reduce((s, c) => s + c.items.length, 0)} ændringer
                </span>
                <span className={`text-white/30 text-lg transition-transform ${expanded[patch.version] ? "rotate-180" : ""}`}>
                  ▾
                </span>
              </div>
            </button>

            {/* Content */}
            {expanded[patch.version] && (
              <div className="px-5 pb-5 border-t border-white/5">
                {patch.changes.map(section => (
                  <div key={section.category} className="mt-4">
                    <span className={`inline-block text-xs px-2.5 py-1 rounded-full border font-medium mb-3
                      ${CATEGORY_COLORS[section.category] || CATEGORY_COLORS["Nyt"]}`}>
                      {section.category}
                    </span>
                    <ul className="space-y-2">
                      {section.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm">
                          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0
                            ${section.category === "Nyt" ? "bg-green-400" :
                              section.category === "Forbedringer" ? "bg-blue-400" :
                              section.category === "Fejlrettelser" ? "bg-red-400" :
                              "bg-[#e8c547]"}`} />
                          <span className="text-white/60 leading-relaxed">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
