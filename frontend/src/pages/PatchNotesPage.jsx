import { useState } from "react";

const PATCHES = [
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
          "Holdstørrelsesgræ nser per division med advarsel",
          "Balance skjult for andre managers",
          "Sæsonstart lukker transfervindue og genberegner lønninger automatisk",
        ],
      },
    ],
  },
];

export default function PatchNotesPage() {
  const [expanded, setExpanded] = useState("1.21");

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Patch Notes</h1>
        <p className="text-white/30 text-sm">Opdateringshistorik for Cycling Zone Manager</p>
      </div>

      <div className="flex flex-col gap-3">
        {PATCHES.map((patch) => {
          const isOpen = expanded === patch.version;
          return (
            <div key={patch.version}
              className={`bg-[#0f0f18] border rounded-xl overflow-hidden transition-all
                ${isOpen ? "border-[#e8c547]/20" : "border-white/5"}`}>
              <button
                onClick={() => setExpanded(isOpen ? null : patch.version)}
                className="w-full flex items-center justify-between px-5 py-4 text-left">
                <div className="flex items-center gap-3">
                  <span className="text-white font-bold text-sm">v{patch.version}</span>
                  <span className="text-[9px] uppercase bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20 px-2 py-0.5 rounded-full">
                    {patch.label}
                  </span>
                  <span className="text-white/25 text-xs">{patch.date}</span>
                </div>
                <span className={`text-white/30 text-xs transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 border-t border-white/5 pt-4 space-y-4">
                  {patch.changes.map((section, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0
                          ${section.category === "Nyt" ? "bg-green-400" :
                            section.category === "Forbedringer" ? "bg-blue-400" :
                            section.category === "Fejlrettelser" ? "bg-red-400" :
                            "bg-[#e8c547]"}`} />
                        <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">
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
                            <span className="text-white/60 text-sm leading-relaxed">{item}</span>
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
