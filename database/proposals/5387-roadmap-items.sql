-- #5387 /roadmap = roadbooken. FORSLAG i database/proposals/ (auto-applies IKKE).
-- Ejer-gated: koeres foerst naar ejeren har godkendt teksterne i docs/drafts/5387-roadmap-indhold.md.
-- Idempotent: alle UPDATEs er vagtet (status + gammel/ny titel), INSERTs har faste id'er
-- + "where not exists" paa title_en + "on conflict (id) do nothing".
-- Roerer ALDRIG roadmap_votes. Intet DELETE: arkivering via status='archived'.
-- Baseline 23/9: 23 active, 6 shipped, 0 archived, 809 stemmer fra 40 managers.
-- Forventet efter: 42 active, 11 shipped, 1 archived, stemmetal uaendret.

-- PRE-CHECK (koer foerst, noter tallene):
-- select status, count(*) from roadmap_items group by status order by status;
-- select count(*) as votes_total from roadmap_votes;
-- select id, status, title_en, updated_at from roadmap_items where updated_at >= '2026-09-23' order by updated_at;

begin;

-- 1. Omskriv + ny raekkefoelge (kun aktive raekker; en titel aendret i admin siden 23/9 springes over).
--    new_en/new_da = null betyder "behold teksten, ret kun sort_order".
update roadmap_items r
set sort_order = v.sort_order,
    title_en   = coalesce(v.new_en, r.title_en),
    title_da   = coalesce(v.new_da, r.title_da),
    updated_at = now()
from (values
  -- This season (100)
  ('00000954-0000-4000-8000-000000000017'::text, 110::int,
   'Rider values that follow the market: prices shaped by real auctions and transfers.'::text,
   'Rider values that make sense: values follow your rider''s abilities and what the market really pays, and I explain how they are set.'::text,
   'Rytterværdier der giver mening: værdien følger rytterens evner og det, markedet reelt betaler, og jeg forklarer, hvordan den bliver sat.'::text),
  ('00000954-0000-4000-8000-000000000005', 110,
   'Long-term development you can see and steer, season over season.',
   'The training score for everyone: see how good each training day was, and steer your riders'' development season over season.',
   'Træningsscoren for alle: se hvor god hver træningsdag var, og styr dine rytteres udvikling sæson efter sæson.'),
  -- Before season 4 (200)
  ('00000954-0000-4000-8000-000000000004', 210,
   'Real training depth: programs for individual riders, not just a single focus.',
   'Training per race day: one rebuilt training page where you plan each rider around his races.',
   'Træning pr. løbsdag: én ny træningsside, hvor du planlægger hver rytter omkring hans løb.'),
  ('00000954-0000-4000-8000-000000000016', 210,
   'U19 and U23 squads with real promotion paths from academy to the top.',
   'U23 and junior squads: two real squads under your first team, with a path from the academy to the top.',
   'U23- og juniortrupper: to rigtige trupper under dit førstehold, med en vej fra akademiet til toppen.'),
  ('00000954-0000-4000-8000-000000000009', 230,
   'Generational renewal, so your club has a future beyond its current squad.',
   'Graduation Day: once a season you decide who moves up, who is sold and who leaves, so your club always has a next generation.',
   'Graduation Day: én gang pr. sæson bestemmer du, hvem der rykker op, hvem der sælges, og hvem der forlader klubben, så din klub altid har en ny generation på vej.'),
  -- During season 4 (300)
  ('00000954-0000-4000-8000-000000000008', 310,
   'Young riders you discovered, developed and made your stars.',
   'Your own young stars: choose the country your young riders come from, and steer which rider types your academy produces.',
   'Dine egne unge stjerner: vælg hvilket land dine unge ryttere kommer fra, og styr hvilke ryttertyper dit akademi får frem.'),
  ('df446f41-2314-4c7e-9ed8-38e9538c4798', 310,
   'Default training programs, and a workshop to share your own.',
   'Ready-made training programs, and later a way to share your own.',
   'Færdige træningsprogrammer, og senere en måde at dele dine egne på.'),
  ('00000954-0000-4000-8000-000000000019', 320,
   'Road captains and mentors: riders who lift the team around them.',
   'Road captains, mentors and teamwork: riders who lift the team around them.',
   'Vejkaptajner, mentorer og holdarbejde: ryttere der løfter holdet omkring sig.'),
  -- Not decided yet (900)
  ('00000954-0000-4000-8000-000000000014', 910,
   'National championships and national teams: ride for your country, win the jersey.',
   'National championships, worlds and europeans: ride for your country, win the jersey, and coach a national team.',
   'Nationale mesterskaber, VM og EM: kør for dit land, vind trøjen, og bliv landstræner.'),
  ('00000954-0000-4000-8000-000000000018', 930,
   'Earn renown: wins, records and history that build your club''s reputation in the world.',
   'Earn renown: statistics, records and history that build your club''s reputation in the world.',
   'Optjen renommé: statistik, rekorder og historie der bygger din klubs omdømme i verden.'),
  -- Beholdes uaendret, kun ny raekkefoelge
  ('00000954-0000-4000-8000-000000000013', 920, null, null, null),
  ('9a14a23b-475e-4870-af03-57e1cab2228d', 930, null, null, null),
  ('5bb11a13-a5de-402b-94df-f931ca980fca', 940, null, null, null),
  ('00000954-0000-4000-8000-000000000015', 910, null, null, null),
  ('00000954-0000-4000-8000-000000000011', 910, null, null, null),
  ('00000954-0000-4000-8000-000000000012', 920, null, null, null),
  ('00000954-0000-4000-8000-000000000021', 940, null, null, null),
  ('00000954-0000-4000-8000-000000000022', 960, null, null, null),
  ('aa3283fe-59c4-4774-a34b-ee9560efa858', 970, null, null, null),
  ('2f84b3a4-51ad-4b6d-b056-12008f52bf54', 980, null, null, null),
  ('cae1e719-1277-4547-b09e-7be6cf4ee514', 990, null, null, null)
) as v(id, sort_order, old_en, new_en, new_da)
where r.id = v.id::uuid
  and r.status = 'active'
  and (v.new_en is null or r.title_en in (v.old_en, v.new_en))
  and (r.sort_order <> v.sort_order
       or r.title_en is distinct from coalesce(v.new_en, r.title_en)
       or r.title_da is distinct from coalesce(v.new_da, r.title_da));

