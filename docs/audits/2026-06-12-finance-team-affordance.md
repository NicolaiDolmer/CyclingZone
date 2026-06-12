# Affordance-audit: /finance + /team (2026-06-12)

**Issue:** [#1131](https://github.com/NicolaiDolmer/CyclingZone/issues/1131) — dækningsnote fra #864.
**Metode:** Samme som #864 — Clarity dead/rage-click-data (element-niveau) × kode-verifikation af hver hotspot i `FinancePage.jsx` + `TeamPage.jsx` (+ inline-komponenter `FinanceForecastCard`, `RiderActionModal`, `SquadTab`, `EconomyTab`).
**Datavindue:** 2026-06-05 → 2026-06-12 (post-5/6, jf. #864-måle-issue), non-bot.

## Topline (Clarity)

| Side | Dead clicks | Rage clicks |
|------|------------|-------------|
| /team | 291 (288 vercel + 3 org) | 39 |
| /finance | 124 (122 vercel + 2 org) | 14 |

Element-niveau-tallene nedenfor er Clarity's totaler pr. klikket tekst (kan overstige side-totalen fordi Clarity tæller alle klik på elementet, også på tværs af besøg).

## Fund — /team

| # | Element (ClickedText) | Dead clicks | Kode-verifikation | Status |
|---|---|---|---|---|
| T1 | "Løn" (trup-tabel-header) | **1.385** | `SquadTab`: eneste kolonne-header i rækken der var en død `<th>` — Rytter/Værdi/Potentiale/alle 14 stats er `SortTh`. Visuelt identisk med de sortérbare. Samme data ER sortérbar på /riders (`sortKey="salary"`). | **FIKSET** — `SortTh sortKey="salary"`; klient-sorten håndterer feltet via `a[sort] \|\| 0`-fallthrough |
| T2 | "▫▫" (maskeret 2-tegns tekst) | 840 | Sandsynligvis stat-celler (maskerede tal) i trup-tabellen — non-interaktive `<span>`. Intentionen er uklar (nysgerrighed på stat-forkortelser?). | **DELVIST** — fulde stat-navne (`rider:skills.*.long`) som native `title`-tooltip på stat-headers. Celler bevidst ikke gjort klikbare (rytter-navnet er klikmålet) |
| T3 | "☰CZCycling Zoneda…" (navbar) varianter | 653+494+179+133 | Layout/navbar — udenfor denne audits scope (deles af alle sider; /finance har samme mønster). | **RAPPORTERET** — bør tælles i en navbar-specifik runde, ikke duplikeres pr. side |
| T4 | "Netto (ekskl. præmiepenge" | 328 | `EconomyTab` prognose-række — død plain-tekst. Spillere klikker for detaljer; den fulde prognose (lånerenter, præmie-estimat, multi-sæson, risk-tier) findes på /finance men der var ingen vej derhen fra Økonomi-fanen. | **FIKSET** — "Fuld prognose og lån →"-link i prognose-kortets header → /finance |
| T5 | "↔ Transferliste" (modal-tab) | 155 | `RiderActionModal`: tab-knappen virker, men klik på allerede-aktiv tab er no-op (dead click). Modal kender desuden ikke `windowOpen` — "Sæt til salg" fejler først ved backend-kald når vinduet er lukket. | **RAPPORTERET** — ærlig disabled-state kræver designbeslutning (må man liste med lukket vindue til næste åbning? `SquadTab` antyder ja: "Skift træder i kraft ved næste åbning") |
| T6 | "Sponsorindtægt" | 123 | Samme som T4 — `EconomyTab` prognose-række. | **FIKSET** (af T4-linket) |
| T7 | "Sælg / Auktion" (action-knap) | 123 | Knappen HAR handler og åbner modal (DOM-ændring). Dead clicks her er sandsynligvis dobbeltklik eller klik på `<td>`-padding omkring knappen. | **WHITELISTET** — knappen virker; ingen kodefejl fundet |

## Fund — /finance

| # | Element (ClickedText) | Dead clicks | Kode-verifikation | Status |
|---|---|---|---|---|
| F1 | "Giro del Veneto" / "Flandrien O Classic" / "Præmiepenge — …" / "▫▪ siden" | 231+198+132+132+231 | Løbsnavne i `prizeRows` + tx-historik er død plain-tekst, men rækkerne HAR `race_id`. Spillere forventer navigation til løbet (samme navne ER links andre steder, fx /races). | **FIKSET** — hele rækken ét klikmål (#1029/#1030-mønstret): `Link` → `/races/{race_id}` med hover-feedback + ›-chevron + title. Gælder både Løbspræmier-listen og Transaktionshistorik (kun rækker med `race_id`; øvrige forbliver statiske) |
| F2 | "FinanserBalance, lån og t" (side-header) | 366 | `<h1>` + subtitle — ren tekst, intet plausibelt navigationsmål. Idle-/nysgerrigheds-klik. | **WHITELISTET** |
| F3 | "Optag lån" | 203 | Både sektions-`<h2>` og submit-knappen har denne tekst. Submit er ærligt disabled (`disabled:opacity-50`) ved tomt beløb/over loft, og loftet forklares allerede inline (#1012: maxBorrowable + exceedsMax-tekst). | **WHITELISTET** — disabled-state er allerede ærlig og forklaret; resterende klik er på headeren |
| F4 | "••••• •••• •••• ••••" (maskerede tal) | 159 | Balance-/beløbstal — non-interaktive. Ingen oplagt drill-down (tx-historik er på samme side). | **WHITELISTET** |
| F5 | "Aktive lån" | 154 | Sektions-`<h2>` — ren tekst. "Betal rate →"-knappen i kortet er ærligt disabled (`opacity-30`) ved 0 ledig balance. | **RAPPORTERET (lav prio)** — overvej title-tooltip på disabled "Betal rate" der forklarer at penge låst i bud ikke kan bruges (#44-reglen findes kun som kodekommentar) |

## Implementerede fixes (denne PR)

1. **/team trup-tabel: Løn-kolonne sortérbar** (T1, 1.385 dead clicks — største enkeltfund på tværs af begge sider). Konsistens-fix: samme data var sortérbar på /riders og død på /team — præcis #1030-mønstret "samme data klikbar i ét panel, død i et andet".
2. **/team trup-tabel: stat-header-tooltips** (T2-afbødning) — fulde stat-navne fra `rider:skills.*.long` (en+da findes allerede) som `title` på de 14 forkortede headers.
3. **/team Økonomi-fane: "Fuld prognose og lån →"-link** (T4+T6, 450+ dead clicks) — prognose-kortet linker nu til /finance hvor den fulde forecast (FinanceForecastCard) bor.
4. **/finance: løbspræmie- og transaktionsrækker med `race_id` er klikbare** (F1, ~900 dead clicks samlet) — hele rækken ét klikmål → `/races/{race_id}`, hover + chevron + title (en+da). Rækker uden `race_id` forbliver statiske (ærligt: intet mål at navigere til).

## Rapporterede fund (kræver designbeslutning — IKKE fikset)

- **T5 — RiderActionModal kender ikke transfervindue-status:** "Sæt til salg"/"Start auktion" fejler først ved backend-svar når vinduet er lukket. Ærlig disabled-state (eller eksplicit "træder i kraft ved næste åbning"-hint i modalen) kræver afklaring af om listing med lukket vindue er tilladt. Postet på #1131.
- **T3 — Navbar-dead-clicks** (1.400+ på tværs af varianter) er Layout-scope og rammer alle sider; fortjener egen måling i stedet for at blive talt med i side-audits.
- **F5 — disabled "Betal rate →"** uden forklaring på hvorfor (penge låst i bud). Lav prio, lille fix, men afventer om #44-reglen skal eksponeres i UI-copy.

## Konklusion

Med denne runde er #864's affordance-spor **fuldt dækket**: alle 8 oprindelige sider + /finance + /team er auditeret med Clarity-friktion × kode-verifikation. Resterende fund er enten whitelistet med begrundelse (idle-klik på headere/tal) eller rapporteret med designspørgsmål på #1131.

**Forward-guard:** /team og /finance er begge dækket af `core-smoke.spec.js` (snapshots `team.png`/`finance.png`, 3 projekter). Sortérbarheden og rækkelinks er funktionelle ændringer uden styling-regression; snapshots refreshed hvor nødvendigt.
