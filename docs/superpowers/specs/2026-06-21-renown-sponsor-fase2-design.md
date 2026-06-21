# Omdømme-skaleret sponsor + forhandlbare kontrakter — design (2026-06-21)

> Implementerings-design for **#1663** (Økonomi Fase 2). Konkretiserer den ejer-godkendte
> økonomi-filosofi fra [`2026-06-21-economy-coherence-design.md`](2026-06-21-economy-coherence-design.md)
> til en byg-bar feature: en sponsor-base der skalerer med klub-omdømme + forhandlbare
> kontrakter (vælg-blandt-tilbud) + per-løbsdag-aktivitets-indkomst.
> Refs #1663, #1441 (epic), #1607 (præmie), #1099/#1112/#844 (omdømme), #933 (sponsor-økonomi).
> **Status:** DESIGN — ejer-godkendte beslutninger fra brainstorm 2026-06-21. Simulér-før-ship gælder.

## 1. Problemet (fra kalibrerings-audit 2026-06-21)

En **flad** sponsor-konstant kan matematisk ikke gøre både friske (~316k løn) og tungt-opbyggede
hold (~3,4M løn) bæredygtige samtidig — 10× løn-forskel, og et fladt sponsor-add rammer begge
lige hårdt. Audit'en beviste: hæver man sponsor nok til at lukke det modne D1-gap (~+360k),
over-fodres det friske hold (D2 → 2,57× start ved S5, bryder fresh-gaten).

**Løsning:** sponsor-basen skal **skalere med klubbens omdømme/standing** (Football-Manager-agtig
stadion-indtægts-model). Omdømme er korreleret med roster-styrke, så et frisk hold (lav standing)
forbliver på basen mens et modent top-hold løftes — uden den flade konstants kollaterale skade.

## 2. Ejer-låste beslutninger (brainstorm 2026-06-21)

| # | Beslutning |
|---|---|
| **Scope** | Alt i én slice: renown-skaleret base + forhandlbare kontrakter + per-løbsdag-indkomst + tabel/migration + UI. |
| **Renown-multiplier-input** | **Resultat-historik + division.** (Aktivitet er IKKE en multiplier-faktor — se næste række.) |
| **Aktivitet** | **Per-løbsdag-indkomst** (ikke binære "mål"): fast beløb × løbsdage, krediteret ved race-finalisering. Selv-forstærkende, ingen clawback. |
| **Forhandlings-model v1** | **Vælg blandt 2-3 genererede tilbud. Intet modbud** (modbud = senere fase). Tilbud forhandler split mellem garanteret base / per-løbsdag-rate / længde. |
| **Renown-form** | Division-base som anker × renown-multiplier (forankret ≥ 1,0 for friske hold). Maks-løft kalibreres i harness. |
| **UI-placering** | **Hybrid**: forhandling = modal udløst ved sæson-skifte fra Board; løbende kontrakt = read-only "Sponsor"-fane i Finance. |
| **Migration** | Opdatér **alle** hold (forever-relaunch nulstiller alligevel senere). Bagudfyld renown-neutral kontrakt = nul saldo-chok. Ingen runtime-flag; harness-grøn er merge-gaten. |
| **Sponsor-navne** | Pulje på **~50** fiktive navne (ingen logoer i v1; rigeligt forbi 22 hold). |

## 3. Renown-multiplier (kernen)

```
renownTarget(team) = SPONSOR_INCOME_BY_DIVISION[division] × renownMultiplier(team)

renownMultiplier(team) = clamp(
    1 + W_RESULTS · resultsScore,
    1.0,            // gulv: friske/svage hold falder aldrig under division-basen
    MAX_MULTIPLIER  // loft: anti-runaway
)
```

`renownTarget` = den **samlede** sponsor et hold tjener ved **fuld aktivitet** (fuld kalender).
Den splittes per tilbud i garanteret base + per-løbsdag-rate (§4).

**Default-konstanter (start-gæt — kalibreres i harness mod break-even, jf. §7):**
- `W_RESULTS = 0.60` (top-hold med resultsScore 1,0 → multiplier 1,60)
- `MAX_MULTIPLIER = 1.60` (modent top-hold ≈ +60% ≈ det ~360k D1 mangler)

**`resultsScore` ∈ [0,1]** — genbruger den eksisterende `computeVariableSponsor`-logik
([sponsorEngine.js:45](../../backend/lib/sponsorEngine.js)): sidste sæsons point relativt til
divisions-median × rank-faktor, **clamp'et til [0,1]** (et dominerende hold har pointFactor > 1 →
clamp holder modellen læsbar; loftet fanger uanset overshoot). **0 hvis ingen historik** (frisk hold).

