import { useState } from "react";

const PATCHES = [
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
          "Auktioner — 'Du har budt' orange badge når du er overbudt men har aktive bud",
          "Auktioner — dit højeste bud vises på kortet selv når du ikke vinder",
          "Hall of Fame — viser nu alle managers korrekt (RLS fix)",
          "Backend api.js — fuldstændig genopbygget med korrekt struktur",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "RLS fix — auction_bids manglede INSERT policy",
          "RLS fix — transfer_offers havde ingen policies",
          "RLS fix — users tabel blokerede læsning af andre managers profiler",
          "Backend crash — export default router manglede",
          "Backend crash — imports og router i forkert rækkefølge",
          "RiderStatsPage crash — myTeam state var ikke defineret",
          "HallOfFamePage crash — myUserId og myTeamId state manglede",
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
          "Filtrer på navn, UCI-pris, alder, U25, U23, fri agent og hold",
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
          "Holdstørrelsesgrænser per division med advarsel",
          "Balance skjult for andre managers",
          "Sæsonstart lukker transfervindue og genberegner lønninger automatisk",
        ],
      },
    ],
  },
  {
    version: "0.9",
    date: "2026-04-16",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Notifikationssystem rettet — forbliver læst efter markering (RLS fix)",
          "F5-opdatering virker nu på alle sider (SPA rewrite regel)",
          "Admin siden crashede — rettet",
          "Notification badge opdaterer sig korrekt i menuen",
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
          "Præmiepenge admin panel — klik og rediger direkte",
          "Auktionshistorik side",
          "Ryttersammenligning — sammenlign op til 3 ryttere",
          "Hold oversigt og holdprofiler",
          "Økonomi-fane på Mit Hold",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Live auktionsopdateringer via Supabase Realtime",
          "Balance-check inden bud",
          "Mobilkortvisning på rytterlisten",
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
        category: "Grundlag",
        items: [
          "8.699 ryttere importeret med UCI-points og stats",
          "Auktionssystem med live bud og 10-minutters forlængelse",
          "Transfermarked med tilbud, modbud og accept/afvis",
          "Admin panel med sæson, løb og resultatimport",
          "Bestyrelse med mål og tilfredshed",
          "Notifikationssystem",
          "Login med automatisk holdoprettelse",
          "Dashboard, rytterdatabase, rangliste med divisioner",
          "Deployment på Vercel og Railway",
        ],
      },
    ],
  },
];

const CATEGORY_COLORS = {
  "Nyt":           "text-green-400 bg-green-500/10 border-green-500/20",
  "Forbedringer":  "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "Fejlrettelser": "text-red-400 bg-red-500/10 border-red-500/20",
  "Grundlag":      "text-[#e8c547] bg-[#e8c547]/10 border-[#e8c547]/20",
};

const LABEL_COLORS = {
  "Beta":    "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Alpha":   "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "Release": "bg-green-500/10 text-green-400 border-green-500/20",
};

export default function PatchNotesPage() {
  const [expanded, setExpanded] = useState({ "1.3": true });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Patch Notes</h1>
        <p className="text-white/30 text-sm">Hvad er nyt og rettet i Cycling Zone</p>
      </div>

      <div className="flex flex-col gap-4">
        {PATCHES.map(patch => (
          <div key={patch.version} className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
            <button onClick={() => setExpanded(p => ({ ...p, [patch.version]: !p[patch.version] }))}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/3 transition-all text-left">
              <div className="flex items-center gap-3">
                <span className="text-white font-bold text-lg">v{patch.version}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${LABEL_COLORS[patch.label] || LABEL_COLORS["Beta"]}`}>
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
                <span className={`text-white/30 text-lg transition-transform ${expanded[patch.version] ? "rotate-180" : ""}`}>▾</span>
              </div>
            </button>

            {expanded[patch.version] && (
              <div className="px-5 pb-5 border-t border-white/5">
                {patch.changes.map(section => (
                  <div key={section.category} className="mt-4">
                    <span className={`inline-block text-xs px-2.5 py-1 rounded-full border font-medium mb-3 ${CATEGORY_COLORS[section.category] || CATEGORY_COLORS["Nyt"]}`}>
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
