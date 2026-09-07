-- #4943 · In-app spoergeskema til alle spillere.
--
-- Ejer-beslutning 7/9 (issue #4943): skemaet bygges I SPILLET i stedet for
-- Google Forms. Begrundelse fra ejeren: roadmap-afstemningen paa /roadmap faar
-- 30-35 stemmer pr. punkt, mens den eksterne NPS-prompt kun fik 9 svar. Et link
-- ud af spillet koster svar; en side inde i spillet goer det ikke.
--
-- Indhold = docs/discord/2026-09-07-spoergeskema-spillere-v2.md (v2 er sandhed).
-- SSOT for systemet + analyse-forespoergsler: docs/SURVEY_SYSTEM.md.
--
-- HVORFOR EGNE TABELLER og ikke roadmap_votes / forum_polls:
--   * roadmap_items/roadmap_votes er en PERMANENT flade: kuraterede items der
--     lever videre sæson efter sæson, med een dual-akse-stemme pr. bruger pr.
--     item og ingen afslutning. Et spoergeskema er en KAMPAGNE: den aabner,
--     lukker, har blandede spoergsmaalstyper (fritekst, NPS, afkrydsning) og
--     skal kunne gentages med et nyt saet spoergsmaal uden migration.
--   * forum_poll_options/forum_poll_votes er een afstemning bundet til eet
--     forumopslag med eet valg pr. bruger. Den kan hverken baere 12 fritekst-
--     og skala-spoergsmaal eller en aabne/luk-tilstand.
--
-- HVORFOR INGEN SEGMENTERINGS-SPOERGSMAAL:
--   v2-filens Q1-Q6 (division, sæsoner, login-hyppighed, Pro, platform, sprog)
--   er droppet. Vi kender dem allerede: division fra teams.division, sæsoner
--   fra season_standings, Pro fra subscriptions, hyppighed fra users.login_streak
--   /users.last_seen, sprog fra users.language. At spoerge om dem koster et
--   minut pr. spiller og giver et daarligere svar end databasen. Join-noeglerne
--   staar i docs/SURVEY_SYSTEM.md §3.
--
-- HVORFOR IKKE ANONYMT (bevidst afvigelse fra v2s Google-Forms-plan):
--   In-app kraever login, og segmenteringen kraever user_id. Svar er derfor
--   knyttet til kontoen, og det staar i introen paa selve siden. Til gengaeld
--   kan spilleren rette sine svar indtil skemaet lukker (upsert paa
--   survey_responses), hvilket en anonym Forms-besvarelse ikke kan.
--
-- Idempotent (IF NOT EXISTS + DROP POLICY IF EXISTS + ON CONFLICT DO UPDATE).
-- Skemaet seedes med status 'draft' — INTET er synligt for spillerne foer
-- ejeren siger til og status flippes til 'open'. Ingen destruktiv klasse.
-- Applies af CI ved merge (auto-migrate.yml).
--
-- Post-verify:
--   SELECT slug, status, count(*) FILTER (WHERE TRUE) FROM public.surveys GROUP BY 1,2;
--   SELECT count(*) FROM public.survey_questions
--     WHERE survey_id = (SELECT id FROM public.surveys WHERE slug = '2026-09-features');
--     -- forventet 12
--   SELECT count(*) FROM public.survey_responses;   -- forventet 0
--   SELECT count(*) FROM public.survey_completions; -- forventet 0

-- ── Skemaer ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.surveys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT NOT NULL UNIQUE,
  title_en   TEXT NOT NULL,
  title_da   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  opens_at   TIMESTAMPTZ,
  closes_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Spoergsmaal ────────────────────────────────────────────────────────────
-- `kind` styrer hvilken kontrol frontend tegner. Listen er lukket med vilje:
-- en ny type kraever en migration OG en renderer, saa et seed aldrig kan
-- oenske en kontrol der ikke findes.
--   scale_1_5       een 1-5-skala (tilfredshed)
--   scale_0_10      een 0-10-skala (NPS, samme skala som NpsPrompt)
--   idea_importance een raekke pr. option med TO 1-5-skalaer (idé + vigtighed)
--                   plus en "ved ikke"-udvej. Det er v2s to-akse-gitter.
--   multi_max3      afkrydsning, hoejst 3 valgte
--   multi           afkrydsning uden loft (v2 Q14: "pick as many as you like")
--   single          eet valg fra options
--   text            fritekst
--   yes_no          ja/nej
-- `options` = JSONB-array af {key, label_en, label_da}; NULL for skala/fritekst.
CREATE TABLE IF NOT EXISTS public.survey_questions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id  UUID NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  key        TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN (
    'scale_1_5', 'scale_0_10', 'idea_importance', 'multi_max3', 'multi', 'single', 'text', 'yes_no'
  )),
  label_en   TEXT NOT NULL,
  label_da   TEXT NOT NULL,
  help_en    TEXT,
  help_da    TEXT,
  options    JSONB,
  required   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT survey_questions_survey_key_uniq UNIQUE (survey_id, key)
);

