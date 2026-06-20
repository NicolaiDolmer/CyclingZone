# Konsolidering af hold-/liga-sider → én Standings-hub

> Design-spec til ejer-review. Refs #1605. Dato: 2026-06-20.
> Status: **forslag** — ingen kode ændret. Output er dette dokument.
> Scope: player-facing IA-ændring (kræver patch note + i18n-paritet, se §8).

---

## 0. Resumé (TL;DR)

I dag findes hold-/liga-data spredt på **fire sider** med fire nav-indgange. Alle fire er
overlappende skæringer af det samme datagrundlag (`teams` + `season_standings` + `riders`).
`StandingsPage.jsx` er allerede den modneste tabel og **defaulter allerede til brugerens egen
division** — den bliver hub'en. De tre svagere sider (Teams, Head-to-Head, Season-Preview)
foldes ind som henholdsvis en **kolonne/online-prik**, en **visnings-linse** og en
**compare-drawer**. Resultat: én indgang i stedet for fire, og det bedste fra alle tre bevaret
som funktion.

---

## 1. Nuværende tilstand

### 1.1 De fire sider

| Side | Route | Nav-gruppe | Primær præsentation |
|------|-------|-----------|---------------------|
| Standings | `/standings` | "Season & Results" (`saeson`) | Moden tabel pr. division |
| Teams | `/teams` | "League" (`liga`) | Kort-grid pr. division |
| Head-to-Head | `/head-to-head` | "League" (`liga`) | To-hold-sammenligning |
| Season Preview | `/season-preview` | "League" (`liga`) | Styrke-rangering (bars) |

**Vigtig korrektion til issue-formuleringen:** der er **3 items i "League"-gruppen**
(`Layout.jsx:71-78`: `/teams`, `/head-to-head`, `/season-preview`) **plus** Standings som en
fjerde indgang i en *anden* gruppe, "Season & Results" (`Layout.jsx:62-70`, item på
`Layout.jsx:65`). Det er den "3 + en fjerde"-konstellation ejeren beskriver. Standings ligger
altså ikke i League-gruppen i dag.

Routes defineres i `App.jsx`:
- `/standings` → `App.jsx:173`
- `/teams` → `App.jsx:171`, `/teams/:id` → `App.jsx:172`
- `/head-to-head` → `App.jsx:184`
- `/season-preview` → `App.jsx:183`

Nav-labels (EN) i `frontend/public/locales/en/common.json`:
- Gruppe-labels: `klubhus`="Clubhouse", `marked`="Market", `saeson`="Season & Results"
  (`common.json:6`), `liga`="League" (`common.json:8`).
- Item-labels: `standings`="Standings" (`common.json:28`), `teams`="Teams"
  (`common.json:38`), `headToHead`="Head-to-Head" (`common.json:39`),
  `seasonPreview`="Season Preview" (`common.json:40`).

### 1.2 `StandingsPage.jsx` — hvad den viser + datakilder

En tabel pr. division med høj informationstæthed. Konkret:

- **Defaulter til brugerens egen division** (`StandingsPage.jsx:60`:
  `if (myTeam?.division) setDivTab(myTeam.division);`). Dette er kerne-egenskaben der gør den
  til hub.
- Division-tabs med hold-tæller pr. division (`StandingsPage.jsx:184-197`, `divCounts` på
  `:162-165`).
