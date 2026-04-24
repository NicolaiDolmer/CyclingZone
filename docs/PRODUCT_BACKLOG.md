# PRODUCT BACKLOG — Cycling Zone

_Formål: Samlet backlog for bugs, features, integrationer og forbedringer._
_Regel: Kun aktive/top-prioriterede ting spejles til NOW.md. Kun statusændringer spejles til FEATURE_STATUS.md._

---

## 🧭 Execution roadmap

_Dette er den kanoniske udførelsesrækkefølge for de næste større produkt-slices. `NOW.md` skal kun pege på aktiv slice, næste slice og aktuelle blockers._

### ✅ Afsluttede slices
- Slice 0 — Baseline & blockers ✅
- Slice 1 — Navigation & app-shell ✅
- Slice 2 — Indbakke, notifikationer og topbar ✅
- Slice 3 — Min aktivitet ✅
- Slice 4 — Markedsregler og rytterflader ✅
- Slice 5 — Resultater og rytterrangliste ✅
- Slice 6 — Løbshistorik og løbsarkiv ✅
- Slice 7 — Integrationer og Discord ✅

### Slice 8 — Bug-rydning og quick wins
- Mål: Ryd P1-bugs og hurtige wins inden en ny tung feature-slice påbegyndes.
- Afhænger af: Slice 7 afsluttet.
- Centrale leverancer (prioriteret):
  1. ~~Hemmelige achievements synlige i UI → fix~~ ✅ løst
  2. Event-sekvens dokumentation (`docs/EVENT_SEQUENCE.md`)
  3. Live beta-verifikation af season flow (start → result approval → end)
  4. ~~Landekode/flag på øvrige rytterflader~~ ✅ løst
  5. Discord/webhook-regression → reproducér og afgræns
- Holdt ude: boardEngine split, økonomi retuning, PCM mappings
- Done when: P1-bugs løst, docs færdige, season flow verificeret. (flag-visning: ✅)

### Låste defaults for roadmapen
- `Liga` beholdes som navn indtil videre.
- Managers kan ikke sende beskeder til hinanden.
- `Min aktivitet` forbliver en separat side under `Marked`.
- `Indbakke` er kun til systemhændelser, ikke chat.
- Almindelige auktioner kræver minimum `Værdi`.
- `Garanteret salg` er eneste undtagelse og må fortsat bruge 50%.
- `NOW.md` skal holdes kort og ikke kopiere roadmapen.

## 🤝 Samarbejdsmodel

- `docs/PRODUCT_BACKLOG.md` forbliver kanonisk roadmap; `docs/NOW.md` holder kun aktiv slice, næste slice og blockers
- Hver ny opgave starter med en kort feature-brief i chatten: mål, manager-værdi, berørt runtime-path, åbne beslutninger, anbefaling og evt. inputbehov
- Hver opgave klassificeres før execution som `direkte implementerbar`, `investigation` eller `kræver askuserquestion`
- `askuserquestion` bruges især ved IA/naming, flere plausible produktmodeller, nye datakontrakter/integrationer/offentlige visninger og balancing-spor
- Afgrænsede bugfixes og tydelige runtime-reproduktioner håndteres normalt uden afklaringssession, medmindre der opdages drift mellem frontend, API, engine/service og DB
- Ved slutningen af hver slice laves en kort review i chatten: hvad lukkede vi, hvad blokerer stadig, hvilke nærliggende quick wins dukkede op, og hvilken næste session skal låses
- Nye featureforslag må gerne komme løbende, men skal være tydeligt forankret i aktiv slice, runtimeen eller et konkret produktgap

### Planlagte sparringssessioner
- Session 6: økonomiretuning hvis den løftes i prioritet

---

## 🔴 Kritiske bugs / investigations

- P1: Discord/webhook-regression skal reproduceres og spores gennem nuværende notifier-paths og live webhook-konfiguration; samme spor bør også afklare hvordan transferhistorik kan spejles til en dedikeret Discord-tråd via webhook
- P2: Evne-filter/slider kræver frisk reproduktion på rigtige data; nuværende kodegennemgang fandt ingen entydig root cause

---

## 🟠 Navigation & informationsarkitektur

- Sidebar/navigation skal omstruktureres med tydeligere domænegrupper i stedet for den nuværende spredning
- `Overblik` skal åbne Dashboard som default click target
- `Bestyrelsen` skal ligge under `Overblik`
- `Mit hold` skal ligge under `Overblik`
- `Økonomi` skal ligge under `Overblik`
- `Finanser` skal ligge som underside/fane under `Økonomi`
- `Aktivitetsfeed` skal ligge under `Overblik`
- `Notifikationer` skal ligge under `Overblik`
- `Min aktivitet` skal ligge under `Marked`
- `Talentspejder` skal flyttes under `Marked` og omdøbes til `Ønskeliste`
- `Resultater` skal oprettes som egen nav-gruppe
- `Ranglisten` skal ligge under `Resultater`
- `Sæsonresultater` skal ligge under `Resultater`
- `Hall of Fame` skal ligge under `Resultater`
- `Sæson Preview` skal flyttes under den nuværende liga-gruppe
- `Liga` beholdes som navn indtil videre
- `Min Profil` skal foldes ind i managerprofilen som en indstillingssektion i stedet for at leve som separat produktflade
- Klik på logo bør føre til Dashboard på både desktop og mobil