CREATE INDEX IF NOT EXISTS survey_questions_survey_sort_idx
  ON public.survey_questions (survey_id, sort_order);

-- ── Svar ───────────────────────────────────────────────────────────────────
-- Een raekke pr. (skema, bruger, spoergsmaal). `question_key` frem for
-- question_id: svarene overlever at et spoergsmaal slettes og genskabes, og
-- analyse-SQL kan laese dem uden et join. team_id gemmes som en oejebliks-
-- kopi, saa et svar kan krydses selv hvis holdet senere skifter ejer.
CREATE TABLE IF NOT EXISTS public.survey_responses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id    UUID NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id      UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  question_key TEXT NOT NULL,
  value        JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT survey_responses_survey_user_question_uniq
    UNIQUE (survey_id, user_id, question_key)
);

CREATE INDEX IF NOT EXISTS survey_responses_survey_question_idx
  ON public.survey_responses (survey_id, question_key);

-- ── Afsluttede besvarelser ─────────────────────────────────────────────────
-- Svarprocenten maales her, ikke paa survey_responses: en spiller der satte
-- eet kryds og lukkede fanen har svaret, men ikke gennemfoert.
CREATE TABLE IF NOT EXISTS public.survey_completions (
  survey_id     UUID NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seconds_spent INTEGER,
  PRIMARY KEY (survey_id, user_id)
);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.surveys             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_questions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_completions  ENABLE ROW LEVEL SECURITY;

-- Skemaer: 'draft' er admin-only, saa et skema kan bygges og seedes uden at
-- nogen ser det. 'closed' ER laesbart med vilje: uden den raekke kan
-- /survey/:slug ikke skelne "skemaet er lukket" fra "slug findes ikke", og
-- luk-tilstanden (tak + link til roadmap) ville blive en 404 for alle der
-- foelger et gammelt indbakke-link. Spoergsmaalene er stadig kun laesbare
-- mens skemaet er aabent (policy nedenfor), saa et lukket skema kan hverken
-- besvares eller laeses igennem.
DROP POLICY IF EXISTS "Authenticated can read open surveys" ON public.surveys;
CREATE POLICY "Authenticated can read open surveys"
  ON public.surveys FOR SELECT
  TO authenticated
  USING (status IN ('open', 'closed') OR public.is_admin());

DROP POLICY IF EXISTS "Admins can write surveys" ON public.surveys;
CREATE POLICY "Admins can write surveys"
  ON public.surveys FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Authenticated can read questions of open surveys" ON public.survey_questions;
CREATE POLICY "Authenticated can read questions of open surveys"
  ON public.survey_questions FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.surveys s
      WHERE s.id = survey_id AND s.status = 'open'
    )
  );

DROP POLICY IF EXISTS "Admins can write survey questions" ON public.survey_questions;
CREATE POLICY "Admins can write survey questions"
  ON public.survey_questions FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Svar: egne ind/op/laes. Admin laeser alt (analysen koeres af ejeren).
-- Ingen DELETE-policy: svar rettes via upsert, oprydning sker via service_role.
DROP POLICY IF EXISTS "Users can read own survey responses" ON public.survey_responses;
CREATE POLICY "Users can read own survey responses"
  ON public.survey_responses FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can insert own survey responses" ON public.survey_responses;