**Hvorfor dette holder fresh-gaten grøn af sig selv:** et frisk hold har resultsScore = 0
→ multiplier = 1,0 → renownTarget = nuværende prod-division-base. Gulvet på 1,0 sikrer at selv et
svagt hold aldrig får mindre end i dag. Aktivitets-indkomsten (§4) kalibreres så et fuld-kalender-hold
rammer renownTarget — altså ~nuværende niveau for et frisk hold → ingen regression.

**Arketype-eksempler** (default-konstanter, renownTarget = total ved fuld aktivitet):

| Arketype | Div-base | resultsScore | Multiplier | renownTarget |
|---|---|---|---|---|
| Frisk hold (D3, sæson 1) | 340k | 0,0 | 1,00× | 340k *(= i dag)* |
| Etableret mid (D2) | 400k | 0,5 | 1,30× | ~520k |
| Modent top (D1) | 600k | 1,0 | 1,60× | ~960k *(≈ +360k)* |

## 4. Forhandlbare kontrakter + per-løbsdag-indkomst

### 4.1 Indkomst-model
Sponsor-indtægt har to dele:
- **Garanteret base** — krediteret ved sæson-start (board-modifier × pullout × loft anvendes her).
- **Per-løbsdag** — `per_race_day_rate × løbsdage`, krediteret løbende ved hver race-finalisering
  (genbruger prize-payout-stien, [prizePayoutEngine](../../backend/lib/)), så spilleren ser pengene
  komme ind mens holdet kører.

Kalibrerings-invariant: ved **fuld kalender** gælder `guaranteedBase + per_race_day_rate ×
FULL_CALENDAR_DAYS ≈ renownTarget × variantFaktor`. Inaktivitet straffes naturligt (tabt per-dag-indkomst)
— ingen binære mål, ingen clawback.

### 4.2 Tilbuds-generering
Givet holdets `renownTarget` `T`, genereres **3 deterministiske tilbud** (seedet på
`team_id + season_number`, så de er stabile på tværs af page-reloads — kritisk, ellers kan
spilleren "reroll'e" ved refresh). Tilbuddene forhandler **split mellem sikker base og per-løbsdag**
+ længde:

| Variant | Garanteret base | Per-løbsdag | Længde | Risiko-profil |
|---|---|---|---|---|
| **Forudsigelig** | høj (~0,88·T) | lav | 1 sæson | stabil uanset aktivitet |
| **Aktivitets-drevet** | lav (~0,55·T) | høj | 2 sæsoner | kør meget → tjen mest |
| **Sikker / lang** | medium (~0,73·T) | medium | 3 sæsoner | låst base i 3 sæsoner |

Splittene (0,88 / 0,55 / 0,73 + matchende per-dag-rater) er justérbare og kalibreres så hver variant
≈ `T` ved fuld kalender. Hver variant får et fiktivt sponsor-navn fra `SPONSOR_NAME_POOL` (seedet udvælgelse).

### 4.3 Kontrakt-livscyklus
- En aktiv kontrakt har `guaranteed_base`, `per_race_day_rate`, `length_seasons`, `start_season`,
  `expires_after_season`.
- **Mens kontrakten løber:** `guaranteed_base` + `per_race_day_rate` er **låst** — ingen ny forhandling,
  uanset om renown stiger/falder. Det er hele pointen med længde (sikkerhed vs. upside).
- **Ved udløb:** nye tilbud genereres fra den da-aktuelle renown. Forhandling sker ved sæson-skifte.
- Board-modifier × pullout × loft anvendes på `guaranteed_base` ved hver sæson-start
  (genbruger [economyEngine.js:243](../../backend/lib/economyEngine.js)). Per-løbsdag-indkomsten er
  rå (ikke board-modificeret) — det er aktivitets-betaling, ikke standing-betaling.

## 5. Datamodel (migration)

Ny tabel `sponsor_contracts` (én aktiv pr. hold + historik):

