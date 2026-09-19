-- #3624 — Udgaaende koe for LOEBS-notifikationer (notify ud af den blokerende sti)
-- ============================================================================
-- Maaling: docs/audits/2026-09-18-3624-loebsforsinkelser.md §3+§5.
-- Notify-fasen (Discord-embeds til divisionens kanaler) er efter #5182/#5204 det
-- stoerste enkeltbidrag til koetiden i stage-scheduleren: en SIDSTE etape koster
-- 54 s i median mod 8 s for en mellem-etape, og "board faerdig → notifikation ude"
-- alene er 25-62 s af det. Hele koen af forfaldne etaper venter paa at et eksternt
-- Discord-kald er returneret, foer den naeste etape overhovedet begynder.
--
-- Denne tabel er afleverings-punktet: afviklingen SKRIVER beskeden her (hurtigt,
-- lokalt) og et selvstaendigt tick SENDER den. Afviklingen venter aldrig paa
-- Discord igen.
--
-- ADDITIV + IDEMPOTENT. Migrationen aendrer INGEN adfaerd af sig selv: tabellen er
-- tom og urort indtil `race_notify_outbox_enabled` er "on". Flag OFF = notify
-- sendes synkront praecis som i dag (bit-identisk). Flag-flip er ejer-only.
--
-- ── KONTRAKTEN (rapportens §5, bindende) ────────────────────────────────────
-- 1) RAEKKEFOELGE: koe-raekken committes FOER races.finalize_state markerer
--    notify-trinnet udfoert (#4147). Afviklingen indsaetter inde i notify-trinnet,
--    og #4147 markerer foerst i sit `finally` — et nedbrud imellem de to skridt
--    efterlader derfor en umarkeret raekke, ikke en tabt besked.
-- 2) UNIK NOEGLE pr. (loeb, beskedtype, modtager-kanal): en genkoersel af
--    afslutningen (recovery, #4147-genoptagelse, manuel re-finalisering) rammer
--    ON CONFLICT DO NOTHING i stedet for at laegge en dublet i koen. En dubleret
--    resultat-besked er synlig for spillerne; en manglende er ikke.
--    Kanalen noegles paa `channel_key` (SHA-256 af webhook-URL'en), ikke paa
--    URL'en selv: Discords webhook-token skal ikke staa i et indeks eller i en
--    constraint-fejltekst. `webhook_url` bliver staaende som ren leverings-adresse.
-- 3) LEVERINGSSTATUS + LEASE: pending → sending → sent/failed. `lease_expires_at`
--    goer, at to afsender-tick ikke kan tage samme raekke (claim'en er en
--    betinget UPDATE paa status), og at en raekke der haenger i `sending` — fordi
--    processen doede midt i et HTTP-kald — kan tages igen naar leasen udloeber.
-- 4) RETRY: begraenset antal forsoeg med backoff, derefter `failed` + Sentry.
--    En Discord-fejl maa aldrig kunne vaelte afviklingen — og efter dette skridt
--    kan den det pr. konstruktion ikke, for afviklingen roerer ikke Discord.
--
-- Foortrolighed: `webhook_url` baerer Discords webhook-token, samme klasse som
-- discord_settings.webhook_url og discord_webhook_outbox.webhook_url (samme
-- database, samme service_role-only-adgang). Ingen ny eksponering.

