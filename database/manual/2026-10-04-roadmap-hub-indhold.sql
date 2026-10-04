-- KOERES IKKE AUTOMATISK (manual-only): startindhold til roadmap-hubben, koeres af orkestratoren paa ejerens "koer".
--
-- #5387 / #6149 · Roadmap-hub: ejer-godkendt startindhold (4/10 aften)
--
-- STATUS: IKKE ANVENDT. Skrevet 4/10 2026, intet er koert mod prod.
-- Kilde: docs/drafts/2026-10-04-roadmap-indhold.md, afsnit 8 (vinder), 6c, 6b, 5.6, 5.3, 3, 2, 1.
-- Rapport med alle titler (foer/efter) og tvivlspunkter:
--   docs/drafts/2026-10-04-roadmap-indhold-apply-rapport.md
--
-- Forudsaetninger:
--   - database/2026-10-05-5387-roadmap-hub.sql er applied (kolonner horizon, issue_ref,
--     flag_key, beta_since, beta_soon, live_soon; tabellerne known_issues og
--     known_issue_updates; triggeren roadmap_items_sync_flag).
--   - Spillersiden (#6160) er merget (den gamle side viser kun active/shipped).
--   - Prod 4/10 21:55: 60 raekker i roadmap_items (42 active, 12 shipped, 6 archived),
--     1.121 stemmer i roadmap_votes.
--
-- Hvad filen goer (een transaktion, ingen DELETE, roadmap_votes roeres kun ved kopien
-- til det delte rute-punkt):
--   0. Vagt: alle 45 eksisterende id'er, filen roerer, skal findes, ellers ROLLBACK.
--   A. Eksisterende punkter: 10 til Done, 11 til Plan, 1 til Beta, 10 bliver paa Vote
--      (nye titler/sortering), 13 hviler i idé-puljen (approved=false, stemmer bevares).
--   B. 21 nye Plan-punkter (inkl. N4/N9 i gang, N15 skjult, rute-resten med kopierede stemmer).
--   C. 4 nye Beta-punkter (+ 538c4798 koblet til training_programs).
--   D. 18 nye Vote-idéer.
--   E. 5 nye Done-raekker.
--   F. 53 kendte fejl og 34 foerste opdateringer.
--   G. Post-verify-SELECTs nederst (kommentar).
--
-- Idempotent: UPDATE saetter faste vaerdier; INSERT bruger faste uuid'er + ON CONFLICT
-- DO NOTHING; stemme-kopien springer eksisterende (user_id, item_id) over.
-- Faste uuid'er: roadmap_items 00006149-0000-4000-8000-0000000000NN,
-- known_issues 00006149-0000-4000-8000-0000000001NN, opdateringer ...0000000002NN
-- (samme NN som fejlen).

BEGIN;

-- 0. Vagt ---------------------------------------------------------------------
DO $$
DECLARE
  v_found INTEGER;
BEGIN
  SELECT count(*) INTO v_found FROM roadmap_items WHERE id IN (
    '00000954-0000-4000-8000-000000000004', '00000954-0000-4000-8000-000000000008',
    '00000954-0000-4000-8000-000000000011', '00000954-0000-4000-8000-000000000012',
    '00000954-0000-4000-8000-000000000013', '00000954-0000-4000-8000-000000000014',
    '00000954-0000-4000-8000-000000000015', '00000954-0000-4000-8000-000000000016',
    '00000954-0000-4000-8000-000000000017', '00000954-0000-4000-8000-000000000018',
    '00000954-0000-4000-8000-000000000019', '00000954-0000-4000-8000-000000000021',
    '00000954-0000-4000-8000-000000000022',
    '00005387-0000-4000-8000-000000000201', '00005387-0000-4000-8000-000000000202',
    '00005387-0000-4000-8000-000000000203', '00005387-0000-4000-8000-000000000204',
    '00005387-0000-4000-8000-000000000205', '00005387-0000-4000-8000-000000000206',
    '00005387-0000-4000-8000-000000000207', '00005387-0000-4000-8000-000000000208',
    '00005387-0000-4000-8000-000000000209', '00005387-0000-4000-8000-000000000210',
    '00005387-0000-4000-8000-000000000211', '00005387-0000-4000-8000-000000000212',
    '00005387-0000-4000-8000-000000000213', '00005387-0000-4000-8000-000000000214',
    '00005387-0000-4000-8000-000000000215', '00005387-0000-4000-8000-000000000216',
    '00005387-0000-4000-8000-000000000217', '00005387-0000-4000-8000-000000000218',
    '00005387-0000-4000-8000-000000000219', '00005387-0000-4000-8000-000000000220',
    '00005387-0000-4000-8000-000000000221', '00005387-0000-4000-8000-000000000222',
    '00005387-0000-4000-8000-000000000223', '00005387-0000-4000-8000-000000000224',
    '00005387-0000-4000-8000-000000000225', '00005387-0000-4000-8000-000000000226',
    '00005387-0000-4000-8000-000000000227', '00005387-0000-4000-8000-000000000228',
    'cae1e719-1277-4547-b09e-7be6cf4ee514', '9a14a23b-475e-4870-af03-57e1cab2228d',
    '5bb11a13-a5de-402b-94df-f931ca980fca', 'df446f41-2314-4c7e-9ed8-38e9538c4798'
  );
  IF v_found <> 45 THEN
    RAISE EXCEPTION 'roadmap-indhold: forventede 45 eksisterende punkter, fandt %', v_found;
  END IF;
END $$;

-- A1. Done: de 9 punkter fra liste 5 (afsnit 1-datoer, kl. 12:00 UTC) ------------
UPDATE roadmap_items SET status = 'shipped', approved = true, shipped_at = '2026-10-01T12:00:00Z',
  issue_ref = 4850, updated_at = NOW()
  WHERE id = '00000954-0000-4000-8000-000000000004'; -- Real training depth (titel uaendret)

UPDATE roadmap_items SET status = 'shipped', approved = true, shipped_at = '2026-09-26T12:00:00Z',
  issue_ref = 2492, updated_at = NOW(),
  title_en = 'U23 and junior squads with real promotion paths from academy to the top.',
  title_da = 'U23- og juniorhold med ægte oprykningsveje fra akademi til toppen.'
  WHERE id = '00000954-0000-4000-8000-000000000016'; -- U19 hedder nu junior

UPDATE roadmap_items SET status = 'shipped', approved = true, shipped_at = '2026-09-26T12:00:00Z',
  issue_ref = 5443, updated_at = NOW(),
  title_en = 'Rider values that follow the market.',
  title_da = 'Rytterværdier der følger markedet.'
  WHERE id = '00000954-0000-4000-8000-000000000017';

UPDATE roadmap_items SET status = 'shipped', approved = true, shipped_at = '2026-09-27T12:00:00Z',
  issue_ref = 4385, updated_at = NOW()
  WHERE id = '00005387-0000-4000-8000-000000000225'; -- Upkeep per race day (titel uaendret)

UPDATE roadmap_items SET status = 'shipped', approved = true, shipped_at = '2026-09-27T12:00:00Z',
  issue_ref = 3514, updated_at = NOW()
  WHERE id = 'cae1e719-1277-4547-b09e-7be6cf4ee514'; -- Negotiate board goals upward (titel uaendret)

UPDATE roadmap_items SET status = 'shipped', approved = true, shipped_at = '2026-10-02T12:00:00Z',
  issue_ref = 6080, updated_at = NOW(),
  title_en = 'Split times, and where and why your riders lost time.',
  title_da = 'Mellemtider, og hvor og hvorfor dine ryttere tabte tid.'
  WHERE id = '9a14a23b-475e-4870-af03-57e1cab2228d'; -- delvist: v7.332

UPDATE roadmap_items SET status = 'shipped', approved = true, shipped_at = '2026-10-01T12:00:00Z',
  issue_ref = 5932, updated_at = NOW(),
  title_en = 'A plan for each race day: hard, normal, recovery or rest, for the whole squad or one rider.',
  title_da = 'En plan for hver løbsdag: hård, normal, restitution eller hvile, for hele truppen eller én rytter.'
  WHERE id = '00005387-0000-4000-8000-000000000209'; -- delvist: v7.330

UPDATE roadmap_items SET status = 'shipped', approved = true, shipped_at = '2026-10-02T12:00:00Z',
  issue_ref = 5539, updated_at = NOW(),
  title_en = 'See how far a session moved each ability, on the rider''s profile and in the training report.',
  title_da = 'Se hvor langt et pas flyttede hver evne, på rytterprofilen og i træningsrapporten.'
  WHERE id = '00005387-0000-4000-8000-000000000212'; -- delvist: v7.305 + v7.331

UPDATE roadmap_items SET status = 'shipped', approved = true, shipped_at = '2026-10-01T12:00:00Z',
  issue_ref = 5620, updated_at = NOW()
  WHERE id = '00005387-0000-4000-8000-000000000213'; -- Auto-rest (titel uaendret)

-- A2. Ruter (ca980fca) deles: Done-delen ---------------------------------------
UPDATE roadmap_items SET status = 'shipped', approved = true, shipped_at = '2026-10-04T12:00:00Z',
  issue_ref = 2768, updated_at = NOW(),
  title_en = 'Cobbles that count, and mountain stages decided on the final climb.',
  title_da = 'Brosten der tæller, og bjergetaper der afgøres på slutstigningen.'
  WHERE id = '5bb11a13-a5de-402b-94df-f931ca980fca'; -- v7.332 (2/10) + v7.336 (4/10)

-- A3. Planned · Next (afsnit 8, liste 2; eksisterende punkter) -----------------
UPDATE roadmap_items SET status = 'planned', approved = true, horizon = 'next', sort_order = 10,
  issue_ref = 3813, updated_at = NOW(),
  title_en = 'See on a rider''s profile what his second type means for him, and why another ability can still reach higher.',
  title_da = 'Se på rytterens profil, hvad hans anden type betyder for ham, og hvorfor en anden evne stadig kan nå højere.'
  WHERE id = '00005387-0000-4000-8000-000000000201';

UPDATE roadmap_items SET status = 'planned', approved = true, horizon = 'next', sort_order = 20,
  issue_ref = 5074, updated_at = NOW(),
  title_en = 'Pick which part of a stage race a rider peaks in, with a main goal and a backup goal.',
  title_da = 'Vælg hvilken del af et etapeløb en rytter topper i, med et hovedmål og et reservemål.'
  WHERE id = '00005387-0000-4000-8000-000000000203';

UPDATE roadmap_items SET status = 'planned', approved = true, horizon = 'next', sort_order = 30,
  issue_ref = 5238, updated_at = NOW()
  WHERE id = '00005387-0000-4000-8000-000000000208'; -- Race sharpener (titel uaendret)

UPDATE roadmap_items SET status = 'planned', approved = true, horizon = 'next', sort_order = 40,
  issue_ref = 5238, updated_at = NOW()
  WHERE id = '00005387-0000-4000-8000-000000000210'; -- Form training (titel uaendret)

UPDATE roadmap_items SET status = 'planned', approved = true, horizon = 'next', sort_order = 50,
  issue_ref = 5105, updated_at = NOW()
  WHERE id = '00000954-0000-4000-8000-000000000008'; -- Your own young stars (titel uaendret)

-- A4. Planned · Later (eksisterende punkter) -----------------------------------
UPDATE roadmap_items SET status = 'planned', approved = true, horizon = 'later', sort_order = 140,
  issue_ref = 1177, updated_at = NOW()
  WHERE id = '00000954-0000-4000-8000-000000000019'; -- Road captains and mentors

UPDATE roadmap_items SET status = 'planned', approved = true, horizon = 'later', sort_order = 150,
  issue_ref = 3513, updated_at = NOW(),
  title_en = 'A new dashboard: what needs you today comes first.',
  title_da = 'Nyt dashboard: det, der kræver dig i dag, står først.'
  WHERE id = '00005387-0000-4000-8000-000000000226'; -- ejer 4/10: dashboard og indbakke deles i to

-- Indbakke-delen som eget punkt, med en kopi af det oprindelige punkts stemmer (del-reglen).
INSERT INTO roadmap_items
  (id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, created_at, updated_at)
VALUES
  ('00006149-0000-4000-8000-000000000060', 'club', 155,
   'A new inbox: a message takes seconds to read.',
   'Ny indbakke: en besked tager sekunder at læse.',
   true, 'planned', 'later', 2223, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO roadmap_votes (item_id, user_id, idea_score, importance_score, created_at, updated_at)
SELECT '00006149-0000-4000-8000-000000000060', v.user_id, v.idea_score, v.importance_score, v.created_at, v.updated_at
FROM roadmap_votes v
WHERE v.item_id = '00005387-0000-4000-8000-000000000226'
ON CONFLICT (user_id, item_id) DO NOTHING;

UPDATE roadmap_items SET status = 'planned', approved = true, horizon = 'later', sort_order = 160,
  issue_ref = 5573, updated_at = NOW()
  WHERE id = '00005387-0000-4000-8000-000000000202'; -- Ride for a jersey (S5)

UPDATE roadmap_items SET status = 'planned', approved = true, horizon = 'later', sort_order = 170,
  issue_ref = 5575, updated_at = NOW()
  WHERE id = '00005387-0000-4000-8000-000000000204'; -- The team meeting (S5)

UPDATE roadmap_items SET status = 'planned', approved = true, horizon = 'later', sort_order = 180,
  issue_ref = 4620, updated_at = NOW(),
  title_en = 'Promotion and relegation for U23 and junior groups, from season 5.',
  title_da = 'Op- og nedrykning for U23- og juniorpuljer fra sæson 5.'
  WHERE id = '00005387-0000-4000-8000-000000000215';

UPDATE roadmap_items SET status = 'planned', approved = true, horizon = 'later', sort_order = 260,
  issue_ref = 5113, updated_at = NOW()
  WHERE id = '00005387-0000-4000-8000-000000000222'; -- Club's look

-- A5. Beta: 538c4798 koblet til training_programs (triggeren laeser kontakten) ---
UPDATE roadmap_items SET status = 'in_progress', approved = true, horizon = 'next', sort_order = 30,
  issue_ref = 4629, flag_key = 'training_programs', beta_since = '2026-09-27T12:00:00Z',
  beta_soon = false, live_soon = false, updated_at = NOW(),
  title_en = 'Ready-made training programs per race day.',
  title_da = 'Færdige træningsprogrammer pr. løbsdag.'
  WHERE id = 'df446f41-2314-4c7e-9ed8-38e9538c4798';

-- A6. Vote: de 10 gamle idéer, der bliver (6c-raekkefoelge, sort_order = 10 x nr.) --
UPDATE roadmap_items SET status = 'active', approved = true, sort_order = 60, issue_ref = 5200, updated_at = NOW(),
  title_en = 'The calendar page shows your own status on each race: entered, withdrawn or squad set.',
  title_da = 'Kalendersiden viser din egen status på hvert løb: tilmeldt, udmeldt eller hold sat.'
  WHERE id = '00005387-0000-4000-8000-000000000206'; -- 6c nr. 6

UPDATE roadmap_items SET status = 'active', approved = true, sort_order = 110, issue_ref = 5063, updated_at = NOW()
  WHERE id = '00005387-0000-4000-8000-000000000211'; -- 6c nr. 11, titel uaendret

UPDATE roadmap_items SET status = 'active', approved = true, sort_order = 120, issue_ref = 5420, updated_at = NOW()
  WHERE id = '00005387-0000-4000-8000-000000000214'; -- 6c nr. 12, titel uaendret

UPDATE roadmap_items SET status = 'active', approved = true, sort_order = 150, updated_at = NOW(),
  title_en = 'Prize money in youth races.',
  title_da = 'Præmiepenge i ungdomsløb.'
  WHERE id = '00005387-0000-4000-8000-000000000216'; -- 6c nr. 15

UPDATE roadmap_items SET status = 'active', approved = true, sort_order = 160, issue_ref = 5540, updated_at = NOW(),
  title_en = 'A better scout charges less per report, so two scouts are never the same.',
  title_da = 'En bedre spejder tager mindre pr. rapport, så to spejdere aldrig er ens.'
  WHERE id = '00005387-0000-4000-8000-000000000217'; -- 6c nr. 16

UPDATE roadmap_items SET status = 'active', approved = true, sort_order = 210, issue_ref = 5431, updated_at = NOW(),
  title_en = 'Limits on deals between friends: a floor and a ceiling on what a rider can be traded for.',
  title_da = 'Grænser for handler mellem venner: et gulv og et loft for, hvad en rytter kan handles for.'
  WHERE id = '00005387-0000-4000-8000-000000000219'; -- 6c nr. 21

UPDATE roadmap_items SET status = 'active', approved = true, sort_order = 220, issue_ref = 5621, updated_at = NOW()
  WHERE id = '00005387-0000-4000-8000-000000000220'; -- 6c nr. 22, titel uaendret

UPDATE roadmap_items SET status = 'active', approved = true, sort_order = 230, issue_ref = 5314, updated_at = NOW(),
  title_en = 'See an injury on another team''s rider on his profile, and how long he is out.',
  title_da = 'Se en skade på en rytter fra et andet hold på hans profil, og hvor længe han er ude.'
  WHERE id = '00005387-0000-4000-8000-000000000221'; -- 6c nr. 23

UPDATE roadmap_items SET status = 'active', approved = true, sort_order = 290, updated_at = NOW(),
  title_en = 'Medical, academy and commercial facilities that work: faster recovery, more academy places and more sponsor money.',
  title_da = 'Medicinsk afdeling, akademi og kommerciel afdeling, der virker: hurtigere restitution, flere akademipladser og flere sponsorpenge.'
  WHERE id = '00005387-0000-4000-8000-000000000224'; -- 6c nr. 29

UPDATE roadmap_items SET status = 'active', approved = true, sort_order = 300, issue_ref = 1441, updated_at = NOW()
  WHERE id = '00005387-0000-4000-8000-000000000223'; -- 6c nr. 30, titel uaendret

-- A7. Idé-puljen: 13 gamle idéer hviler (skjult, stemmer bevares, titler uaendret) --
UPDATE roadmap_items SET approved = false, updated_at = NOW()
  WHERE status = 'active' AND id IN (
    '00000954-0000-4000-8000-000000000018', '00000954-0000-4000-8000-000000000021',
    '00000954-0000-4000-8000-000000000022', '00000954-0000-4000-8000-000000000011',
    '00000954-0000-4000-8000-000000000012', '00000954-0000-4000-8000-000000000014',
    '00000954-0000-4000-8000-000000000013', '00000954-0000-4000-8000-000000000015',
    '00005387-0000-4000-8000-000000000228', '00005387-0000-4000-8000-000000000227',
    '00005387-0000-4000-8000-000000000205', '00005387-0000-4000-8000-000000000207',
    '00005387-0000-4000-8000-000000000218'
  );

-- B. Nye Plan-punkter (Next 10-130, Later 140-300, In progress) ----------------
INSERT INTO roadmap_items
  (id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, created_at, updated_at)
VALUES
  -- Planned · Next
  ('00006149-0000-4000-8000-000000000001', 'club', 60,
   'Send a message to another manager straight from his team page.',
   'Send en besked til en anden manager direkte fra hans holdside.',
   true, 'planned', 'next', 5831, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000002', 'youth', 70,
   'Move a rider between your squads while he is on the transfer list.',
   'Flyt en rytter mellem dine hold, mens han står på transferlisten.',
   true, 'planned', 'next', 5917, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000003', 'training', 80,
   'Copy one day''s training plan to the next days.',
   'Kopiér én dags træningsplan til de næste dage.',
   true, 'planned', 'next', 6060, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000021', 'training', 90,
   'Injuries reset at the season switch, the same way fatigue does.',
   'Skader nulstilles ved sæsonskiftet, ligesom trætheden.',
   true, 'planned', 'next', 5865, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000022', 'races', 100,
   'A shared captain: a second rider with his own GC chance, without a free role''s breakaway or a helper''s sacrifice.',
   'Delt kaptajn: en anden rytter med egen klassementschance, uden en fri rolles udbrud eller en hjælpers ofring.',
   true, 'planned', 'next', 5981, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000023', 'market', 110,
   'Rider values without potential: the training score takes its place in a rider''s value.',
   'Rytterværdier uden potentiale: træningsscoren tager dens plads i rytterens værdi.',
   true, 'planned', 'next', NULL, NOW(), NOW()), -- NY TEKST, kraever ejer-go
  ('00006149-0000-4000-8000-000000000016', 'club', 120,
   'A faster game: pages that open quickly, also on your phone.',
   'Et hurtigere spil: sider der åbner hurtigt, også på din telefon.',
   true, 'planned', 'next', 5131, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000015', 'races', 130,
   'Teamwork and Leadership values for the riders already in the game, not only new ones.',
   'Holdarbejde og Lederskab for de ryttere, der allerede er i spillet, ikke kun nye.',
   false, 'planned', 'next', 5268, NOW(), NOW()), -- skjult til ejeren har valgt paa #5268
  -- Planned · Later
  ('00006149-0000-4000-8000-000000000010', 'races', 190,
   'After each race, a card per rider with the order you gave him and a verdict on how he carried it out.',
   'Efter hvert løb et kort pr. rytter med den ordre, du gav ham, og en dom over, hvordan han løste den.',
   true, 'planned', 'later', 5101, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000011', 'races', 200,
   'Conditional orders: tell a rider what to do if something happens, for example chase only if other teams help.',
   'Betingede ordrer: sig til en rytter, hvad han skal gøre, hvis noget sker, for eksempel kun jagte, hvis andre hold hjælper.',
   true, 'planned', 'later', 5574, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000012', 'races', 210,
   'Team time trials: your riders ride together against the clock and get the team''s time.',
   'Holdtidskørsel: dine ryttere kører sammen mod uret og får holdets tid.',
   true, 'planned', 'later', 3463, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000013', 'club', 220,
   'Reputation for clubs and nations, like riders have now, built from results.',
   'Omdømme for klubber og nationer, ligesom rytterne har nu, bygget på resultater.',
   true, 'planned', 'later', 4957, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000014', 'club', 230,
   'Reputation for races and staff: a race''s prestige can change, and staff earn a name too.',
   'Omdømme for løb og personale: et løbs prestige kan ændre sig, og personalet får også et navn.',
   true, 'planned', 'later', 5106, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000018', 'races', 240,
   'Keep a rider out of the assistant''s picks, and let your rider ranking count in every race, not only target races.',
   'Hold en rytter ude af assistentens udtagelse, og lad din rangering af rytterne gælde i alle løb, ikke kun i målløb.',
   true, 'planned', 'later', 3374, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000020', 'market', 250,
   'Sell a rider to the AI when nobody bids on him after several auctions, for less than his value.',
   'Sælg en rytter til AI''en, når ingen byder på ham efter flere auktioner, til mindre end hans værdi.',
   true, 'active', 'next', 2885, NOW(), NOW()),  -- ejer 4/10: ikke planlagt, staar paa Vote som idé
  ('00006149-0000-4000-8000-000000000024', 'races', 280,
   'Its own icon for hilly stages in the calendar.',
   'Eget ikon for kuperede etaper i kalenderen.',
   true, 'planned', 'later', 6125, NOW(), NOW()), -- EN er NY TEKST, kraever ejer-go
  ('00006149-0000-4000-8000-000000000025', 'market', 290,
   'Set an auto-accept price on a listed rider: when someone hits it, a short public auction starts at once.',
   'Sæt en auto-accept-pris på en listet rytter: rammer nogen den, starter en kort offentlig auktion med det samme.',
   true, 'planned', 'later', 2176, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000026', 'club', 300,
   'Log in with Discord in one click.',
   'Log ind med Discord med ét klik.',
   true, 'planned', 'later', 2161, NOW(), NOW()),
  -- In progress
  ('00006149-0000-4000-8000-000000000009', 'training', 20,
   'Development 2.0: one clear development curve, racing that pays off by role, and a decline in older riders you can slow down.',
   'Udvikling 2.0: én tydelig udviklingskurve, løb der betaler sig efter rolle, og en tilbagegang hos ældre ryttere, du kan bremse.',
   true, 'in_progress', 'next', 6110, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- N4: i gang og "Coming to beta"
INSERT INTO roadmap_items
  (id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, beta_soon, created_at, updated_at)
VALUES
  ('00006149-0000-4000-8000-000000000004', 'training', 10,
   'On the Program tab, pick the rider first and then his program.',
   'På Program-fanen vælger du rytteren først og derefter hans program.',
   true, 'in_progress', 'next', 6035, true, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- B2. Rute-resten (ca980fca) med en KOPI af kildens stemmer ----------------------
INSERT INTO roadmap_items
  (id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, created_at, updated_at)
VALUES
  ('00006149-0000-4000-8000-000000000027', 'races', 270,
   'Mountain stages with a long valley road before the last climb.',
   'Bjergetaper med en lang dalvej før sidste stigning.',
   true, 'planned', 'later', 2768, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO roadmap_votes (item_id, user_id, idea_score, importance_score, created_at, updated_at)
SELECT '00006149-0000-4000-8000-000000000027', v.user_id, v.idea_score, v.importance_score, v.created_at, v.updated_at
FROM roadmap_votes v
WHERE v.item_id = '5bb11a13-a5de-402b-94df-f931ca980fca'
ON CONFLICT (user_id, item_id) DO NOTHING;

-- C. Beta: 4 nye punkter koblet til deres kontakt -----------------------------
-- status og beta_since angives eksplicit; triggeren roadmap_items_sync_flag
-- beholder en angivet beta_since (COALESCE). Ingen live_soon.
INSERT INTO roadmap_items
  (id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref,
   flag_key, beta_since, beta_soon, live_soon, created_at, updated_at)
VALUES
  ('00006149-0000-4000-8000-000000000005', 'training', 40,
   'Train now: run today''s training when it suits you, with the same result as the evening run.',
   'Træn nu: kør dagens træning, når det passer dig, med samme resultat som aftenkørslen.',
   true, 'in_progress', 'next', 4847, 'training_train_now', '2026-10-01T12:00:00Z', false, false, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000006', 'training', 50,
   'Training groups: one plan for several riders, and each rider keeps his own copy.',
   'Træningsgrupper: én plan for flere ryttere, og hver rytter beholder sin egen kopi.',
   true, 'in_progress', 'next', 6000, 'training_groups', '2026-10-01T12:00:00Z', false, false, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000007', 'races', 60,
   'The season matrix in Planning fits your phone screen.',
   'Sæsonmatricen i Planlægning passer til din telefonskærm.',
   true, 'in_progress', 'next', 5124, 'season_matrix_mobile', '2026-10-01T12:00:00Z', false, false, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000028', 'races', 70,
   'Choose whether a role applies from this stage to the end, or to this stage only.',
   'Vælg, om en rolle gælder fra denne etape og løbet ud, eller kun for denne etape.',
   true, 'in_progress', 'next', 6095, 'race_role_scope_choice', '2026-10-04T12:00:00Z', false, false, NOW(), NOW()) -- DA er NY TEKST
ON CONFLICT (id) DO NOTHING;

-- D. 18 nye Vote-idéer (6c minus nr. 8 og nr. 20; sort_order = 10 x 6c-nr.) ------
INSERT INTO roadmap_items
  (id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, created_at, updated_at)
VALUES
  ('00006149-0000-4000-8000-000000000031', 'races', 10,
   'See a rider''s age and abilities in a pop-up while you plan training or use the Planning board.',
   'Se en rytters alder og evner i et pop-up, mens du planlægger træning eller bruger planlægningsbrættet.',
   true, 'active', 'next', 2009, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000032', 'races', 20,
   'Iconic races are written by hand, so a classic stays the same classic every season.',
   'Ikoniske løb er skrevet i hånden, så en klassiker er den samme klassiker hver sæson.',
   true, 'active', 'next', 4122, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000033', 'races', 30,
   'AI teams field riders that fit their division, so Division 4 is no walkover.',
   'AI-holdene stiller ryttere, der passer til deres division, så Division 4 ikke er en walkover.',
   true, 'active', 'next', 2457, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000034', 'races', 40,
   'Watch a stage play out on the race page while it is being ridden, with the field moving along the profile.',
   'Se en etape udspille sig på løbssiden, mens den køres, med feltet der bevæger sig hen over profilen.',
   true, 'active', 'next', 4916, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000035', 'races', 50,
   'After today''s last race, Planning jumps to the next race day.',
   'Når dagens sidste løb er kørt, hopper Planlægning videre til næste løbsdag.',
   true, 'active', 'next', 2030, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000036', 'training', 70,
   'Each ability and power number explained in plain words when you hover over it or tap it.',
   'Hver evne og hvert effekttal forklaret i klart sprog, når du holder musen over det eller trykker på det.',
   true, 'active', 'next', 1833, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000037', 'training', 90,
   'See on the training page how many days until each rider''s next race.',
   'Se på træningssiden, hvor mange dage der er til hver rytters næste løb.',
   true, 'active', 'next', 4342, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000038', 'training', 100,
   'Your team''s injury and crash history: see how many injuries and crashes your riders have had.',
   'Dit holds skade- og styrthistorik: se hvor mange skader og styrt dine ryttere har haft.',
   true, 'active', 'next', 4942, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000039', 'youth', 130,
   'Lower age limits for the youth classification and juniors.',
   'Lavere aldersgrænser for ungdomsklassementet og juniorer.',
   true, 'active', 'next', 6126, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000040', 'youth', 140,
   'Homegrown riders: follow every rider from your academy, also after he leaves.',
   'Egne talenter: følg hver rytter fra dit akademi, også når han forlader holdet.',
   true, 'active', 'next', NULL, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000041', 'market', 170,
   'Filter the rider database by division.',
   'Filtrér rytterdatabasen på division.',
   true, 'active', 'next', 2399, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000042', 'market', 180,
   'The potential band stays steady between seasons, with its midpoint shown.',
   'Potentialebåndet er stabilt mellem sæsoner, og midtpunktet vises.',
   true, 'active', 'next', 5683, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000043', 'market', 190,
   'A market value that does not give away a young rider''s hidden potential.',
   'En markedsværdi, der ikke afslører en ung rytters skjulte potentiale.',
   true, 'active', 'next', 2798, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000044', 'club', 240,
   'A longer break between seasons, with time to plan the new one.',
   'En længere pause mellem sæsonerne, med tid til at planlægge den nye.',
   true, 'active', 'next', 5833, NOW(), NOW()), -- DA er NY TEKST
  ('00006149-0000-4000-8000-000000000045', 'club', 250,
   'See which riders the board counts as your stars.',
   'Se hvilke ryttere bestyrelsen regner som dine stjerner.',
   true, 'active', 'next', 1928, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000046', 'club', 260,
   'Your sponsor''s base amount paid race day by race day, like the rest.',
   'Sponsorens basisbeløb udbetalt løbsdag for løbsdag ligesom resten.',
   true, 'active', 'next', 3147, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000047', 'club', 270,
   'A way back for small clubs: cheaper ways to develop when you start late or fall behind.',
   'En vej tilbage for små klubber: billigere udvikling, når du starter sent eller er bagud.',
   true, 'active', 'next', 1981, NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000048', 'club', 280,
   'Wages paid per race day, like upkeep, instead of in one go.',
   'Løn betalt pr. løbsdag ligesom drift, i stedet for i én omgang.',
   true, 'active', 'next', NULL, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- E. 5 nye Done-raekker (afsnit 2 nederst) ------------------------------------
INSERT INTO roadmap_items
  (id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, shipped_at, created_at, updated_at)
VALUES
  ('00006149-0000-4000-8000-000000000051', 'training', 800,
   'One tap for Rest, Recovery or Program on your phone.',
   'Ét tryk for Hvile, Restitution eller Program på telefonen.',
   true, 'shipped', 'next', 5685, '2026-10-01T12:00:00Z', NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000052', 'training', 800,
   'See how tired each rider will be tonight before you choose.',
   'Se hvor træt hver rytter bliver i aften, før du vælger.',
   true, 'shipped', 'next', 5933, '2026-10-01T12:00:00Z', NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000053', 'training', 800,
   'Racing trains your riders: a rider develops from the race itself.',
   'Løb træner dine ryttere: en rytter udvikler sig af selve løbet.',
   true, 'shipped', 'next', 5267, '2026-09-28T12:00:00Z', NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000054', 'club', 800,
   'The new board: one confidence score, one mandate, an annual meeting.',
   'Den nye bestyrelse: én tillid, ét mandat, et årsmøde.',
   true, 'shipped', 'next', 3514, '2026-09-27T12:00:00Z', NOW(), NOW()),
  ('00006149-0000-4000-8000-000000000055', 'club', 800,
   'See each rider''s reputation.',
   'Se hver rytters omdømme.',
   true, 'shipped', 'next', 4956, '2026-10-01T12:00:00Z', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- F. Kendte fejl (5.6-fordelingen, afsnit 8 liste 4) ---------------------------
-- created_at: NOW() for aabne fejl (udkastet har ingen aabningsdato); for rettede
-- = closed_at (rettelsesdatoen fra patch notes), saa created_at aldrig ligger efter closed_at.
INSERT INTO known_issues
  (id, area, status, title_en, title_da, published, sort_order, issue_ref, created_at, updated_at, closed_at)
VALUES
  -- Confirmed · Fix in progress
  -- 101: sandhedstjek 4/10: rettet og live for alle siden 29/9 (ejer-godkendt 4/10 sent).
  ('00006149-0000-4000-8000-000000000101', 'training', 'fixed',
   'Fatigue and form moved far more in a day than they should.',
   'Træthed og form flyttede sig langt mere på en dag, end de skulle.',
   true, 10, 5928, '2026-09-29T12:00:00Z', '2026-09-29T12:00:00Z', '2026-09-29T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000102', 'training', 'fixing',
   'Some riders missed evening training on several days.',
   'Nogle ryttere fik ikke aftentræning på flere dage.',
   true, 20, 6129, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000103', 'club', 'fixing',
   'Youth race results moved some senior boards.',
   'Ungdomsløbenes resultater flyttede nogle seniorbestyrelser.',
   true, 30, 5897, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000104', 'other', 'fixing',
   'The game was unreachable for a while on some evenings.',
   'Spillet kunne ikke nås i et stykke tid på nogle aftener.',
   true, 40, 5878, NOW(), NOW(), NULL),
  -- 105: sandhedstjek 4/10: rettet 1/10 (beta-gruppen er de eneste med funktionen).
  ('00006149-0000-4000-8000-000000000105', 'training', 'fixed',
   'Train now (beta) does not show the result right away.',
   'Train now (beta) viser ikke resultatet med det samme.',
   true, 50, 6006, '2026-10-01T12:00:00Z', '2026-10-01T12:00:00Z', '2026-10-01T12:00:00Z'),
  -- 106: sandhedstjek 4/10: den gamle titel holdt ikke; ny titel, bekraeftet, intet arbejde i gang.
  ('00006149-0000-4000-8000-000000000106', 'training', 'confirmed',
   'A rider who drops out of a stage race rests for the rest of the race instead of training.',
   'En rytter, der udgår af et etapeløb, hviler resten af løbet i stedet for at træne.',
   true, 60, 5949, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000107', 'training', 'fixing',
   'The race day numbers in the training report are hard to understand.',
   'Løbsdagenes numre i træningsrapporten er svære at forstå.',
   true, 70, 5915, NOW(), NOW(), NULL),
  -- Confirmed
  ('00006149-0000-4000-8000-000000000108', 'races', 'confirmed',
   'A dangerous GC rider can get into the break without the GC teams reacting.',
   'En farlig klassementsrytter kan komme med i udbruddet, uden at klassementsholdene reagerer.',
   true, 80, 5978, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000109', 'training', 'confirmed',
   'Evening training can take a long time to finish after the last stage.',
   'Aftentræningen kan tage lang tid om at blive færdig efter sidste etape.',
   true, 90, 5911, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000110', 'market', 'confirmed',
   'Rider values changed at the season switch, which they should not.',
   'Rytterværdierne ændrede sig ved sæsonskiftet, hvilket de ikke må.',
   true, 100, 5842, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000111', 'training', 'confirmed',
   'Scouted projection is too low for the biggest young talents.',
   'Scouted projection viser for lavt for de største unge talenter.',
   true, 110, 6110, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000112', 'training', 'confirmed',
   'You can''t remove a rider''s own plan or put him back on the team program.',
   'Du kan ikke fjerne en rytters egen plan eller sætte ham tilbage på holdets program.',
   true, 120, 6123, NOW(), NOW(), NULL),
  -- (113 Malwarebytes #6047 udeladt: ejer 4/10, holdes ude af listerne)
  -- Reported, being checked
  ('00006149-0000-4000-8000-000000000114', 'training', 'checking',
   'Riders seem to develop more slowly with the new training.',
   'Rytterne virker til at udvikle sig langsommere med den nye træning.',
   true, 140, 5965, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000115', 'club', 'checking',
   'Board messages repeat after you negotiate, and the 3-year plan prompt leads nowhere.',
   'Bestyrelsesbeskeder gentager sig, efter du har forhandlet, og 3-års-planen fører ingen steder hen.',
   true, 150, 6122, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000116', 'club', 'checking',
   'The board can show your old target after you renegotiated it.',
   'Bestyrelsen kan vise dit gamle mål, efter du har genforhandlet det.',
   true, 160, 5946, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000117', 'club', 'checking',
   'The sponsor amount per race day looks lower than the deal you signed.',
   'Sponsorbeløbet pr. løbsdag ser lavere ud end den aftale, du skrev under på.',
   true, 170, 5916, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000118', 'club', 'checking',
   'Next season''s prize money estimate shows a range too wide to be useful.',
   'Præmieestimatet for næste sæson viser et spænd, der er for bredt til at bruge.',
   true, 180, 5940, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000119', 'market', 'checking',
   'Rider search finds names that don''t match what you typed.',
   'Ryttersøgningen finder navne, der ikke passer til det, du skrev.',
   true, 190, 5941, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000120', 'other', 'checking',
   'A squad selection reminder you deleted comes back.',
   'En påmindelse om holdudtagelse, som du har slettet, kommer igen.',
   true, 200, 5979, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000121', 'other', 'checking',
   'The reminder switch is hard to see in dark mode once it''s turned off.',
   'Kontakten for påmindelser er svær at se i mørkt tema, når den er slået fra.',
   true, 210, 5980, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000122', 'other', 'checking',
   'Some pages stop loading on mobile after an update.',
   'Nogle sider holder op med at indlæse på mobilen efter en opdatering.',
   true, 220, 5162, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000123', 'youth', 'checking',
   'A junior squad below the starting minimum shows as taking part, but can''t start.',
   'Et juniorhold under minimum står som deltager, men kan ikke starte.',
   true, 230, 5945, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000124', 'youth', 'checking',
   'Moving riders between squads can leave them on the wrong start list.',
   'Når du flytter ryttere mellem trupper, kan de blive stående på den forkerte startliste.',
   true, 240, 5903, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000125', 'youth', 'checking',
   'The assistant may fill a U23 squad you picked yourself when the race starts.',
   'Assistenten fylder måske et U23-hold op, som du selv har udtaget, når løbet starter.',
   true, 250, 6124, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000126', 'races', 'checking',
   'The race film repeats the same event many times in a row.',
   'Løbsfilmen gentager den samme hændelse mange gange i træk.',
   true, 260, 6137, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000127', 'races', 'checking',
   'Rolling and punchy uphill finishes can still give too big time gaps.',
   'Kuperede etaper og punch-afslutninger opad kan stadig give for store tidsforskelle.',
   true, 270, NULL, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000128', 'training', 'checking',
   'Training injuries feel too frequent, and the fatigue warning comes too late.',
   'Træningsskader føles for hyppige, og træthedsadvarslen kommer for sent.',
   true, 280, 5418, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000129', 'training', 'checking',
   'Some riders jumped or dropped in abilities at the season switch.',
   'Nogle ryttere sprang op eller ned i evner ved sæsonskiftet.',
   true, 290, 6059, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000130', 'training', 'checking',
   'A rider can still gain two points in one ability on the same day.',
   'En rytter kan stadig stige to point i samme evne på én dag.',
   true, 300, NULL, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000131', 'training', 'checking',
   'On a phone, training cannot be changed after a rider has trained.',
   'På telefonen kan træningen ikke ændres, når rytteren har trænet.',
   true, 310, NULL, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000132', 'youth', 'checking',
   'Some U23 riders with an expired contract stayed on the U23 team.',
   'Nogle U23-ryttere med udløbet kontrakt blev på U23-holdet.',
   true, 320, NULL, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000133', 'youth', 'checking',
   'Riders moving from junior to U23 can show the wrong age.',
   'Ryttere, der går fra junior til U23, kan vise forkert alder.',
   true, 330, NULL, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000134', 'market', 'checking',
   'Money from a sale can look like it came back to your account.',
   'Penge fra et salg kan se ud, som om de kom tilbage på kontoen.',
   true, 340, NULL, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000135', 'market', 'checking',
   'A 24-hour scout mission can return 4 riders instead of 5.',
   'En 24-timers scoutmission kan give 4 ryttere i stedet for 5.',
   true, 350, 6138, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000136', 'market', 'checking',
   'Sorting riders by reputation is not fully correct.',
   'Sortering af ryttere efter omdømme er ikke helt korrekt.',
   true, 360, NULL, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000137', 'market', 'checking',
   'You get an outbid mail when your own team bids.',
   'Du får en overbudt-mail, når dit eget hold byder.',
   true, 370, 5919, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000138', 'club', 'checking',
   'The left menu disappears in the board meeting.',
   'Venstremenuen forsvinder i bestyrelsesmødet.',
   true, 380, NULL, NOW(), NOW(), NULL),
  ('00006149-0000-4000-8000-000000000139', 'races', 'checking',
   'Caught breakaway riders can lose far more time than the race shows.',
   'Indhentede udbrydere kan tabe langt mere tid, end løbet viser.',
   true, 390, 5951, NOW(), NOW(), NULL),
  -- Fixed (closed_at = rettelsesdatoen i patch notes, kl. 12:00 UTC)
  ('00006149-0000-4000-8000-000000000140', 'races', 'fixed',
   'Riders went for the morning break without the order you gave them.',
   'Ryttere gik efter morgenudbruddet uden den ordre, du havde givet dem.',
   true, 400, 5955, '2026-10-02T12:00:00Z', NOW(), '2026-10-02T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000141', 'races', 'fixed',
   'Breakaway flags and the race film mixed up morning escapees and later attacks.',
   'Udbrudsflag og løbsfilmen blandede morgenudbrydere og senere angreb sammen.',
   true, 410, 5953, '2026-10-01T12:00:00Z', NOW(), '2026-10-01T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000142', 'races', 'fixed',
   'Top sprinters and puncheurs finished behind weaker teammates.',
   'De bedste sprintere og puncheurs sluttede bag svagere holdkammerater.',
   true, 420, 5957, '2026-10-02T12:00:00Z', NOW(), '2026-10-02T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000143', 'races', 'fixed',
   'A flat time trial paid a mountain prize although nobody scored mountain points.',
   'En flad enkeltstart udbetalte bjergpræmie, selvom ingen havde taget bjergpoint.',
   true, 430, 5956, '2026-10-01T12:00:00Z', NOW(), '2026-10-01T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000144', 'races', 'fixed',
   'Riders behind the breakaway won intermediate sprints and mountain tops.',
   'Ryttere bag udbruddet vandt mellemspurter og bjergtoppe.',
   true, 440, 5914, '2026-09-29T12:00:00Z', NOW(), '2026-09-29T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000145', 'races', 'fixed',
   'Teams on equal time could appear in the wrong order in the team classification.',
   'Hold på samme tid kunne stå i forkert rækkefølge i holdklassementet.',
   true, 450, 5952, '2026-09-30T12:00:00Z', NOW(), '2026-09-30T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000146', 'races', 'fixed',
   'A rider could ride two races on the same race day after a transfer.',
   'En rytter kunne køre to løb på samme løbsdag efter en transfer.',
   true, 460, 5860, '2026-10-04T12:00:00Z', NOW(), '2026-10-04T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000147', 'races', 'fixed',
   'Saving tactics for one stage changed the roles you had set on other stages.',
   'Når du gemte taktik for én etape, ændrede det rollerne på andre etaper.',
   true, 470, 6095, '2026-10-04T12:00:00Z', NOW(), '2026-10-04T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000148', 'training', 'fixed',
   'Training on the first race day of season 4 was lost for many riders.',
   'Træningen på sæson 4''s første løbsdag gik tabt for mange ryttere.',
   true, 480, 5912, '2026-09-29T12:00:00Z', NOW(), '2026-09-29T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000149', 'training', 'fixed',
   'Development history missed gains or showed them on the wrong date.',
   'Udviklingshistorikken manglede stigninger eller viste dem på den forkerte dato.',
   true, 490, 5947, '2026-10-01T12:00:00Z', NOW(), '2026-10-01T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000150', 'youth', 'fixed',
   'You couldn''t keep a U23 or junior squad out of racing.',
   'Du kunne ikke holde et U23- eller juniorhold ude af løb.',
   true, 500, 5944, '2026-10-01T12:00:00Z', NOW(), '2026-10-01T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000151', 'training', 'fixed',
   'Some riders did not train in the evening.',
   'Nogle ryttere trænede ikke om aftenen.',
   true, 510, 6061, '2026-10-03T12:00:00Z', NOW(), '2026-10-03T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000152', 'races', 'fixed',
   'The chasing group pushed caught breakaway riders backwards.',
   'Jagtgruppen skubbede indhentede udbrydere baglæns.',
   true, 520, 5951, '2026-10-01T12:00:00Z', NOW(), '2026-10-01T12:00:00Z'), -- NY TEKST
  ('00006149-0000-4000-8000-000000000153', 'other', 'fixed',
   'The site stopped on a blank page when the browser blocked site data.',
   'Siden stoppede på en tom side, når browseren blokerede site-data.',
   true, 530, 6168, '2026-10-04T12:00:00Z', NOW(), '2026-10-04T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- F2. Foerste opdatering: kun de 34 med en opdatering i afsnit 3 (ordret) --------
INSERT INTO known_issue_updates (id, issue_id, body_en, body_da, created_at)
VALUES
  ('00006149-0000-4000-8000-000000000201', '00006149-0000-4000-8000-000000000101',
   'Since 29 September, fatigue and form are settled once per date from the day''s total load, and the first day of the season was recalculated. Riders who still miss evening training are listed as a separate issue.',
   'Siden 29. september afregnes træthed og form én gang pr. dato ud fra dagens samlede belastning, og sæsonens første dag er regnet om. Ryttere, der stadig ikke får aftentræning, står som en særskilt fejl.',
   '2026-09-29T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000205', '00006149-0000-4000-8000-000000000105',
   'Train now trains the whole squad straight away, also when the assistant picks your riders. Riders entered in a race wait for their stage, and fatigue and form follow at the evening settlement.',
   'Træn nu træner hele truppen med det samme, også når assistenten udtager dine ryttere. Ryttere, der er tilmeldt et løb, venter på deres etape, og træthed og form følger ved aftenens afregning.',
   '2026-10-01T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000206', '00006149-0000-4000-8000-000000000106',
   'I checked it: a rider who drops out does not block training for the rest of the team. He rests on the race''s remaining days, and I''m looking at letting him train instead.',
   'Jeg har tjekket det: en rytter, der udgår, blokerer ikke træningen for resten af holdet. Han hviler på løbets resterende dage, og jeg ser på at lade ham træne i stedet.',
   NOW()),
  ('00006149-0000-4000-8000-000000000202', '00006149-0000-4000-8000-000000000102',
   'Riders who join a team now get their starting condition and train from their first day. Some riders who joined before 3 October still miss evening training. I''m fixing them, and their missed days will be made up with your current plans once I have approved the calculation.',
   'Ryttere, der kommer på et hold, får nu deres starttilstand og træner fra første dag. Nogle ryttere, der kom til før 3. oktober, får stadig ikke aftentræning. Jeg retter dem, og deres tabte dage bliver erstattet med dine nuværende planer, når jeg har godkendt beregningen.',
   NOW()),
  ('00006149-0000-4000-8000-000000000203', '00006149-0000-4000-8000-000000000103',
   'Youth results no longer move your senior board. Cleaning the old youth entries out of board history is the next step.',
   'Ungdomsresultater flytter ikke længere din seniorbestyrelse. Næste skridt er at rydde de gamle ungdomsposter ud af bestyrelseshistorikken.',
   NOW()),
  ('00006149-0000-4000-8000-000000000204', '00006149-0000-4000-8000-000000000104',
   'The database went down more than once. I''m working on automatic restarts, the root cause and more capacity.',
   'Databasen gik ned mere end én gang. Jeg arbejder på automatisk genstart, rodårsagen og mere kapacitet.',
   NOW()),
  ('00006149-0000-4000-8000-000000000207', '00006149-0000-4000-8000-000000000107',
   'The report now shows one receipt per rider for each date. Next is a plain explanation of the race day numbers on the page itself.',
   'Rapporten viser nu én kvittering pr. rytter for hver dato. Næste skridt er en klar forklaring af løbsdagenes numre på selve siden.',
   NOW()),
  ('00006149-0000-4000-8000-000000000208', '00006149-0000-4000-8000-000000000108',
   'On the new race rules, GC teams react with their free helpers when a threat is up the road. I still get reports of GC riders getting away, and I''m checking them against the standings before the stage.',
   'Med de nye løbsregler reagerer klassementsholdene med deres ledige hjælpere, når en trussel er kørt væk. Jeg får stadig meldinger om klassementsryttere, der slipper afsted, og tjekker dem op mod stillingen før etapen.',
   NOW()),
  ('00006149-0000-4000-8000-000000000209', '00006149-0000-4000-8000-000000000109',
   'The cause is found: teams are trained one at a time, and the run waits before it starts. The goal is a run that starts right away and finishes within minutes.',
   'Årsagen er fundet: holdene trænes ét ad gangen, og kørslen venter, før den starter. Målet er en kørsel, der starter med det samme og er færdig på få minutter.',
   NOW()),
  ('00006149-0000-4000-8000-000000000210', '00006149-0000-4000-8000-000000000110',
   'Values update on Sundays only. I''m finding what changed them at the switch.',
   'Værdierne opdateres kun om søndagen. Jeg finder ud af, hvad der ændrede dem ved skiftet.',
   NOW()),
  ('00006149-0000-4000-8000-000000000212', '00006149-0000-4000-8000-000000000112',
   'Reported by players. I''m checking the training page and adding a way back to the team program if it''s missing.',
   'Meldt ind af spillere. Jeg tjekker træningssiden og tilføjer en vej tilbage til holdets program, hvis den mangler.',
   NOW()),
  ('00006149-0000-4000-8000-000000000214', '00006149-0000-4000-8000-000000000114',
   'I''m comparing actual daily gains and programs, not just the number of breakthroughs. It is part of the development work I''m designing now.',
   'Jeg sammenligner det faktiske dagsudbytte og programmerne, ikke kun antallet af gennembrud. Det indgår i det udviklingsarbejde, jeg designer nu.',
   NOW()),
  ('00006149-0000-4000-8000-000000000215', '00006149-0000-4000-8000-000000000115',
   'Your board''s goals are under Mandate. I''m checking what makes the messages repeat.',
   'Bestyrelsens mål ligger under Mandat. Jeg tjekker, hvad der får beskederne til at gentage sig.',
   NOW()),
  ('00006149-0000-4000-8000-000000000216', '00006149-0000-4000-8000-000000000116',
   'Reported, not reproduced yet.',
   'Meldt ind, ikke genskabt endnu.',
   NOW()),
  ('00006149-0000-4000-8000-000000000217', '00006149-0000-4000-8000-000000000117',
   'I''m checking payment, display and units before I say anyone was paid too little.',
   'Jeg tjekker betaling, visning og enheder, før jeg siger, at nogen har fået for lidt.',
   NOW()),
  ('00006149-0000-4000-8000-000000000218', '00006149-0000-4000-8000-000000000118',
   'Reported and registered. No cause confirmed yet.',
   'Meldt ind og registreret. Ingen bekræftet årsag endnu.',
   NOW()),
  ('00006149-0000-4000-8000-000000000219', '00006149-0000-4000-8000-000000000119',
   'Reported and registered. No cause confirmed yet.',
   'Meldt ind og registreret. Ingen bekræftet årsag endnu.',
   NOW()),
  ('00006149-0000-4000-8000-000000000220', '00006149-0000-4000-8000-000000000120',
   'Reported. No cause confirmed yet.',
   'Meldt ind. Ingen bekræftet årsag endnu.',
   NOW()),
  ('00006149-0000-4000-8000-000000000221', '00006149-0000-4000-8000-000000000121',
   'Reported, not checked on screen yet.',
   'Meldt ind, ikke tjekket på skærmen endnu.',
   NOW()),
  ('00006149-0000-4000-8000-000000000222', '00006149-0000-4000-8000-000000000122',
   'Clearing the browser cache helped in one reported case. That doesn''t mean the whole problem is solved.',
   'At rydde browserens cache hjalp i én meldt sag. Det betyder ikke, at hele problemet er løst.',
   NOW()),
  ('00006149-0000-4000-8000-000000000223', '00006149-0000-4000-8000-000000000123',
   'The page doesn''t show the minimum either. No cause is confirmed yet.',
   'Siden viser heller ikke minimum. Der er ingen bekræftet årsag endnu.',
   NOW()),
  ('00006149-0000-4000-8000-000000000224', '00006149-0000-4000-8000-000000000124',
   'Some cleanup already runs when you move a rider. I''m checking the cases that remain.',
   'Noget oprydning kører allerede, når du flytter en rytter. Jeg tjekker de tilfælde, der er tilbage.',
   NOW()),
  ('00006149-0000-4000-8000-000000000225', '00006149-0000-4000-8000-000000000125',
   'Reported by a player. I''m checking whether your own selection is overwritten at the start.',
   'Meldt ind af en spiller. Jeg tjekker, om din egen udtagelse bliver overskrevet ved start.',
   NOW()),
  ('00006149-0000-4000-8000-000000000239', '00006149-0000-4000-8000-000000000139',
   'A fix is live: the chasing group now closes the gap, and caught riders are no longer pushed back. I have new reports of odd gaps and I''m checking whether they have the same cause.',
   'En rettelse er live: jagtgruppen lukker nu hullet, og indhentede ryttere skubbes ikke længere bagud. Jeg har nye meldinger om mærkelige tidsforskelle og undersøger, om de har samme årsag.',
   NOW()),
  ('00006149-0000-4000-8000-000000000240', '00006149-0000-4000-8000-000000000140',
   'In races on the new race rules, captains, sprint captains and helpers only go for the morning break with Try the break selected, and an attempt can fail. The Tactics tab shows which rules a race uses.',
   'I løb med de nye løbsregler går kaptajner, spurt-kaptajner og hjælpere kun efter morgenudbruddet med Forsøg udbrud valgt, og et forsøg kan mislykkes. Taktik-fanen viser, hvilke regler et løb bruger.',
   '2026-10-02T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000241', '00006149-0000-4000-8000-000000000141',
   'The results now separate the morning break from later attacks, and the film shows regroupings and descent attacks. Older stages without full history keep their markers.',
   'Resultaterne skelner nu mellem morgenudbruddet og senere angreb, og filmen viser samlinger og angreb på nedkørsler. Ældre etaper uden fuld historik beholder deres markeringer.',
   '2026-10-01T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000242', '00006149-0000-4000-8000-000000000142',
   'Form and fresh legs in the finale now follow ability, and AI teams no longer empty their leader before the sprint. It applies from the next stage that has not been raced.',
   'Form og friske ben i finalen følger nu evnerne, og AI-holdene kører ikke længere deres kaptajn tom før spurten. Det gælder fra næste etape, der ikke er kørt.',
   '2026-10-02T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000243', '00006149-0000-4000-8000-000000000143',
   'A mountain prize now needs mountain points. It applies to upcoming stages.',
   'En bjergpræmie kræver nu bjergpoint. Det gælder kommende etaper.',
   '2026-10-01T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000244', '00006149-0000-4000-8000-000000000144',
   'Riders in the breakaway now cross sprints and summits first, and in a bigger group only point hunters contest what is left. Points already awarded stay as they are.',
   'Ryttere i udbruddet krydser nu spurter og bjergtoppe først, og i en større gruppe kæmper kun pointjægere om resten. Point, der allerede er givet, står ved magt.',
   '2026-09-29T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000245', '00006149-0000-4000-8000-000000000145',
   'Equal time now follows the UCI tie-break, and this season''s team classifications have been recalculated.',
   'Lige tid afgøres nu efter UCI''s regel, og sæsonens holdklassementer er regnet om.',
   '2026-09-30T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000246', '00006149-0000-4000-8000-000000000146',
   'Selection now checks every race a rider has ridden that day, also finished races, and the assistant follows the same rule.',
   'Udtagelsen tjekker nu alle løb, rytteren har kørt den dag, også afsluttede løb, og assistenten følger samme regel.',
   '2026-10-04T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000247', '00006149-0000-4000-8000-000000000147',
   'Saving now only stores the stages you changed, and a stage that has started can no longer be changed.',
   'Når du gemmer, gemmes nu kun de etaper, du har ændret, og en etape, der er startet, kan ikke længere ændres.',
   '2026-10-04T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000248', '00006149-0000-4000-8000-000000000148',
   'The lost training has been restored for managers'' riders and checked rider by rider.',
   'Den tabte træning er genoprettet for managernes ryttere og kontrolleret rytter for rytter.',
   '2026-09-29T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000249', '00006149-0000-4000-8000-000000000149',
   'Each date now shows how the rider ended that date.',
   'Hver dato viser nu, hvordan rytteren sluttede den dato.',
   '2026-10-01T12:00:00Z'),
  ('00006149-0000-4000-8000-000000000250', '00006149-0000-4000-8000-000000000150',
   'On the U23 or Junior team page, set Races to Train only. The assistant stops entering that squad, and its riders train on days without a race.',
   'På siden for U23-holdet eller juniorholdet sætter du Løb til Kun træning. Assistenten stopper med at tilmelde holdet, og rytterne træner på dage uden løb.',
   '2026-10-01T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- H. Rettelser efter ejerens gennemsyn af billederne (4/10 sent) ----------------
-- H1. En fejls "updated"-dato foelger dens seneste opdatering, ikke seed-tidspunktet.
UPDATE known_issues k
  SET updated_at = u.latest
  FROM (SELECT issue_id, max(created_at) AS latest FROM known_issue_updates GROUP BY issue_id) u
  WHERE u.issue_id = k.id
    AND k.id::text LIKE '00006149-0000-4000-8000-0000000001%';

-- H2. De tre gamle Done-punkter uden dato faar den omtrentlige dato fra udkastets
--     aabne spoergsmaal 7 (ejer 4/10: hellere en omtrentlig dato end ingen).
UPDATE roadmap_items SET shipped_at = '2026-06-04T12:00:00Z'
  WHERE id = '00000954-0000-4000-8000-000000000001' AND shipped_at IS NULL;  -- race engine built for stories
UPDATE roadmap_items SET shipped_at = '2026-08-05T12:00:00Z'
  WHERE id = '00000954-0000-4000-8000-000000000002' AND shipped_at IS NULL;  -- livelier race reports
UPDATE roadmap_items SET shipped_at = '2026-06-13T12:00:00Z'
  WHERE id = '00000954-0000-4000-8000-000000000007' AND shipped_at IS NULL;  -- youth academies

COMMIT;

-- G. Post-verify (read-only, koeres af orkestratoren efter COMMIT) ---------------
--   1. SELECT status, approved, count(*) FROM roadmap_items GROUP BY 1, 2 ORDER BY 1, 2;
--        forventet: active/true 28 · active/false 13 · planned/true 29 · planned/false 1 (N15)
--                   in_progress/true 7 · shipped/true 27 · archived/true 3 · i alt 108
--      (hvis en beta-kontakt er flippet til on foer apply, flytter triggeren punktet
--       fra in_progress til shipped; tjek i saa fald app_config).
--   2. SELECT count(*) FROM roadmap_items WHERE status = 'active' AND approved;        -- 28 synlige idéer
--   3. SELECT horizon, count(*) FROM roadmap_items WHERE status = 'planned' AND approved GROUP BY 1;
--        -- next 12 · later 17
--   4. SELECT id, flag_key, status, beta_since, beta_soon, live_soon FROM roadmap_items
--        WHERE flag_key IS NOT NULL OR beta_soon ORDER BY sort_order;
--        -- 5 med flag_key (in_progress, beta_since 27/9, 1/10 x3, 4/10), N4 med beta_soon = true
--   5. SELECT count(*) FROM roadmap_votes;
--        -- 1121 + antal stemmer paa ca980fca (udkastet: 21, altsaa 1142)
--      SELECT (SELECT count(*) FROM roadmap_votes WHERE item_id = '5bb11a13-a5de-402b-94df-f931ca980fca') AS kilde,
--             (SELECT count(*) FROM roadmap_votes WHERE item_id = '00006149-0000-4000-8000-000000000027') AS kopi;
--        -- kilde = kopi
--   6. SELECT status, count(*) FROM known_issues WHERE published GROUP BY 1 ORDER BY 1;
--        -- checking 26 · confirmed 6 · fixed 14 · fixing 7 · i alt 53
--   7. SELECT count(*) FROM known_issue_updates;                                        -- 34
--   8. SELECT count(*) FROM known_issues WHERE status = 'fixed' AND closed_at IS NULL;  -- 0
