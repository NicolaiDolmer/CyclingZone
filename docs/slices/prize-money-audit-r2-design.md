# Design · R2 — Sammenkædet/relativ point-model med master-kategori

**Issue:** [#894](https://github.com/NicolaiDolmer/CyclingZone/issues/894) · **Epic:** [#893](https://github.com/NicolaiDolmer/CyclingZone/issues/893) · **Slice:** [`prize-money-audit.md`](prize-money-audit.md)

**Status:** ✅ Design låst + **v1 implementeret** (i PR, 2026-06-01). Migration + backend + frontend + tests leveret. Akse-1 ratio-editor = v1.1 (se §10-tabel).

**Ejer-beslutning (AskUserQuestion 2026-06-01):** kaskade-akse = **faktor pr. (kategori × result-type)** (Option B — bevarer balancen, mere fleksibel end én faktor pr. kategori).

---

## 1. Mål (genopfriskning)

I dag redigeres ~1.500 absolutte point-felter **ét ad gangen** (`PUT /api/admin/race-points/:id` pr. id i [`RacePointsAdminSection.jsx`](../../frontend/src/components/admin/RacePointsAdminSection.jsx)). At ændre balancen = mange manuelle handlinger.

Ønske: sæt **master-kategorien (Tour de France)** fuldt — point pr. placering + **ratioer mellem result-typer** (fx "pointtrøje = 250% af etapesejr") — og lad **alle andre kategorier kaskadere automatisk** efter deres niveau. To ratio-akser:
- **Akse 1 (intra-kategori):** mellem result-typer i masteren (pointtrøje vs etapesejr vs GC …).
- **Akse 2 (inter-kategori):** master → afledte kategorier, **én faktor pr. (kategori × result-type)** (Option B).

---

## 2. Kritisk fund: kurveformer + længder er bevidst forskellige pr. kategori

Verificeret i `uciRacePointDefaults.js` (2026-06-01):

| Result-type | Kurve-længder (TdF → Class2) |
|---|---|
| Etapeplacering | 15 · 15 · 10 · 10 · 10 · 5 · 3 · 3 |
| Klassement (GC) | 60 · 60 · 60 · 60 · 60 · 40 · 25 · 20 |

Top-formen er *næsten* ens (GC rank-2 ≈ 0,80 i alle kategorier), men **antal betalte placeringer og halens form adskiller sig**. Lavere kategorier betaler bevidst færre placeringer.

**Konsekvens for designet:** en naiv kaskade ("master-form × skalar-faktor") ville påtvinge masterens fulde kurve (fx 60 GC-placeringer) på lavere kategorier (Class2 har kun 20) → opfinde præmier for ikke-eksisterende placeringer og forvrænge halens falloff. En måling viste afvigelser på 90-600%+ i halen hvis masterens form blev påtvunget.

→ **Kaskaden må skalere magnitude (anker), IKKE påtvinge form.** Hver (kategori × result-type) beholder sin egen normaliserede kurveform.

---

## 3. Model

Tre redigerbare knap-sæt + per-kategori kurveformer. `race_points` forbliver den **materialiserede output-tabel** — læse-/import-stien (`raceResultsEngine.js`, `raceResultsSheetSync.js`, `expectedPrizeCalculator.js`) røres **ikke**.

### 3a. Kurveformer (templates) — per (race_class, result_type)
Normaliseret rang-kurve `weight[rank] = points[rank] / points[1]`, med kategoriens **egen længde**. Seedes fra nuværende `race_points`. Sjældent redigeret. Bevarer dagens balance-form præcist.

### 3b. Master-ankre (akse 1) — per result_type i master-kategorien
Rank-1-ankeret pr. result_type, sat enten:
- **eksplicit** (et tal), eller
- **som ratio** til et reference-result_types anker — fx `Pointtroje = 2,50 × Etapeplacering`. Dette er ejerens "pointtrøje = 250% af etapesejr".

**To master-kategorier** (uundgåeligt, domæne-bestemt):
- **TourFrance** = master for etapeløbs-result-typer (Etapeplacering, Klassement, Pointtroje, Bjergtroje, Ungdomstroje, Forertroje, *Dag, EtapelobHold).
- **Monuments** = master for endags-result-typer (Klassiker, KlassikerHold) — TdF har ingen endags-klassifikation.

### 3c. Kaskade-faktorer (akse 2, Option B) — per (race_class, result_type)
`factor` så `anchor[class][rt] = factor × master_anchor[rt]`. Seedes som `current_r1[class][rt] / current_r1[master][rt]` → reproducerer nuværende rank-1 **eksakt**.

### Generér-algoritme
```
for hver (class, rt):
  master = masterFor(rt)                 // TourFrance (etape) | Monuments (endags)
  if class == master:
     anchor = masterAnchor[rt]           // eksplicit ELLER via akse-1-ratio
  else:
     anchor = factor[class][rt] × masterAnchor[rt]
  for rank in 1..len(template[class][rt]):
     points = round(anchor × template[class][rt][rank])
  upsert race_points(class, rt, rank, points)
```

**Eksakt reproduktion ved seed (bevis):** for master er `weight = cur[rank]/cur[1]` og `anchor = cur[1]` → `round(cur[1] × cur[rank]/cur[1]) = cur[rank]`. For afledte er `anchor = (cur_r1/master_r1) × master_r1 = cur_r1` og `weight = cur[rank]/cur_r1` → produkt = `cur[rank]`. ⇒ Generér fra seedet model giver **bit-for-bit dagens `race_points`**. Balance tabes ikke ved indførsel; kaskaden ændrer kun noget når admin redigerer et anker eller en faktor.

---

## 4. Storage (forslag — race_points uændret som output)

Tre små model-tabeller (kan kollapses til én `race_point_model` med en `role`-kolonne; normaliseret form vist for klarhed):

```
race_point_template(race_class, result_type, rank, weight NUMERIC, UNIQUE(race_class,result_type,rank))
race_point_master(result_type PK, anchor NUMERIC, ratio_ref TEXT NULL, ratio NUMERIC NULL)
race_point_cascade(race_class, result_type, factor NUMERIC, UNIQUE(race_class,result_type))
```

- `race_point_master.ratio_ref/ratio`: hvis sat, beregnes `anchor = ratio × master_anchor[ratio_ref]` (akse 1). Ellers bruges `anchor` direkte.
- Master-kategorier har ikke rækker i `race_point_cascade` (eller `factor = 1`).
- RLS: admin-only writes, public/auth read (samme mønster som `race_points`).

**Alternativ:** drop templates-tabellen og udled formen on-the-fly fra et `race_points`-snapshot ved "lås"-tidspunkt. Trade-off: færre tabeller / mindre auditbarhed. Anbefaling: eksplicit template-tabel (revisorbar, kan redigeres senere).

---

## 5. Endpoints

| Metode | Path | Funktion |
|---|---|---|
| GET | `/api/admin/race-point-model` | master-ankre + faktorer + templates + beregnet preview |
| PUT | `/api/admin/race-point-model/master/:result_type` | sæt master-anker (værdi eller ratio) |
| PUT | `/api/admin/race-point-model/factor/:class/:result_type` | sæt kaskade-faktor |
| POST | `/api/admin/race-point-model/generate` | kaskadér → upsert `race_points` (transaktionelt) + audit-log + diff-resumé |

Eksisterende `PUT /api/admin/race-points/:id` (per-celle) **beholdes** som escape-hatch til engangs-rettelser. ⚠️ UI advarer: en efterfølgende **Generér** overskriver manuelle celle-edits (medmindre templaten opdateres).

---

## 6. UI (admin → Race Points)

1. **Master-panel (TdF):** rediger ankre pr. result_type. Ratio-tilstand pr. række: `Pointtrøje = [250]% af Etapesejr`.
2. **Endags-master-panel (Monuments):** for Klassiker/KlassikerHold.
3. **Kaskade-grid:** rækker = afledte kategorier, kolonner = result-typer, celle = faktor (%). Live preview-tabel af resulterende rank-1 (fuld kurve ved expand).
4. **"Generér & gem"-knap** → kald generate → vis diff (X rækker ændret) før commit.
5. Behold nuværende per-celle-editor som "Avanceret / manuel"-fane.

---

## 7. Migration / back-compute (engangs-seed)

Script:
1. Templates = normalisér nuværende `race_points` (`weight = points/points_rank1` pr. kurve).
2. Master-ankre = TdF/Monuments rank-1 pr. result_type.
3. Faktorer = `cur_r1[class][rt] / master_r1[rt]`.
4. **Verifikations-gate:** kør `generate` mod en kopi og assertér output == nuværende `race_points` (regression). Mismatch = stop + flag.

---

## 8. Edge cases

- **Afrunding:** `round()` på `anchor × weight`. Eksakt ved seed (se §3-bevis); efter anker-edit kan ±1 forekomme — acceptabelt.
- **Manuelle celle-edits vs generate:** generate er autoritativ; UI-advarsel. (v2: "bag celle-edit ind i template".)
- **Kurve-længde-ændring:** template-længden er fast pr. kategori; at tilføje/fjerne placeringer = template-edit (sjældent, v2).
- **Result-type findes ikke i master:** kun relevant for Klassiker/KlassikerHold → håndteret via Monuments-master. Øvrige typer findes alle i TdF-master.
- **Nye kategorier/result-typer:** kræver template + master/faktor-rækker; generate springer (class,rt) over uden template.

---

## 9. Acceptkriterier

- [ ] Generate fra seedet model reproducerer nuværende `race_points` **eksakt** (regressionstest).
- [ ] Edit af et master-anker kaskaderer til alle kategorier der deler result_type (via deres faktor).
- [ ] Edit af én faktor ændrer kun den (kategori, result-type)-kurves magnitude.
- [ ] Kurve-længder/-former pr. kategori uændrede medmindre template redigeres.
- [ ] Læse-/import-stien (`raceResultsEngine`, sheet-sync, `expectedPrizeCalculator`) urørt — læser stadig `race_points`.
- [ ] Audit-log (bulk) ved generate registrerer før/efter-antal.
- [ ] Patch notes ved bruger-/admin-rettet ændring.

---

## 10. Beslutninger (LÅST med ejer 2026-06-01)

1. ✅ **Kaskade-akse:** Option B (faktor pr. kategori × result-type).
2. ✅ **To-master-split:** ja — TdF for etape-typer, Monuments for endags-typer (Klassiker/KlassikerHold). Domæne-uundgåeligt.
3. ✅ **v1-scope = trinvis (B):** v1 = direkte master-ankre (tal) + kaskade-faktorer + generate. **Akse-1 ratio-editor** ("pointtrøje = 250% af etapesejr") → **v1.1** (rent additivt, ingen datamodel-ændring). Templates holdes frosne i v1 (kun magnitude/ankre/faktorer redigeres).
4. ✅ **Manuel per-celle-editor:** beholdes som "Avanceret / manuel"-escape-hatch.

→ Scope låst. Implementering kan starte (Fase 6).

### v1 vs v1.1 afgrænsning
| Element | v1 | v1.1 |
|---|---|---|
| 3 model-tabeller + seed-migration | ✅ | |
| GET model, PUT faktor, POST generate | ✅ | |
| PUT master-anker (eksplicit tal) | ✅ | |
| PUT master-anker (ratio til anden result-type) | | ✅ |
| Master-panel + kaskade-grid + generate-knap | ✅ | |
| Ratio-builder-UI ("= 250% af …") | | ✅ |
| Template/kurveform-editor | | senere |