CREATE POLICY "Users can insert own survey responses"
  ON public.survey_responses FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.surveys s
      WHERE s.id = survey_id AND s.status = 'open'
    )
  );

DROP POLICY IF EXISTS "Users can update own survey responses" ON public.survey_responses;
CREATE POLICY "Users can update own survey responses"
  ON public.survey_responses FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.surveys s
      WHERE s.id = survey_id AND s.status = 'open'
    )
  );

DROP POLICY IF EXISTS "Users can read own survey completions" ON public.survey_completions;
CREATE POLICY "Users can read own survey completions"
  ON public.survey_completions FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can insert own survey completions" ON public.survey_completions;
CREATE POLICY "Users can insert own survey completions"
  ON public.survey_completions FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.surveys s
      WHERE s.id = survey_id AND s.status = 'open'
    )
  );

DROP POLICY IF EXISTS "Users can update own survey completions" ON public.survey_completions;
CREATE POLICY "Users can update own survey completions"
  ON public.survey_completions FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.surveys IS
  '#4943 in-app spoergeskemaer. status draft -> open -> closed; kun open er synlig for spillere (RLS). Indhold seedes redaktionelt, EN+DA i samme raekke.';
COMMENT ON TABLE public.survey_questions IS
  '#4943 spoergsmaal pr. skema. kind styrer frontendens kontrol; options = JSONB-array af {key,label_en,label_da}. EN+DA i samme raekke (redaktionelt indhold, ikke i18n-filer).';
COMMENT ON TABLE public.survey_responses IS
  '#4943 svar: een raekke pr. (skema, bruger, spoergsmaal), value som JSONB. Upsert paa survey_responses_survey_user_question_uniq, saa en spiller kan rette indtil skemaet lukker. Spillere laeser kun egne svar.';
COMMENT ON TABLE public.survey_completions IS
  '#4943 gennemfoerte besvarelser. Svarprocenten maales her, ikke paa survey_responses (eet kryds er ikke en besvarelse).';

-- ══════════════════════════════════════════════════════════════════════════
-- Seed: 2026-09-features (12 spoergsmaal, EN+DA, status draft)
-- Kilde: docs/discord/2026-09-07-spoergeskema-spillere-v2.md afsnit 3-6.
-- v2s Q1-Q6 (segmentering) er droppet — se hovedet. v2s Q17 (managernavn) er
-- droppet fordi vi kender kontoen; introen paa siden siger det aabent i stedet
-- for at love en anonymitet skemaet ikke har.
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO public.surveys (slug, title_en, title_da, status)
VALUES (
  '2026-09-features',
  'What should I build next?',
  'Hvad skal jeg bygge næste gang?'
)
ON CONFLICT (slug) DO UPDATE
  SET title_en = EXCLUDED.title_en,
      title_da = EXCLUDED.title_da,
      updated_at = NOW();

-- Spoergsmaalene skrives med ON CONFLICT DO UPDATE, saa en gen-koersel retter
-- tekst og rækkefølge uden at røre afgivne svar (de haenger paa question_key).
WITH s AS (SELECT id FROM public.surveys WHERE slug = '2026-09-features')
INSERT INTO public.survey_questions
  (survey_id, sort_order, key, kind, label_en, label_da, help_en, help_da, options, required)
