-- Discord webhook-outbox (#3545): varig levering af kanal-poster.
-- Søster-tabel til discord_dm_outbox (#1115, 2026-06-10) — samme kontrakt,
-- anden destination: DM'er adresseres på discord_id, kanal-poster på webhook-URL.
--
-- Rod-årsag: discordWebhookDelivery.js har KUN inline-retry (4 forsøg, ~3 sek).
-- Det dækker en 429 (millisekunder), men ikke et Discord-5xx-udfald (minutter).
-- 7/8 22:21-22:23 tabte 8 auktions-annonceringer permanent på præcis den måde.
-- Nu: retryable fejl der overlever inline-forsøgene lander her, og en drain-cron
-- (hvert 5. minut) prøver igen med eksponentiel backoff over ~27 timer.
--
-- IDEMPOTENS: Discord opretter kun beskeden ved 2xx, så et genforsøg efter
-- 429/5xx/netværksfejl kan pr. definition ikke give en dublet (samme argument
-- som i discordWebhookDelivery.js's modul-header).

CREATE TABLE IF NOT EXISTS discord_webhook_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_url     text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dead')),
  attempts        integer NOT NULL DEFAULT 1,
  next_attempt_at timestamptz NOT NULL,
  last_status     integer,
  last_error      text,
  dead_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Drain-query: WHERE status='pending' AND next_attempt_at <= now() ORDER BY next_attempt_at
CREATE INDEX IF NOT EXISTS discord_webhook_outbox_drain_idx
  ON discord_webhook_outbox (next_attempt_at)
  WHERE status = 'pending';

-- webhook_url indeholder Discords webhook-token. Det er samme fortrolighedsklasse
-- som discord_settings.webhook_url (samme database, samme service_role-only-adgang),
-- så outbox'en introducerer ingen ny eksponering. Kun service_role (backend) rører
-- tabellen: RLS enabled uden policies blokerer anon/authenticated helt.
ALTER TABLE discord_webhook_outbox ENABLE ROW LEVEL SECURITY;
