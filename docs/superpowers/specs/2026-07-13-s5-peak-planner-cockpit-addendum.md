# S5 Addendum — Peak-planner cockpit + trænings-kobling (Season Planner)

**Status:** Design-spec til ejer-review — INTET er implementeret, ingen migrationer anvendt.
**Dato:** 2026-07-13
**Parent-spec:** [`2026-07-11-race-engine-depth-credibility-design.md`](2026-07-11-race-engine-depth-credibility-design.md) — §10 (S5 form-peaks), §11.4 (`rider_peak_plans`), §13 (S5-rækken), §16.4 (ejer-beslutning: 2 peaks/rytter/sæson, ren kalender-mekanik i v1).
**Ejer-issues:** #2224 (race-engine-dybde) · S5-slice. Ny/opdateret issue oprettes ved lås.

Dette tillæg **udvider S5** fra parent-spec'ens enkeltlinje ("Peak-planer: API + trænings-UI") til en dedikeret **Season Planner-side** (cockpit), og **rykker trænings-koblingen fra v2 til v1** (ejer 2026-07-13: "koblingen er hele pointen"). Alt andet i parent-spec'en står ved magt.

---

## 1. Hvorfor større scope end parent-spec'en

Parent-spec'en §10 lagde S5 som en lille flade på træningssiden + ren kalender-bonus. Ejer-review 2026-07-13 låste tre ting der gør fladen større og bedre:

1. **Ét beslutnings-sted (cockpit), ikke fane-hop.** Manageren skal se rating, ryttertype, nation, akademi-status, rute-profiler OG overlap fra ét sted, og planlægge **hele holdet på én gang**.
2. **Trænings-koblingen er v1, ikke v2.** En peak må ikke være en gratis kalender-bonus; dens kvalitet skal *tjenes* gennem træning i optakten. Det er det der løfter systemet fra "spreadsheet-bonus" til troværdig sport.
3. **Dedikeret Planner-side** (ejer-valg), ikke en fane på TrainingPage.

---

## 2. Kerne-mekanik — peak + trænings-kobling (v1)

**Peak-vindue (uændret fra parent §10):** manager udpeger op til **2 peak-vinduer pr. rytter pr. sæson**, hvert rettet mod et **mål-løb**. Vinduet snapper til ~5 dage omkring løbet (spec §10: 4-6 dage). Låses senest **3 dage før vinduets start**. `peak`-komponenten lægges oven på `finalScore` (parent §9: `... + peak - fatigue ...`) og persisteres i `race_simulation_rider_scores.components.peak`.

**Payback (uændret):** `-PAYBACK` i N dage efter vinduet (formhul). Betales **fuldt uanset træningskvalitet** — taper er et lån.

**Trænings-koblingen (NY i v1):** de `+PEAK_MAX` er et **loft**, ikke en garanti:

```
peak_realiseret = PEAK_MAX × trainingQuality(rytter, optakts-vindue)
payback         = PAYBACK                       // uafhængig af trainingQuality
```

`trainingQuality ∈ [0,1]` udledes af **eksisterende træningssignaler** i optakten (build→taper-blokken), ingen ny daglig mekanik:
- **Konsistens:** andel af optakts-dage der faktisk blev trænet (ikke sprunget). Bruger `training_day_runs` + konsistens-bonus-signalet (`todayRun.bonus_applied`).
- **Fokus-match:** trænede rytteren evner relevante for mål-løbets profil (climber→climbing før et bjergløb)? Bruger `TRAINING_FOCUS_ABILITIES` + løbets terræn.
- **Sundhed:** skade i optakten (`rider_condition.injured_until`) reducerer.
- **Trætheds-styring:** at ramme taper med for høj fatigue reducerer (kernen i periodisering).

Præcise vægte + `PEAK_MAX`/`PAYBACK`/N **tunes i harnesset** (§6), ikke her. Mål-tal fra parent §12-scorecard bevares; peak må ikke bryde eksisterende bånd.