SELECT s.id, q.sort_order, q.key, q.kind, q.label_en, q.label_da, q.help_en, q.help_da, q.options, q.required
FROM s, (VALUES

  (10, 'nps', 'scale_0_10',
   'How likely are you to recommend Cycling Zone to a friend who likes cycling?',
   'Hvor sandsynligt er det at du vil anbefale Cycling Zone til en ven der kan lide cykling?',
   '0 means not at all likely, 10 means extremely likely.',
   '0 betyder slet ikke sandsynligt, 10 betyder yderst sandsynligt.',
   NULL::JSONB, TRUE),

  (20, 'satisfaction', 'scale_1_5',
   'All in all, how satisfied are you with Cycling Zone right now?',
   'Alt i alt, hvor tilfreds er du med Cycling Zone lige nu?',
   '1 means not satisfied, 5 means very satisfied.',
   '1 betyder ikke tilfreds, 5 betyder meget tilfreds.',
   NULL::JSONB, TRUE),

  -- To-akse-gitteret. Rækkefølgen er v2s tabel i afsnit 4, som er spredt over
  -- loebsmotoren, traeningen, ungdommen, identiteten og hverdagen som manager.
  (30, 'feature_axes', 'idea_importance',
   'Rate each idea twice.',
   'Giv hver idé to karakterer.',
   'First: how good an idea is this for the game, no matter whether you would use it yourself. Second: how much it matters to you right now. Pick "Do not know" if you have no view.',
   'Først: hvor god en idé er det for spillet, uanset om du selv ville bruge det. Dernæst: hvor meget det betyder for dig lige nu. Vælg "Ved ikke" hvis du ikke har en mening.',
   '[
     {"key":"live_race","label_en":"Follow a race live while it happens, stage by stage","label_da":"Følg et løb live mens det kører, etape for etape"},
     {"key":"rider_effort","label_en":"Choose how hard each rider works on a race day","label_da":"Vælg hvor hårdt hver rytter arbejder på en løbsdag"},
     {"key":"jersey_targets","label_en":"Target the mountains or points jersey from the start","label_da":"Gå efter bjerg- eller pointtrøjen fra løbets start"},
     {"key":"training_programs","label_en":"Build a training week once as a reusable program","label_da":"Byg en træningsuge én gang som et genbrugeligt program"},
     {"key":"shared_programs","label_en":"Share training programs and use other managers programs","label_da":"Del træningsprogrammer og brug andre manageres programmer"},
     {"key":"form_training","label_en":"Form training for riders who no longer gain skills","label_da":"Formtræning til ryttere der ikke længere kan lære mere"},
     {"key":"youth_teams","label_en":"U23 and junior teams with their own races","label_da":"U23- og juniorhold med deres egne løb"},
     {"key":"team_looks","label_en":"Team looks: kit colours, logo and rider portraits","label_da":"Holdets udseende: trøjefarver, logo og rytterportrætter"},
     {"key":"deeper_staff","label_en":"Deeper staff: more roles, real strengths and weaknesses","label_da":"Dybere personale: flere roller, rigtige styrker og svagheder"},
     {"key":"inbox_transfers","label_en":"Handle transfer offers straight from your inbox","label_da":"Håndtér transfertilbud direkte fra din indbakke"},
     {"key":"manager_messages","label_en":"Send messages to other managers inside the game","label_da":"Send beskeder til andre managere inde i spillet"},
     {"key":"custom_front_page","label_en":"A front page you set up yourself, showing what needs action","label_da":"En forside du selv sætter op, med det der kræver handling"}
   ]'::JSONB, FALSE),

  (40, 'works_worst', 'multi_max3',
   'Which parts of the game work worst today? Pick up to three.',
   'Hvilke dele af spillet fungerer dårligst i dag? Vælg op til tre.',
   NULL, NULL,
   '[
     {"key":"racing","label_en":"Racing and results","label_da":"Løbene og resultaterne"},
     {"key":"training","label_en":"Training and rider development","label_da":"Træning og rytterudvikling"},
     {"key":"market","label_en":"Transfers and auctions","label_da":"Transfers og auktioner"},
     {"key":"selection","label_en":"Team selection and planning","label_da":"Holdudtagelse og planlægning"},
     {"key":"calendar","label_en":"The season calendar and the routes","label_da":"Sæsonkalenderen og ruterne"},
     {"key":"economy","label_en":"Money, sponsors and the board","label_da":"Penge, sponsorer og bestyrelsen"},
     {"key":"academy","label_en":"The academy and young riders","label_da":"Akademiet og de unge ryttere"},
     {"key":"inbox","label_en":"The inbox and notifications","label_da":"Indbakken og notifikationerne"},
     {"key":"forum","label_en":"The forum and the community","label_da":"Forummet og fællesskabet"},
     {"key":"stability","label_en":"Speed, bugs and things that break","label_da":"Hastighed, fejl og ting der går i stykker"}
   ]'::JSONB, TRUE),

  (50, 'works_worst_detail', 'text',
   'What exactly goes wrong there? The more concrete, the better.',
   'Hvad går præcist galt der? Jo mere konkret, jo bedre.',
   NULL, NULL, NULL::JSONB, FALSE),

  (60, 'one_thing', 'text',
   'If I could only build one thing in the next month, what should it be?',
   'Hvis jeg kun kunne bygge én ting den næste måned, hvad skulle det så være?',
   NULL, NULL, NULL::JSONB, TRUE),

  (70, 'play_more', 'text',
   'What would make you play more than you do now?',
   'Hvad ville få dig til at spille mere end du gør nu?',
   NULL, NULL, NULL::JSONB, FALSE),

  (80, 'invite_friend', 'text',
   'What would make you invite a friend to join?',
   'Hvad ville få dig til at invitere en ven med?',
   NULL, NULL, NULL::JSONB, FALSE),

  (90, 'pro_contents', 'multi',
   'What would belong in Pro, if you got to decide? Pick as many as you like.',
   'Hvad hører hjemme i Pro, hvis du bestemte? Vælg lige så mange du vil.',
   'Pro is optional and always will be. The game must be fair for everyone. You cannot pay for better riders, faster training, or better results. So this is about what else Pro could hold.',
   'Pro er valgfrit og bliver ved med at være det. Spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater. Så spørgsmålet her er hvad Pro ellers kunne indeholde.',
   '[
     {"key":"compare","label_en":"Deep rider comparison tools","label_da":"Grundig sammenligning af ryttere"},
     {"key":"analytics","label_en":"Advanced statistics and analytics","label_da":"Avanceret statistik og analyse"},
     {"key":"history","label_en":"Extended history and palmares","label_da":"Udvidet historik og palmares"},
     {"key":"looks","label_en":"Team looks: kit, logo, rider portraits","label_da":"Holdets udseende: trøje, logo, rytterportrætter"},
     {"key":"renaming","label_en":"Renaming riders, from an approved name list","label_da":"Omdøbning af ryttere, fra en godkendt navneliste"},
     {"key":"badge","label_en":"A badge on your profile","label_da":"Et mærke på din profil"},
     {"key":"scouting","label_en":"Faster or better scouting","label_da":"Hurtigere eller bedre scouting"},
     {"key":"nothing","label_en":"Nothing extra, I would just be backing the project","label_da":"Ikke noget ekstra, jeg ville bare bakke projektet op"}
   ]'::JSONB, FALSE),

  (100, 'pro_exclusions', 'text',
   'Is there anything that should stay out of Pro? Tell me what, and why.',
   'Er der noget der ikke skal ind i Pro? Skriv hvad, og hvorfor.',
   NULL, NULL, NULL::JSONB, FALSE),

  (110, 'pro_would_pay', 'single',
   'Would you pay for Pro as you have described it?',
   'Ville du betale for Pro, sådan som du har beskrevet det?',
   NULL, NULL,
   '[
     {"key":"yes","label_en":"Yes","label_da":"Ja"},
     {"key":"maybe","label_en":"Maybe","label_da":"Måske"},
     {"key":"no","label_en":"No","label_da":"Nej"},
     {"key":"already","label_en":"I already do","label_da":"Det gør jeg allerede"}
   ]'::JSONB, TRUE),

  (120, 'follow_up', 'yes_no',
   'May I come back to you about your answers?',
   'Må jeg vende tilbage til dig om dine svar?',
   NULL, NULL, NULL::JSONB, FALSE)

) AS q(sort_order, key, kind, label_en, label_da, help_en, help_da, options, required)
ON CONFLICT (survey_id, key) DO UPDATE
  SET sort_order = EXCLUDED.sort_order,
      kind       = EXCLUDED.kind,
      label_en   = EXCLUDED.label_en,
      label_da   = EXCLUDED.label_da,
      help_en    = EXCLUDED.help_en,
      help_da    = EXCLUDED.help_da,
      options    = EXCLUDED.options,
      required   = EXCLUDED.required;
