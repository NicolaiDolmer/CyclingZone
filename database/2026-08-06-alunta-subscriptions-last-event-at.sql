-- #2736 — Alunta fornyelses-/udløbs-events i webhooken: out-of-order-guard.
--
-- BAGGRUND: aluntaWebhook.js dedupliserer eksakte retries via det eksisterende
-- last_event_id-felt, men det siger intet om REKKEFØLGE mellem to FORSKELLIGE
-- events for samme team (fx en forsinket `subscription.cancelled`-levering der
-- ankommer EFTER en nyere `subscription.started` allerede er anvendt — ville
-- uden dette felt fejlagtigt regressere status tilbage til cancelled).
--
-- last_event_at gemmer den seneste ANVENDTE events `payload.timestamp` (Aluntas
-- egen event-tidsstempel-konvention, samme felt webhooken allerede bruger i
-- last_event_id's fallback-format). Et nyt event skal have en STRENGT nyere
-- last_event_at end den lagrede for at blive anvendt — se aluntaWebhook.js's
-- kodekommentar for selve sammenligningslogikken og dens kendte begrænsninger.
--
-- Fail-safe hvis IKKE anvendt: aluntaWebhook.js's opslag efter denne kolonne
-- fejler roligt til `existing = null` (PostgREST returnerer {data:null,error}
-- for en ukendt kolonne, ingen throw) — webhooken falder da tilbage til
-- FØR-#2736-adfærd (ingen out-of-order-beskyttelse, ingen felt-bevarelse ved
-- delvise payloads), men crasher IKKE. Migrationen SKAL dog anvendes før
-- fornyelsen ~24/8 for at få den fulde beskyttelse — se PR-beskrivelsen.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;