**Auto-foreslået træningsblok (anti-micromanagement):** når en peak sættes, genererer Planneren en foreslået build→taper-uge-rytme for rytteren (skriver til de eksisterende `training_plans` / uge-rytme #1895) som manageren kan **acceptere eller finjustere** på TrainingPage. Default periodiserer for dig. Dette ER broen mellem Planner (strategi) og TrainingPage (udførelse).

**Game-design-begrundelse (til postmortem/undervisning):** Planner = strategi (hvor/hvornår), TrainingPage = udførelse (daglig hvordan), form = tjent output. Opportunity-cost er ægte: build koster træthed + kalender, payback rammer efter, og maks 2/sæson tvinger valg. Bygger mod CTL/ATL (#931): form = fitness − træthed; peak = drop træthed (taper) mens fitness er høj.

---

## 3. UI — Season Planner (Direction E, låst)

Dedikeret side (`/planner`, egen menu-rute). To lag:

**A. Master-canvas (altid synligt) — kampagne-bræt:**
- Én lane pr. rytter. Venstre: nation, navn, **OVR-rating** (`riderOverallRating`, IKKE potentiale — ejer 13/7), ryttertype, akademi-mærke.
- Midten: rytterens **formkurve** hen over den fælles sæson-kalender. **Potentiel top** (stiplet) vs **realiseret top** (fyldt) — forskellen = tabt form af utilstrækkelig træning (koblingen gjort synlig i heltet). Payback-hul under baseline. Build/taper-blok som navy-skygge (in-palette). **NOW-markør** med rytterens nuværende form forankret på kurven (adskilt fra OVR).
- Højre: peak-tokens (0-2) + **trænings-status-chip** ("✓ Taper on track" / "↓ Peak at risk").

**B. Kontekst-skuffe (drill-down):**
- Klik et **løb-hoved** → race-fokus: rute-profil (terræn-glyf + stages/nøgleklatringer) + dine ryttere **rangeret efter egnethed** mod profilen + **rival-neutralisering** (antal rivaler der topper samme løb).
- Klik en **rytter** → rytter-fokus: evne-barer + den foreslåede træningsblok pr. peak med "Auto-plan training".

**Interaktion:** klik en prik på en lane for at toppe/aftoppe. Drag-and-drop af peak-vinduet er et build-krav (§5).

Palette/typografi: chalk `#f4f2ec` / gold `#e8c547` / navy `#1a1f38`, Bebas display + DM Sans + Inter Tight data. Ingen tredje farvefamilie (kritik-fund: byg/taper skal være navy, ikke blå).

---

## 4. Datamodel — refinement af parent §11.4

Parent `rider_peak_plans` udvides med **mål-løb** (så cockpittet er race-centrisk + story-tag `perfect_peak` kan matche):

```sql
CREATE TABLE IF NOT EXISTS rider_peak_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id       uuid NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  season_id      uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  target_race_id uuid REFERENCES races(id) ON DELETE SET NULL, -- hvad du sigtede mod (UI + story)
  window_start   date NOT NULL,   -- afledt (snap ~5 dage om mål-løbet); motoren læser disse
  window_end     date NOT NULL,
  locked_at      timestamptz,     -- sat 3 dage før window_start; NULL = redigerbar
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end >= window_start)
);
-- Maks 2 pr. (rider, season): håndhæves i API (count-check) + harness-oracle.
-- RLS: SELECT/write for holdets ejer (join riders→teams.owner_id) + service_role.
```

`window_start/end` er **datoer** (ikke game-days): kalenderen mapper allerede game-day → ISO-dato server-side (`/api/races/calendar`), og motoren sammenligner etape-dato mod vindue. Konsistent med parent §11.4's `date`-kolonner.

---

## 5. Build-krav foldet ind fra design-kritik (13/7)

Disse er for store til en mockup, men SKAL med i React-buildet:

1. **Trækbart peak-vindue** (ikke kun klik-prik): bracket med håndtag på lanen, snap til mål-løb, respektér `locked_at`. Den "lækre" drag-UX ejer bad om.
2. **Overlap/konflikt synligt:** advarsel når (a) payback-vinduet rammer et løb rytteren skal køre, (b) mål-løbet clasher med et andet løb samme dag (jf. "1 rytter = 1 løb/dag"-invarianten). Chip på lane + i race-skuffe.
3. **Mobil:** master-brættet er 3-kolonne-grid — kræver et stakket mobil-spor (lane → tap åbner sheet). Ikke en detalje; eget verify-pass (alle 3 Playwright-projekter).
4. **Tilgængelighed:** peak-mål ≥24px touch + keyboard/fokus-states (SVG-prikker er mus-kun i mockup); farve-kodning får tekst/ikon-redundans (↑ peak / ↓ payback, ✓/↓ på status-chips); labels ≥10-11px; kontrol af `--t3`-kontrast på chalk.
5. **Tom-/first-run-tilstand:** 0 peaks = flade streger uindbydende → tom-tilstand der lærer mekanikken + "foreslå peaks"-nudge.
6. **Tids-proportional kalender-akse** med måneds-ticks + i-dag; filter "mine løb / alle".
7. **Egnetheds-transparens:** tooltip på egnetheds-prikkerne der mapper profil → rytterens matchende evner (lærer + retfærdiggør).

---

## 6. Harness + gates (følger parent §12/§13)

- **Peak-neutralitets-oracle (parent §12.4):** to modsatte peak-planer må ikke begge dominere.
- **Trænings-koblings-scorecard:** `peak_realiseret` skal skalere monotont med `trainingQuality`; "Behind"-rytter (lav tq) får målbart mindre top end "on track" (høj tq), payback ens. Kør 3 seeds × prod-population-snapshot.
- **Determinisme/idempotens:** flag-off (`race_engine_v3_scoring`) bit-identisk (peak=0 uden plan). Samme seed → samme output.
- **Eksisterende bånd (parent §12) forbliver grønne.**

---

## 7. Byggerækkefølge (S5, egne PR'er; migration merges manuelt af ejer)

1. **Migration** `rider_peak_plans` (§4) — committes, ejer anvender post-merge.
2. **`racePeaks.js`** (ny, ren): peak/payback-komponent + `trainingQuality`-udledning; wiring i `raceSimulator.js` + `raceRunner.js` (peak ind i `components`). Bag `race_engine_v3_scoring`.
3. **API** (CRUD peak-plans: maks 2, snap-vindue, lock 3 dage før) + auto-foreslået træningsblok-skrivning.
4. **Harness** (§6) → kalibrering → ejer-go.
5. **Planner-side** (React-cockpit, Direction E polished) — verificeret på preview med ægte ryttere/løb; §5-build-krav; patch note + help/FAQ (en+da).

Hver slice: eget PR-flow, harness-gate. Migration ALDRIG auto-apply.

---

## 8. Åbne ejer-spørgsmål (ved lås)

1. **Rute-profil-dybden i race-skuffen:** hvor meget vises (kun terræn-glyf, eller stages + nøgleklatringer)? Kandidat: glyf + 1 linje ("6 stages · 2 summit finishes").
2. **Auto-plan træning:** skal den skrive uge-rytmen direkte, eller kun *foreslå* (accept-knap)? Kandidat: foreslå + accept (ikke-destruktivt).
3. **Kan man toppe for et løb holdet ikke er tilmeldt?** Kandidat: nej — kun løb i holdets kalender (ellers meningsløs peak).
