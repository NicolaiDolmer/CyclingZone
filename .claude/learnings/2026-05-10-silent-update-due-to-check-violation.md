# 2026-05-10 · Silent UPDATE-fail pga. ulovlig CHECK-værdi (#270 follow-up)

## Symptom
Bruger klikker "🗑️ Fjern fra transferlisten" (ny knap shipped tidligere samme dag som #270 v3.05). Toast viser "✅ Rytter fjernet". `loadAll()` re-fetcher. Men listingen forbliver i markedet — rytteren er IKKE fjernet. Symptomet beskrevet som "der sker ikke noget".

## Root cause
[`backend/routes/api.js:1434`](../../backend/routes/api.js) (før fix):
```js
await supabase.from("transfer_listings").update({ status: "closed" }).eq("id", req.params.id);
res.json({ success: true });
```

`transfer_listings.status` har CHECK-constraint:
```sql
status = ANY (ARRAY['open', 'negotiating', 'sold', 'withdrawn'])
```

**`'closed'` er ikke i enum'en.** Postgres afviser UPDATE'en med `check_violation`, men:
1. `await` returnerer en `{ data, error }`-struktur (ikke en throw)
2. Kode ignorerede `error`
3. Endpointet returnerede `success:true` til frontend
4. Frontend viste grøn toast og kaldte `loadAll()` — listing forbliver `status='open'` i DB
5. Listingen dukker op igen i markedet

## Hvordan det blev opdaget
Bruger rapporterede mid-session: "knappen virker ikke". Direkte query mod prod via Supabase MCP afslørede CHECK-constraint enum'en. Sammenligning med søsterkode (`transfer_offers`/`swap_offers` withdraw-flows) viste at de bruger `'withdrawn'`, ikke `'closed'`.

## Fix
- Skift til `'withdrawn'` (matcher CHECK-enum + samme semantik som søsterkode)
- Propagér Supabase-fejl som 500 i stedet for at sluge dem
- Test opdateret til at bruge `'withdrawn'` som `already_closed`-case (i stedet for ikke-eksisterende `'closed'`)

## Lessons learned

### 1. Supabase JS client returnerer fejl, throw'er ikke
Pattern ses utallige steder i kodebasen:
```js
const { error } = await supabase.from(X).update(Y);
if (error) return res.status(500).json({ error: error.message });
```
Men én glemt error-check og fejlen er silent. CI tester ikke runtime DB-state mod CHECK-constraints. Heller ikke stat-tests fanger det fordi tests ofte mock'er Supabase eller bruger ren-funktion-helpers.

**Værktøj:** Søg efter alle `.update(...)` kald uden `error`-håndtering når man laver et review:
```bash
rg "\.update\([^)]+\)\.eq\(" backend/ -A 1 | rg -B 1 -v "error"
```

### 2. Status-strings bør matche enum'en bogstaveligt
Når flere tabeller har lignende `status`-kolonner (`transfer_listings`, `transfer_offers`, `swap_offers`, `loan_offers`), er det fristende at antage at "closed", "cancelled", "withdrawn" alle er gyldige overalt. **De er ikke.** Hver tabel har sin egen CHECK-enum.

**Værktøj:** Før man skriver en ny `status: "X"` UPDATE, kør:
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'TABLE_NAME'::regclass AND contype = 'c';
```
…eller bare brug Read-tool på `database/schema.sql`.

### 3. UI-success ≠ DB-success
Frontend gjorde det rigtige: tjekkede `res.ok`, viste passende toast, kaldte refresh. Men "200 OK" fra backend var en løgn. Dette er klassisk distributed-systems-problem: trust boundaries.

**Princip:** Når man laver en write-operation, vis ikke success før man har bekræftet write'en faktisk landede. Enten via:
- Returnér det opdaterede objekt og verificér det matcher forventet state (frontend kan tjekke `data.status === "withdrawn"`)
- Eller fail-loud i backend (som denne fix gør)

### 4. Test-case-data bør matche schema
Den existerende test brugte `status: "closed"` som `already_closed`-eksempel. Det fungerede som unit-test fordi pure-helperen `getListingCancelIssue` ikke validerer mod schema — den tjekker bare `status !== "open" && status !== "negotiating"`. Men det hider at `'closed'` ikke er en mulig state i virkeligheden. Testen var teknisk korrekt men semantisk vildledende, og den forhindrede ikke bug'en.

**Princip:** Unit-tests bør bruge realistiske data der matcher schema. Hvis der er en CHECK-enum, brug værdier fra enum'en som testdata.

## Relaterede issues
- [#270](https://github.com/NicolaiDolmer/CyclingZone/issues/270) — knap shipped i v3.05 (commit `b7b2d36`)
- [#270 follow-up](https://github.com/NicolaiDolmer/CyclingZone/pull/272) — denne fix shipped i v3.07 (commit `41d1a4a`)
