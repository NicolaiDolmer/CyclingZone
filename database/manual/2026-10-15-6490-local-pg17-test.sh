#!/usr/bin/env bash
# #6490: kør drop-migrationen og rollback mod en lokal PG17, præcis som auto-migrate
# (psql -f, ON_ERROR_STOP). Hvert trin har en forventning; ét afvigende trin = exit 1.
# Brug: PG_BIN=<pg17/bin> bash database/manual/2026-10-15-6490-local-pg17-test.sh
set -u
BIN=${PG_BIN:-/c/Users/Nicolai/scoop/apps/postgresql/current/bin}  # PG17-binaerer
D=${SCRATCH:-$(mktemp -d)}  # midlertidig klynge, aldrig i repoet
WT=$(cd "$(dirname "$0")/../.." && pwd)
MIG=$WT/database/2026-10-15-6490-drop-training-report-riders-gin.sql
RB=$WT/database/manual/2026-10-15-6490-recreate-training-report-riders-gin.sql
PORT=${PG_PORT:-55490}
FAILS=0
expect() { # expect <navn> <faktisk> <forventet>
  if [ "$2" = "$3" ]; then echo "OK   $1: $2"; else echo "FAIL $1: fik '$2', forventede '$3'"; FAILS=$((FAILS+1)); fi
}

rm -rf "$D/data"
"$BIN/initdb" -D "$D/data" -U postgres -A trust >/dev/null || { echo "FAIL initdb"; exit 1; }
"$BIN/pg_ctl" -D "$D/data" -o "-p $PORT" -l "$D/pg.log" -w start >/dev/null || { echo "FAIL pg_ctl start"; exit 1; }
trap '"$BIN/pg_ctl" -D "$D/data" -m fast stop >/dev/null 2>&1' EXIT
P() { "$BIN/psql" -h localhost -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q "$@"; }
idx() { P -tAc "select count(*)||':'||coalesce(bool_and(i.indisvalid)::text,'-') from pg_indexes x left join pg_class c on c.relname=x.indexname left join pg_index i on i.indexrelid=c.oid where indexname='idx_training_day_runs_report_riders'"; }

P <<'SQL' || { echo "FAIL fixture"; exit 1; }
create table public.training_day_runs(id bigserial primary key, team_id uuid not null default gen_random_uuid(), tick_date date not null default current_date, report jsonb not null);
insert into training_day_runs(report)
select jsonb_build_object('riders', (select jsonb_agg(jsonb_build_object('rider_id',gen_random_uuid(),'gain',random())) from generate_series(1,25)))
from generate_series(1,20000);
create index idx_training_day_runs_report_riders on public.training_day_runs using gin (((report -> 'riders'::text)) jsonb_path_ops);
-- prod-lignende funktion der udpakker raekke for raekke (maa IKKE stoppe vagten)
create function public.rider_training_seen_sources() returns setof uuid language sql as $f$
  select (e->>'rider_id')::uuid from public.training_day_runs t cross join lateral jsonb_array_elements(t.report->'riders') e $f$;
SQL
expect "1. indeks foer" "$(idx)" "1:true"

# samtidig skriver (som aftenafregningen) mens migrationen koerer
( fails=0; for i in $(seq 1 200); do P -c "insert into training_day_runs(report) values (jsonb_build_object('riders', jsonb_build_array(jsonb_build_object('rider_id',gen_random_uuid()))))" || fails=$((fails+1)); done; echo "$fails" > "$D/writefails" ) &
W=$!
t0=$(date +%s%N); P -f "$MIG"; rc=$?; t1=$(date +%s%N)
wait $W
echo "     migrationstid $(( (t1-t0)/1000000 )) ms"
expect "2. migration rc" "$rc" "0"
expect "2. indeks efter" "$(idx)" "0:-"
expect "2. samtidige skrivninger" "$(P -tAc 'select count(*)-20000 from training_day_runs')" "200"
expect "2. fejlede skrivninger" "$(cat "$D/writefails")" "0"
P -f "$MIG" 2>/dev/null; expect "3. idempotent genkoersel rc" "$?" "0"
expect "3. indeks" "$(idx)" "0:-"
P -f "$RB"; expect "4. rollback rc" "$?" "0"
expect "4. indeks gyldigt" "$(idx)" "1:true"
P -c "create function public.bad_reader(u uuid) returns boolean language sql as \$f\$ select exists(select 1 from public.training_day_runs where report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',u))) \$f\$"
P -f "$MIG" 2>"$D/guard.err"; rc=$?  # det ENESTE trin der skal fejle
expect "5. vagt stopper (rc != 0)" "$([ "$rc" -ne 0 ] && echo stop || echo koerte)" "stop"
expect "5. vagtens besked" "$(grep -c 'bad_reader' "$D/guard.err")" "1"
expect "5. indeks urort" "$(idx)" "1:true"

if [ "$FAILS" -gt 0 ]; then echo "RESULTAT: $FAILS trin fejlede"; exit 1; fi
echo "RESULTAT: alle trin OK"