CREATE TABLE IF NOT EXISTS public.race_notify_outbox (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id          UUID NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  -- Beskedtype, ikke kanal-type: 'race_result' er den eneste i dag. Nye typer
  -- (fx et etape-resume) faar deres egen vaerdi og deler noeglen uden migration.
  message_type     TEXT NOT NULL,
  -- SHA-256 (hex) af webhook-URL'en. Se punkt 2 ovenfor.
  channel_key      TEXT NOT NULL,
  webhook_url      TEXT NOT NULL,
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  -- 0 = endnu ikke forsoegt. Taelles op naar en afsender CLAIMER raekken, ikke
  -- naar den lykkes — ellers ville en proces der doer midt i et kald kunne
  -- genforsoege i det uendelige uden nogensinde at naa maxAttempts.
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  leased_at        TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  failed_at        TIMESTAMPTZ,
  last_status      INTEGER,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Punkt 2: dublet-vaernet. Unikt INDEX (ikke tabel-constraint) er nok som
-- ON CONFLICT-arbiter og kan oprettes idempotent med IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_race_notify_outbox_race_type_channel
  ON public.race_notify_outbox (race_id, message_type, channel_key);

-- Afsender-tikkets claim-query: forfaldne raekker der enten venter eller hvis
-- lease er udloebet. Partielt, saa leverede/opgivne raekker ikke fylder i indekset.
CREATE INDEX IF NOT EXISTS idx_race_notify_outbox_due
  ON public.race_notify_outbox (next_attempt_at)
  WHERE status IN ('pending', 'sending');

-- Opryddningen (sent-raekker aeldre end retentionen) laeser paa denne.
CREATE INDEX IF NOT EXISTS idx_race_notify_outbox_retention
  ON public.race_notify_outbox (sent_at)
  WHERE status = 'sent';

COMMENT ON TABLE public.race_notify_outbox IS
  '#3624: udgaaende koe for eksterne loebs-notifikationer (Discord-kanalposter). '
  'Afviklingen afleverer her og venter aldrig paa Discord; backend/cron.js'' '
  'notify-outbox-tick sender. Unik paa (race_id, message_type, channel_key) mod '
  'dubletter ved genkoersel af afslutningen; status+lease mod dobbelt-afsendelse '
  'fra to tick. Skrives kun naar race_notify_outbox_enabled er on. '
  'IKKE det samme som discord_webhook_outbox (#3545), som er en RETRY-koe for '
  'poster der allerede har fejlet i den synkrone sti.';

COMMENT ON COLUMN public.race_notify_outbox.channel_key IS
  '#3624: SHA-256 (hex) af webhook_url. Dublet-noeglens kanal-led — URL''en selv '
  'baerer Discords token og hoerer ikke i et indeks eller en fejltekst.';

COMMENT ON COLUMN public.race_notify_outbox.lease_expires_at IS
  '#3624: tidsstemplet lease. En raekke i status=sending kan foerst tages af et '
  'andet tick naar denne er passeret — saa overlever koen at en proces doer midt '
  'i et Discord-kald uden at beskeden hverken tabes eller sendes to gange.';

-- RLS: kun service_role (backend). Ingen policies = anon/authenticated blokeret
-- helt. Samme moenster som rider_ability_race_day_history og
-- discord_webhook_outbox; der findes ingen spiller-vendt laesning af koen.
ALTER TABLE public.race_notify_outbox ENABLE ROW LEVEL SECURITY;

-- ── Feature-flag (default OFF) ───────────────────────────────────────────────
-- OFF = notify sendes synkront i afviklingen, bit-identisk med i dag.
-- Flippet er EJER-ONLY og faar sit eget kort: effekten maales paa en stor
-- klynge kl. 12 eller 18 med samme SELECT som rapportens §1.
INSERT INTO public.app_config (key, value, description)
  VALUES (
    'race_notify_outbox_enabled',
    -- JSON-strengen "off", ikke den bare identifikator: app_config.value er jsonb
    -- (2026-05-16-app-config.sql), saa 'off'::jsonb ville fejle ved parse.
    '"off"'::jsonb,
    'When on, the race finalization hands external result notifications (Discord channel posts) to race_notify_outbox and a dedicated cron tick delivers them, instead of sending them inline while the stage queue waits (#3624). Off = unchanged synchronous behaviour. In-app notifications always stay in the synchronous path.'
  )
  ON CONFLICT (key) DO NOTHING;
