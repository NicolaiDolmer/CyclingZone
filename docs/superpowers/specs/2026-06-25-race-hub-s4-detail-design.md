# Race Hub S4 — Fase 3 Løbs-detalje (Lag 2) — design

> **Status:** frosset til review · **Dato:** 2026-06-25 · **Ejer-godkendt scope:** 2026-06-25
> **Branch:** `feat/race-hub-s4-detail` (isoleret worktree fra `origin/main`)
> **Relation:** implementerer S4-rækken i programmet `2026-06-25-race-hub-program-design.md` (§4 slice-tabel, §5 S4-detaljer, §6 delt fundament) + master-designets Lag 2 (`2026-06-23-race-hub-redesign-design.md` §5). S1+S2a (#1838) og S3 (#1840) er merged + live. **Refs #1834 (klikbar løb-navigation) + #1747-ruteprofil-del.**
> **Live-blok:** nej. **Balance-gate:** nej. **Migration:** nej → AI kan selv-merge PR'en.

## 1. Formål

Gør løbet til et **førsteklasses, klikbart objekt** med en **status-bevidst detalje-flade**: er løbet kørt → resultater; ellers → ruteprofil + din opstilling. Det er rygraden (`RaceLink`) for S5 (taktik) og S6 (andre divisioner), og det direkte svar på #1834 ("løb er ikke klikbare nok; resultater er svære at finde"). Ambitionen er world-class: detaljen skal ikke bare vise data, men gøre den til **forståelse** (hvad belønner ruten, hvem af mine ryttere passer den).

## 2. Låste beslutninger (ejer 2026-06-25)

| # | Beslutning | Konsekvens |
|---|------------|------------|
| D1 | **Manager-centrisk** detalje (ikke offentlig startliste) | Kommende løb viser DIT holds opstilling via `/selection`. Ingen ny offentlig flade, ingen modstander-spionage før løb. |
| D2 | **Per-etape rute-match** | `/selection` udvides med `riders[].stageSuitability: number[]` (afledt server-side; rå evner forlader ikke serveren). Ingen migration. |
| D3 | **Kategori-visning udskudt** (#1834-del) | S4 leverer klikbart løb → detalje + direkte links. "Klik kategori → kategorivisning" tages som follow-up; #1834 holdes åben til den del. |
| D4 | **Etape-stribe overalt** | Den visuelle etape-stribe erstatter BÅDE de stablede kommende-profilkort OG tekst-etapefanerne på kørte løb → ét navigations-mønster. |
| D5 | **Opportunity-cost/friskheds-forecast udskudt** | Træthedens effekt er pt. lille (~3 %; fuld fysiologi = #1021 post-launch), så en forecast ville være lav-signal. Binding/tradeoff bor allerede på board'et (S1). S4 = forstå løbet + mit fit. |
| D6 | **RaceLink app-bredt** | Løbsnavnet gøres klikbart overalt det optræder (board, dashboard, resultater, standings, kalender/library/world, arkiv), ikke kun board+dashboard. Største discoverability-gevinst. |
| D7 | **Konsolidér, slet det erstattede** | Genbrug `RaceSelectionPanel` (forbedret) + `StageProfileSilhouette`; fjern stablede profilkort + skema-kort fra detaljen + tekst-faner. |

## 3. Arkitektur + komponenter

### 3.1 Status-bevidst landing (`RaceDetailPage.jsx`)
`deriveRaceStatus(status, stages_completed, stages)` (`frontend/src/lib/raceHubLogic.js:28`) afgør grenen:
- **completed / live** → resultater (eksisterende OverallTab/StageTab/ResultTable — uændret indhold), men navigeret via den nye `StageStripe` i stedet for tekst-faner (D4). Live viser delresultater + Live-badge (allerede).
- **scheduled** → ny kommende-flade: header (m. næste-start-countdown) → `StageStripe` → valgt-etape-panel (`StageProfileSilhouette` + `FinaleMarker` + `TerrainDNABar`) → race-DNA-gestalt → opstilling (`RaceSelectionPanel`, forbedret med per-etape rute-match).

Valgt etape styres af `?stage=N` (eksisterende `searchParams`-mønster, `RaceDetailPage.jsx:87-103`) — delelig/bogmærkbar.

### 3.2 Nye komponenter
| Komponent | Ansvar | Model/genbrug |
|-----------|--------|---------------|
| `frontend/src/components/RaceLink.jsx` | Løb som klikbart objekt → `/races/:id` (valgfri `?stage=`). `id` mangler → `<span>` (graceful). | Kopiér mønster fra `RiderLink.jsx`/`TeamLink.jsx`. |
| `frontend/src/components/race/StageStripe.jsx` | Klikbar etape-stribe: glyf + nr. + (kommende: tid + min-klarhed-prik) / (kørt: leder-/GC-markør). Leder-chip = "Overall/GC". | `StageProfileSilhouette`, `computeColumnStatus` (`raceHubLogic.js:6`). |
| `frontend/src/components/race/TerrainDNABar.jsx` | Segmenteret bar over hvad etapen belønner (top-N evner fra `demand_vector`) + labels. | `topDemands` (ny helper), bucket-i18n. |
| `frontend/src/components/race/StageDetailPanel.jsx` | Valgt-etapes silhuet + finale-markør + terræn-navn + `TerrainDNABar`. | `StageProfileSilhouette`, `profileLabelKey`, `finaleLabelKey`. |

`FinaleMarker` er et lille SVG-element (guld-flag ved mål-enden) inde i `StageDetailPanel` — ikke en separat fil medmindre den genbruges.

### 3.3 Nye pure helpers (frontend, `node --test`)
Ny fil `frontend/src/lib/stageTerrain.js` (ren `.js`, ingen JSX — så `node --test` loader den direkte, som `stageProfileConfig.js`):
- `terrainBucket(profileType)` → frontend-port af de 9→5 buckets. **Mirror af `backend/lib/raceTerrain.js`** (samme mapping); test asserterer hele mapping'en eksplicit (mønster fra `strategyLogic.test.js`). Defensiv default `"flat"`.
- `bucketCounts(stages)` → `{flat:n, hilly:n, …}` til race-DNA-gestalten ("3 bjerg · 2 flad · 1 ITT").
- `topDemands(demandVector, n=5)` → sorteret top-N `[{ability, weight}]`, ekskl. `randomness`, til `TerrainDNABar`. Tom/null → `[]`.

### 3.4 Backend-udvidelse (ingen migration)
`backend/lib/raceSelection.js` (`getSelectionContext`, :73-133): den loader allerede `race_stage_profiles.demand_vector` pr. etape (:79) + `rider_derived_abilities` (:93). `suitabilityScore` (`raceAutopick.js:33`) snitter allerede per-etape-`terrainScore`. **Ekstrahér** en pure helper der returnerer **per-etape-arrayet** (ikke kun snittet) og eksponér som `riders[].stageSuitability: number[]` (0-100, samme skala som `suitability`). Eksisterende `suitability` (løb-snit) bevares som fallback. Rå evner sendes IKKE til klienten. `node --test` for helperen + endpoint-form.

### 3.5 demand_vector til klienten (ingen migration/GRANT)
`race_stage_profiles` er allerede klient-læsbar (RLS `SELECT TO authenticated USING (true)`, ingen kolonne-revoke — verificeret i `database/2026-06-06-race-stage-profiles.sql:41`). `RaceDetailPage`'s eksisterende `.select("stage_number, profile_type, finale_type")` (:134) udvides med `demand_vector`. Det driver `TerrainDNABar` selv når man ikke deltager/ikke er logget korrekt på `/selection`.

## 4. Data-flow

```
RaceDetailPage(raceId)
  ├─ races (direkte): id,name,race_type,race_class,stages,stages_completed,status,season,pool_race   [eksisterer]
  ├─ race_stage_profiles (direkte): stage_number, profile_type, finale_type, demand_vector           [+demand_vector]
  ├─ race_results (direkte, paginERET): kun ved kørt/live                                            [eksisterer]
  └─ GET /api/races/:raceId/selection (eget hold): riders[{suitability, stageSuitability[], form,
                                                    fatigue, role}], selection, size                  [+stageSuitability]
```

- Etape-valg (`?stage=N`) → vælger hvilken `demand_vector` (DNA-bar) + hvilken `stageSuitability[N-1]`-kolonne (rute-match i opstilling).
- **Graceful degrade:** mangler `demand_vector` → skjul DNA-bar; mangler `stageSuitability` → fald tilbage til løb-snit-`suitability` i `FitBar`; deltager ikke / `/selection` ikke tilgængelig → vis profil + DNA uden opstilling (ingen fejl-UI). One-day-løb: ingen stribe (1 etape) — vis panelet direkte.

## 5. Konsolidering (hvad fjernes/erstattes — præcist)

| I dag (`RaceDetailPage.jsx`) | Handling | Hvorfor |
|------------------------------|----------|---------|
| Stablede `StageProfileCard` pr. etape, kommende-gren (:246-252) | **Slettes** | Erstattet af `StageStripe` + `StageDetailPanel` (én profil ad gangen, valgbar). |
| `StageScheduleCard` på detaljen (:238-240) | **Fjernes fra detaljen** | Per-etape-tider foldes ind i striben; næste-start-countdown i headeren. Komponenten **beholdes** (Dashboard bruger den — verificeret). |
| Tekst-`TabButton`-etapefaner, kørte løb (:277-286) | **Erstattes** af `StageStripe` (D4) | Ét konsistent navigations-mønster; terræn synligt pr. etape. |
| `StageProfileCard`-wrapper i resultat-faner (:298, :353) | **Beholdes** | Stadig brugt i StageTab/one-day-resultat. Kun den stablede kommende-liste fjernes. |
| `StageProfileSilhouette` (:413) | **Genbruges** | Tegnes inde i `StageStripe` + `StageDetailPanel`. |
| `RaceSelectionPanel` | **Forbedres, ikke erstattes** | Eneste importør er `RaceDetailPage` (verificeret) → sikkert at tilføje per-etape rute-match (`FitBar` mod valgt etape). |
| Hårdkodet back-link `→ /races?tab=library` (:193, :207) | **Gøres kontekst-bevarende** | Tilbage hvor man kom fra (board-dag / dashboard) via referrer-param eller history. |

## 6. World-class (kurateret — inkluderet i S4)

1. **Etape-striben = kontroltårn.** Hver chip: terræn-glyf + nr. + (kommende) starttid + **min-klarhed-prik** (`computeColumnStatus`: fuld/underbemandet) / (kørt) leder-markør. Navigation + status + terræn i ét.
2. **Race-DNA-gestalt.** Én linje over striben: "Dette løb: 3 bjerg · 2 flad · 1 ITT" (fra `bucketCounts`) + dominerende karakter. Helheden før man driller ned.
3. **Terrain DNA-bar pr. etape.** Ægte `demand_vector` → top-N evner ruten belønner, editorial bar + labels. Skjult-engine-transparens (spec §6.3).
4. **"Why this rider"-linje.** Pr. rytter i opstillingen, koblet til etapens top-krav: "Klatrer godt (92) — passer denne bjergafslutning". Gør tallet til forståelse (delt hint, spec §6.3).
5. **Best-fit-nudge.** Fremhæv automatisk dit stærkeste valg til den valgte etape (max `stageSuitability`).
6. **Finale-markør på silhuet.** Lille guld-markør + label ved målet (`finale_type`).

## 7. Discoverability (RaceLink-breddе, D6)

`RaceLink` hookes ind hvor løbsnavne optræder:
- `RaceHubBoard.jsx:54` (kolonne-header) — **højest værdi:** board↔detalje-loopet (fordel trup → klik løb → se DNA/fit → tilbage).
- `DashboardPage.jsx:720` ("Kommende løb" → direkte til løbet i stedet for hub).
- Resultater/standings/kalender-faner/arkiv hvor et løbsnavn vises (sweep — hold konsistent med `RiderLink`/`TeamLink`).
- Kontekst-bevarende tilbage-navigation fra detaljen.

## 8. Test

- **Backend `node --test`:** ny per-etape-suitability-helper (per-etape-array ≡ komponenterne i det eksisterende snit; defensiv ved tom demand_vector) + `/selection`-form (`stageSuitability` til stede, længde = `stages`).
- **Frontend `node --test`:** `stageTerrain.js` — `terrainBucket` (9→5 mapping eksplicit, drift-guard mod backend), `bucketCounts`, `topDemands` (sortering, randomness ekskl., tom input).
- **Playwright core-smoke alle 3 projekter** (desktop-chromium + mobile-chromium + mobile-webkit) + **snapshot-refresh** (visuel ændring på detalje- og resultat-navigation).
- **Hele CI-gate-sættet** (`verify-local.ps1` + `npm run lint` + i18n-leak + tone-em-dash + warning-budget).

## 9. Uden for scope (YAGNI)

Offentlig startliste (D1) · kategori-visning (D3) · Lag 3 taktik (S5 — kun link/indgang) · opportunity-cost/forecast (D5) · målt højdeprofil (#1021) · DB-migration.

## 10. Proces + accept

- [ ] `RaceLink.jsx` + hook i board-header + dashboard + sweep (resultater/standings/kalender/arkiv).
- [ ] `StageStripe` erstatter stablede kommende-profilkort OG tekst-etapefaner (kørt) — gammelt slettet.
- [ ] `StageDetailPanel` (silhuet + finale-markør + `TerrainDNABar`) + race-DNA-gestalt.
- [ ] `RaceSelectionPanel` forbedret: per-etape rute-match (`FitBar` mod valgt etape) + "why this rider"-linje + best-fit-nudge.
- [ ] Backend `/selection` + `stageSuitability[]`; `RaceDetailPage` henter `demand_vector`.
- [ ] `StageScheduleCard` fjernet fra detaljen (tider i stribe, countdown i header); komponent beholdt til dashboard.
- [ ] Kontekst-bevarende back-link.
- [ ] Graceful degrade verificeret (ingen demand_vector / ingen /selection / one-day / ikke-deltager).
- [ ] TDD grøn + hele CI-gate-sæt + playwright alle 3 + snapshot-refresh.
- [ ] Patch notes v6.11 + help.json (en+da): løbs-detalje/ruteprofil/terrain-DNA.
- [ ] Design: navy/guld/Bebas, editorial, INGEN AI-slop. Copy EN-først, DA-under.
- [ ] PR med fuld Brugerverifikation. Markér #1834/#1747 efter merge.

## 11. Åbne verifikations-punkter (afklares i plan/build, ikke blokerende)

- **`/selection`-tilgængelighed:** panelet gater på race-engine-flaget (`RaceDetailPage.jsx:255`). Verificér flag-tilstand i prod, så opstilling+rute-match faktisk renderes for managere; ellers degraderer detaljen til profil+DNA (gyldig tilstand).
- **i18n-nøgler:** evne-navne (climbing/sprint/…) til DNA-bar + "why this rider"-skabelon → `races.json` (en+da); genbrug eksisterende `strategy.buckets.*`-labels hvor muligt.
- **Snapshot-omfang:** stribe-ændringen rører både kommende OG resultat-visning → forvent flere snapshot-diffs; kør alle 3 projekter.
</content>
</invoke>
