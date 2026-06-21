# Omdømme-skaleret sponsor + forhandlbare kontrakter — design (2026-06-21)

> Implementerings-design for **#1663** (Økonomi Fase 2). Konkretiserer den ejer-godkendte
> økonomi-filosofi fra [`2026-06-21-economy-coherence-design.md`](2026-06-21-economy-coherence-design.md)
> til en byg-bar feature: en sponsor-base der skalerer med klub-omdømme + forhandlbare
> kontrakter (vælg-blandt-tilbud).
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
| **Scope** | Alt i én slice: renown-skaleret base + forhandlbare kontrakter + tabel/migration + UI. |
| **Renown-input** | Fuld proxy: **resultat-historik + division + aktivitet**. |
| **Forhandlings-model v1** | **Vælg blandt 2-3 genererede tilbud. Intet modbud** (modbud = senere fase). |
| **Renown-form** | Division-base som anker × renown-multiplier (forankret ≥ 1,0 for friske hold). Resultat vægter ~2× aktivitet. Maks-løft kalibreres i harness. |
| **UI-placering** | **Hybrid**: forhandling = modal udløst ved sæson-skifte fra Board; løbende kontrakt = read-only "Sponsor"-fane i Finance. |
| **Migration** | Opdatér **alle** hold (forever-relaunch nulstiller alligevel senere). Bagudfyld renown-neutral kontrakt = nul saldo-chok. Ingen runtime-flag; harness-grøn er merge-gaten. |
| **Sponsor-navne** | Pulje af fiktive navne (ingen logoer i v1). |

## 3. Renown-multiplier (kernen)

```
sponsorBase(team, season) = SPONSOR_INCOME_BY_DIVISION[division] × renownMultiplier(team)

renownMultiplier(team) = clamp(
    1 + W_RESULTS · resultsScore + W_ACTIVITY · activityScore,
    1.0,            // gulv: friske/svage hold falder aldrig under division-basen
    MAX_MULTIPLIER  // loft: anti-runaway
)
```

**Default-konstanter (start-gæt — kalibreres i harness mod break-even, jf. §7):**
- `W_RESULTS = 0.40`, `W_ACTIVITY = 0.20` (resultat 2× aktivitet)
- `MAX_MULTIPLIER = 1.60` (modent top-hold ≈ +60% ≈ det ~360k D1 mangler)

**`resultsScore` ∈ [0,1]** — genbruger den eksisterende `computeVariableSponsor`-logik
([sponsorEngine.js:45](../../backend/lib/sponsorEngine.js)): sidste sæsons point relativt til
divisions-median × rank-faktor, **clamp'et til [0,1]** (et dominerende hold har pointFactor > 1 →
clamp holder multiplier-modellen læsbar; loftet på `MAX_MULTIPLIER` fanger uanset overshoot).
**0 hvis ingen historik** (frisk hold).

**`activityScore` ∈ [0,1]** — sidste sæsons aktivitet:
`0.7 · (races_completed / scheduled_races) + 0.3 · squadFullness`.
**0 hvis ingen historik** (frisk hold) → friske hold lander på multiplier 1,0 = division-base.
(Vægt-split 0,7/0,3 er justérbar; kalibreres ikke kritisk — det er aktivitets-akslen.)

**Hvorfor dette holder fresh-gaten grøn af sig selv:** et frisk hold har resultsScore = activityScore = 0
→ multiplier = 1,0 → sponsor = nuværende prod-division-base. Ingen regression mulig. Gulvet på 1,0
sikrer at selv et svagt/inaktivt hold aldrig får mindre end i dag.

**Arketype-eksempler** (default-konstanter):

| Arketype | Div-base | resultsScore | activityScore | Multiplier | Sponsor-base |
|---|---|---|---|---|---|
| Frisk hold (D3, sæson 1) | 340k | 0,0 | 0,0 | 1,00× | 340k *(= i dag)* |
| Etableret mid (D2) | 400k | 0,5 | 0,8 | 1,36× | ~544k |
| Modent top (D1) | 600k | 1,0 | 1,0 | 1,60× | ~960k *(≈ +360k)* |

## 4. Forhandlbare kontrakter

### 4.1 Tilbuds-generering
Givet holdets renown-skalerede base `B`, genereres **3 deterministiske tilbud** (seedet på
`team_id + season_number`, så de er stabile på tværs af page-reloads — kritisk, ellers kan
spilleren "reroll'e" ved refresh):

| Variant | Garanteret base | Længde | Aktivitets-mål |
|---|---|---|---|
| **Ambitiøs** | `B × 1.05` | 1 sæson | hårdt (kør ≥ 90% af kalenderen) |
| **Balanceret** | `B × 1.00` | 2 sæsoner | medium (behold fuld trup) |
| **Sikker** | `B × 0.92` | 3 sæsoner | blødt (ingen hårde krav) |

