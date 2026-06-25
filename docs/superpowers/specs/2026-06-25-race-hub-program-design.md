# Race Hub + afvikling — eksekverings-program (design)

> **Status:** frosset til review · **Dato:** 2026-06-25 · **Ejer-godkendt scope:** 2026-06-25
> **Relation:** eksekverings-SSOT der binder master-designet `2026-06-23-race-hub-redesign-design.md` (6-faset redesign, Fase 0+1 shippet via #1802) sammen med (a) Fase-1 bugfixes, (b) afvikling-stabilisering, (c) akademi op/ned (#932). Fase 2-5's *indhold* er specificeret i master-designet; dette dokument tilføjer det nye + sekvens + de låste beslutninger.
> **Hærdet med:** design-hardening-workflow 2026-06-25 (4 verifikations-agenter + 7 idé-agenter + kritiker) — korrigerede rod-årsager + kuraterede world-class forbedringer er foldet ind nedenfor.

## 1. Formål

Gøre løbs-oplevelsen world-class: den daglige loop (udtag trup → afvikl løb → se resultat) skal virke fejlfrit, og de planlagte race-hub-lag (Holdstrategi, løbs-detalje, taktik, andre divisioner) skal bygges færdige. Ambition: et af de bedste cykel-managerspil i verden.

## 2. Korrigerede rod-årsager (fra hardening — VIGTIGT, erstatter tidligere antagelser)

1. **#1823 "auto-udfyld dobbeltallokerer ved overlap" — rod-årsag IKKE bekræftet.** Kernen `assignTeamAcrossRaces` (`backend/lib/raceEntryGenerator.js:23-53`) binder overlappende løb korrekt og har en grøn test (`raceEntryGenerator.test.js:25-33`). `excludeRaceIds` er korrekt design, ikke en fælde. **Hvis dobbeltbooking ses i prod, ligger årsagen et andet sted:** (a) manglende `race_stage_schedule`-rækker → `raceTimeWindow` returnerer null → overlap ikke detekteret, eller (b) auto-filled entries i ikke-synlige men tidsoverlappende løb låses ikke under regenerate (`raceDistribution.js:63` springer `is_auto_filled` over). → **S1 skal reproducere mod prod-data FØR kode røres.**
2. **#1823 "kan ikke skifte kaptajn" — IKKE en bug.** Der findes ingen UI til kaptajn-/rolle-skift; `RaceColumn.jsx` viser roller read-only og `putSelection` sætter altid `captain_id = riderIds[0]`. Det er en **manglende Fase-1-feature**, ikke en regression.
3. **#1823 "gemmes ikke / kan ikke fjerne" — BEKRÆFTET.** `RaceHubBoard.jsx:70` (`putSelection`) inspicerer aldrig `res.ok`; backend returnerer 400/409 (`selection_wrong_size` 1623, `selection_wrong_pool` 1606, `selection_race_not_open` 1600, `selection_rider_bound` 1634) som swallowes → board reloader uden fejlbesked. `removeRider` der bringer truppen under min-størrelse rammer 400 og ruller stille tilbage. Samme mønster i `toggleWithdraw` + `regenerate`.
4. **Afvikling-status — BEKRÆFTET.** `races.status` forbliver `'scheduled'` hele afviklingen (kun `stages_completed` bumpes; `raceRunner.js:826`); enum-værdien `'active'` sættes aldrig. Frontend læser kun `status` → igangværende løb vises som "Kommende". **Fix: afled en tredje visnings-status i frontend fra `stages_completed`; skriv IKKE `'active'` i backend (finalization-invarianter).**
5. **Tæller — BEKRÆFTET.** `seasonRaceDays.js:17` summerer kun `status='completed'` og er sæson-global, ikke per-pulje. **Fix: per-pulje, klient-side `sum(stages_completed) / sum(stages)` for managerens pulje, inkl. igangværende etaper. Ingen migration.**
6. **Trup-frysning — BEKRÆFTET-med-nuance.** `PUT /selection` gater allerede på `status!=='scheduled'` (`api.js:1600`), men da status forbliver `'scheduled'` mellem etaper kan en manager redigere midt i et igangværende etapeløb, og `buildRaceResults` re-simulerer fra etape 1 med faste seeds → ændret startfelt gør viste etaperesultater inkonsistente. **Fix: gate på `stages_completed>0` (fejlkode `selection_race_started`); `entrant_snapshot` persisteres allerede (`raceRunner.js:215`).**
7. **Sync-drift (prod 2026-06-25):** 7 aktive puljer, ingen mangler skema-rækker. To puljer (tier1/pulje0, tier3/pulje2) er 2 løbsdage foran de øvrige 5. Puljerne har **forskellige kalender-totaler** (34-60 løbsdage), så "samme etape overalt" er umuligt uden rekalibrering. Driften stammer fra 23/6-rodet (uensartet pause).

## 3. Låste beslutninger (ejer 2026-06-25)

| # | Beslutning |
|---|------------|
| D1 | **Auto-udfyld:** spilleren vælger "Udfyld kun manglende" eller "Udfyld alt" (to-tilstands-knap; `?mode=missing\|all`). |
| D2 | **Tæller:** løbsdage kørt / sæsonens løbsdage (inkl. igangværende etaper). I dag = puljens faktiske total; efter rekalibrering = 140. |
| D3 | **Sync-model (REVIDERET):** alle divisioner/puljer skal have **140 løbsdage**, **5 løbsdage/dag**, og **alle rykker 1 løbsdag synkront** (global cursor). → kræver fuld 140-rekalibrering (#1712) + cursor-mekanik. **Balance-følsom → sim-før-ship → egen slice (S2b), ikke i dag.** |
| D4 | **Scope i dag:** S1 + S2a (live-blokerende). Build-out (S3/S4/S5/S6) + akademi op/ned (S7) + S2b følger i efterfølgende sessioner. |
| D5 | **Akademi-demote berettigelse:** kun U23 (`ageForSeason <= 22`), ejet rytter, ikke pending auktion/transfer; via RPC under `pg_advisory_xact_lock(team_id)` der tjekker akademi-8-cap, gen-beregner løn ned til ungdomsrate, sletter fremtidige `race_entries`. (Anbefalet af hardening.) |
| D6 | **A-kæde:** RANGORDNET liste (ikke sæt) — array-index er tiebreak, bevarer generatorens determinisme. (Anbefalet af hardening.) |

## 4. Slice-program + sekvens

| Slice | Indhold | Issue | Størrelse | Live-blok | Balance-gate |
|-------|---------|-------|-----------|-----------|--------------|
| **S1** | Fase 1 fixes: synlige gem-fejl, kan fjerne/skifte rolle, dual-mode auto-udfyld, kaptajn-/rolle-UI | #1823 | S-M | 🔴 | nej |
| **S2a** | Afled "I gang"-status, løbsdage-tæller, trup-frysning ved løbsstart | #1828, #1829, (#1825-del) | M | 🔴 | nej |
| **S2b** | Global løbsdags-cursor (synkron afvikling) + 140-rekalibrering | #1825, #1712 | L | — | **JA (sim)** |
| **S3** | Fase 2 Holdstrategi (Lag 0): A-kæde, faste roller, kaptajn 1/2/3 pr. terræn, mål-løb + generator-integration | race-hub epic | L | — | nej* |
| **S4** | Fase 3 Løbs-detalje (Lag 2): klikbart løb → ruteprofil + opstilling | #1834, #1747-del | M | — | nej |
| **S5** | Fase 4 Taktik (Lag 3): rolle-tildeling + fit/typer + skjult-engine-hints | #1747 | M | — | nej |
| **S6** | Fase 5 Andre divisioner (read-only): pulje-vælger + read-only board | #1835 | S-M | — | nej |
| **S7** | Akademi op/ned: manuel promote + demote (U23) | #932 | M | — | nej |

\* S3 er ikke balance-følsom, men generator-ændringen SKAL have en idempotens-/determinisme-test (`strategy=null` ≡ uændret adfærd).

**Rækkefølge i dag:** S1 + S2a (én stabiliserings-session). Derefter parallelt via subagents: S7 (uafhængig), S3 (tungest, feeder resten), S4/S5/S6 oven på board'et. S2b når sim-harness + ejer-go er klar.

**Afhængigheder:** S4 (klikbart løb / RaceLink) er rygrad for S5/S6's navigation. S3's generator-strategi læses både i `runRaceEntryGenerator` og Fase-1's `regenerate`-endpoint. S7's `is_academy`-flip er kontaktpunkt til board'ets population.

## 5. Slice-detaljer

### S1 — Fase 1 fixes (#1823)
**Loci:** `frontend/src/components/racehub/RaceHubBoard.jsx` (putSelection/removeRider/toggleWithdraw/regenerate), `RaceColumn.jsx`, `AvailableRidersPool.jsx`, `AddRiderPopover.jsx`, backend `PUT /selection` + `POST /distribution/regenerate` (`api.js`), `races.json` (en+da).
**Accept:**
- [ ] **REPRO FØRST:** reproducér (eller afkræft) dobbeltallokering mod prod-data; log `windowByRace` for de to løb før kode. Hvis reel: luk auto-lock-hullet for ikke-synlige overlappende auto-filled løb.
- [ ] `putSelection`/`removeRider`/`toggleWithdraw`/`regenerate` tjekker `res.ok`, parser fejlkode, viser besked (toast/inline), beholder optimistisk rollback.
- [ ] Fejlkoder mappet til races-i18n (`selection_wrong_size/_wrong_pool/_rider_bound/_race_not_open`).
- [ ] Kaptajn-/rolle-vælger i `RaceColumn` (klik rytter → captain/sprint_captain/hunter) → eksplicit `captain_id` i PUT.
- [ ] Dual-mode auto-udfyld (D1): `?mode=missing|all`; `missing` springer manuelt-udtagne kolonner over (folder dem ind i `lockedWindows`).
- [ ] Regenerate gøres transaktionel (delete+insert) så fejl ikke efterlader 0 entries.

**World-class (kurateret):**
- *core* Suitability-fit som primært signal i kolonne + pulje (farve-bar + score; `ctx.riders.suitability` sendes allerede, vises ikke).
- *core* Navngiv bindingen: "Locked — racing in {løbsnavn}" i stedet for generisk lås.
- *core* Smart popover: ranger mål-løb efter fit + flag underbemandede + vis fit pr. løb.
- *polish* Visuel adskillelse assistent-forslag vs. manuelt (`is_auto_filled`-eyebrow).
- *polish* Læsbar friskheds-skala (erstat magisk `fatigue>50` med pure helper + delt indikator).

### S2a — Afvikling-stabilisering (#1828, #1829, frys)
**Loci:** ny pure `deriveRaceStatus()` i `frontend/src/lib/raceHubLogic.js`, `DashboardPage.jsx`, `RaceDetailPage.jsx`, `RacesPage.jsx` (status-badge), klient-side tæller (genbrug `seasonRaceDays`-mønster men per-pulje), backend `PUT /selection` freeze-gate (`api.js:1600`).
**Accept:**
- [ ] `deriveRaceStatus(status, stages_completed, stages)` → "Live" når `status='scheduled' && 0<stages_completed<stages`. Backend uændret (ingen `'active'`-write).
- [ ] Igangværende etapeløb vises "I gang" + etape-fremdrift (etape X/Y) + countdown til næste etape på Dashboard + RaceDetailPage.
- [ ] Tæller: løbsdage kørt (inkl. igangværende) / puljens samlede løbsdage (D2).
- [ ] Frys: `PUT /selection` afvises når `stages_completed>0` (`selection_race_started`); verificér at service_role-autofill ikke rammes. Synlig "Lineup locked"-tilstand i board.

**World-class (kurateret):**
- *core* Ægte "In progress"-status med live etape-fremdrifts-bjælke (`deriveRaceStatus` + delt bjælke).
- *core* Synlig "Lineup locked" + uændret-snapshot-garanti (`entrant_snapshot` findes).
- *polish* Tæller viser også "Y i gang" (ærligt mellemregnings-tal).

### S2b — Sync + 140-rekalibrering (#1825 + #1712) — EGEN SLICE, SIM-GATE
**Indhold:** global løbsdags-cursor (alle puljer rykker 1 løbsdag pr. slot, 5/dag), fuld 140-løbsdags-kalender pr. pulje, engangs-genjustering af de 2 forude-puljer. **Kræver sim-harness (140 løbsdage: præmie/træthed/form/standings) + ejer-go FØR ship.** Migration → ejer merger.
**Åbent punkt:** identiske RACES pr. pulje vs. identisk STRUKTUR (140 dage/5-per-dag/synkron, men forskellige løb pr. pulje). Anbefaling: ét master-140-kalender-template instantieret pr. pulje (samme profiler/dage, separate race-rækker pr. pulje for egne resultater/standings). Afklares når S2b planlægges.

### S3 — Fase 2 Holdstrategi (master-design §5 Lag 0)
**Datamodel (fra hardening):** to tabeller — `team_race_strategy` (PK team_id, JSONB `a_chain` rangordnet array, `captain_priorities` objekt pr. terræn-bucket, `target_race_ids` array) + `team_rider_role_rules` (PK (team_id, rider_id), `role_rule` CHECK in 'always_captain'/'always_sprint_captain_if_present', FK+CASCADE). RLS: read authenticated (egen team), write service_role. **Migration → ejer merger.**
**Generator:** `assignTeamAcrossRaces({..., strategy=null})` — strategi videreføres til `autopickTeamSelection` som deterministisk præference-lag (a-kæde-rang → score → rider_id). `strategy=null` ≡ bit-for-bit uændret (idempotens-test KRÆVET). Delt `terrainBucket(profile_type)` (9 profiltyper → 5 buckets) som ny pure export. Stale rider_id filtreres tavst mod faktisk trup.
**World-class (kurateret):** *core* live preview-diff ("sådan ændrer din strategi udtagelserne"); *core* kaptajn 1/2/3-board med ægte egnethedsdata + auto-foreslå; *core* A-kæde som rangordnet pecking-order.

### S4 — Fase 3 Løbs-detalje (#1834, #1747-ruteprofil)
**World-class (kurateret):** *core* status-bevidst løbs-detalje + RaceLink fra board (rygrad for #1834); *core* demand-vector "terrain DNA"-bar pr. etape (viser hvilke evner ruten belønner — ægte `demand_vector`-data); *core* per-rytter rute-match i opstilling (suitability mod etape-krav); *polish* klikbar etape-stribe; *polish* finale-markør på silhuet.

### S5 — Fase 4 Taktik (#1747)
**World-class (kurateret):** *core* rolle-tildeling som klikbare rytterkort (ikke dropdowns); *core* profil-bevidst rolle-hint (hvorfor rollen passer terrænet); *core* suitability som terræn-egnethedsbar (det delte fit-tema); *core* "Jæger"-rollen forklaret som reel udbruds-mekanik (terræn-betinget chance).

### S6 — Fase 5 Andre divisioner (#1835)
**World-class (kurateret):** *core* pulje-vælger der genbruger StandingsPage's tier→pulje-træ; *core* samme overlap-kolonne-board read-only for fremmed pulje (`buildColumnSet` er allerede pulje-parametriseret); *core* read-only eksplicit + forklaret (genbrug ContextBand's disabled-pill-mønster).

### S7 — Akademi op/ned (#932)
**Loci:** ny `backend/lib/academyTransfer.js` (genbrug `resolveGraduation`-byggeklodser, men kald den IKKE direkte — den kræver pending grad-row). Promote: cap-guard + `is_academy=false` + `computeFrozenSalary` + resolv evt. pending `academy_graduation`-row til 'promoted' (ellers dobbelt-kører sweepet). Demote (D5): RPC under advisory-lock. Frontend: AcademyPage + holdside. **Migration (RPC) → ejer merger.**
**World-class (kurateret):** *core* konsekvens-bevidst promote/demote-confirm (cap + løn-delta + løbs-effekt i én rude); *core* sammenhængende akademi↔board-loop (promoverede dukker op i pulje med "new"-markør); *polish* race-readiness-gauge (p10-p90 anlægs-bånd — kræver ny derivation).

## 6. Delt fundament (byg ÉN gang, genbrug på tværs — fra hardening cross-cutting)

1. **Fit-komponent:** én editorial suitability-bar (navy/guld + ord-anker Strong/Average/Poor). Genbrug i S1, S3, S4, S5. Datakilde `ctx.riders.suitability` (`raceSelection.js:109`).
2. **`deriveRaceStatus()` + fremdriftsbjælke:** én pure helper (0<stages_completed<stages = "Live"). Genbrug i S2a-chip, tæller-segment, S6-liga-bånd.
3. **"Why this role / why this rider"-hint:** én delt helper koblet til `race_stage_profiles`. Genbrug i S3, S4, S5 (skjult-engine-transparens: beskyttet leder, udbruds-odds pr. finale_type).
4. **RaceLink-mønster:** løbet som førsteklasses klikbart objekt med status-bevidst landing (resultater hvis kørt, ellers profil). Rygrad i S4; genbrug i S2a, S6.
5. **`terrainBucket(profile_type)`:** 9 profiltyper → 5 strategi-buckets, ét sted (ny pure export).
6. **Pure node --test-helpers:** ekstrahér tærskel-logik (friskheds-buckets, fit-formatering) frem for inline-tal (fx `RaceColumn.jsx:55` magisk `fatigue>50`).
7. **StandingsPage-vokabular:** genbrug `DIV_VARS`/tier→pulje-træ i S6 (opfind ikke nye farver).

## 7. Åbne punkter (afklares ved slice-planlægning)

- S1: dobbeltallokering-repro mod prod — reel bug eller ej?
- S2b: identiske races vs. identisk struktur pr. pulje (140-kalender).
- S7: demote-løn — gen-beregn ned til ungdomsrate; kontrakt-felter ved demote.
- S3: AI-holds forslag — samme generator eller lettere variant (master §8).

## 8. Proces (gælder alle slices)

- **Worktree-isoleret** (`.claude/worktrees/feat+race-hub-redesign` eller ny via `scripts/new-worktree.ps1`); branch fra `origin/main`.
- **`database/*.sql` auto-applies i prod ved merge → EJER MERGER** disse PR'er (S2b, S3, S7).
- **S2b er balance-følsom → sim-før-ship** (140-løbsdags ekstrapolering, jf. memory-regel).
- **Verificér-før-claim:** runtime/prod-tjek før "done"; reproducér fejl lokalt før fix.
- **Per slice:** TDD (`node --test` backend + frontend), CI-gate-sæt (lint + i18n-leak + tone + warning-budget), playwright core-smoke alle 3 projekter ved visuel ændring + snapshot-refresh.
- **Patch notes** (`PatchNotesPage.jsx`) + **help.json (en+da)** ved enhver brugerrettet ændring.
- **Design-smag:** editorial, navy/guld/Bebas, ægte cykel-data, INGEN AI-slop (ingen rounded-2xl/glow/emoji-ikoner/gradient-blobs). Player-facing copy EN-først, DA-under.
- **Markér issue `claude:todo`→`claude:done`** straks efter merge, PR-for-PR.
