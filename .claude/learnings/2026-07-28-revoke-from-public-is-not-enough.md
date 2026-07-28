# `REVOKE ALL ... FROM PUBLIC` lukker ikke en ny funktion i dette projekt

**Dato:** 2026-07-28
**Issue:** #3013 · **PR:** #3058 (migration applied post-merge)
**Berørt:** `database/2026-07-27-3013-refresh-matviews-concurrently.sql`

## Hvad der skete

Migrationen oprettede fire nye `SECURITY DEFINER`-funktioner og lukkede dem, som man plejer:

```sql
REVOKE ALL ON FUNCTION public.refresh_rider_rankings_mv() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_rider_rankings_mv() TO service_role;
```

Post-verify (som PR'en selv havde skrevet queryen til) viste noget andet:

```
refresh_rider_rankings_mv | anon,authenticated,postgres,service_role
refresh_ranking_matviews  | postgres,service_role          ← den gamle, korrekt
```

Supabase-projekter har `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated`. Den grant lægges på ved `CREATE`, og **`REVOKE ... FROM PUBLIC` rører den ikke** — `PUBLIC` og en eksplicit rolle-grant er to forskellige ting i Postgres' privilegie-model.

Resultatet var fire `SECURITY DEFINER`-funktioner, kaldbare af enhver besøgende via PostgREST RPC, som hver tager **ACCESS EXCLUSIVE**-lås på en rangliste-matview. Et loop mod dem ville have blokeret /rider-rankings, /standings, /results og Global Rank-widgetten uden nogen form for autentifikation.

Lukket med en opfølgende migration der eksplicit revoker fra `anon, authenticated`.

## Læring

**Den defensive linje man har skrevet tusind gange kan være no-op i netop dette projekt.**
`REVOKE FROM PUBLIC` er korrekt Postgres og ser rigtigt ud i review — den er bare
utilstrækkelig når default-privileges giver navngivne roller adgang. Vil man lukke en ny
funktion her, skal det være:

```sql
REVOKE ALL ON FUNCTION public.f() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.f() TO service_role;
```

**Post-verify er ikke ceremoni.** PR'en havde selv skrevet den rigtige query med det
rigtige forventede resultat ("kun service_role pr. funktion"). Havde jeg applied
migrationen og sprunget verifikationen over, fordi den var "additiv og idempotent", var
hullet gået live og havde stået åbent til nogen ledte efter det. Forskellen mellem en
sikker og en usikker migration var her ét SELECT efter apply.

**Backwards-check gav ro:** en sweep over alle `prosecdef=true`-funktioner i `public`
fandt kun én anden med anon-adgang — `is_admin()`, som er argumentløs og kun rapporterer
om `auth.uid()`. Det er det tilsigtede RLS-predikat-mønster og skal være kaldbart. Ingen
øvrige forekomster.

## Forward-guard

#2830 (systematisk audit af brede grants + default-privileges-guard) er den rigtige
permanente løsning — en CI-guard der fejler når en ny `SECURITY DEFINER`-funktion ender
med `anon`/`authenticated` i sine grants ville have fanget dette i selve PR'en i stedet
for i post-verify. Dette fund er konkret evidens for at det issue er værd at prioritere.
