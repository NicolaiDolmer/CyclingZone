-- normalize-crlf-functions.sql - KUN staging (#5904). Genskaber public-funktioner hvis krop
-- indeholder CR (migrationer anvendt fra et Windows-checkout med CRLF), saa definitionen
-- bliver byte-identisk med prod (LF fra Linux-CI). Aendrer ikke signatur, ejer eller grants
-- (CREATE OR REPLACE bevarer dem). Idempotent: 0 funktioner med CR = ingen aendring.
do $$
declare r record; n int := 0;
begin
  if current_database() <> 'postgres' then raise exception 'uventet database'; end if;
  for r in
    select p.oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prokind in ('f', 'p') and position(E'\r' in p.prosrc) > 0
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute replace(pg_get_functiondef(r.oid), E'\r', '');
    n := n + 1;
  end loop;
  raise notice 'normalize-crlf: % funktioner genskabt', n;
end $$;
