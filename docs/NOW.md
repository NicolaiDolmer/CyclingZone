# NOW — Aktuel arbejdsstatus

## Aktiv slice
- `Slice 7 — Integrationer og Discord` — implementeret, klar til deploy.
- Discord-webhooks: Admin kan nu tilføje webhooks med type `general` / `transferhistorik`, sætte standard og sende testbesked.
- Transferhistorik til Discord: gennemførte transfers og byttehandler sendes automatisk til webhook med type `transfer_history`.
- dyn_cyclist sync: Admin kan synkronisere PCM-rytterstats fra Google Sheets via URL-input (match på pcm_id).

## Kræver deploy-handling
- Kør `2026-04-23-discord-settings.sql` i Supabase (opretter `discord_settings`-tabel med `webhook_name` og `webhook_type`).
- Kør `2026-04-24-dyn-cyclist-import-type.sql` i Supabase (udvider import_log check constraint).
- Tilføj webhook-URL i Admin → Discord webhooks (type: general = standard, transfer_history = transferhistorik-kanal).

## Blockers / investigations
- Follow-up: Evne-filter/slider kræver frisk live-reproduktion; ingen statisk root cause fundet.