```sql
CREATE TABLE sponsor_contracts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id            UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  sponsor_name       TEXT NOT NULL,
  guaranteed_base    BIGINT NOT NULL,          -- låst base for kontraktens løbetid
  per_race_day_rate  BIGINT NOT NULL DEFAULT 0,-- låst per-løbsdag-rate
  length_seasons     INTEGER NOT NULL CHECK (length_seasons BETWEEN 1 AND 3),
  start_season       INTEGER NOT NULL,
  expires_after_season INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'expired' | 'terminated'
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sponsor_contracts_team_active
  ON sponsor_contracts(team_id) WHERE status = 'active';
```

**RLS / kolonne-grants:** følg eksisterende mønster — `GRANT SELECT` til `authenticated` for
holdets egne rækker (RLS-policy `team_id` ejer-match). **Husk `GRANT SELECT (...)` i SAMME migration**
hvis kolonne-privilegier bruges (jf. #1162-fælden) — verificeres mod prod-klon.

**Backfill (alle hold, renown-neutral):**
```sql
INSERT INTO sponsor_contracts (team_id, sponsor_name, guaranteed_base, per_race_day_rate,
    length_seasons, start_season, expires_after_season, status)
SELECT id, '<seedet fiktivt navn>',
    SPONSOR_INCOME_BY_DIVISION[division] /* renown=1.0 i frisk S1 → fuld base som garanteret */,
    0 /* ingen per-dag før første forhandling */,
    1, <current_season>, <current_season>, 'active'
FROM teams WHERE <ikke-AI/test-filter, jf. feedback_match_ui_filter_for_capacity_logic>;
```
Da alle nuværende hold er friske (historik = 0 → renown 1,0) og backfill lægger hele basen i
`guaranteed_base` med `per_race_day_rate = 0`, er payout = division-basen = nuværende →
**nul saldo-chok**. Tilbuds-forhandling (med per-dag-split) aktiveres ved næste sæson-skifte.

> **NB (PR-disciplin):** Denne PR indeholder `database/*.sql` → **auto-merge forbudt, ejer merger**
> (migration auto-applies i prod). Jf. [[pr-with-migration-owner-merges]].

## 6. Komponent-arkitektur

### Backend
| Enhed | Ansvar | Fil |
|---|---|---|
| `renownEngine.js` (NY) | `computeRenownMultiplier({division, lastSeasonStanding, divisionStandings})` + `renownTarget()` — ren funktion, ingen I/O. Eksporterer `W_RESULTS/MAX_MULTIPLIER` (genbruges af harness). | `backend/lib/` |
| `sponsorOffers.js` (NY) | `generateOffers({team, renownTarget, seasonNumber})` → 3 deterministiske tilbud (base/per-dag/længde, seedet). `SPONSOR_NAME_POOL` (~50). | `backend/lib/` |
| `sponsorEngine.js` (udvid) | `computeSponsorForSeason` bruger aktiv-kontraktens `guaranteed_base` (board-modificeret) som sæson-start-payout i stedet for flad division-base. | `backend/lib/sponsorEngine.js` |
| Per-løbsdag-kreditering | Ved race-finalisering: kredit `per_race_day_rate × dagens-løbsdage` til holdet (rå, ikke board-modificeret). Genbruger prize-payout-transaktions-stien + idempotent key. | `backend/lib/prizePayoutEngine` (el. tilstødende) |
| `sponsorContractsService.js` (NY) | DB-CRUD: hent aktiv kontrakt, generér/hent tilbud, accepter tilbud (skriv kontrakt), udløb→ny-tilbud ved sæson-skifte. | `backend/lib/` el. `services/` |
| API-routes (NY) | `GET /api/sponsor/contract` (aktiv), `GET /api/sponsor/offers` (ved sæson-skifte), `POST /api/sponsor/offers/accept`. Auth + ejer-match. | eksisterende route-mønster |

### Frontend (hybrid)
| Enhed | Ansvar | Fil |
|---|---|---|
| `SponsorOfferModal.jsx` (NY) | 2-3 tilbuds-kort (base + per-dag + længde + risiko-profil) + "Vælg" + confirm. Genbruger `ui/Modal.jsx` + `FinanceForecastCard`-kort-mønster. | `frontend/src/components/` |
| Board-integration | Trigger modal ved sæson-skifte-vindue (gate-logik fra `seasonTransitionGate.js`). Banner/CTA på BoardPage. | `frontend/src/pages/BoardPage.jsx` |
| `SponsorContractPanel.jsx` (NY) | Read-only: nuværende kontrakt (navn, garanteret base, per-dag-rate, akkumuleret aktivitets-indkomst, længde, udløb). Ny "Sponsor"-fane i Finance. | `frontend/src/components/` + `FinancePage.jsx` (`FINANCE_TABS`) |
| i18n | `help.json` (en+da) + sponsor-forklarings-keys (EN først, DA under). | `frontend/src/i18n/` |

### Loft-justering
`FINAL_SPONSOR_PAYOUT_CEILING` (i dag flad 720k/900k) ville **cappe** den renown-skalerede
garanterede base (top-D1 ~0,88·960k ≈ 845k × board-modifier 1,20 ≈ 1,01M). Loftet gøres
kontrakt-bevidst: `ceiling = guaranteed_base × MAX_BOARD_MODIFIER`, hvor **`MAX_BOARD_MODIFIER = 1.20`**
(bekræftet [boardEvaluation.js:109](../../backend/lib/boardEvaluation.js)). Det guarder stadig mod
board-modifier-bypass, men capper ikke legitim renown-skalering. (Per-løbsdag-indkomsten er ikke
board-modificeret → ikke omfattet af loftet.)

## 7. Simulér-før-ship (harness) — OBLIGATORISK gate

Per [[feedback_simulate_before_ship_balance]] kalibreres `W_RESULTS`, `MAX_MULTIPLIER` + base/per-dag-split
**empirisk** før ship — gættes ikke.

1. **Udvid `economyCalibrationOverrides.js`** til at modellere renown-multiplier + per-løbsdag-indkomst
   (ikke kun flad sponsor pr. division): scorecardet beregner hvert holds renownTarget fra dets
   simulerede standing og fordeler på base + per-dag × simulerede løbsdage.
2. **`prizeDistributionScorecard.js`**: de stærke drafted rosters får nu renown-skaleret sponsor →
   det modne D1-gap skal lukkes mod break-even-båndet.
3. **`economyCalibrationSweep.js`**: sweep `W_RESULTS × MAX_MULTIPLIER × split` × seeds; rangér efter
   (i) modent-felt trukket mod break-even, (ii) **fresh-gaten forbliver grøn**, (iii) Gini falder
   (anti-snowball, jf. spec §6 divergens-monitor).
4. **`moneySupplyScorecard.js --synthetic-only`**: friske hold ved **fuld kalender** skal forblive på
   D1 +3,6k / D2 +13,6k / D3 +8,6k (renownTarget 1,0 → uændret total). **Må ikke regressere.**

**Merge-gate:** sweep finder konstanter hvor modent felt nærmer sig break-even UDEN at bryde
fresh-gaten OG med faldende Gini. De endelige tal bages ind i `renownEngine.js` + dokumenteres i en
kalibrerings-rapport (`docs/audits/2026-06-21-renown-sponsor-calibration.md`).

## 8. Verifikation
- **Backend unit-tests:** `renownEngine` (gulv/loft/arketyper), `sponsorOffers` (determinisme på reload),
  per-løbsdag-kreditering (idempotent), kontrakt-låsning under løbetid. `node --test` i `backend/`.
- **Frontend unit-tests:** `node --test` i `frontend/` (obligatorisk, jf. #803 ESM-loader).
- **UI-verify:** Playwright-mocks (logget-ind) — offer-modal + contract-panel renderes; snapshot-refresh
  hvis visuel (alle 3 projekter, jf. #536).
- **Harness:** §7-scorecards grønne + kalibrerings-rapport committet.
- **Migration:** verificér mod prod-klon (grants + backfill renown-neutral), ikke frisk DB.

## 9. Out of scope (senere faser)
- Modbud / genforhandling under løbende kontrakt (#1441 senere fase).
- Sponsor-logoer / fuld brand-identitet.
- Fans→merchandise-indtægt (#1113, Fase 4/5).
- Fuld renown-motor (#1099/#1112/#844 Slice 3) — denne feature bruger **proxy v1** (division +
  resultat-historik) indtil den fulde motor lander.

## 10. Åbne spørgsmål (afklares i plan/impl, ikke blockers)
- `FULL_CALENDAR_DAYS` pr. division i sæson 1 (ProSeries-only) — læses fra kalender-seed for at
  kalibrere per-dag-rater. Verificeres mod faktisk race-pool.
- Per-løbsdag-kreditering: per race-finalisering (immediat feedback) vs. sæson-slut-tally — start med
  per-finalisering (genbruger prize-stien), fald tilbage til tally hvis idempotens bliver knudret.
- Sponsor-navne-pulje: ~50 navne, kuratér for tone (ingen ægte mærker, undgå AI-slop-klingende navne).
