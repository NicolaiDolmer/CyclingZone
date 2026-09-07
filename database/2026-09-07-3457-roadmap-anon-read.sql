-- Anon-adgang til roadmap-siden (#3457).
-- Fund: RLS-policyen "Authenticated can read approved roadmap items"
-- (2026-06-20-roadmap-shipped-history.sql) gaelder KUN rollen `authenticated`.
-- Logget-ud besoegende (landing → /roadmap) faar tom liste fra Supabase og
-- ser i stedet den statiske i18n-fallback (frontend/public/locales/{en,da}/
-- roadmap.json), som var foraeldet (se samme PR for fallback-opdatering).
--
-- Loesning: samme USING-udtryk som den eksisterende authenticated-policy,
-- men til rollen `anon` — ingen aendring af de eksisterende policies.
-- roadmap_votes forbliver LUKKET for anon (ingen ny policy her): stemme
-- kraever fortsat login, og der findes ingen authenticated-only kolonne der
-- laekker via denne aendring.
--
-- DROP-then-CREATE for idempotent re-apply (feedback_create_policy_idempotent).

DROP POLICY IF EXISTS "Anon can read approved roadmap items" ON roadmap_items;
CREATE POLICY "Anon can read approved roadmap items"
  ON roadmap_items FOR SELECT
  TO anon
  USING (approved AND status IN ('active', 'shipped'));

COMMENT ON TABLE roadmap_items IS
  'Kurateret roadmap-indhold til /roadmap (#954, #1600, #3457). EN+DA i samme row; approved-flag gater visning. status: active (paa vej) → shipped (historik, spiller-synlig) → archived (skjult for spillere). shipped_at tidsstempler historik-raekkefoelgen. Laeses af BAADE authenticated og anon (#3457 — logget-ud besoegende saa foer tom liste + foraeldet statisk fallback).';
