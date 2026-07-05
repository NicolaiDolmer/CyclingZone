# Staff-rigdom — evner, profiler, ability-drevet effekt (Fase 3, staff-udvidelse)

> Design-doc · 2026-07-05 · ejer-godkendt i design-runde samme dag (efter A3-UI-preview).
> Bygger på: [`2026-07-05-economy-fase3-empire-design.md`](2026-07-05-economy-fase3-empire-design.md) §2.2 (staff), A3-UI (PR #2215), A2-kalibrering (`docs/audits/2026-07-05-facility-investment-calibration.md`), rytterprofil-design-SSOT (`docs/design/design_handoff_rider_profile/`), Living World-doktrinen ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)).
> **Status:** DESIGN — ejer-godkendt. Simulér-før-ship gælder hele effekt-modellen (ingen konstant shippes uden harness-bevis).

## 0. Problem + vision

A3 leverede staff som **tier + løn → en udnyttelses-skalar** (0,5–1,0) på facilitets-effekten. Ejer-feedback (2026-07-05): staff-lønnen føltes triviel (Q1), og staff skal være **rige karakterer** — klikbare profiler der spejler rytterprofilerne, med **evner** og **specialiseringer**. Det løfter staff fra en økonomisk detalje til en **levende-verden-loop**:

> En rytter der stopper sin senior-karriere bliver træner/spejder efter sine styrker (en stærk fysisk klatrer → fysisk-træner). Staff-markedet fødes af rytter-livscyklussen.

**Design-tese:** staff-evnernes VÆRDI er ikke "køb højeste tier" men "find den chef der passer til MIN trup + mit budget". Specialisering skaber strategien; overall rating driver effekt-størrelsen; løn skalerer med rating → løn bider (svaret på Q1, bedre end at brede en skalar ud).

## 1. Ability-model

### 1.1 Struktur (spejler rytter: overall + kategori-kolonner + specialisering)

Hver staff har:
- **Overall rating (1–99)** — vægtet gennemsnit af evnerne. Driver effekt-størrelsen + løn. Vist som rating-cirkel (`statColor`, som rytter-overall).
- **3 evne-kolonner** (spejler rytterens Fysisk/Mental/Teknisk-grid), rolle-tilpasset.
- **Specialiseringer** langs to akser (ejer-låst 2026-07-05):
  - **Trænings-dimension:** Fysisk / Mental / Teknisk — matcher rytter-evne-kategorierne direkte (`ABILITY_CATEGORIES` i `frontend/src/lib/abilities.js`). En chefs "Fysisk træning"-rating løfter rytterens *fysiske* evner.
  - **Niveau-affinitet:** Ungdom / Junior / Senior — hvilket alderstrin chefen udvikler bedst (Ungdom = akademi-pipeline; Senior = hovedtrup; Junior = U23/graduates — mappes til spillets faktiske alders-bånd i implementeringsplanen).

### 1.2 Pr. rolle (kolonner + specialiserings-akser)

| Rolle | Kolonne A (kerne) | Kolonne B (rolle-2) | Kolonne C (universel) | Specialiserings-akser |
|---|---|---|---|---|
| **Sportsdirektør** (training) | Coaching: Fysisk, Mental, Teknisk | Niveau: Ungdom, Junior, Senior | Ledelse: Motivation, Kommunikation, Disciplin | dimension × niveau |
| **Chefscout** (scouting) | Vurdering: Talent-øje, Dømmekraft | Rækkevidde: Netværk, Region | Ledelse (universel) | niveau (spejder ungdom vs. senior) |
| **Læge** (medical) | Medicin: Restitution, Skadesforebyggelse, Genoptræning | Pleje (universel) | Ledelse | (form/skade-motor senere) |
| **Akademichef** (academy) | Udvikling: Intake-kvalitet, Vækstfart | Metode: dimensioner | Ledelse | niveau (iboende ungdom) |
| **Kommerciel direktør** (commercial) | Forretning: Forhandling, Marketing | Netværk | Ledelse | (Fase 4 merchandise-krog) |

Training-rollen detaljeres fuldt i A4 (den wirer ind i trænings-motoren = Q3). De øvrige rollers effekt-kroge aktiveres i takt med deres motorer (form/skade for læge, scouting-fane for scout) — evnerne vises fra dag 1, mærket ærligt "mål" indtil deres motor lander (samme `effectLive`-mønster som A3).

### 1.3 Retired-rytter-kompatibilitet (design-constraint, bygges senere)

Evne-strukturen SKAL kunne populeres fra en pensioneret rytters profil:
- Rytterens evne-kategori-styrker (fysisk/mental/teknisk) → coaching-dimension-ratings.
- Rytterens type/tactics/experience → rolle-egnethed (taktisk stærk → scout/DS; høj fysik → fysisk-træner) + start-tier.
- Rytterens alder/erfaring → start-rating-bånd.
Mapping-funktionen bygges i pensions-slicen (§5), men A4-datamodellen designes så den passer (samme evne-felter, deriverbare fra rytter-evner).

## 2. Effekt-model (erstatter tier-skalaren — Q1 + Q3)

**Gammel (A1/A2):** `effect = FACILITY_BASE_EFFECT[track][facilityTier] × staffUtilization(staffTier)` (0,5..1,0 skalar).

**Ny (A4):**
```
effect = FACILITY_BASE_EFFECT[track][facilityTier] × staffFactor(overall) [× specializationMatch]
```
- **`staffFactor(overall)`**: ingen chef = gulv (kandidat: 0,5); overall 1→99 mapper til 0,5..1,0 (kurve kalibreres i harness). Højere-ratet (dyrere) chef løfter mere → løn bider.
- **`specializationMatch`** (målrettede bonusser, ejer-valgt): effekten anvendes pr. **dimension × niveau**. En Fysisk-Ungdoms-coach løfter unge rytteres *fysiske* træning ekstra; en generalist løfter fladt. Wirer ind i trænings-motoren (respekterer akademi-caps #2082/#1938 — bonussen forbedrer udnyttelse under caps, udvider dem ikke).
- **Løn ← overall:** `STAFF_SALARY_BY_*` gøres rating-drevet (ikke tier-fast). Skala kalibreres så staff er en reel omkostning (Q1) uden at blive en fælde (A2-relevans-gaten genbruges/udvides).

**Tier's rolle:** bliver et afledt "kvalitets-bånd" (tier 1 ≈ overall 30–45, tier 5 ≈ 70–85) — kandidat-generering trækker overall inden for tier-båndet + per-staff variation + rolle-skew (samme disciplin som rytter-derivation + kontrast-boost i `abilityDerivation.js`).

## 3. Staff-profil-side (spejler rytterprofil — ejer-valgt: FØR flip)

Route `/staff/:id` (parallel til `/riders/:id`). Genbruger rytter-profil-mønstre 1:1 hvor muligt:
- **Switcher-bar:** ‹ forrige · HOLD · rolle · næste ›.
- **Hero:** foto-placeholder (initialer + "FOTO"), navn (Bebas uppercase), meta-chips (rolle, tier, hired-season, alder), rating-cirkel (`statColor`), løn, kontrakt (fra B-koblingen; indtil da: hired/status), specialiserings-headline ("Bedst til at udvikle klatrere ★★★" → for staff: "Bedst til fysisk træning af ungdom").
- **Tabs:** Overblik (evne-kolonner + specialiserings-visning), Effekt (bidraget til facilitetens effekt + hvem der gavner), Historik.
- **Genbrug:** `statColor`/`statTextColor` (uændret), rating-cirkel-mønster, ability-kolonne-grid (adaptér `RiderAbilityColumns` → `StaffAbilityColumns`), design-tokens (Bebas/Inter Tight/DM Sans, 5px/8px, 1px hairlines, 2px guld-rule). To bar-betydninger bevares (tynd guld = progress hvis relevant; tyk m. tick = magnitude vs. peers).
- **Klikbar:** staff-navn i StaffPanel + FacilityTrackCard → `/staff/:id` (løser det flagede hul: ingen genindgang til besat rolle).

## 4. Kandidat-generering med evner

Udvid `generateStaffCandidates` (`backend/lib/staffCandidates.js`): hver kandidat får deterministisk (teamId+season+role+navn-hash) en fuld evne-profil inden for facilitets-tier-båndet + rolle-skew. Ansæt/fyr genbruger A1-service (ledger, idempotens); evnerne persisteres på `team_staff`. Kandidat-listen + hire-UI viser overall + top-specialisering (ikke bare tier) → strategisk valg.

## 5. Dekomponering (fler-bølge-epos — ejer-godkendt)

| Bølge | Indhold | Timing | GitHub |
|---|---|---|---|
| **A4 — Rigt staff-system** | §1 ability-model + §2 ability-drevet effekt (erstatter tier-skalar, wirer training-effekt) + §3 fuld profil-side + §4 kandidat-generering m. evner + klikbar staff + re-harness + migration (staff-evne-kolonner) + `app_config`-flag-migration | **FØR flip** | [#2216](https://github.com/NicolaiDolmer/CyclingZone/issues/2216) |
| **B-kobling — Staff-kontrakter** | Staff får kontrakt-længde + genforhandling + udløb, spejler rytter-kontrakt-livscyklussen | **Med Slice B** | [#2217](https://github.com/NicolaiDolmer/CyclingZone/issues/2217) |
| **Pension→staff** | Retired ryttere bliver staff efter deres styrker (rytter-evner → staff-evner via §1.3-mapping). **Dependency:** kræver et rytter-pensions-/aldrings-system (verificér om det findes; ellers del af slicen) | **Senere slice** | [#2218](https://github.com/NicolaiDolmer/CyclingZone/issues/2218) |

**Spændings-resolution (Q1 "alt før flip" vs. Q3 "sammen med rytter-forhandlinger + pension"):** det rige staff-SYSTEM (evner/profiler/effekt/specialiseringer) bygges før flip. Staff-KONTRAKTER + PENSION→STAFF kobles til andre systemer (Slice B + pensions-system) og kommer bagefter — men A4-modellen designes kompatibel med begge fra dag 1. Flippet kobles IKKE til hele Slice B + et nyt pensions-system.

## 6. A4-scope (før-flip, detaljeres i implementeringsplan)

1. **Migration (ejer-merge):** udvid `team_staff` med evne-kolonner (dimensioner, niveau-affinitet, rolle-evner, overall) ELLER en `team_staff_abilities`-tabel (spejler `rider_derived_abilities`). RLS: authenticated SELECT egne rækker.
2. **Backend:** evne-derivation (`staffAbilityDerivation.js`, spejler `abilityDerivation.js` + kontrast-disciplin), rating-drevet løn, ny effekt-model i `facilityEngine.js` (staffFactor + specializationMatch), training-effekt-hook i trænings-motoren (dimension×niveau, respekterer caps), kandidat-generering m. evner.
3. **Frontend:** `/staff/:id`-profil-side + `StaffAbilityColumns` + rating-cirkel-genbrug + klikbar staff + kandidat-sammenligning + sæson-omkostnings-stribe på Klub-fladen.
4. **Harness (obligatorisk, simulér-før-ship):** genkør `facilityInvestmentScorecard` (anti-optimal-path + payback + tid-som-valuta) + `inflationScorecard` + fresh/Gini-non-regression MOD den nye effekt-model + rating-drevne lønninger. Ny gate: staff-specialiserings-balance (ingen specialisering dominerer; generalist vs. specialist konkurrencedygtige). Ejer-review af tal før flip.
5. **Flag:** migrér `FACILITIES_ENABLED` (kode-konstant) → `app_config`-række (instant SQL-flip, spejler `academy_enabled`) — samme som oprindelig Plan B.

## 7. Simulér-før-ship-gates (A4)

- Fresh-gate + Gini uændret grønne (staff-model rører ikke fresh-population-nettoen direkte, men effekt-model-ændringen skal bevises harmløs).
- `facilityInvestmentScorecard` grøn på ny effekt-model (anti-optimal-path holder; staff er nu en meningsfuld men ikke-dominerende akse).
- Rating-drevet løn: staff er en reel omkostning (Q1) uden at være en fælde (relevans-gaten: løn ∈ rimeligt bånd af marginal værdi-tilførsel).
- Specialiserings-balance: generalist- OG specialist-chefer er spilbare (specialist bedre for matchende trup, generalist bredere) — ingen enkelt-specialisering dominant.

## 8. Ejer-beslutninger (LÅST 2026-07-05)

| # | Beslutning |
|---|---|
| **Profil-ambition** | Fuld staff-profil-side (spejler rytter) FØR flip (Q1). |
| **Effekt-model** | Målrettede specialiserings-bonusser (ikke kun samlet rating) (Q2). |
| **Specialiserings-akser** | Trænings-dimension (Fysisk/Mental/Teknisk, = rytter-evne-kategorier) × Niveau (Ungdom/Junior/Senior). |
| **Staff-marked** | Statiske evner nu; kontrakter med Slice B; pension→staff senere slice (Q3). |
| **Pension→staff** | Retired ryttere bliver staff efter deres styrker (levende-verden-loop). Design-ind nu, byg senere. |

## 9. Åbne spørgsmål (afklares i implementeringsplan, ikke blockers)

- Præcis `staffFactor(overall)`-kurve + rating-drevet løn-skala (harness-kalibreres).
- Evne-persistens: kolonner på `team_staff` vs. separat tabel (vælges i migration-design; separat tabel spejler rytter-mønsteret bedst).
- Niveau-bånd-mapping: spillets faktiske alders-/akademi-bånd → Ungdom/Junior/Senior.
- Rækkevidde af specialiserings-effekt (kun training i A4; øvrige roller mærkes "mål" til deres motor lander).
- Rytter-pensions-system: findes det? (verificér før pensions-slicen planlægges).
