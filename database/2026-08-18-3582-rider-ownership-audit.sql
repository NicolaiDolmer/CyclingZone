-- #3582 · Bevægelses-log for rytter-ejerskab.
--
-- BAGGRUND: to sammenhængende huller blev synlige samme dag (#3577-målingen):
--
--   1. #3561's oprydning slettede sit eget bevismateriale. De fire defekte
--      akademi-ryttere blev slettet, og med dem forsvandt auctions/auction_bids
--      for netop de auktioner spillerne havde disponeret ud fra (auctions.rider_id
--      har ON DELETE CASCADE til riders, se schema.sql). Budhistorikken kunne kun
--      genskabes fordi notifications tilfældigvis overlevede med fritekst-strenge.
--      Beviset for en økonomisk hændelse må ikke afhænge af at en helt anden
--      tabel ikke er ryddet op.
--   2. #3580's bagudrettede sweep ("completed auktioner hvor rytteren ikke står
--      hos vinderen") fandt 21 kandidater, men kun ÉN kunne bekræftes — fordi der
--      ingen kilde findes til HVORFOR en rytter skiftede hold. finance_transactions.
--      related_entity_id peger ikke på rytteren, transfer_offers dækker kun
--      handler/bytter (ikke frigivelse→fri agent, akademi-oprykning, sæsonskifte,
--      admin), og der findes ingen bevægelses-log at holde noget op imod.
--
-- DENNE migration retter begge: én række pr. ejerskabsskifte, uafhængig af
-- riders/auctions/teams' egen levetid (se rider_id/team_id-designet nedenfor),
-- så invarianten "vinder af en afsluttet auktion ejer rytteren, medmindre han er
-- flyttet videre ad en dokumenteret vej" kan håndhæves OG efterprøves bagudrettet.
--
-- SKRIVES IKKE HERFRA — kode-callsites (auctionFinalization.js,
-- stageRaceTransferDefer.js, transferExecution.js, routes/api.js admin/override-rider)
-- kalder backend/lib/riderOwnershipAudit.js::recordRiderOwnershipEvent() efter en
-- bekræftet ejerskabsmutation. Skrivning er BEST-EFFORT (try/catch, non-fatal) —
-- samme princip som alle andre berigelses-sideeffekter i finaliserings-stien
-- (kontraktudløb-notifikationen, #3401-reveal): en fejlet audit-INSERT må ALDRIG
-- kunne rulle en allerede-committet ejerskabsændring tilbage.
--
-- MIGRATION APPLIES IKKE VED PR-oprettelse (ejer-mandat #2642: Claude applier
-- SELV, men KUN efter merge, idempotent + post-verify). Denne fil er ren plan
-- indtil da.
--
-- Idempotent BY DESIGN (CREATE ... IF NOT EXISTS + DROP/ADD CONSTRAINT-parret,
-- samme mønster som 2026-05-09-audit-log-foundation.sql) — IKKE afprøvet mod en
-- levende database endnu, da migrationen bevidst ikke er kørt (se ovenfor).
-- Post-verify ved apply: genkør filen én gang til og bekræft 0 fejl + samme
-- rækkeantal i information_schema.columns/pg_indexes for tabellen.
--
-- Rollback (idempotent):
--   DROP TABLE IF EXISTS rider_ownership_events;

-- ============================================================
-- 1. rider_ownership_events
-- ============================================================

CREATE TABLE IF NOT EXISTS rider_ownership_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- #3561-lektien: INGEN FK til riders(id). auctions.rider_id har ON DELETE
  -- CASCADE, og en fremtidig oprydning af defekte ryttere kunne på samme måde
  -- rydde et FK-bundet revisionsspor med sig — præcis det denne tabel findes
  -- for at forhindre. rider_id er derfor en plain UUID (ingen FK, ingen
  -- CASCADE, ingen SET NULL) — raekken overlever uanset rytterens skæbne.
  -- rider_firstname/rider_lastname er et NAVNE-SNAPSHOT taget ved
  -- event-tidspunktet (samme mønster som notifications' fritekst, der reddede
  -- #3561-opgørelsen) så en senere sletning ikke gør raekken ulæselig.
  rider_id            UUID NOT NULL,
  rider_firstname     TEXT,
  rider_lastname      TEXT,

  -- from/to: NULL = fri agent (frigivelse TIL fri agent, eller erhvervelse
  -- FRA fri agent/akademi-fri-agent). ON DELETE SET NULL (ikke CASCADE) — et
  -- slettet hold (skulle aldrig ske i praksis) må ikke fjerne raekken, kun
  -- afidentificere den ene side.
  from_team_id        UUID REFERENCES teams(id) ON DELETE SET NULL,
  to_team_id          UUID REFERENCES teams(id) ON DELETE SET NULL,

  -- Hvorfor skiftede rytteren hold. Listen er de veje der FAKTISK muterer
  -- riders.team_id/pending_team_id i kodebasen pr. 2026-08-18 (#3582-issuets
  -- egen liste) + 'academy_promotion' reserveret (endnu ikke wired i denne PR,
  -- se PR-beskrivelsen for hvilke stier der IKKE er dækket endnu).
  reason              TEXT NOT NULL,

  -- Samme kontrakt som finance_transactions.related_entity_type/_id
  -- (2026-05-09-audit-log-foundation.sql) — 'auction'/'transfer'/'swap'/
  -- 'manual', værdien der udløste skiftet (auktions-id, transfer_offers-id,
  -- swap_offers-id). Ingen FK (målet er på tværs af flere tabeller).
  related_entity_type TEXT,
  related_entity_id   UUID,

  -- Samme aktør-kontrakt som finance_transactions.
  actor_type          TEXT,
  actor_id            UUID,

  -- occurred_at = hvornår ejerskabet FAKTISK ændrede sig (kalderens actualEnd/
  -- flushedAt/now() — kan afvige fra created_at ved en forsinket cron-retry).
  -- created_at = hvornår raekken blev skrevet (ren INSERT-bogføring).
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Cron-/retry-sikkerhed: samme idempotency_key-mønster som
  -- finance_transactions, så en gen-finalize af samme auktion (23505-stien i
  -- auctionFinalization.js) ikke skriver duplikat-raekker.
  idempotency_key     TEXT
);

ALTER TABLE rider_ownership_events
  DROP CONSTRAINT IF EXISTS rider_ownership_events_reason_check;
ALTER TABLE rider_ownership_events
  ADD CONSTRAINT rider_ownership_events_reason_check CHECK (reason IN (
    'auction_win',
    'guaranteed_bank_sale',
    'trade',
    'swap',
    'release',
    'free_agent_signing',
    'academy_promotion',
    'season_transition',
    'admin',
    'stage_race_deferred_flush'
  ));

ALTER TABLE rider_ownership_events
  DROP CONSTRAINT IF EXISTS rider_ownership_events_related_entity_type_check;
ALTER TABLE rider_ownership_events
  ADD CONSTRAINT rider_ownership_events_related_entity_type_check
    CHECK (related_entity_type IS NULL OR related_entity_type IN
      ('auction', 'loan', 'transfer', 'swap', 'race', 'season', 'manual'));

ALTER TABLE rider_ownership_events
  DROP CONSTRAINT IF EXISTS rider_ownership_events_actor_type_check;
ALTER TABLE rider_ownership_events
  ADD CONSTRAINT rider_ownership_events_actor_type_check
    CHECK (actor_type IS NULL OR actor_type IN ('cron', 'api', 'admin', 'system', 'migration'));

-- ============================================================
-- 2. Indices
-- ============================================================

-- "hvem ejede denne rytter hvornår" — den primære forespørgsel #3580's sweep
-- og enhver fremtidig kompensations-opgørelse har brug for.
CREATE INDEX IF NOT EXISTS idx_rider_ownership_events_rider
  ON rider_ownership_events (rider_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_rider_ownership_events_to_team
  ON rider_ownership_events (to_team_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_rider_ownership_events_from_team
  ON rider_ownership_events (from_team_id, occurred_at DESC);

-- Krydsreference til den udløsende auktion/handel/bytte — svarer til
-- idx_finance_related i 2026-05-09-audit-log-foundation.sql, så et beløb og
-- et ejerskabsskifte kan slås op fra samme related_entity_id.
CREATE INDEX IF NOT EXISTS idx_rider_ownership_events_related
  ON rider_ownership_events (related_entity_type, related_entity_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_rider_ownership_events_idempotency_key
  ON rider_ownership_events (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================
-- 3. RLS — service_role-only, samme mønster som discord_webhook_outbox
--    (2026-08-10) og admin_log: kun backend (service_role) skriver/læser
--    denne tabel. RLS enabled UDEN policies blokerer anon/authenticated helt.
-- ============================================================

ALTER TABLE rider_ownership_events ENABLE ROW LEVEL SECURITY;
