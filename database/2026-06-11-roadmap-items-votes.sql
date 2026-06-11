-- Roadmap-voting MVP (#954) — fundament for transparens-hubbens voting-flade.
-- Ejer-beslutning 11/6: genbrug /roadmap-siden, ny Supabase-tabel, 1 stemme pr.
-- bruger pr. item, kurateret EN+DA-tekst der er godkendt FØR visning.
--
-- Design:
--   * roadmap_items: kurateret founder-indhold (EN+DA i samme row — items er
--     redaktionelt indhold, ikke brugertekst; approved-flag gater visning).
--     status forbereder "auto-flyt til historik" (epic-kommentar 6/6) uden
--     senere schema-ændring: active → shipped/archived.
--   * roadmap_votes: dual-akse 1-6 ("god idé?" + "vigtigt for dig?") per
--     brainstorm-beslutningen 2/6 (lige antal trin = intet neutralt midtpunkt).
--     Én row pr. (user, item) via UNIQUE — frontend upserter på constrainten.
--   * Synlighed: spillere ser KUN egen stemme (ejer-beslutning 11/6, undgår
--     bandwagon) — SELECT er auth.uid() = user_id; public.is_admin() ser alt.
--   * Styrings-score (founder-værktøj): score = Ø(vigtig)·0.6 + Ø(god)·0.4,
--     ganget med sqrt(antal stemmer). Eksponeret via roadmap_item_scores
--     (security_invoker-view): RLS på votes afgør hvad der aggregeres, så kun
--     admin ser den fulde score — en alm. bruger aggregerer kun egne rows.
--   * Seed: 2026-06-11-roadmap-voting-seed.sql (22 ejer-godkendte items, 11/6).
--     'club' i engine-CHECK = 5. kort på siden (Klub & verden) ud over de fire
--     doctrine-motorer — board/renommé/stab/museum/social bor dér.

CREATE TABLE IF NOT EXISTS roadmap_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine TEXT NOT NULL CHECK (engine IN ('races', 'training', 'youth', 'market', 'club')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  title_en TEXT NOT NULL,
  title_da TEXT NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'shipped', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roadmap_votes (
  id BIGSERIAL PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idea_score SMALLINT NOT NULL CHECK (idea_score BETWEEN 1 AND 6),
  importance_score SMALLINT NOT NULL CHECK (importance_score BETWEEN 1 AND 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT roadmap_votes_user_item_uniq UNIQUE (user_id, item_id)
);

-- Aggregering pr. item (styrings-score + admin-overblik).
CREATE INDEX IF NOT EXISTS roadmap_votes_item_id_idx ON roadmap_votes (item_id);

ALTER TABLE roadmap_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadmap_votes ENABLE ROW LEVEL SECURITY;

-- DROP-then-CREATE så auto-/re-apply er idempotent (feedback_create_policy_idempotent).

DROP POLICY IF EXISTS "Authenticated can read approved active roadmap items" ON roadmap_items;
CREATE POLICY "Authenticated can read approved active roadmap items"
  ON roadmap_items FOR SELECT
  TO authenticated
  USING ((approved AND status = 'active') OR public.is_admin());

DROP POLICY IF EXISTS "Admins can insert roadmap items" ON roadmap_items;
CREATE POLICY "Admins can insert roadmap items"
  ON roadmap_items FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update roadmap items" ON roadmap_items;
CREATE POLICY "Admins can update roadmap items"
  ON roadmap_items FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete roadmap items" ON roadmap_items;
CREATE POLICY "Admins can delete roadmap items"
  ON roadmap_items FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- Votes: egen stemme ind/op/læs; stemmer kan kun afgives på synlige items.
DROP POLICY IF EXISTS "Users can read own roadmap votes" ON roadmap_votes;
CREATE POLICY "Users can read own roadmap votes"
  ON roadmap_votes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can insert own roadmap votes" ON roadmap_votes;
CREATE POLICY "Users can insert own roadmap votes"
  ON roadmap_votes FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM roadmap_items i
      WHERE i.id = item_id AND i.approved AND i.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Users can update own roadmap votes" ON roadmap_votes;
CREATE POLICY "Users can update own roadmap votes"
  ON roadmap_votes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM roadmap_items i
      WHERE i.id = item_id AND i.approved AND i.status = 'active'
    )
  );

-- Ingen DELETE-policy: stemmer ændres via upsert; oprydning sker via service_role.

-- Founder styrings-score. security_invoker: caller'ens RLS gælder, så en alm.
-- bruger ser kun aggregat af egne stemmer — kun admin ser den reelle score.
CREATE OR REPLACE VIEW roadmap_item_scores
  WITH (security_invoker = true) AS
SELECT
  i.id AS item_id,
  i.engine,
  i.title_en,
  i.approved,
  i.status,
  COUNT(v.id) AS votes,
  ROUND(AVG(v.idea_score)::numeric, 2) AS avg_idea,
  ROUND(AVG(v.importance_score)::numeric, 2) AS avg_importance,
  ROUND(((AVG(v.importance_score) * 0.6 + AVG(v.idea_score) * 0.4) * sqrt(COUNT(v.id)))::numeric, 2) AS steering_score
FROM roadmap_items i
LEFT JOIN roadmap_votes v ON v.item_id = i.id
GROUP BY i.id, i.engine, i.title_en, i.approved, i.status;

COMMENT ON TABLE roadmap_items IS
  'Kurateret roadmap-indhold til /roadmap (#954). EN+DA i samme row; approved-flag gater visning (ejer godkender tekst FØR den vises). status: active → shipped/archived (fremtidig historik-flytning).';

COMMENT ON TABLE roadmap_votes IS
  'Roadmap-stemmer (#954): dual-akse 1-6 (idea_score = "hvor god en idé", importance_score = "hvor vigtigt for dig"). Én row pr. (user, item) via roadmap_votes_user_item_uniq; frontend upserter. Spillere læser kun egne stemmer.';

COMMENT ON VIEW roadmap_item_scores IS
  'Founder styrings-score pr. roadmap-item (#954): (Ø importance · 0.6 + Ø idea · 0.4) · sqrt(antal stemmer). security_invoker: kun admin ser alle stemmer via RLS på roadmap_votes.';
