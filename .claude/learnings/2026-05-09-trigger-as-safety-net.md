# 2026-05-09 · BEFORE INSERT-trigger som safety-net for "glemte" payload-felter

## Symptom
Slice 07h startede med antagelse om at 07d Fase B (v2.92) havde populeret `season_id` + `reason_code` på alle finance_transactions. Runtime-tjek mod prod afslørede:
- 77/79 rows havde `reason_code = NULL`
- 79/79 rows havde `season_id = NULL`

## Root cause
- **Legacy rows** (før v2.92) blev aldrig backfill'et — soak-gaten i v2.92 verificerede kun nye rows.
- **`auctionFinalization.js` glemte `season_id` i payload** til `increment_balance_with_audit`-RPC. Selv om creditTeam/debitTeam-wrapperne understøtter feltet, kalder finalizer'en RPC'en direkte og udelod det.

## Løsning
To-trins approach:

1. **Backfill via heuristisk SQL CASE** på `type` + `description`. Alle 79 rows var auktion-rows (verificeret før migration), så mappingen var entydig: `transfer_out + 'Købt ... på auktion'` → `auction_winner_payment`, `transfer_in + 'Solgt ... på auktion'` → `auction_seller_payout`.

2. **BEFORE INSERT-trigger** der auto-stamper `season_id` fra aktiv sæson hvis NULL:

```sql
CREATE OR REPLACE FUNCTION fill_finance_tx_season() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.season_id IS NULL THEN
    SELECT id INTO NEW.season_id
    FROM seasons WHERE status = 'active'
    ORDER BY number DESC LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Resultat: 26 callsites behøver ikke ændres. Triggeren er central, dybt testbar (Postgres) og fanger fremtidige glemsomheder.

## Lære
- **Triggers > callsite-disciplin** når du har 26 places at glemme det samme felt
- **Antag ikke spec'er holder** — kør runtime-SQL FØR du skriver kode der bygger på "07d er LIVE"
- **Sample faktiske rows** (`GROUP BY type, description`) før heuristisk migration — ellers er dit CASE en gætværk
- **Triggers er ikke en undskyldning for sjusk** — opfølgnings-issue ([#240](https://github.com/NicolaiDolmer/CyclingZone/issues/240)) auditer alle 26 callsites for at sikre de eksplicit sætter feltet

## Genbrug
Pattern kan replikeres for andre invariants:
- `idempotency_key` på cron-paths (fanger duplicate-runs)
- `actor_type` på finance_transactions (kunne defaulte til 'system' hvis NULL)
- `created_by` på admin_log (kunne defaulte til auth.uid())

## Verifikationsteknik
Privacy-test mønster der replikeres fra denne slice — input-tampering for at fange field-leakage:

```js
test("topTransactions — public output strips audit internals", () => {
  const result = topTransactions([tx({
    actor_id: "secret-uuid",
    before_balance: 999999,
    idempotency_key: "secret-key",
  })], 1);
  assert.ok(!("actor_id" in result.top_in[0]));
  assert.ok(!("before_balance" in result.top_in[0]));
});
```

Værdifuld for ENHVER endpoint der returnerer team-private data.
