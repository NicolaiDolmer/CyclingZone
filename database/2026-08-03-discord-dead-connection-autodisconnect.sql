-- Auto-afkobling af døde Discord-koblinger (#3130, ejer valgte vej A 3/8).
--
-- Problem: en spiller der forlader vores Discord-server kan ikke længere DM'es
-- (Discord-kode 50278, "no mutual guilds" → HTTP 403). Vi klassificerede fejlen
-- korrekt som permanent og droppede beskeden — men lod discord_id blive stående.
-- Resultat: spilleren så "Discord tilsluttet" i indstillingerne og modtog aldrig
-- en eneste DM igen, mens hver fremtidig notifikation lavede et nyt spildt
-- API-kald der 403'ede. Tilstanden var permanent, selv-vedligeholdende og usynlig.
--
-- Vej A: tæl PÅ HINANDEN FØLGENDE permanente 'recipient-blocked'-fejl pr. bruger.
-- Ved tærsklen (3, se DEAD_CONNECTION_THRESHOLD i backend/lib/discordDeadConnection.js)
-- nulstilles discord_id, og discord_disconnected_at sættes. Indstillingerne viser
-- så "Discord disconnected — reconnect to receive messages" i stedet for tavshed.
--
-- Tælleren nulstilles ved hver leveret DM (derfor "på hinanden følgende"), så en
-- enkelt gammel fejl ikke akkumulerer mod tærsklen over måneder.
--
-- Additiv + idempotent. Ingen backfill: eksisterende brugere starter på 0 og
-- afkobles først hvis de faktisk fejler 3 gange i træk fremover.
--
-- Bemærk: discord_disconnected_at RYDDES IKKE ved genforbindelse. Banneret vises
-- kun når discord_id IS NULL AND discord_disconnected_at IS NOT NULL, så det
-- forsvinder af sig selv når spilleren gemmer et nyt id — og tidsstemplet
-- bevares som historik.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS discord_dm_failure_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discord_disconnected_at TIMESTAMPTZ;

-- PostgREST cacher skemaet: uden reload ser backendens Supabase-klient ikke de
-- nye kolonner, og /me/discord-status + tælleren fejler indtil næste genstart.
NOTIFY pgrst, 'reload schema';

COMMENT ON COLUMN users.discord_dm_failure_count IS
  'Antal PÅ HINANDEN FØLGENDE permanente Discord-DM-fejl (recipient-blocked). Nulstilles ved leveret DM og ved auto-afkobling. #3130';
COMMENT ON COLUMN users.discord_disconnected_at IS
  'Hvornår vi auto-afkoblede en død Discord-kobling (#3130). Sammen med discord_id IS NULL styrer den genforbind-banneret i indstillingerne.';