Tradeoff: kortere kontrakt → højere base + hårdere mål, men du genforhandler tit (fanger upside
hvis du klatrer). Længere → lavere men **låst** base (sikkerhed mod at falde, men du misser upside).
Multiplikatorerne (1.05/1.00/0.92) er justérbare; sum-effekten er sekundær til renown-niveauet.

Hver variant får et fiktivt sponsor-navn fra `SPONSOR_NAME_POOL` (seedet udvælgelse).

### 4.2 Kontrakt-livscyklus
- En aktiv kontrakt har `base`, `length_seasons`, `activity_goal`, `start_season`, `expires_after_season`.
- **Mens kontrakten løber:** basen er **låst** (den garanterede base) — ingen ny forhandling, uanset
  om renown stiger/falder. Det er hele pointen med længde.
- **Ved udløb:** nye tilbud genereres fra den da-aktuelle renown. Forhandling sker ved sæson-skifte.
- Board-modifier × pullout × loft anvendes stadig oven på den (låste) base ved hver sæson-start
  (genbruger [economyEngine.js:243](../../backend/lib/economyEngine.js)).

### 4.3 Aktivitets-mål (bløde)
Evalueres ved **hver** sæson-slut for den aktive kontrakt:
- **Opfyldt** → ingen effekt (forventningen er mødt).
- **Misset** → **ingen tilbagebetaling** af nuværende sæson. I stedet: omdømme-hak (føder ringere
  fremtidige tilbud) + bidrager til **sponsor-pullout** (genbruger den eksisterende pullout-faktor,
  lag 5 i economyEngine — ikke en ny mekanik). Gentagne misser → sponsor kan trække sig før udløb.
- Soft, ikke straffende: målet er at belønne aktivt spil, ikke at knuse en spiller der springer en sæson over.

## 5. Datamodel (migration)

Ny tabel `sponsor_contracts` (én aktiv pr. hold + historik):

```sql
CREATE TABLE sponsor_contracts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  sponsor_name    TEXT NOT NULL,
  base_income     BIGINT NOT NULL,          -- garanteret/låst base for kontraktens løbetid
  length_seasons  INTEGER NOT NULL CHECK (length_seasons BETWEEN 1 AND 3),
  activity_goal   TEXT NOT NULL,            -- enum-agtig: 'none' | 'full_squad' | 'calendar_90'
  start_season    INTEGER NOT NULL,
  expires_after_season INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'expired' | 'terminated'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sponsor_contracts_team_active
  ON sponsor_contracts(team_id) WHERE status = 'active';
```

