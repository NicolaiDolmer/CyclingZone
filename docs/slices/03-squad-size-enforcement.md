# Slice S-03 · Trupstørrelse-håndhævelse ved vinduesluk

**Status:** ✅ Leveret v2.29 (2026-05-04). Runtime-verificeret 2026-05-05.

## Leveret og verificeret

- Commit: `2a6e8c0 Feat: S-03 Trupstørrelse-håndhævelse ved vinduesluk (v2.29)`.
- Runtime: `backend/cron.js` importerer og kalder `processSquadEnforcementCron`; `backend/lib/squadEnforcement.js` indeholder `enforceTeamSquadCompliance` + window-level atomic claim på `transfer_windows.squad_enforcement_completed_at`.
- DB/constraints: `database/2026-05-04-squad-enforcement.sql` tilføjer `riders.acquired_at`, `transfer_windows.squad_enforcement_completed_at`, `season_standings.penalty_points`, finance-types `auto_squad_purchase` / `auto_squad_sale` / `squad_violation_fine` og notification-type `squad_enforced`.
- Write-paths: `acquired_at` opdateres i auktionsfinalisering, direkte transfer, swaps, lån-buyout, admin override og pending-team flush.
- Test 2026-05-05: `node --test backend/lib/squadEnforcement.test.js` → 7/7 grønne.

**Ikke genkørt i denne docs-sweep:** manuel beta-smoke med et live hold under/over grænsen. Kode- og teststatus er verificeret; live smoke kan stadig være en P1 drift-check hvis ønsket.

---

## Original brief (bevaret som historik)

## Mål
Når et transfervindue lukker og en manager er under minimum eller over maksimum trupstørrelse, håndhæver systemet automatisk: auto-køb/salg, 100K bøde og 200 point fradrag pr. afvigende rytter.

## Runtime-evidens
- [backend/lib/marketUtils.js:1-5](backend/lib/marketUtils.js): `MARKET_SQUAD_LIMITS = { 1: {min:20,max:30}, 2: {min:14,max:20}, 3: {min:8,max:10} }`
- [backend/lib/marketUtils.js:70-110](backend/lib/marketUtils.js:70): `getTeamMarketState()` — tjek af nuværende trupstørrelse
- [backend/cron.js](backend/cron.js) — 5-min cron der allerede håndterer DD-warnings
- `transfer_windows.closes_at` — eksisterende kolonne fra Deadline Day S1
- Schema: `riders.acquired_at` er leveret via `database/2026-05-04-squad-enforcement.sql`.

## Invariant der beskyttes
- Squad limits håndhæves efter enhver market action (eksisterende invariant fra GUARDRAILS_CORE).
- Ingen manager må gå i sæson med ulovlig trup.
- Bøder og point-fradrag er idempotent (samme cron-kørsel må ikke trække dobbelt).

## Minimal change

### Forudsætning: `riders.acquired_at` migration

```sql
ALTER TABLE riders ADD COLUMN acquired_at TIMESTAMPTZ DEFAULT now();
UPDATE riders SET acquired_at = created_at WHERE acquired_at IS NULL OR team_id IS NULL;
```

Backfill med `created_at` for eksisterende ryttere (= rimeligt udgangspunkt for ord-af-tilegnelse). Live-opdatering ved ejer-skifte tilføjes i alle write-paths.

### Hovedlogik

1. **`backend/lib/squadEnforcement.js` ny pure-function-modul:**
   - `enforceTeamSquadCompliance(teamId, supabase)` — hovedfunktion
   - Læser team_state via `getTeamMarketState()`
   - Beregner violation: under_min (count) eller over_max (count)
   - Hvis under_min:
     - Find billigste tilgængelige AI- eller fri-rytter (uci_points ASC), eksklusiv ryttere ejet af manager teams
     - Beregn pris = `Math.round(market_value * 1.5)`
     - Hvis manager balance < pris → opret nødlån (genbrug eksisterende auto-nødlån-mønster fra economyEngine)
     - Tildel rytter til hold (UPDATE riders SET team_id, acquired_at=now())
     - Træk pris fra balance, log finance_transaction (type='auto_squad_purchase')
     - Gentag indtil ≥ min
   - Hvis over_max:
     - Find rytter med seneste `acquired_at` på holdet
     - Sælg tilbage til AI-pool (UPDATE riders SET team_id=NULL eller ai_team_id)
     - Krediter holdet `market_value` (50% af køb-pris-mønstret? — diskutér: lad os bare give market_value tilbage, undgå dobbelt-straf)
     - Log finance_transaction (type='auto_squad_sale')
     - Gentag indtil ≤ max
   - For hver afvigende rytter (under eller over): træk 100K + 200p fradrag
2. **Bøde + point-fradrag:**
   - `finance_transactions` insert (type='squad_violation_fine', amount=-100000) pr. afvigende rytter
   - `season_standings.bonus_points -= 200` (eller dedikeret `penalty_points`-kolonne hvis vi vil holde dem adskilt)
3. **Cron-trigger i `backend/cron.js`:**
   - Tilføj `processSquadEnforcementCron(supabase)` der fyrer ÉN gang når et transfervindue lukker
   - Idempotency: tilføj `transfer_windows.squad_enforcement_completed_at TIMESTAMPTZ` — atomic claim som Final Whistle-mønstret
4. **Notifikationer til ramt manager:**
   - `notifyTeamOwner(teamId, type='squad_enforced', detail={purchased: [], sold: [], fine: 100000, points: 200})`
   - I-app-besked + Discord DM (hvis enabled)
5. **acquired_at-opdatering i alle relevante paths:**
   - [backend/lib/auctionFinalization.js](backend/lib/auctionFinalization.js) ved finalisering
   - [backend/routes/api.js](backend/routes/api.js) transfer-confirm-flow
   - Swap-confirm-flow
   - Lån-aktivering
   - Og denne nye `enforceTeamSquadCompliance` selv

## Verification path

1. **Unit test `squadEnforcement.test.js`:**
   - Manager med 5 ryttere i D3 (min=8) → kør enforce → forventet: +3 ryttere købt, 300K + 600p fradrag
   - Manager med 12 ryttere i D3 (max=10) → kør enforce → forventet: -2 ryttere solgt, 200K + 400p fradrag
   - Idempotency: kald 2x → second call må ikke gøre noget
2. **Manuelt på beta:**
   - Sæt et hold til 7 ryttere (D3 min=8) via admin
   - Luk transfer window via admin
   - Verificér 1 ryttar købt, 100K trukket, 200p fradrag på season_standings, notifikation sendt
3. **Edge cases:**
   - Hold uden råd → nødlån oprettes
   - Pool tom (alle AI-ryttere ejet) → fail-soft med admin-alert (skal aldrig ske i praksis)

## Out of scope
- UI til at advare manager FØR vinduesluk om at de er over/under (P1 polish — deres ansvar at tjekke).
- Manuel admin-override af fines (P2).
- Differentiation på pris baseret på division (alle bruger 150% × market_value).

## Forudsætninger
- `riders.acquired_at` migration kørt.
- S-01 leveret (salary må ikke skifte mens vi tester).

## Risiko og mitigation
- **Risiko:** Auto-køb/salg tager >30s for stort batch → cron timeout.
- **Mitigation:** Batch per-team i parallel; fail-soft per hold (én manager-fail blokerer ikke næste).
- **Risiko:** Pris 150% × market_value → for billigt sammenlignet med auktion.
- **Mitigation:** Acceptabel tradeoff — det er en STRAF for at gå over, ikke en gratis adgang. Bruger sagde 150%.

## Estimat
1 session (~2-3 timer inklusiv tests + migration).
