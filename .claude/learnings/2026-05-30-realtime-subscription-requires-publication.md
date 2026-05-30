# Realtime-subscription kræver at tabellen ligger i supabase_realtime publication

**Dato:** 2026-05-30
**Issue:** #783 (+ Standings/Resultater-klynge), PR #789
**Bed 2. gang** — første gang #196 (auctions, 2026-05-08).

## Symptom

Rangliste/Resultater/Dashboard opdaterede ikke efter en resultat-import — kun
ved hård reload. Frontend "live"-data var tavs.

## Rod

To-delt, men kerne-fælden er #2:

1. Siderne abonnerede slet ikke — kun `useEffect(() => loadAll(), [])` (mount-only).
2. Selv da subscriptionen blev tilføjet, ville den være **tavs** fordi tabellerne
   (`season_standings`, `race_results`, `seasons`) ikke lå i `supabase_realtime`
   publication. Kun `auctions` + `auction_bids` var nogensinde tilføjet (#196).

## Regel fremover

**Når du tilføjer en `postgres_changes`-subscription på en ny tabel, så tjek FØRST
at tabellen er i publicationen:**

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

Mangler den → tilføj en idempotent migration (`ALTER PUBLICATION supabase_realtime
ADD TABLE public.<tabel>` bag `NOT EXISTS`-tjek) OG bekræft at tabellen har en
SELECT-policy for den indloggede rolle (realtime filtrerer events via RLS — uden
SELECT-adgang leveres intet).

Verificér end-to-end uden UI/login: lille node-script med publishable key der
abonnerer + en no-op `UPDATE ... SET col = col` via service-rolle → eventet skal
ankomme.

## Forward-guard-kandidat

Overvej en CI- eller doctor-check der krydsrefererer alle frontend
`.on("postgres_changes", { table })`-kald mod `pg_publication_tables` og fejler
hvis en abonneret tabel mangler i publicationen. Ville have fanget begge tilfælde.
