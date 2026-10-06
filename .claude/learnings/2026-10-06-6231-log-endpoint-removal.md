# Log Watch must fail on API-body errors as well as HTTP errors

Refs #6231. Supabase removed logs.all; the script already used ClickHouse SQL
but still sent it to the old endpoint. Updating the URL alone also left a
false-green path: HTTP 200 with an error/null result became an empty window.

Use the unified logs endpoint with explicit timestamps, validate the result
and counts, and fail on query errors. Do not log raw API error bodies.
The injected transport tests pin the time window and prove the old endpoint,
HTTP-200-error and raw-error-body regressions before the correction.

Read-only review also caught coercion of empty strings, booleans and arrays into counts. Expanded malformed-row tests reproduced RED; accept only numeric values or decimal-digit strings, then enforce safe nonnegative integers. The same 9 tests now cover these shapes.