---

## 🟡 Inbox, notifikationer & presence

- Byg en Football Manager-inspireret indbakke hvor aktiviteter, notifikationer og systemhændelser samles ét sted
- Indbakken skal have stærke filtre så man hurtigt kan finde handler, resultater, board-events, økonomi og øvrige hændelser
- Der skal vises tællere for ulæste indbakke-/notifikationselementer i top-højre
- Notifikationer skal stadig kunne eksistere som en særskilt overbliksflade, men informationsarkitekturen mellem indbakke, notifikationer og aktivitetsfeed skal gøres kanonisk før UI-refactor
- Managers skal ikke kunne sende direkte beskeder til hinanden; indbakken er kun til systemhændelser, notifikationer og aktivitetsopsamling
- Online status skal være tydelig på managerprofilen
- Online status og sidst-set skal være tydelig i lister over managers
- Managernavn bør helst kunne matches med Discord-navn
- Head-to-head skal som default forudvælge brugerens eget hold som det ene hold, men stadig kunne ændres
- Klik på notifikation bør deep-linke til relevant side
- Direkte Discord-besked til manager ved events undersøges som særskilt forbedringsspor

---

## 🟢 Marked, ryttere & handler

- Langsigtet UX-anbefaling: `Min aktivitet` bør bevares som separat markedsside under `Marked`, ikke opsluges af den globale indbakke
- `Min aktivitet` bør være brugerens personlige markedsarbejdsflade med egne auktioner, egne bud, egne transferforhandlinger, lån og watchlist-signaler samlet i ét handlingsorienteret view
- `Min aktivitet` bør skille sig fra den globale indbakke ved at fokusere på "ting der involverer mig direkte" i markedet, mens indbakken samler alle systemhændelser på tværs af produktet
- Foreslået UI for `Min aktivitet`: faner eller stærke filtre for `Kræver handling`, `Auktioner`, `Transfers`, `Lån`, `Ønskeliste` og `Historik`
- `Min aktivitet` bør som default åbne på `Kræver handling`, så pending bekræftelser, modbud, afsluttende steps og udløbende handler ligger øverst
- `Min aktivitet` bør bruge kompakte kort/rækker med statusbadge, tid, modpart/rytter, næste handling og deep-link til den relevante handel
- Rytterfeltet `Point` skal omdøbes til `Værdi` i UI
- Ved oprettelse af auktion må startbud ikke være lavere end rytterens værdi
- Ved manager-til-manager-køb skal tilbud stadig kunne være præcis det beløb man ønsker, også under rytterens værdi
- Rytterlisten skal tydeligt vise hvis rytteren er i en aktiv auktion
- Ryttersiden skal tydeligt vise hvis rytteren er i en aktiv auktion
- Notifikation når en ønskeliste-rytter sættes til salg
- Vis tidspunkt for hvornår en rytter blev sat til transfer
- Vis ryttertype på ryttersiden
- Vis landenavn/flag i stedet for rå landekoder på øvrige rytterflader

---

## 🔵 Resultater, historik & ranglister

- Opret en egentlig `Resultater`-hub i produktet
- Byg individuel rytterrangliste med mindst: point, etapesejre, klassementssejre, samlede sejre, pointklassementer, ungdomsklassementer og bjergklassementer
- Rytterranglisten skal inkludere både manager-ejede og AI-ejede ryttere
- Gør alle tilgængelige løb browsebare fra en samlet løbsoversigt med historik pr. løb
- Hvert løb skal kunne vise alle tidligere udgaver på tværs af sæsoner, tidligere vindere og de ryttere der historisk har klaret sig bedst i netop det løb
- Hvert løb skal have en akkumuleret historikvisning eller graf, fx hvem der samlet har tjent flest point i Liège-Bastogne-Liège
- UCI-point udvikling over tid
- Stats-udvikling over tid
- Oprykningsindikator under ranglisten
- Rytterhistorik skal vise AI-salg med pris
- Rytterhistorik skal vise alle transfers
- Rytterhistorik skal vise manager-handler uden pris

---

## 🟣 Data & integrationer

- Google Sheets integration til `dyn_cyclist`-arket
- Afventer eksempel-Google Sheet fra bruger til resultatformat og datakontrakt
- Scraper til UCI-ranglisten
- UCI rangliste sync
- Løbsresultater sync
- Teams PCM mapping
- Cyclists PCM mapping

---

## 🟤 Økonomi & tuning

- Økonomien i spillet skal retunes
- Overvej prisfaktor x4000 som særskilt tuning-spor
- Finans-overblikket skal ses i sammenhæng med navigationsoverblikket (`Økonomi` → `Finanser`)

---

## ⚙️ System, docs & admin

- Gennemgå runtime mod `PatchNotesPage.jsx` og `HelpPage.jsx`/FAQ for funktioner der mangler dokumentation; opdater docs før næste release
- FAQ auto-opdatering
- Patch notes auto-opdatering
- Admin skal kunne slette en bruger
- Split `backend/lib/boardEngine.js` i mindre moduler uden at miste den delte runtime-path mellem proposal, status, requests og season-end
- Frontend-build advarer stadig om stor Vite-chunk; senere code-splitting/manualChunks bør planlægges

---

## ❓ Åbne produktafklaringer

- Ingen åbne produktafklaringer registreret lige nu fra denne noteopsamling
