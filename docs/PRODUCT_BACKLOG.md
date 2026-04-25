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
- Slice 10 — Navigation-omstrukturering + UX-fixes ✅
- Slice 11b — Quick wins (docs-audit, patch notes, HelpPage) ✅

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

### Slice 10 — Navigation-omstrukturering + bundlede UX-fixes
- Mål: Omstrukturer sidebar efter aftalte domænegrupper; bundle billige UX-fixes i samme session.
- Afhænger af: Slice 9 afsluttet.
- Centrale leverancer (prioriteret):
  1. Sidebar: Overblik (Dashboard default + klik), Bestyrelsen, Mit hold, Økonomi (Finanser undernav), Aktivitetsfeed, Notifikationer
  2. Sidebar: Marked (Min aktivitet, Ønskeliste — omdøb Talentspejder)
  3. Sidebar: Ny gruppe `Resultater` (Ranglisten, Sæsonresultater, Hall of Fame)
  4. Sidebar: Sæson Preview → under Liga; Logo-klik → Dashboard; Min Profil → fold ind i managerprofil
  5. UX-fix: Head-to-head auto-suggest eget hold
  6. UX-fix: Vis igangværende auktion på rytterliste + rytterside
  7. UX-fix: "Point" → "Værdi" omdøbning i UI
  8. UX-fix: Fjern ubrugte evne-farver i rytteroversigten
  9. UX-fix: Løn synlig i rytterlisten med filter og sortering; løn tydeligt vist på ryttersiden

### Slice 11 — Resultater-hub + Rytterrangliste ⛔ BLOKERET
- Mål: Forbedre rytterrangliste og løbsarkiv med rigtige data fra Google Sheets.
- Blokeret af: bruger skal sende Google Sheet med løbsresultater (format, kolonner) + liste over alle løb.
- Centrale leverancer:
  1. Rytterrangliste-forbedringer baseret på Google Sheets-datakontrakt
  2. Løbsarkiv-forbedringer: historik pr. løb på tværs af sæsoner, akkumuleret graf fra rigtige data

### Slice 12 — Bugs (Discord + evne-filter)
- Mål: Luk udskudte live-bugs fra Slice 8.
- Afhænger af: Live debug-session.
- Centrale leverancer:
  1. Discord/webhook-regression: reproducér og afgræns; transferhistorik til Discord-tråd
  2. Evne-filter/slider: reproducér og afgræns

### Slice 13 — FM-style indbakke
- Mål: Football Manager-inspireret indbakke med stærke filtre.
- Afhænger af: Slice 10 + Slice 11 afsluttet.
- Centrale leverancer: samle aktiviteter, notifikationer og systemhændelser ét sted; filtre for typer og status

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

- ~~P0: Garanteret salg kunne misbruges til at købe AI-ejede ryttere til 50% af værdien~~ ✅ løst
- ~~P1: Bestyrelse vises ikke korrekt på dashboard efter boardEngine-refactor — regression~~ ✅ løst (v1.46)
- P1: Discord/webhook-regression skal reproduceres og spores gennem nuværende notifier-paths og live webhook-konfiguration; samme spor bør også afklare hvordan transferhistorik kan spejles til en dedikeret Discord-tråd via webhook
- P2: Evne-filter/slider kræver frisk reproduktion på rigtige data; nuværende kodegennemgang fandt ingen entydig root cause

---

## 🟠 Navigation & informationsarkitektur ✅ FÆRDIG (Slice 10)

_Alle punkter implementeret. Se commit-historik for detaljer._

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
- ~~Head-to-head skal som default forudvælge brugerens eget hold som det ene hold, men stadig kunne ændres~~ ✅ (v1.47)
- ~~Klik på notifikation bør deep-linke til relevant side~~ ✅ (v1.32)
- Direkte Discord-besked til manager ved events undersøges som særskilt forbedringsspor

---

## 🟢 Marked, ryttere & handler

- ~~`Min aktivitet` ombygget med 6 faner: Kræver handling, Auktioner, Transfers, Lån, Ønskeliste, Historik~~ ✅ (v1.34)
- ~~Rytterfeltet `Point` omdøbt til `Værdi` i UI~~ ✅ (v1.35)
- ~~Ved oprettelse af auktion må startbud ikke være lavere end rytterens Værdi~~ ✅ (v1.35, backend+frontend)
- Ved manager-til-manager-køb skal tilbud stadig kunne være præcis det beløb man ønsker, også under rytterens Værdi _(allerede muligt)_
- ~~Rytterlisten viser ⚡-badge ved aktiv auktion~~ ✅ (v1.35)
- ~~Ryttersiden viser ⚡-badge ved aktiv auktion~~ ✅ (v1.35)
- ~~Notifikation når en ønskeliste-rytter sættes til salg eller auktion~~ ✅ (v1.35)
- ~~Vis tidspunkt for hvornår en rytter blev sat til transfer~~ ✅ (v1.35)
- ~~Vis ryttertype på ryttersiden~~ ✅ (v1.35)
- ~~Vis landenavn/flag i stedet for rå landekoder på øvrige rytterflader~~ ✅ (v1.39)

---

## 🔵 Resultater, historik & ranglister

- ~~Opret en egentlig `Resultater`-hub i produktet~~ ✅ (v1.36)
- ~~Individuel rytterrangliste (etapesejre, GC, point, bjerg, ungdom, inkl. AI-ryttere)~~ ✅ (v1.36) — _Slice 11 forbedrer med Google Sheets-data_
- ~~Gør alle løb browsebare med historik pr. løb~~ ✅ (v1.37)
- ~~Akkumuleret historikvisning/graf pr. løb~~ ✅ (v1.37) — _Slice 11 forbedrer med Google Sheets-data_
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

- ~~Startkapital og sponsorindtægt retunede~~ ✅ — startkapital 800K, sponsor 240K/sæson (v1.44)
- Præmiepenge skal kalibreres — afventer Google Sheets-integration til løbsresultater (Session 6b); præmier og Google Sheets skal designes samlet så de hænger sammen med ranglisten
- Overvej prisfaktor x4000 som særskilt tuning-spor (ikke prioriteret)
- Finans-overblikket skal ses i sammenhæng med navigationsoverblikket (`Økonomi` → `Finanser`)

---

## ⚙️ System, docs & admin

- ~~Gennemgå runtime mod `PatchNotesPage.jsx` og `HelpPage.jsx`/FAQ for manglende dokumentation~~ ✅ (2026-04-26)
- FAQ auto-opdatering
- Patch notes auto-opdatering
- ~~Admin skal kunne slette en bruger~~ ✅ (v1.42)
- ~~Split `backend/lib/boardEngine.js` i mindre moduler~~ ✅ (refactor, 2026-04-25)
- Frontend-build advarer stadig om stor Vite-chunk; senere code-splitting/manualChunks bør planlægges

---

## ❓ Åbne produktafklaringer

- Ingen åbne produktafklaringer registreret lige nu fra denne noteopsamling
