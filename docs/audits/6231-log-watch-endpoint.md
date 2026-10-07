# Supabase Log Watch endpoint correction

Refs #6231. The existing ClickHouse query already reads the unified logs table
and log_attributes map; only the transport endpoint was still logs.all.
The script now uses GET analytics/endpoints/logs with both ISO timestamps.
Classification thresholds and current/previous-day comparisons are unchanged.

Primary migration notice:
[Supabase announcement](https://github.com/orgs/supabase/discussions/48235).
The connected Supabase logs tool documents and queries the live `source` field;
the announcement's source_name examples are not used by this script.

HTTP 200 can contain a query error, so the result array and each nonnegative
integer count are checked before classification. Empty valid arrays remain
valid; missing/malformed data fails. Raw error bodies are never printed.
Tests inject the transport and use explicit fixed start/end timestamps.

No database writes, monitoring schedule changes or threshold changes. After
merge Claude should run Supabase Log Watch and confirm actual aggregate rows
were read; a green exit without a validated result is not sufficient.

Read-only live check on 6 October: the exact committed LOG_SQL ran through the
connected replacement logs endpoint for 06:00-07:00 UTC. It returned three
aggregate groups covering 189 matching log events, from postgres_logs and
postgrest_logs. No message/bucket values or personal data are published here.
This verifies the query against the live endpoint; the GitHub workflow/token
execution remains a separate check after the branch is pushed.
