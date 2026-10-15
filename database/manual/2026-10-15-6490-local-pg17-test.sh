#!/usr/bin/env bash
# #6490: kør drop-migrationen og rollback mod en lokal PG17, præcis som auto-migrate (psql -f, ON_ERROR_STOP).
set -u
BIN=${PG_BIN:-/c/Users/Nicolai/scoop/apps/postgresql/current/bin}  # PG17-binaerer
D=${SCRATCH:-$(mktemp -d)}  # midlertidig klynge, aldrig i repoet
WT=$(cd "$(dirname "$0")/../.." && pwd)
MIG=$WT/database/2026-10-15-6490-drop-training-report-riders-gin.sql
RB=$WT/database/manual/2026-10-15-6490-recreate-training-report-riders-gin.sql
PORT=55490
rm -rf "$D/data"; "$BIN/initdb" -D "$D/data" -U postgres -A trust >/dev/null
"$BIN/pg_ctl" -D "$D/data" -o "-p $PORT" -l "$D/pg.log" -w start >/dev/null
P() { "$BIN/psql" -h localhost -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q "$@"; }
idx() { P -tAc "select count(*)||':'||coalesce(bool_and(i.indisvalid)::text,'-') from pg_indexes x left join pg_class c on c.relname=x.indexname left join pg_index i on i.indexrelid=c.oid where indexname='idx_training_day_runs_report_riders'"; }

P <<'SQL'
create table public.training_day_runs(id bigserial primary key, team_id uuid not null default gen_random_uuid(), tick_date date not null default current_date, report jsonb not null);
insert into training_day_runs(report)
select jsonb_build_object('riders', (select jsonb_agg(jsonb_build_object('rider_id',gen_random_uuid(),'gain',random())) from generate_series(1,25)))
from generate_series(1,20000);
create index idx_training_day_runs_report_riders on public.training_day_runs using gin (((report -> 'riders'::text)) jsonb_path_ops);
-- prod-lignende funktion der udpakker raekke for raekke (maa IKKE stoppe vagten)
create function public.rider_training_seen_sources() returns setof uuid language sql as $f$
  select (e->>'rider_id')::uuid from public.training_day_runs t cross join lateral jsonb_array_elements(t.report->'riders') e $f$;
SQL
echo "1. foer: indeks=$(idx)"

# samtidig skriver (som aftenafregningen) mens migrationen koerer
( for i in $(seq 1 200); do P -c "insert into training_day_runs(report) values (jsonb_build_object('riders', jsonb_build_array(jsonb_build_object('rider_id',gen_random_uuid()))))" || echo WRITE_FAIL; done ) &
W=$!
t0=$(date +%s%N); P -f "$MIG"; rc=$?; t1=$(date +%s%N)
wait $W
echo "2. migration rc=$rc tid=$(( (t1-t0)/1000000 )) ms, indeks=$(idx), skrivninger ialt=$(P -tAc 'select count(*)-20000 from training_day_runs')"
P -f "$MIG"; echo "3. idempotent genkoersel rc=$? indeks=$(idx)"
P -f "$RB"; echo "4. rollback rc=$? indeks(antal:gyldigt)=$(idx)"
P -c "create function public.bad_reader(u uuid) returns boolean language sql as \$f\$ select exists(select 1 from public.training_day_runs where report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',u))) \$f\$"
P -f "$MIG" 2>"$D/guard.err"; rc=$?
echo "5. vagt med containment-laeser: rc=$rc ($(grep -o '#6490[^.]*' "$D/guard.err" | head -1)), indeks=$(idx)"
"$BIN/pg_ctl" -D "$D/data" -m fast stop >/dev/null