- Tabel-kolonner (`StandingsPage.jsx:207-313`): rang (#), hold (med mini-progress-bar),
  etapesejre, holdklassement-sejre (`teamComp`), podier (`podiums`), præmiepenge
  (`prizeEarned`), point (med penalty-fradrag), og en progressions-**sparkline**
  (`MiniSparkline`, `:26-40`).
- **Op-/nedryknings-zoner**: top-2 = promotion (grøn), bund-2 = relegation (rød), med
  separator-rækker og zone-bars via `boxShadow` (`StandingsPage.jsx:233-242`, `:246-252`,
  `:301-308`) + legend (`:316-335`).
- **Leder-badge** (`LeaderBadge`, `:268`) + **"You"-badge** (`:269`) + **me-ring** (`:241`).
- **Realtime**: `useRealtimeRefetch` på `["season_standings","race_results"]`
  (`StandingsPage.jsx:24`, `:150`) — ranglisten opdaterer live ved resultat-import.
- Række-klik → `/teams/:id?tab=results` (`StandingsPage.jsx:254`) — fra ranglisten forventer
  man holdets resultater (#824).
- Division-farver via design-tokens: `DIV_VARS = { 1:"--accent", 2:"--cz-chart-1",
  3:"--cz-chart-2" }` + `divColor()`-helper (`StandingsPage.jsx:18-22`).

**Datakilder:** `teams` (filtreret: `is_ai=false`, `is_test_account=false`, `is_frozen=false`,
`StandingsPage.jsx:66`), `season_standings` joinet med `team` (`:68-72`), `races` (`:73-77`),
`race_results` pagineret via `fetchAllRows` (`:96-100`). Podier client-tælles
(`countTeamPodiums`, `:132`), holdklassement og præmiepenge client-aggregeres (`:119-144`).

### 1.3 `TeamsPage.jsx` — hvad den viser + datakilder

Kort-grid grupperet pr. division (`TeamsPage.jsx:108-184`). Hvert hold-kort viser:
- Holdnavn + manager-navn + "You"-badge (`:138-148`).
- **Online-status-prik** (grøn/grå) baseret på `user.last_seen` < 5 min
  (`TeamsPage.jsx:126-127`, `:150`) + ryttertal (`:151`).
- Tre stat-bokse: point, etapesejre, GC-sejre (`TeamsPage.jsx:158-177`).
- Søgefelt + division-filter (`all/1/2/3`) (`TeamsPage.jsx:92-105`).
- Kort-klik → `/teams/:id` (`:130`).

**Datakilder:** `teams` (samme filter som Standings, `TeamsPage.jsx:38-43`, joiner
`user.last_seen`), `riders` til ryttertælling (`:44`), `season_standings` (`:46-49`).

**Unikt ift. Standings:** online-status-prik (last_seen) + fri tekst-søgning. Alt andet er en
svagere visning af data Standings allerede har.

### 1.4 `HeadToHeadPage.jsx` — hvad den viser + datakilder

To-hold-sammenligning. Den eneste side med **ægte relationelle data** (relation *mellem* to
hold). Indhold:
- To `TeamSearch`-felter med autosuggest (`HeadToHeadPage.jsx:10-71`, `:201-204`); default
  teamA = brugerens eget hold (`:110-116`).
- **`StatCompare`-komponent** (`HeadToHeadPage.jsx:73-100`) — to-sidet bar-sammenligning med
  vinder-fremhævning; bruges til point / etapesejre / GC-sejre / antal sæsoner
  (`:241-244`). **Genbrugbar nøgle-komponent.**
- **Indbyrdes transfer-historik** (`HeadToHeadPage.jsx:247-274`) — auktioner hvor det ene
  hold købte fra det andet (`:131-134`, `or(...)`-query mod `auctions`). Dette er den unikke
  relationelle datakilde.
- **Top-5-ryttere pr. hold**, rangeret efter faktisk optjente race-point (summeret fra
  `race_results.points_earned`, `:147-166`), tie-break på `market_value`.

**Datakilder:** `season_standings` (alle sæsoner, `:125-128`), `auctions` (completed,
indbyrdes, `:131-134`), `riders` for begge hold (`:136-137`), `race_results` for top-5-point
(`:155-158`).

### 1.5 `SeasonPreviewPage.jsx` — hvad den viser + datakilder

Styrke-rangering på tværs af alle divisioner, sorteret efter samlet trup-værdi
(`SeasonPreviewPage.jsx:57-61`). Indhold:
- Per-hold: total trup-værdi, gns. climbing/sprint/time_trial, U25-tal, top-stjerne, ryttertal
  (`SeasonPreviewPage.jsx:46-55`).
- Styrke-overblik med horizontale bars (`:85-129`) + hold-kort-grid (`:131-181`).
- "Strong"-tærskel = 55 på CZ-evne-skalaen (`:14`, kommentar `:9-13`: erstatter den gamle
  PCM-stat-visning, #1529).
- "You"-badge + me-ring (`:138`, `:145`).

**Datakilder:** `teams` (samme filter, `SeasonPreviewPage.jsx:34`), `riders` med
`ABILITY_SELECT`-join fladet via `flattenAbilities` (`:35`, `:40-44`), `seasons` (`:36`).
Værdi via `getRiderMarketValue` (`lib/marketValues`).

**Bemærk:** Season-Preview's i18n-keys ligger **allerede** i `standings.json` under `preview.*`
(`standings.json:25-31` + `SeasonPreviewPage.jsx:21`/`:79-83` bruger `useTranslation("standings")`).
Namespace-mæssigt er de to sider altså allerede koblet — det gør indfoldning lettere.

### 1.6 Enkelt-hold-sider (mål for række-klik, ændres ikke)

- `TeamProfilePage.jsx` (`/teams/:id`) — andres hold: header, sæson-standing, tabs
  squad/results/transfers (`TeamProfilePage.jsx:20`, `:206-227`). Squad-tabel med 15
  evne-kolonner (`:268-271`). `?tab=results` deep-link understøttet (`:51-54`).
- `TeamPage.jsx` (`/team`) — eget hold: squad-management + action-modal (auktion/transfer),
  loan-pills, current/upcoming-toggle (`TeamPage.jsx:412-559`).

Disse er destinationer, ikke oversigter — de berøres ikke af konsolideringen ud over at de
forbliver række-klik-target.

---

## 2. Overlap-analyse

### 2.1 Hvad gentages

| Data/funktion | Standings | Teams | H2H | Season-Preview |
|---------------|:---------:|:-----:|:---:|:--------------:|
| `teams` (samme is_ai/test/frozen-filter) | ✔ | ✔ | ✔ (søgt) | ✔ |
| Point / etapesejre / GC-sejre | ✔ | ✔ | ✔ | — |
| Division-gruppering | ✔ (tabs) | ✔ (grid) | — | ✔ (label) |
| "You"-badge + me-ring | ✔ | ✔ | — | ✔ |
| Række/kort → `/teams/:id` | ✔ | ✔ | ✔ (top-5 navne) | ✔ |
| Top-stjerne / top-ryttere | — | — | ✔ (top-5) | ✔ (top-1) |
| Online-status (last_seen) | — | ✔ | — | — |
| Trup-værdi + avg-evner + U25 | — | — | — | ✔ |
| **Indbyrdes transfer-historik** | — | — | **✔** | — |
| `StatCompare` to-hold-bars | — | — | **✔** | — |

Tre af de fire sider er i praksis **forskellige visninger af `teams`+`season_standings`**.
Standings er supersæt af Teams (mangler kun online-prik + søgning) og leverer mere
(zoner, præmie, podier, sparkline, realtime).

### 2.2 Hvad er reelt unikt (skal bevares — ikke bare slettes)

1. **Indbyrdes relation (H2H)** — `auctions`-query for transfers *mellem* netop de to valgte
   hold (`HeadToHeadPage.jsx:131-134`). Kan ikke udledes af en flad rangliste; kræver to valgte
   hold. Dette er den eneste ægte relationelle datakilde og må ikke tabes.
2. **`StatCompare`-visualiseringen** (`HeadToHeadPage.jsx:73-100`) — to-sidet bar med
   vinder-fremhævning. Genbruges i compare-drawer.
3. **Squad-styrke-aggregaterne** (Season-Preview) — trup-værdi, avg climbing/sprint/TT, U25,
   top-stjerne. Disse beregnes ikke i Standings i dag (Standings kender point, ikke evner).
4. **Online-status-prik** (Teams) — `last_seen`-baseret tilstedeværelse pr. hold.

Alt det unikke har en plads i den foreslåede hub (§3). Intet af det slettes som funktion —
kun de tre *sider* (containere) udfases.

---

## 3. Foreslået informationsarkitektur

### 3.1 Én hub: udvidet `StandingsPage`

Topniveau uændret: titel + sæson-label + **division-tabs** (default = egen division,
`StandingsPage.jsx:60`). Under tabs tilføjes en **visnings-switch** (segmented control) der
skifter mellem to *linser* på samme division-tabel:

```
┌─ Standings ─────────────────────────────────── Season 1 ─┐
│  [ Div 1 (8) ] [ Div 2 (6) ] [ Div 3 (5) ]               │  ← division-tabs (egen først)
│                                                           │
│  [ ◉ Standings ] [ Squad strength ]      [ Compare (0) ] │  ← visnings-switch + compare-action
│                                                           │
│  #  Team            … kolonner pr. linse …          Pts   │
│  1  Team A  ●you                                    412   │  ← me-ring, online-prik
│  …                                                        │
└───────────────────────────────────────────────────────────┘
```

### 3.2 Linse A — "Standings" (default)

**Uændret** ift. nuværende `StandingsPage`-tabel (point-sorteret, zoner, præmie, podier,
sparkline, realtime). Eneste tilføjelse: **online-status-prik** ved holdnavnet (foldet ind fra
Teams via `last_seen`; kræver join på `user:user_id(last_seen)` som `TeamsPage.jsx:39` allerede
gør). Dette gør `/teams` overflødig.

Kolonner (som i dag): `# · Team · Stage wins · Team class. · Podiums · Prize · Points · Progress`.

### 3.3 Linse B — "Squad strength" (folder Season-Preview ind)

Samme division-tabel, men **sorteret efter trup-værdi** og med squad-styrke-kolonner i stedet
for resultat-kolonner. Folder `SeasonPreviewPage`'s aggregater ind:

Kolonner: `# · Team · Squad value · Riders · U25 · Avg Climb · Avg Sprint · Avg TT · Top star`.

- Værdier beregnes som i `SeasonPreviewPage.jsx:46-55` (`totalValue`, `avgBj/Sp/Tt`, `u25Count`,
  `topRider`, `riderCount`).
- Kræver at hub'en henter `riders` med `ABILITY_SELECT` (som Season-Preview, `:35`) — kun når
  linse B er aktiv (lazy, så Linse A ikke betaler for evne-fetch).
- "Strong"-fremhævning genbruger tærsklen `STRONG_THRESHOLD = 55` (`SeasonPreviewPage.jsx:14`).
- Erstatter `/season-preview`.

**Bemærk om scope:** Season-Preview viser i dag *alle divisioner samlet* i én styrke-rangering;
hub'en viser én division ad gangen (via tabs). Det er en bevidst ændring — "styrke i min
division" er mere relevant end en global liste, og divisions-konteksten bevares. Hvis ejeren vil
have den globale styrke-liste bevaret, kan en "All divisions"-pseudo-tab tilføjes (åben
beslutning §7).

### 3.4 Compare-drawer (folder Head-to-Head ind)

**Multi-select på 2 rækker** (checkbox/klik-til-vælg pr. række) → en **Compare-action** bliver
aktiv → åbner en drawer (side-panel) der genbruger H2H's indhold for de 2 valgte hold:

- `StatCompare` for point / etapesejre / GC-sejre / sæsoner (`HeadToHeadPage.jsx:241-244`).
- **Indbyrdes transfer-historik** (`HeadToHeadPage.jsx:247-274`) — den unikke relationelle del.
- Top-5-ryttere pr. hold efter race-point (`HeadToHeadPage.jsx:163-178`).

Drawer-load genbruger `HeadToHeadPage`'s `loadStats`-logik (`:120-187`) næsten 1:1 — den tager
allerede to team-id'er. Erstatter `/head-to-head`.

**Default-valg:** når drawer åbnes uden 2 manuelt valgte hold (fx via deep-link, §4), foreslås
brugerens eget hold som hold A (`HeadToHeadPage.jsx:110-116`-mønstret) + det række-valgte som
hold B.

### 3.5 Hvorfor switch og ikke ny side

Trade-off:
- **Fordel:** én route, én datafetch-grundstamme, ingen ny nav-indgang; linserne deler
  division-tabs + me-ring + DIV_VARS, så koden og den mentale model er én.
- **Omkostning:** `StandingsPage` vokser; squad-styrke-fetch (evner) skal gates bag linse B for
  ikke at gøre default-visningen tungere. Drawer-state (valgte rækker) tilføjer kompleksitet.
- **Alternativ:** beholde Season-Preview/H2H som separate ruter men flytte dem ind i samme
  nav-gruppe. Forkastet — det løser ikke "færrest indgange"-kravet.

---

## 4. Nav-ændringer + redirect-plan

### 4.1 Nav (Layout.jsx)

- **Fjern "League"-gruppen** (`Layout.jsx:71-78`) helt — den indeholder kun de tre sider der nu
  er linser/drawer.
- Behold `/standings` som hub i "Season & Results"-gruppen (`Layout.jsx:65`). Overvej at
  omdøbe item-label fra "Standings" til fx "League / Standings" eller "Teams & Standings" så
  brugere der ledte efter Teams/H2H finder hub'en (i18n-key `nav.item.standings`,
  `common.json:28` — eller ny key). **Åben beslutning §7.**
- Konsekvens: "League"-gruppe-label (`common.json:8`) og item-keys `teams`/`headToHead`/
  `seasonPreview` (`common.json:38-40`) bliver ubrugte i nav (behold keys indtil redirect-plan
  er verificeret, ryd op i opfølgning).

### 4.2 Redirects (App.jsx) — bevar dybe links

Erstat side-routes med `Navigate` (mønstret findes allerede, fx `App.jsx:179`, `:191`, `:194`):

| Gammel route | Ny adfærd |
|--------------|-----------|
| `/teams` (`App.jsx:171`) | → `/standings` |
| `/season-preview` (`App.jsx:183`) | → `/standings?view=strength` (åbner Linse B) |
| `/head-to-head` (`App.jsx:184`) | → `/standings?compare=1` (åbner compare-drawer, eget hold som A) |
| `/teams/:id` (`App.jsx:172`) | **uændret** — enkelt-hold-profil er stadig destination |

- Hub'en læser `?view=` og `?compare=` via `useSearchParams` (mønster: `TeamProfilePage.jsx:39`,
  `:51-54`) til at vælge initial linse / åbne drawer.
- H2H-deep-links med team-id'er (hvis nogen deles eksternt) kan mappes til
  `/standings?compare=1&a=<id>&b=<id>` — men H2H tager ikke id'er i URL i dag
  (`HeadToHeadPage.jsx` bruger søgning), så der er ingen eksisterende dybe H2H-links at bevare.
- `/teams/:id?tab=results`-links fra ranglisten (`StandingsPage.jsx:254`) er uændrede.

---

## 5. Genbrugs-komponenter

| Komponent / token | Kilde | Genbrug i hub |
|-------------------|-------|---------------|
| `StatCompare` | `HeadToHeadPage.jsx:73-100` | Compare-drawer (§3.4). **Bør udtrækkes** til `components/` så hub + (evt. fremtidig) H2H deler én kilde. |
| Me-ring `boxShadow` | `StandingsPage.jsx:241`, `TeamsPage.jsx:131`, `SeasonPreviewPage.jsx:138` | Allerede i Standings — ingen ændring. |
| "You"-badge (`--me-badge-bg/fg`) | `StandingsPage.jsx:269`, `TeamsPage.jsx:142-143` | Allerede i Standings. |
| `DIV_VARS` + `divColor()` | `StandingsPage.jsx:18-22` | Begge linser; Season-Preview's rå hex (`SeasonPreviewPage.jsx:68`: `{1:"#e8c547",...}`) **droppes** til fordel for token-helperen (anti-AI-slop / token-disciplin). |
| Online-prik (`last_seen` < 5 min) | `TeamsPage.jsx:126-127`, `:150` | Linse A holdnavn-celle. |
| `LeaderBadge` | `StandingsPage.jsx:7`, `:268` | Uændret. |
| Squad-aggregater (`totalValue`, `avgBj/Sp/Tt`, `u25Count`, `topRider`) | `SeasonPreviewPage.jsx:46-55` | Linse B. |
| `ABILITY_SELECT` / `flattenAbilities` | `lib/abilities` (`SeasonPreviewPage.jsx:7`, `:35`) | Linse B's evne-fetch. |
| `MiniSparkline`, `countTeamPodiums`, `useRealtimeRefetch` | `StandingsPage.jsx` | Uændret i Linse A. |

**Anbefalet refaktor i samme PR-serie:** udtræk `StatCompare` til en delt komponent (i dag
privat i `HeadToHeadPage.jsx`), så drawer'en ikke importerer fra en side der skal slettes.

---

## 6. Koordinering med eksisterende issues

| Issue | Titel (kort) | Relation til #1605 |
|-------|--------------|--------------------|
| **#924** | Rangliste bør indeholde mere info (etapesejre, klassementer, podier, point, præmie) | **Stort overlap — næsten løst.** Standings viser allerede etapesejre, holdklassement, podier, point, præmie (`StandingsPage.jsx:207-313`). #1605 bygger oven på samme tabel. Anbefaling: verificér de manglende klassementer (bjerg/sprint/klassikere) og **luk #924 ind i #1605** eller markér som leveret. |
| **#1106** | Multi-sæson visning (rangliste/historik/kalender på tværs) | Hub'en er det naturlige sted for en **sæson-vælger** ved siden af division-tabs. #1605 leverer ikke multi-sæson, men skal **ikke modarbejde den** — hold sæson-state løs så #1106 kan tilføje en vælger uden re-arkitektur. H2H bruger allerede "alle sæsoner" (`headtohead.json:11`), Standings = aktiv sæson (`StandingsPage.jsx:62`). |
| **#1152** | [Design] Divisions, promotion/relegation, newcomer catch-up | Hub'en *viser* promotion/relegation-zoner (`StandingsPage.jsx:233-240`). #1152 designer *reglerne*; #1605 er præsentationen. Begge rører division-modellen — koordinér så zone-visningen matcher #1152's endelige regler (antal op/ned, catch-up). #1605 må ikke hardcode "top-2/bund-2" hvis #1152 ændrer det (i dag er det hardcodet `i < 2` / `length - 2`). |
| **#1027** | Pre-launch UI: nav-header/IA-restructure (#481 Phase 4) | **Direkte søsken.** #1605 fjerner "League"-gruppen → reducerer nav-grupper fra 4 til 3 (+admin). Dette er præcis den IA-forenkling #1027 sigter mod. Koordinér så nav-ændringen i §4.1 sker som del af #1027's restructure (eller mindst ikke konflikter med den). `WIDE_CONTENT_ROUTES` (`Layout.jsx:21`) bør evt. inkludere `/standings` når Linse B's brede evne-tabel er aktiv. |
| **#978** | Menustruktur: placerings-justeringer | Lavprioritets nav-finjustering. #1605's fjernelse af 3 items + 1 gruppe er en større strukturændring der bør **lande før** #978's finjusteringer, så #978 arbejder på den konsoliderede menu. |

**Rækkefølge-anbefaling:** #1152 (regler) informerer zone-visningen → #1605 (denne konsolidering)
folder sider sammen og rører nav → #1027 indfanger nav-ændringen i den bredere restructure →
#1106 (sæson-vælger) og #978 (finjustering) bygger oven på den konsoliderede hub. #924 lukkes
ind i / verificeres mod #1605.

---

## 7. Åbne ejer-beslutninger

1. **Visnings-switch vs. faner.** Anbefaling: **segmented switch** (samme mønster som
   current/upcoming i `TeamProfilePage.jsx:234-249`). Faner ville konkurrere visuelt med
   division-tabs (to tab-rækker oven på hinanden). 👍 switch / 👎 faner.
2. **Nedlæg "League"-gruppen vs. behold.** Anbefaling: **nedlæg** (`Layout.jsx:71-78`) og lad
   hub'en bo i "Season & Results". Reducerer nav fra 4 til 3 grupper og opfylder "færrest
   indgange". 👍 nedlæg / 👎 behold som tom/omdøbt gruppe.
3. **Hub-label.** Behold "Standings", eller omdøb (fx "League & Standings" / "Teams &
   Standings") så folk der ledte efter Teams/H2H finder den? Anbefaling: **omdøb** — ellers er
   "hvor blev Teams af?" en reel risiko. Kræver ny/ændret i18n-key.
4. **Fjern alle 3 sider helt vs. behold H2H separat.** Anbefaling: **fjern alle 3 ruter**, bevar
   funktionen som linse (Season-Preview) + drawer (H2H). H2H's relationelle data lever videre i
   drawer'en. 👍 fjern alle 3 / 👎 behold H2H som egen side.
5. **Squad strength: per-division vs. global liste.** Linse B viser én division ad gangen (via
   tabs). Season-Preview viste alle divisioner samlet. Tilføj en valgfri "All divisions"-tab for
   den globale styrke-rangering? Anbefaling: **start per-division**, tilføj global kun hvis
   efterspurgt. 👍 per-division / 👎 behold global samlet liste.
6. **Online-prik i Linse A.** Tilføjer en `user.last_seen`-join til hub-queryen. Lille
   omkostning, men gør hub'en til erstatning for Teams. Anbefaling: **ja, tilføj.**

---

## 8. Acceptkriterier

- [ ] **Én nav-indgang** til hold/liga-oversigt; de 3 "League"-items (`/teams`,
      `/head-to-head`, `/season-preview`) er fjernet fra nav, og "League"-gruppen er nedlagt
      (per beslutning §7.2).
- [ ] Hub'en **åbner default i brugerens egen division** (bevarer `StandingsPage.jsx:60`).
- [ ] **Linse A ("Standings")** = nuværende tabel, uændret funktion (zoner, præmie, podier,
      sparkline, realtime), + online-status-prik pr. hold.
- [ ] **Linse B ("Squad strength")** bevarer Season-Preview-værdien: trup-værdi, ryttertal,
      U25, avg climbing/sprint/TT, top-stjerne; sorteret efter trup-værdi.
- [ ] **Compare-drawer** for 2 valgte hold = samme sammenligning som Head-to-Head:
      `StatCompare` (point/etapesejre/GC/sæsoner) + **indbyrdes transfer-historik** + top-5
      ryttere pr. hold.
- [ ] `/teams`, `/season-preview`, `/head-to-head` **redirecter** til hub'en med korrekt
      initial-state (ingen døde links); `/teams/:id` uændret.
- [ ] `StatCompare` udtrukket til delt komponent (ikke importeret fra en slettet side).
- [ ] Squad-styrke-evne-fetch er **gated bag Linse B** (default-visning bliver ikke tungere).
- [ ] Division-farver bruger `DIV_VARS`/`divColor()`-tokens overalt (ingen rå hex fra
      Season-Preview).
- [ ] **Patch note** skrevet (EN først, DA under) — player-facing IA-ændring.
- [ ] **i18n-paritet**: alle nye/ændrede keys findes i både `en` og `da`; ingen i18n-leak;
      Season-Preview's `standings.json:preview.*`-keys genbruges/migreres rent.
- [ ] Hjælp/FAQ (`help.json` en+da) opdateret hvis "hvor finder jeg Teams/H2H?" ændrer sig
      (eller note om hvorfor ikke).
- [ ] Promotion/relegation-zonevisning koordineret med #1152's regler (ikke hardcodet i strid
      med endeligt design).
- [ ] Verificeret logget-ind via Playwright-mocks (begge linser + drawer renderer) før push.

---

## 9. Ikke i scope (afgrænsning)

- Multi-sæson-vælger (#1106) — hub'en gøres kun *klar* til den, ikke implementeret.
- Nye klassementer i ranglisten (bjerg/sprint/klassikere, #924-rest) — verificeres separat.
- Ændring af enkelt-hold-sider (`/team`, `/teams/:id`) — kun bevaret som destination.
- Division-reglerne selv (#1152) — kun visningen koordineres.
