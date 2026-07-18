-- #2648: intake-udløb v2 — ejer-beslutning 18/7. Salgssummen fra en 24h
-- intake-udløbs-ungdomsauktion skal krediteres den manager hvis akademi-
-- intake-tilbud udløb (kompensation for inaktivitet).
--
-- Provenu-krediteringen må KUN ske for auktioner der reelt stammer fra et
-- ejerskabs-VERIFICERET udløbet intake-tilbud (samme guard som hændelsen
-- 18/7, se .claude/learnings/2026-07-18-intake-expiry-auctioned-owned-riders.md
-- og PR #2646) — aldrig udledt bagefter fra et status-felt der kan lyve.
-- Løsningen: stemple den tabende manager PÅ selve auktions-rækken i det
-- øjeblik academyIntakeExpirySweep opretter auktionen (efter ejerskabs-
-- guarden allerede har bestået i sweepen) — IKKE genudledt ved finalisering.
--
-- NULL for alle andre auktioner: almindelige salg, manager-initieret
-- kandidat-afvisning (rejectAcademyCandidate → listRejectedAsYouthAuction
-- UDEN denne parameter). Kun academyIntakeExpirySweep sætter kolonnen, og
-- kun for kandidater der bestod ejerskabs-guarden (rider.team_id IS NULL
-- OG rider.pending_team_id IS NULL på udløbs-tidspunktet).
--
-- ON DELETE SET NULL (samme mønster som current_bidder_id): slettes holdet
-- inden auktionen finaliseres, forsvinder krediterings-målet i stedet for at
-- kaskadere auktionsrækken væk — finaliseringen ser blot NULL og springer
-- krediteringen over (ingen orphan-credit til et hold der ikke findes).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Ingen backfill — historiske auktioner
-- har ingen kendt/verificeret tabende manager at kreditere retroaktivt til.
--
-- ⚠️ Migration auto-applies i prod ved merge (#2642-mandat: Claude applier
--    selv EFTER merge, idempotent + post-verify).

ALTER TABLE public.auctions
  ADD COLUMN IF NOT EXISTS expired_intake_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.auctions.expired_intake_team_id IS
  '#2648: manager hvis akademi-intake-tilbud udløb og udløste denne ungdomsauktion. Sat KUN af academyIntakeExpirySweep for ejerskabs-verificerede kandidater (#2646-guarden). NULL for alle andre auktioner, inkl. manager-initieret candidate-rejection.';
