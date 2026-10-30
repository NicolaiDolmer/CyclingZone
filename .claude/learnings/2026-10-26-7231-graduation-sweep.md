# Academy graduation backfill and training-day reads

Refs #7231, #7223. Owner mandate: C1, 26 October 2026.

- Pagination bounds result rows, not the UUID list encoded in a PostgREST URL. Graduation notification recovery had three unbounded filters after loading all pending rows.
- Read-only reproduction using synthetic UUIDs: the season-sized notification URL failed with `UND_ERR_HEADERS_OVERFLOW`; the bounded control returned HTTP 200. This supports a transport-size cause rather than a season-column change; it does not reproduce the exact production `Bad Request` response.
- Reuse `fetchAllRowsChunkedIn` for teams, notifications and riders, preserving per-chunk pagination and owner-specific notification matching. Regression covers a synthetic season-sized cohort and notification history across a page boundary.
- Training knowledge previously issued one parallel exact HEAD per rider. Legacy embedded `rider_training_scores(count)` returns the same team-scoped counts in one request for a normal roster, without enabling aggregate functions or returning training history. Zero-day and missing riders retain zero entries. Large input lists remain chunked.
- Read-only REST comparison confirmed the embedded count matched the former HEAD count. Native PostgreSQL 17.11 synthetic baseline confirmed identical results for the per-rider and correlated count forms. Three timings were noisy and do not demonstrate lower latency. The disposable PG17 server was observed stopped.
- Graduation Day reuses the youth squad counts already read by the same route. No rules, player copy, deadlines, migration or production data changed. No patch notes per wave mandate.
- The earlier `findStuckAcademyGraduates` reader also has unbounded filters. Its current candidate list was smaller than the failing notification cohort; changing this separate shared reader is outside this lane's owned files.
- Release evidence remains Claude's task: observe a successful evening backfill and delivery before existing deadlines. Local fixtures and SELECTs do not establish deployed behavior.
