# Planning Center — SSOT

> **Læs denne FØR enhver opgave der rører holdudtagelse, sæsonplanlægning, kalender-fanen eller assistenten.** Ejer-direktiv 25/8 2026 ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)).

Planning Center er den flade hvor en manager beslutter **hvem der kører hvad, hvornår**. Alt andet om løbene bor i [`RACE_ENGINE_RULES.md`](RACE_ENGINE_RULES.md) og [`CALENDAR_RULES.md`](CALENDAR_RULES.md).

---

## 0. IA — fire zoom-niveauer, to skinner (ejer-låst 21/8)

| Niveau | Hvad | Status |
|---|---|---|
| **Z1 Sæson** | Rytter × løb over hele sæsonen. Bor i `/planning?tab=selection` bag `Season / Day`-toggle | v0 shippet (#4083); gitteret er P1 |
| **Z2 Løbsdag** | Det eksisterende dags-board | live |
| **Z3 Løb** | Løbets planlægningsvisning i centret — etaper, ruteprofiler, trup | ikke bygget |
| **Z4 Etape** | T1-T4-taktikkortet | bygges af motor-sporets F3 |
| Skinne | Rytter-inspektør | ikke bygget |
| Skinne | Stående ordrer | ikke bygget |

**Ét sted at gemme en udtagelse.** Klik på en løbsdag i Z1 åbner dagens board.

**Z4 bygges IKKE her.** P2 monterer motor-sporets kort og forbinder det. Ingen dobbeltbygning.

---

## 1. Skrivevejen

| Endpoint | Bruges af | Rate limit |
|---|---|---|
| `PUT /races/:raceId/selection` | dagsboardet — skriver med det samme | `marketWriteLimiter`: **30 pr. 60 sek** |
| `PUT /races/selection/bulk` | Z1-matrixen — atomart, hele diffen i ét kald | samme limiter, ét kald |
| `POST /races/:raceId/selection/auto` | auto-udfyld pr. løb | samme |
| `POST /races/distribution/regenerate` · `/clear` | sæson-brede operationer | samme |

**Bulk er atomart.** Enten går hele planen ind, eller ingen af den. Delvis succes findes ikke — spilleren må aldrig se halvdelen af sit arbejde gemt. Bulk-vejen orkestrerer kun; valideringen (binding, trupgrænse, tilgængelighed) er den samme som enkelt-endpointets.

**Grænsen er grunden.** 40 celler via enkelt-endpointet ville fejle efter de 30 første. Se `backend/lib/rateLimiters.js:64`.

---

## 2. Rolle-vokabularet

Fem værdier, og de ejes af motoren, ikke af denne flade: `captain` · `sprint_captain` · `hunter` · `helper` · `free_role`. Se [`RACE_ENGINE_RULES.md`](RACE_ENGINE_RULES.md) §1. **Opfind aldrig et sjette ord her.**

---

## 3. De to akser

Kolonnerne i Z1 kan ikke låses uden at kende kalenderens akse-tilstand. Se [`CALENDAR_RULES.md`](CALENDAR_RULES.md) §0: en løbsdag bor **inde i** én kalenderdag, og `game_day` kan aldrig udledes af `scheduled_at`.

Uanset udfald vises **begge akser**: dato-kalenderen som ramme, løbsdags-striben som sandhed. En flade der kun viser den ene lyver om den anden — det kostede en spiller-bugrapport 24/8 ([#4193](https://github.com/NicolaiDolmer/CyclingZone/issues/4193)).

---

## 4. Assistenten

**Åben ejer-beslutning:** [#4201](https://github.com/NicolaiDolmer/CyclingZone/issues/4201) — skal assistenten være opt-in eller sen-udfyldning i stedet for proaktiv auto-udtagelse?

**Indtil den er truffet bygges der ingen ny proaktiv assistent-flade.** Det gælder også kortstakke, forslag-bannere og auto-accept-flows. Grunden er konkret: [#4200](https://github.com/NicolaiDolmer/CyclingZone/issues/4200) — assistenten genudfyldte trupper spillere havde ryddet og gemt, og det var én af de to ting der udskød sæson 3.

Der findes i dag tre indgange til auto-udfyld (dagsboardet, `PlannerAssistantCard`, `/selection/auto`). En fjerde må ikke opstå før #4201.

---

## 5. Linser og filtre

| Linse | I v1 | Datagrundlag |
|---|---|---|
| Udtagelser | ja | gitterets eget indhold |
| Kun problemer | ja | udtagelser + klassegrænser + binding, regnes i browseren |
| Belastning | ja, efter fix | `load.raceDays` — se modsigelse 1 |
| Form og peak | senere | `peak_planner_enabled` er `on` i prod (koden defaulter off) |
| Rute-match | kun ved celle-åbning | `frontend/src/lib/suitability.js`, ægte 0-100 mod demand-vektoren |

Rute-match som fladedækkende linse er fravalgt: kalender-svaret bærer hverken evner eller demand-vektorer.

---

## 6. Komponenter der allerede findes

Byg aldrig disse om. Verificeret mod koden 25/8.

| Komponent | Ansvar |
|---|---|
| `racehub/SeasonView.jsx` | Datolineal, løbs-bånd, lane-packing, klik → dagsboard |
| `racehub/SeasonDayToggle.jsx` | `Season / Day` |
| `racehub/SeasonPicker.jsx` | Sæson-browsing, read-only (B7) |
| `lib/seasonTimeline.js` | 11 rene funktioner, sæson-agnostiske. `nextFocusDayIso` finder næste løbsdag uden udtagelse |
| `lib/suitability.js` | Rute-match 0-100, spejler `raceSimulator.terrainScore` |
| `racehub/FitBar.jsx` | Den delte fit-bar — kolonne, pulje og popover viser samme signal |
| `planner/MobileLanes.jsx` | Mobilt stakket lane-mønster, tap-mål ≥24px |
| `planner/PlannerAssistantCard.jsx` | "Accept all" for peak-forslag |

---

## 7. Verificeret UI-gæld (efterprøvet mod kode 25/8)

| # | Fund | Hvor |
|---|---|---|
| 1 | Strategi-kladde tabes tavst ved fane-skift | `StrategyPage.jsx:68` — kun `saved=false`, ingen unmount-guard, modsat boardets `boardDirty` |
| 2 | Kalender-fanen har nul URL-tilstand | `CalendarPage.jsx:49-62` — `tab`, `division`, `pool` er ren `useState` |
| 3 | Tilbage fra løb åbnet på boardet lander i Resultater | `RaceColumn.jsx:100` → #3954 |
| 4 | Drag er ren HTML5, 0 touch-handlers; løb→løb har intet klik-alternativ | `raceHubDnd.js` |
| 5 | Fem flader returnerer tavst `null` ved slukket flag ELLER fejlet kald | `StrategyPage.jsx:61` m.fl. |
| 6 | Formplanen viser form, aldrig træthed, selvom API'et sender begge | `PlannerSquad.jsx`, `MasterCanvas.jsx` |

---

## 8. Kendte åbne modsigelser

| # | Modsigelse | Issue |
|---|---|---|
| 1 | `api.js:4444` lægger **etapetal** i et felt der hedder `raceDays`. Tallet er tilfældigt rigtigt efter #4161 og bliver forkert i samme sekund to etaper deler en løbsdag | denne fil §5 |
| 2 | To gemme-modeller: boardet skriver straks, matrixen ved Gem — men spec'en siger "ét sted at gemme" | denne fil §1 |
| 3 | Tre indgange til auto-udfyld; #4201 kan gøre alle tre forkerte | [#4201](https://github.com/NicolaiDolmer/CyclingZone/issues/4201) |
| 4 | `?view=`-parameteren slettes af `SeasonView.jsx:202` og sættes aldrig, selvom regel 6 kræver den | [#1146](https://github.com/NicolaiDolmer/CyclingZone/issues/1146) |
| 5 | ~~Trupgrænser pr. klasse er ikke skrevet ned noget sted~~ **Lukket** 27/8: de står i [`CALENDAR_RULES.md` §8](CALENDAR_RULES.md) (tilføjet 24/8 i #4176), som nu også dokumenterer default-fallbacken `{6,8}` og at en delvis trup er lovlig | [#4295](https://github.com/NicolaiDolmer/CyclingZone/issues/4295) |

---

## 9. Kildedokumenter

[`2026-08-21-planning-center-fase2-design.md`](superpowers/specs/2026-08-21-planning-center-fase2-design.md) (IA, faseplan P0-P5, scorecard) · [`2026-08-25-planning-center-z1-saesonmatrix-design.md`](superpowers/specs/2026-08-25-planning-center-z1-saesonmatrix-design.md) (Z1-gitteret).

Spiller-preview live: `frontend/public/race-planning-preview.html` (#4022), som en spiller byggede videre på 25/8 — se `.claude/learnings/2026-08-25-spillerprototype-afsloerede-to-brudte-kalender-invarianter.md`.
