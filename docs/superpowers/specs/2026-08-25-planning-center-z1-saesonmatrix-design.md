# Z1-sæsonmatrixen — rytter × løb-gitteret (design)

**Dato:** 2026-08-25 · **Issue:** [#1146](https://github.com/NicolaiDolmer/CyclingZone/issues/1146) · **Fase:** Planning Center fase 2, P1
**Overordnet spec:** [`2026-08-21-planning-center-fase2-design.md`](2026-08-21-planning-center-fase2-design.md) — IA'en, de fire zoom-niveauer og de to skinner er låst dér. Dette dokument dækker kun Z1-gitteret.
**Ejer-beslutninger:** designsession 25/8, fire valg, ét spørgsmål ad gangen.

## 1. Hvad denne fase er

Fase 2-spec'en beskriver Z1 som "rytter × løb-matrix for hele sæsonen". Z1 **v0** er allerede shippet (#4083): datolineal, løbs-bånd for egen pulje, klik → dagsboardet, read-only. Denne fase bygger gitteret oven på den akse.

Formålet er ét: en manager skal kunne se hele sæsonen på én gang og rette flere ting ad gangen. Dagsboardet løser "planlæg denne dag". Gitteret skal løse "find problemet" og "ret 40 problemer".

## 2. Hvad der allerede er bygget

Efterprøvet mod koden 25/8. Fase 2-spec'ens P1-scope er mindre end den selv regner med.

| Del | Hvor |
|---|---|
| Datolineal, løbs-bånd for egen pulje, lane-packing, klik → dagsboard | `frontend/src/components/racehub/SeasonView.jsx` (404 linjer) |
| `Season / Day`-toggle | `SeasonDayToggle.jsx` |
| Sæson-browsing, read-only (B7) | `SeasonPicker.jsx` + `neighborSeasons` (#4102) |
| Tidslinje-matematik, sæson-agnostisk | `frontend/src/lib/seasonTimeline.js` — 11 rene funktioner |
| Næste løbsdag uden udtagelse | `seasonTimeline.nextFocusDayIso(bands, todayIso)` |
| Rute-match, ægte 0-100 mod demand-vektoren | `frontend/src/lib/suitability.js` |
| Delt fit-bar (kolonne, pulje, popover) | `FitBar.jsx` |
| Mobilt stakket lane-mønster, tap-mål ≥24px | `frontend/src/components/planner/MobileLanes.jsx` |
| Sæson-brede operationer | `POST /races/distribution/regenerate` · `/clear` |

**Mangler:** gitteret · `?view=`-parameteren (`SeasonView.jsx:202` sletter den, sætter den aldrig) · bulk-skrivning af udtagelser · linserne som filtre.

## 3. Aksen — afhænger af #4236

Gitterets kolonner kan ikke låses før [#4236](https://github.com/NicolaiDolmer/CyclingZone/issues/4236) er afgjort.

Målt i prod, sæson 3: **25 af 89 løbsdage i D1 og 21 af 47 i D3 dækker mere end én kalenderdato.** D2 og D4 er rene. Konsekvensen er ikke kosmetisk — den er årsagen til de fire tynde endagsløb, fordi et endagsløb kan dele løbsdag med et etapeløb der er kørt færdig dage forinden.

- **Løses #4236 med bånd-modellen** (hver dato ejer ét sammenhængende interval af løbsdage): kolonnerne er **datoer**. 31 i alle fire divisioner, og `seasonTimeline.js` regner allerede i datoer.
- **Løses det ikke:** kolonnerne skal være **løbsdage** for at være sande. 89 i D1 mod designgrænsens 30 — og så kræver gitteret vandret virtualisering.

Uanset udfald vises **begge akser**: dato-kalenderen som ramme (den findes), løbsdags-striben som sandhed. Det er den model spillerprototypen fra 25/8 valgte, og den er den eneste der ikke lyver om nogen af de to.

**Handling:** aksen låses i implementeringsplanen, ikke her. Byggeriet starter på de dele der er akse-uafhængige.

## 4. Beslutning: cellen er en kladde (ejer 25/8)

`PUT /races/:raceId/selection` skriver ét løb pr. kald bag `marketWriteLimiter`, som tillader **30 skrivninger pr. 60 sekunder** (`backend/lib/rateLimiters.js:64`). En bulk-markering på 40 celler ville fejle efter de 30 første, midt i spillerens arbejde — og bulk er et krav i fase 2-spec'en, ikke nice-to-have.

**Model:** et klik ændrer en lokal kladde. Én **Gem plan**-knap sender hele diffen i ét kald. 40 rettelser = 1 kald.

### 4.1 Nyt endpoint

```
PUT /api/races/selection/bulk
body: { changes: [{ raceId, riderId, role | null }], seasonId }
```

Serveren validerer hele sættet som én transaktion og svarer enten `{ ok: true }` eller en liste af afviste ændringer med grund. **Delvis succes findes ikke** — enten går hele planen ind, eller ingen af den. Det er hele pointen med at samle dem: spilleren skal aldrig se halvdelen af sit arbejde gemt.

Genbruger den eksisterende validering fra enkelt-endpointet (binding pr. løbsdag, trupgrænse pr. klasse, rytter-tilgængelighed). Ingen ny forretningslogik i bulk-vejen — den orkestrerer kun.

### 4.2 Kladde-guard

Kladden må ikke tabes ved fane-skift. Det er UI-gæld fund 1 fra fase 2-spec'ens §4: `StrategyPage.jsx:68` sætter kun `saved=false` og har ingen unmount-guard, modsat boardets `boardDirty` i `RaceHubBoard.jsx`. Samme guard bruges her.

### 4.3 Åben følge

Fase 2-spec'en siger "ét sted at gemme en udtagelse". Dagsboardet skriver stadig med det samme, matrixen ved Gem. Ejeren valgte 25/8 at lade boardet stå. **Forskellen skal derfor være synlig for spilleren** — matrixen viser eksplicit at der er ugemte ændringer, og hvor mange.

## 5. Beslutning: tre linser i v1 (ejer 25/8)

| Linse | I v1 | Hvorfor |
|---|---|---|
| Udtagelser | ja | Gitterets eget indhold |
| **Kun problemer** | ja | Utilgængelige ryttere der er sat på, og løb over trupgrænsen. Regnes i browseren af udtagelser + klassegrænser + binding. Ingen ny server-data |
| Belastning | ja, efter fix | Se 5.1 |
| Form og peak | hvis der er tid | Rækkestribe, ikke celle-opslag. `peak_planner_enabled` er `on` i prod (koden defaulter til off) |
| Rute-match | nej | Kun ved celle-åbning, som fase 2-spec'en allerede besluttede. Kalender-svaret bærer hverken evner eller demand-vektorer |

"Kun problemer" kommer fra spillerprototypen og er den eneste linse der finder noget spilleren ikke vidste han skulle lede efter.

### 5.1 Blocker: `raceDays` tæller etaper

`backend/routes/api.js:4444` gør:

```js
cur.raceDays += stagesByRaceId.get(e.race_id) ?? 1;
```

Feltet hedder `raceDays`, men indholdet er etapetal. Efter akse-reparationen (#4161) falder etape og løbsdag sammen, så tallet er **tilfældigt rigtigt netop nu**. Det bliver forkert i samme sekund to etaper deler en løbsdag.

Tallet står allerede i puljen på dagsboardet, hvor spillerne læser det. Fixet skal derfor ske uanset belastnings-linsen, og det er en forudsætning for den.

## 6. Beslutning: ingen kortstak i lav-data-tilstand (ejer 25/8)

Fase 2-spec'en beskrev en auto-udfyldt "Your next race day"-kortstak med Accept/Adjust før matrixen. Den bygges ikke nu.

`seasonTimeline.nextFocusDayIso` udpeger allerede den første kommende løbsdag uden udtagelse. Matrixen åbner på den dag med kolonnen fremhævet. Ingen auto-udfyldning, intet at acceptere.

**Begrundelse:** [#4201](https://github.com/NicolaiDolmer/CyclingZone/issues/4201) er en åben ejer-beslutning om assistenten skal være opt-in eller sen-udfyldning i stedet for proaktiv, og [#4200](https://github.com/NicolaiDolmer/CyclingZone/issues/4200) er bug'en hvor assistenten genudfyldte trupper spillere havde ryddet og gemt. De to udskød sæsonstarten. En proaktiv kortstak ville foregribe #4201 — og blive bygget forkert hvis svaret bliver opt-in.

Stakken er udskudt, ikke droppet. Den genbesøges efter #4201.

## 7. Komponenter

Nye:

| Komponent | Ansvar | Afhænger af |
|---|---|---|
| `SeasonMatrix.jsx` | Gitteret: kolonner, rækker, celler, virtualisering hvis aksen bliver løbsdage | `seasonTimeline.js`, kladde-hooken |
| `useSelectionDraft.js` | Kladden: lokale ændringer, diff mod server-tilstand, dirty-flag, gem | `PUT /races/selection/bulk` |
| `MatrixCell.jsx` | Én celle: rolle eller tom, låst tilstand, klik | `useSelectionDraft` |
| `CellLockPanel.jsx` | Hvorfor cellen er låst, med navngivet årsag og ét-kliks-fix | `useSelectionDraft` |
| `MatrixFilters.jsx` | De tre linser + sortering + kompakte rækker | ren props |

Genbruges uændret: `SeasonView`, `SeasonDayToggle`, `SeasonPicker`, `seasonTimeline.js`, `FitBar`, `suitability.js`, `MobileLanes`-mønstret.

`?view=` styrer gitter mod rytter-række-visning, som fase 2-spec'ens regel 6 kræver. `SeasonView.jsx:202` sletter parameteren i dag og skal sætte den i stedet.

## 8. Fejlhåndtering

- **Bulk-gem afvist:** hele sættet ruller tilbage, og de afviste ændringer markeres i gitteret med grunden fra serveren. Kladden bevares — spilleren mister ikke sit arbejde.
- **Netværksfejl under gem:** kladden bevares, knappen bliver klikbar igen, ingen tavs tilstand.
- **Slukket flag eller fejlet kald:** fladen siger hvad der er galt. Den returnerer aldrig tavst `null` — det er UI-gæld fund 5, som rammer fem flader i dag, heriblandt `StrategyPage.jsx:61`.
- **Ugemte ændringer ved fane-skift:** guard som boardets `boardDirty`.

## 9. Test

- `seasonTimeline.js` har allerede rene enhedstests; matrix-hjælperne følger samme mønster (`node --test`, ingen React).
- `useSelectionDraft` testes isoleret: diff-beregning, rollback ved afvisning, dirty-flag.
- Bulk-endpointet: enhedstest for atomicitet — ét afvist element må ikke efterlade nogen ændring skrevet.
- E2E: én spec der markerer flere celler, gemmer, og verificerer ét kald og korrekt tilstand. `verify-affected.mjs` klassificerer; TIER FULL forventes, da `lib/` og delte komponenter berøres.
- Mobil: 375px-tæthedstest mod `MobileLanes`-mønstret **før** gitteret bygges færdigt, jf. fase 2-spec'ens A5.

## 10. Hvad vi tog fra spillerprototypen

En spiller byggede 25/8 en fungerende prototype af samme gitter. Fuld gennemgang: [`.claude/learnings/2026-08-25-spillerprototype-afsloerede-to-brudte-kalender-invarianter.md`](../../../.claude/learnings/2026-08-25-spillerprototype-afsloerede-to-brudte-kalender-invarianter.md).

Taget med: begge akser samtidig · roller i cellen (C/S/B/F/D) frem for flueben · låsepanel med navngivet årsag og ét-kliks-fix ("Lozano is riding Tour des Émirats, which shares race days with Le Mur de Huy" → "Unassign from Tour des Émirats") · fodnoten som live problem-tæller ("No problems" i grønt, ellers antal) · "Kun problemer" som femte linse · cap-advarsel på løbsdags-aksen · trupstørrelse pr. klasse i cellen · roster-panel sorteret efter rolle.

Ikke taget med: hans route match `/60` er en placeholder efter hans egen note, og vi har den ægte 0-100. Hans overlap måles på spændet `d1..d2`; vores dag-mængde siden #4173 er mere korrekt.

## 11. Uden for scope

Z2, Z3, Z4 og de to skinner — de bor i fase 2-spec'en. Rytter-inspektøren, taktik-kortet og stående ordrer er ikke en del af denne fase. Modstander-linsen (B4) afventer P3.

## 12. Åbne punkter

1. **Aksen** — låses når #4236 er afgjort.
2. **Trupgrænser pr. klasse** — spillerens tal (7/8/6) skal verificeres mod vores egne før de bruges i "kun problemer"-linsen.
3. **Rolle-sættet** — C/S/B/F/D skal afstemmes med motor-sporets T1-T4-roller, så der ikke opstår to vokabularer.
4. **Boardets gemme-model** — ejer valgte at lade den stå. Genbesøges hvis to modeller viser sig at forvirre.
