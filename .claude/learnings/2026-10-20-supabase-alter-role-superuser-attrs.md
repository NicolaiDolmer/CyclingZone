# Supabase: ALTER ROLE må ikke nævne superuser-attributter (#6994)

**Symptom:** auto-migrate fejlede 20/10 kl. 21:07 på `database/2026-10-20-6994-cz-monitor-role.sql:61` med `permission denied to alter role`. Migrationen blev ikke registreret, så alle senere migrationer stod i kø bag den.

**Rod-årsag:** Supabases `postgres` er ikke superuser. Fra PG16 kræver ændring af SUPERUSER, REPLICATION og BYPASSRLS superuser, også når de sættes til NO. `ALTER ROLE ... NOSUPERUSER NOREPLICATION NOBYPASSRLS` fejler derfor, selvom værdierne allerede er NO.

**Fix:** ALTER ROLE nævner kun LOGIN, NOINHERIT, NOCREATEDB, NOCREATEROLE og CONNECTION LIMIT. Rollen får de tre superuser-attributter som NO fra CREATE ROLE (standard), og verify-blokken fejler nu, hvis nogen af dem er sat.

**Læring:** Rolle-DDL i en migration skal prøves som den rolle, auto-migrate bruger (`postgres`, ikke superuser), i en transaktion der rulles tilbage. Det skal ske før merge, ikke kun med SELECT-prædikaterne. MCP'ens `execute_sql` kører som samme `postgres`, så `begin; ...; rollback;` dér er nok.
