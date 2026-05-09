-- Slice 08 — Sæson 0 → Sæson 1 transition forarbejde
-- ====================================================
-- Bruger-beslutning 2026-05-09: I sæson 0 (open beta transfer-fase) skal
-- ryttere flyttes direkte til deres nye hold ved auktion-slut, IKKE parkeres
-- i pending_team_id. v2.89 introducerede pending-flow som workaround for et
-- manglende åbent transfer_window — det rigtige svar er at dokumentere at
-- sæson 0 ER et åbent transfervindue.
--
-- Denne migration gør to ting:
--   1. Opretter `transfer_windows`-row for sæson 0 med status='open'.
--      Dette aktiverer direkte-flytning i auctionFinalization.js og
--      transferExecution.js's eksisterende `getTransferWindowOpen`-gate
--      uden kode-ændringer.
--   2. Backfill'er 93 eksisterende ryttere fra `pending_team_id` til
--      `team_id` (kun rows hvor auktionen ER `completed`).
--
-- Idempotent: ON CONFLICT DO NOTHING + WHERE pending_team_id IS NOT NULL
-- gør re-run safe.
--
-- Slice 08's transition-engine vil senere lukke dette transfer_window
-- (status='closed') og oprette et nyt closed window for sæson 1.

BEGIN;

-- 1. Dokumentér sæson 0 som åbent transfervindue.
-- Fast UUID for sporbarhed; ON CONFLICT for idempotency.
INSERT INTO transfer_windows (id, season_id, status, opened_at, created_at)
VALUES (
  '00000000-0000-0000-0000-00000000aaaa',
  '00000000-0000-0000-0000-000000000000',
  'open',
  '2026-05-08T18:00:00Z',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- 2. Flyt 93 pending ryttere til team_id (alle har completed auktioner —
-- verificeret via DB-query 2026-05-09 inden migration).
UPDATE riders r
SET
  team_id = pending_team_id,
  pending_team_id = NULL,
  acquired_at = COALESCE(acquired_at, NOW())
WHERE pending_team_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM auctions a
    WHERE a.rider_id = r.id
      AND a.current_bidder_id = r.pending_team_id
      AND a.status = 'completed'
  );

COMMIT;