**RLS / kolonne-grants:** følg eksisterende mønster — `GRANT SELECT` til `authenticated` for
holdets egne rækker (RLS-policy `team_id` ejer-match). **Husk `GRANT SELECT (...)` i SAMME migration**
hvis kolonne-privilegier bruges (jf. #1162-fælden) — verificeres mod prod-klon.

**Backfill (alle hold, renown-neutral):**
```sql
INSERT INTO sponsor_contracts (team_id, sponsor_name, base_income, length_seasons,
    activity_goal, start_season, expires_after_season, status)
SELECT id, '<seedet fiktivt navn>', SPONSOR_INCOME_BY_DIVISION[division] /* renown=1.0 i frisk S1 */,
    1, 'none', <current_season>, <current_season>, 'active'
FROM teams WHERE <ikke-AI/test-filter, jf. feedback_match_ui_filter_for_capacity_logic>;
```
Da alle nuværende hold er friske (historik = 0 → renown 1,0), er backfill-basen = division-basen =
nuværende payout → **nul saldo-chok**. Tilbuds-forhandling aktiveres ved næste sæson-skifte.

> **NB (PR-disciplin):** Denne PR indeholder `database/*.sql` → **auto-merge forbudt, ejer merger**
> (migration auto-applies i prod). Jf. [[pr-with-migration-owner-merges]].

## 6. Komponent-arkitektur

### Backend
| Enhed | Ansvar | Fil |
|---|---|---|
| `renownEngine.js` (NY) | `computeRenownMultiplier({division, lastSeasonStanding, divisionStandings, activity})` — ren funktion, ingen I/O. Eksporterer også `W_RESULTS/W_ACTIVITY/MAX_MULTIPLIER`-konstanter (genbruges af harness). | `backend/lib/` |
| `sponsorOffers.js` (NY) | `generateOffers({team, renownBase, seasonNumber})` → 3 deterministiske tilbud (seedet). `SPONSOR_NAME_POOL`. | `backend/lib/` |
| `sponsorEngine.js` (udvid) | `computeSponsorForSeason` bruger renown-multiplier × division-base i stedet for flad base. Aktiv-kontrakt-base vinder hvis en kontrakt er låst. | `backend/lib/sponsorEngine.js` |
| `sponsorContractsService.js` (NY) | DB-CRUD: hent aktiv kontrakt, accepter tilbud (skriv kontrakt), evaluer aktivitets-mål ved sæson-slut, udløb→ny-tilbud. | `backend/lib/` eller `services/` |
| API-routes (NY) | `GET /api/sponsor/contract` (aktiv), `GET /api/sponsor/offers` (ved sæson-skifte), `POST /api/sponsor/offers/accept`. Auth + ejer-match. | eksisterende route-mønster |

### Frontend (hybrid)
| Enhed | Ansvar | Fil |
|---|---|---|
| `SponsorOfferModal.jsx` (NY) | 2-3 tilbuds-kort + "Vælg" + confirm. Genbruger `ui/Modal.jsx`-primitiv + `FinanceForecastCard`-kort-mønster. | `frontend/src/components/` |
| Board-integration | Trigger modal ved sæson-skifte-vindue (gate-logik fra `seasonTransitionGate.js`). Banner/CTA på BoardPage. | `frontend/src/pages/BoardPage.jsx` |
| `SponsorContractPanel.jsx` (NY) | Read-only: nuværende kontrakt (navn, base, længde, mål, udløb) + status. Ny "Sponsor"-fane i Finance. | `frontend/src/components/` + `FinancePage.jsx` (`FINANCE_TABS`) |
| i18n | `help.json` (en+da) + sponsor-forklarings-keys (EN først, DA under). | `frontend/src/i18n/` |

### Loft-justering (vigtigt)
`FINAL_SPONSOR_PAYOUT_CEILING` (i dag 720k/900k) ville **cappe** den renown-skalerede top
(top-D1 ambitiøst tilbud ≈ 960k × 1,05 ≈ 1,01M). Loftet gøres kontrakt-bevidst:
`ceiling = contractBase × MAX_BOARD_MODIFIER`, hvor `contractBase` er den accepterede (låste) base.
Det guarder stadig mod board-modifier-bypass, men capper ikke legitim renown-skalering. Konkret
`MAX_BOARD_MODIFIER` læses fra boardUtils; verificeres i harness.

## 7. Simulér-før-ship (harness) — OBLIGATORISK gate

Per [[feedback_simulate_before_ship_balance]] kalibreres `W_RESULTS`, `W_ACTIVITY`, `MAX_MULTIPLIER`
**empirisk** før ship — gættes ikke.

1. **Udvid `economyCalibrationOverrides.js`** til at modellere renown-multiplier (ikke kun flad
   sponsor pr. division): scorecardet beregner hvert holds renown fra dets simulerede standing +
   aktivitet og anvender multiplikatoren.
2. **`prizeDistributionScorecard.js`**: de stærke drafted rosters får nu renown-skaleret sponsor →
   det modne D1-gap skal lukkes mod break-even-båndet.
3. **`economyCalibrationSweep.js`**: sweep `W_RESULTS × W_ACTIVITY × MAX_MULTIPLIER` × seeds; rangér
   efter (i) modent-felt trukket mod break-even, (ii) **fresh-gaten forbliver grøn**, (iii) Gini falder
   (anti-snowball, jf. spec §6 divergens-monitor).
4. **`moneySupplyScorecard.js --synthetic-only`**: friske hold skal forblive på D1 +3,6k / D2 +13,6k /
   D3 +8,6k (multiplier 1,0 → uændret). **Må ikke regressere.**

**Merge-gate:** sweep finder konstanter hvor modent felt nærmer sig break-even UDEN at bryde
fresh-gaten OG med faldende Gini. De endelige tal bages ind i `renownEngine.js` + dokumenteres i en
kalibrerings-rapport (`docs/audits/2026-06-21-renown-sponsor-calibration.md`).

## 8. Verifikation
- **Backend unit-tests:** `renownEngine` (gulv/loft/arketyper), `sponsorOffers` (determinisme på reload),
  aktivitets-mål-evaluering, kontrakt-låsning under løbetid. `node --test` i `backend/`.
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
  resultat-historik + aktivitet) indtil den fulde motor lander.

## 10. Åbne spørgsmål (afklares i plan/impl, ikke blockers)
- Præcis `MAX_BOARD_MODIFIER` til loft-formlen (læses fra boardUtils).
- Aktivitets-mål-enum: er `none / full_squad / calendar_90` nok, eller skal der flere mål-typer?
- Sponsor-navne-pulje: hvor mange navne (undgå gentagelse på tværs af 22 hold)?