-- 2. Markér bygget (bevis i draften) + arkivér. Stemmer roeres ikke.
-- Beskeder mellem managers: PR #5019, patch 7.264 (8/9), registry manager-dm-v1 live uden flag.
update roadmap_items
set status = 'shipped', shipped_at = coalesce(shipped_at, '2026-09-08T00:00:00Z'), updated_at = now()
where id = '96553692-9138-42b1-ba16-8bd7b8247cad' and status = 'active';

-- Graduation Day: patch 7.293 (21/9), #2491 lukket. Kun hvis omskrivningen i trin 1 er landet.
update roadmap_items
set status = 'shipped', shipped_at = coalesce(shipped_at, '2026-09-21T00:00:00Z'), updated_at = now()
where id = '00000954-0000-4000-8000-000000000009' and status = 'active' and title_en like 'Graduation Day:%';

-- Designprincip, ikke noget der bygges: arkiveres (skjult), stemmerne bliver liggende.
update roadmap_items
set status = 'archived', updated_at = now()
where id = '00000954-0000-4000-8000-000000000006' and status = 'active';

-- 3. Nye punkter: 22 aktive fra roadbooken + 3 roadbook-punkter der allerede er live.
insert into roadmap_items (id, engine, sort_order, status, shipped_at, title_en, title_da, approved, created_at, updated_at)
select v.id::uuid, v.engine, v.sort_order, v.status, v.shipped_at::timestamptz, v.title_en, v.title_da, true, now(), now()
from (values
  -- This season (100)
  ('00005387-0000-4000-8000-000000000101'::text, 'races'::text, 110::int, 'active'::text, null::text,
   'The season 4 calendar: the same number of race days in every division, plus separate U23 and junior calendars.'::text,
   'Sæson 4-kalenderen: lige mange løbsdage i alle divisioner, plus egne U23- og juniorkalendere.'::text),
  ('00005387-0000-4000-8000-000000000102', 'races', 120, 'active', null,
   'Mental abilities: Teamwork and Leadership for every rider, and tactics and aggression that no longer come with age.',
   'Mentale evner: Holdarbejde og Lederskab for alle ryttere, og taktik og angrebslyst der ikke længere følger med alderen.'),
  ('00005387-0000-4000-8000-000000000103', 'races', 130, 'active', null,
   'Secondary rider types explained: see what a rider''s second type means and where it helps him.',
   'Sekundære ryttertyper forklaret: se hvad en rytters anden type betyder, og hvor den hjælper ham.'),
  ('00005387-0000-4000-8000-000000000104', 'training', 120, 'active', null,
   'A race sharpener: a short session the day before a race, so your riders start sharp.',
   'Åbnere: en kort session dagen før et løb, så dine ryttere starter skarpe.'),
  ('00005387-0000-4000-8000-000000000105', 'training', 130, 'active', null,
   'The game on your phone: daily training, transfers, auctions and the season matrix built for a small screen, then the rest of the game.',
   'Spillet på din telefon: daglig træning, transfers, auktioner og sæsonmatrixen bygget til en lille skærm, og derefter resten af spillet.'),
  -- This season, maybe (150)
  ('00005387-0000-4000-8000-000000000106', 'market', 150, 'active', null,
   'More fair play tools: a transfer market you can trust.',
   'Flere fair play-værktøjer: et transfermarked, du kan stole på.'),
  ('00005387-0000-4000-8000-000000000107', 'club', 150, 'active', null,
   'More facilities: more of your club to build than training and scouting.',
   'Flere faciliteter: mere af din klub at bygge ud end træning og scouting.'),
  ('00005387-0000-4000-8000-000000000108', 'club', 160, 'active', null,
   'A faster game: pages that open quickly, also on your phone.',
   'Et hurtigere spil: sider der åbner hurtigt, også på din telefon.'),
  -- Before season 4 (200)
  ('00005387-0000-4000-8000-000000000109', 'races', 210, 'active', null,
   'Race engine v4: every stage is raced as it unfolds. It switches on when it races better than the current engine.',
   'Løbsmotor v4: hver etape køres, mens den udfolder sig. Den slås til, når den kører bedre løb end den nuværende motor.'),
  ('00005387-0000-4000-8000-000000000110', 'training', 220, 'active', null,
   'Racing trains your riders again: on any day a rider either trains or races, and both count.',
   'Løb træner dine ryttere igen: på en given dag træner en rytter eller kører løb, og begge dele tæller.'),
  ('00005387-0000-4000-8000-000000000111', 'training', 230, 'active', null,
   'Training runs itself every evening: the bonus button goes away, and you can still run a day early if you want.',
   'Træningen kører af sig selv hver aften: bonusknappen forsvinder, og du kan stadig køre en dag tidligt, hvis du vil.'),
  ('00005387-0000-4000-8000-000000000112', 'training', 240, 'active', null,
   'Injuries counted in race days: you see exactly how many race days an injured rider will miss.',
   'Skader tælles i løbsdage: du kan se præcis, hvor mange løbsdage en skadet rytter går glip af.'),
  ('00005387-0000-4000-8000-000000000113', 'youth', 220, 'active', null,
   'Youth racing: U23 and junior races with their own calendars and leagues.',
   'Ungdomsløb: U23- og juniorløb med egne kalendere og ligaer.'),
  ('00005387-0000-4000-8000-000000000114', 'club', 210, 'active', null,
   'A new board: one mandate you agree on together, and a real board meeting.',
   'En ny bestyrelse: ét mandat, du og bestyrelsen bliver enige om, og et rigtigt bestyrelsesmøde.'),
  ('00005387-0000-4000-8000-000000000115', 'club', 220, 'active', null,
   'A clear sign-up for every new season, and inactive clubs parked at the switch, so you race against managers who play.',
   'En tydelig tilmelding til hver ny sæson, og inaktive klubber parkeres ved sæsonskiftet, så du kører mod managers, der spiller.'),
  -- Before season 4, maybe (250)
  ('00005387-0000-4000-8000-000000000116', 'club', 250, 'active', null,
   'Upkeep reworked: travel and staff costs paid per race day, instead of one big bill at season start.',
   'Drift og vedligehold lavet om: rejse- og personaleudgifter betales pr. løbsdag i stedet for én stor regning ved sæsonstart.'),
  -- During season 4 (300)
  ('00005387-0000-4000-8000-000000000117', 'youth', 320, 'active', null,
   'Youth seasons that count: promotion, relegation, rankings and prize money for U23 and junior.',
   'Ungdomssæsoner der tæller: oprykning, nedrykning, ranglister og præmiepenge for U23 og junior.'),
  ('00005387-0000-4000-8000-000000000118', 'club', 310, 'active', null,
   'A new dashboard and inbox: what needs you today comes first, and messages you can scan in seconds.',
   'Et nyt dashboard og en ny indbakke: det, der kræver dig i dag, står først, og beskeder, du kan overskue på få sekunder.'),
  -- Not decided yet (900)
  ('00005387-0000-4000-8000-000000000119', 'youth', 910, 'active', null,
   'Better scouting: more ways to find and judge the next big talent.',
   'Bedre scouting: flere måder at finde og vurdere det næste store talent på.'),
  ('00005387-0000-4000-8000-000000000120', 'club', 910, 'active', null,
   'Your club''s look: logo, team colours and rider faces.',
   'Din klubs udseende: logo, holdfarver og rytteransigter.'),
  ('00005387-0000-4000-8000-000000000121', 'club', 920, 'active', null,
   'Sponsors reworked: sign more than one sponsor at a time.',
   'Sponsorer lavet om: hav mere end én sponsor ad gangen.'),
  ('00005387-0000-4000-8000-000000000122', 'club', 950, 'active', null,
   'A smarter assistant: more help with the daily jobs, whenever you want it.',
   'En klogere assistent: mere hjælp til de daglige opgaver, når du vil have den.'),
  -- Allerede live (direkte i "Already built")
  ('00005387-0000-4000-8000-000000000201', 'market', 800, 'shipped', '2026-09-18T00:00:00Z',
   'All trades in one list: every rider move in the game, newest first.',
   'Alle handler i én liste: hvert rytterskifte i spillet, nyeste først.'),            -- PR #5374, patch 7.288
  ('00005387-0000-4000-8000-000000000202', 'club', 800, 'shipped', '2026-09-18T00:00:00Z',
   'The beta group: ask to join and try new features before everyone else.',
   'Beta-gruppen: bed om at komme med, og prøv nye funktioner før alle andre.'),      -- #5259, patch 7.288
  ('00005387-0000-4000-8000-000000000203', 'races', 800, 'shipped', '2026-09-21T00:00:00Z',
   'Your assistant tells you when it picked a squad you left empty.',
   'Din assistent giver besked, når den har udtaget et hold, du havde ladet stå tomt.') -- PR #5466, patch 7.293
) as v(id, engine, sort_order, status, shipped_at, title_en, title_da)
where not exists (select 1 from roadmap_items r where r.title_en = v.title_en)
on conflict (id) do nothing;

commit;

-- POST-VERIFY
select status, count(*) from roadmap_items group by status order by status;
-- forventet: active 42, archived 1, shipped 11
select count(*) as votes_total from roadmap_votes;
-- skal vaere lig pre-check-tallet (809 den 23/9, plus evt. nye stemmer afgivet i mellemtiden)
select engine, sort_order, left(title_en, 70) as title
from roadmap_items
where status = 'active' and approved
order by engine, sort_order;
