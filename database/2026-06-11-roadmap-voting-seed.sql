-- Roadmap-voting seed (#954): de 22 items ejeren godkendte enkeltvist 11/6.
-- Punkt 1-12 = de eksisterende "på vej hen"-bullets fra locales/{en,da}/roadmap.json
-- (allerede ejer-reviewet copy, 10/6). Punkt 13-22 = nye items forankret i
-- besluttede issues/doctrine (godkendt 11/6): #1146, #934, #931, #932, #1281,
-- #1099, #1177, #930, klubmuseum (doctrine), #935.
--
-- Faste UUID'er (00000954-...-NN) gør seed'en idempotent via ON CONFLICT (id)
-- DO NOTHING — re-apply ændrer intet, og senere tekst-rettelser sker som
-- UPDATE i nye migrationer (eller admin-edit), ikke ved re-seed.
-- Filnavnet sorterer EFTER 2026-06-11-roadmap-items-votes.sql ("items" < "voting"
-- i LC_ALL=C), så tabellen findes når auto-migrate når hertil.

INSERT INTO roadmap_items (id, engine, sort_order, title_en, title_da, approved, status) VALUES
  -- 🏁 Løb
  ('00000954-0000-4000-8000-000000000001', 'races', 1,
   'A race engine built for stories: stage drama you can follow, discuss and brag about.',
   'En løbsmotor bygget til historier: etapedrama du kan følge, diskutere og prale af.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000002', 'races', 2,
   'Livelier race reports, on the way to following races as they unfold.',
   'Mere levende løbsrapporter, på vej mod at følge løb mens de udfolder sig.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000003', 'races', 3,
   'Tactics and rider form that actually shape outcomes, without hiding why.',
   'Taktik og rytterform der reelt former udfaldet, uden at skjule hvorfor.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000013', 'races', 4,
   'A smarter season planner: overlapping races, fatigue and qualification rules you can plan a whole season around.',
   'En klogere sæsonplanlægger: overlappende løb, træthed og kvalifikationsregler du kan planlægge en hel sæson omkring.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000014', 'races', 5,
   'National championships and national teams: ride for your country, win the jersey.',
   'Nationale mesterskaber og landshold: kør for dit land, vind trøjen.', TRUE, 'active'),

  -- 📈 Træning
  ('00000954-0000-4000-8000-000000000004', 'training', 1,
   'Real training depth: programs for individual riders, not just a single focus.',
   'Rigtig træningsdybde: programmer til den enkelte rytter, ikke kun ét fokus.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000005', 'training', 2,
   'Long-term development you can see and steer, season over season.',
   'Langsigtet udvikling du kan se og styre, sæson efter sæson.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000006', 'training', 3,
   'Meaningful choices with consequences, never spreadsheet homework.',
   'Meningsfulde valg med konsekvenser, aldrig regnearks-lektier.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000015', 'training', 4,
   'Coaches as a real resource: balance training load and risk burnout if you push too hard.',
   'Trænere som en ægte ressource: balancér træningsbelastningen og risikér nedslidning hvis du presser for hårdt.', TRUE, 'active'),

  -- 🌱 Ungdom
  ('00000954-0000-4000-8000-000000000007', 'youth', 1,
   'Youth academies: your own next generation growing up through the club.',
   'Ungdomsakademier: din egen næste generation der vokser op gennem klubben.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000008', 'youth', 2,
   'Young riders you discovered, developed and made your stars.',
   'Unge ryttere du selv opdagede, udviklede og gjorde til dine stjerner.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000009', 'youth', 3,
   'Generational renewal, so your club has a future beyond its current squad.',
   'Generationsskifte, så din klub har en fremtid ud over den nuværende trup.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000016', 'youth', 4,
   'U19 and U23 squads with real promotion paths from academy to the top.',
   'U19- og U23-hold med ægte oprykningsveje fra akademi til toppen.', TRUE, 'active'),

  -- ⚡ Marked
  ('00000954-0000-4000-8000-000000000010', 'market', 1,
   'Deadline day: a shared, dramatic climax to every transfer window.',
   'Deadlineday: et fælles, dramatisk klimaks på hvert transfervindue.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000011', 'market', 2,
   'Deeper negotiation between managers.',
   'Dybere forhandling mellem managers.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000012', 'market', 3,
   'A market that tells stories: rumors, rivalries and big moves the whole world talks about.',
   'Et marked der fortæller historier: rygter, rivaliseringer og store handler hele verden taler om.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000017', 'market', 4,
   'Rider values that follow the market: prices shaped by real auctions and transfers.',
   'Rytterværdier der følger markedet: priser formet af rigtige auktioner og transfers.', TRUE, 'active'),

  -- 🏛️ Klub & verden
  ('00000954-0000-4000-8000-000000000018', 'club', 1,
   'Earn renown: wins, records and history that build your club''s reputation in the world.',
   'Optjen renommé: sejre, rekorder og historie der bygger din klubs omdømme i verden.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000019', 'club', 2,
   'Road captains and mentors: riders who lift the team around them.',
   'Vejkaptajner og mentorer: ryttere der løfter holdet omkring sig.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000020', 'club', 3,
   'Build your staff: sports directors, coaches and doctors who shape how your club works.',
   'Byg din stab: sportsdirektører, trænere og læger der former hvordan din klub arbejder.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000021', 'club', 4,
   'A club museum: champions, legendary riders and the races people still talk about.',
   'Et klubmuseum: mestre, legendariske ryttere og løbene folk stadig taler om.', TRUE, 'active'),
  ('00000954-0000-4000-8000-000000000022', 'club', 5,
   'Friends and following: follow managers and riders across the world.',
   'Venner og følg-funktion: følg managers og ryttere på tværs af verden.', TRUE, 'active')
ON CONFLICT (id) DO NOTHING;
