# 2026-07-26: Supabase RAM-incident — 522 på tværs af auth+REST (Micro-instans løb tør)

## Hvad skete

~18:15-18:41 CEST: Micro-instansen (1 GB RAM, ~256 MB shared_buffers) løb tør under normal aftenlast. Postgres holdt op med at acceptere **nye** forbindelser (eksisterende sessioner kørte delvist videre), så Cloudflare returnerede 522 på `/auth/v1/user` og `/rest/v1/*`. Spillere fik fejl; backend-sweeps (market, Discord DM-outbox, role-sync) fejlede med 522/HTML-fejlsider. 12 Sentry-issues, alle fallout.

## Fix

- Akut: ejer opgraderede compute Micro→Small (2 GB) kl. ~18:37; RESIZING tog ~4 min, `/health` meldte `db:ok` 18:41. Sweeps samlede selv efterslæb op (0 overdue auctions, 0 pending DMs efter recovery).
- Opfølgning (grundlast-reduktion): #3033 (backend JWT lokalt i stedet for `/auth/v1/user` pr. request — største enkeltkilde), #3034 (3 users-opslag pr. side-load → 1 + cache), #3035 (Realtime-audit; `list_changes` tog 11 s under presset).

## Læringer

1. **522 fra Supabase = instansen er løbet tør, ikke netværk.** Diagnose-rækkefølge: `get_project` status → postgres-log (statement timeouts, checkpoint-buffers) → API-log (522-mønster). `execute_sql`/advisors der timer ud er i sig selv symptomet.
2. **Advarslen "RAM under pres" i dashboardet er en forvarsling, ikke kosmetik** — næste trin er connection-refusal. Reagér på advarslen, ikke på nedbruddet.
3. **shared_buffers afslører instans-størrelse** uden dashboard-adgang: checkpoint-loggen ("wrote N buffers (X%)") → total buffers × 8 kB ≈ shared_buffers ≈ 25% af RAM.
4. **Backendens `/health` (DB-round-trip) er den rigtige recovery-probe** — REST-gatewayens 401 beviser kun at Kong er oppe, ikke at DB svarer.
5. **Auth-kald pr. request er en skjult DB-multiplikator.** GoTrue slår op i DB pr. `getUser()`; under pres bliver auth den første synlige fejlkilde.
