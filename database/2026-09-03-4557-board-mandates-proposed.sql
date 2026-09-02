-- #4557 S-M2c "Årsmødet" — verifikation/udvidelse af board_mandates-skemaet.
-- Spec: docs/slices/09c-board-annual-meeting.md §4.9
-- Grundlag: database/2026-08-18-3514-mandate-model.sql (oprettede tabellerne)
--
-- ============================================================================
-- HVORFOR DENNE MIGRATION ER SÅ LILLE: de to strukturelle krav §4.9 beder om
-- er ALLEREDE opfyldt af 2026-08-18-3514-mandate-model.sql, verificeret mod
-- migrationens tekst (ikke gættet):
--
--   1. "status-check-constraint udvides med proposed/completed/lapsed" — den
--      oprindelige constraint er allerede
--        check (status in ('draft','proposed','active','completed','lapsed'))
--      Alle fem værdier `proposeNextMandate`/`signMandate`/auto-accept-cronen
--      bruger (proposed → active → completed, samt lapsed reserveret til
--      teoretisk fremtidig brug) var altså allerede gyldige — kun
--      *populationen* har hidtil kun brugt 'active' (migrationsscriptets
--      backfill skrev alle 237 rækker direkte som active).
--
--   2. "partial unique index (team_id, season_id) where status in
--      ('proposed','active')" — den eksisterende
--        uq_board_mandates_team_season on (team_id, season_id)
--      er IKKE partial, men er dermed STRENGERE end det bedte: den forbyder
--      to mandat-rækker for samme (hold, sæson) uanset status, ikke kun for
--      proposed/active. Det er den rigtige regel her: `proposeNextMandate`
--      (boardMandateEngine.js) slår ALTID sæson-rækken op FØRST og skriver
--      KUN når den findes, og lader helt være at skrive (`{skipped:
--      "target_season_not_found"}`) hvis kalenderen ikke er materialiseret så
--      langt frem — der indsættes derfor aldrig et NULL `season_id`, som ville
--      have gjort den eksisterende (ikke-partial) unique-indeks utilstrækkelig
--      (Postgres behandler NULL som forskellig fra NULL i en unique-nøgle).
--      En ny, snævrere partial-indeks ville derfor kun LEMPE beskyttelsen
--      (tillade fx to 'completed'-rækker for samme sæson), ikke stramme den —
--      det bygges bevidst ikke.
--
--   `negotiation_power`: valgt til at ligge i den eksisterende `source jsonb`-
--   kolonne (`source.negotiation_power`, se boardMandateEngine.js::
--   allocateNegotiationPower) frem for en ny dedikeret kolonne — samme mønster
--   migrationsscriptets `source.method`/`weights` allerede brugte. Ingen
--   skema-ændring nødvendig.
--
-- Det ENESTE dette script tilføjer er et understøttende index til
-- GET /board/meeting's opslag (team_id + status='proposed') — billigt,
-- rent additivt, ingen eksisterende forespørgsel påvirkes.
--
-- Idempotent: `create index if not exists`. Ingen backfill (§4.9: "de 237
-- aktive mandater fortsætter til sæson-slut 27/9, hvor det første rigtige
-- årsmøde (S3→S4) opstår automatisk").
-- ============================================================================

create index if not exists idx_board_mandates_team_status
  on public.board_mandates (team_id, status);

comment on index public.idx_board_mandates_team_status is
  '#4557 S-M2c: understøtter GET /board/meeting''s opslag efter holdets proposed-mandat (boardMandateMeeting.js::loadProposedMandate) uden at scanne hele board_mandates-tabellen pr. hold.';
