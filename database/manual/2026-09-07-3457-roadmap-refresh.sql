-- #3457 Roadmap-siden opdateret 7/9 2026 (ejer-go "Koer alt" i Claude Code-session).
-- Koert direkte mod prod via Supabase MCP i een transaktion. Idempotent: kan koeres igen uden dobbelt-effekt.
-- Post-verify: 23 aktive, 6 shippede (foer: 23 aktive, 3 shippede; 3 til shipped, 1 slettet, 4 nye).
begin;
update roadmap_items set status='shipped', shipped_at=coalesce(shipped_at,'2026-07-18T00:00:00Z'), updated_at=now() where id='00000954-0000-4000-8000-000000000020' and status<>'shipped'; -- Build your staff (live 18/7, patch 7.25)
update roadmap_items set status='shipped', shipped_at=coalesce(shipped_at,'2026-09-06T00:00:00Z'), updated_at=now() where id='00000954-0000-4000-8000-000000000003' and status<>'shipped'; -- Tactics and rider form (dagsform + roller, v3)
update roadmap_items set status='shipped', shipped_at=coalesce(shipped_at,'2026-07-22T00:00:00Z'), updated_at=now() where id='c1a3260f-8019-4890-8388-530648aad58c' and status<>'shipped'; -- Bonus seconds & sprints (v7.40)
-- Deadline day: modsiger always-open-markedet (transfervindue fjernet 26/6, patch 6.20). Ejer valgte slet.
delete from roadmap_votes where item_id='00000954-0000-4000-8000-000000000010';
delete from roadmap_items where id='00000954-0000-4000-8000-000000000010';
insert into roadmap_items (id, engine, sort_order, status, title_en, title_da, approved, created_at, updated_at)
select gen_random_uuid(), v.engine, v.sort_order, 'active', v.title_en, v.title_da, true, now(), now()
from (values
  ('club', 7, 'Direct messages and mentions between managers.', 'Direkte beskeder og @-omtaler mellem managers.'),
  ('club', 8, 'Invite a friend and build your rivalry together.', 'Inviter en ven og byg jeres rivalisering sammen.'),
  ('club', 9, 'A living world feed of results, transfers and rivalries.', 'Et levende verdensfeed med resultater, transfers og rivaliseringer.'),
  ('training', 5, 'Default training programs, and a workshop to share your own.', 'Standardtræningsprogrammer og en workshop til at dele dine egne.')
) as v(engine, sort_order, title_en, title_da)
where not exists (select 1 from roadmap_items r where r.title_en = v.title_en);
commit;
