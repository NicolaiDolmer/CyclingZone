# #7875: market gate review follow-up

The generic feature-stage reader intentionally maps read errors to null/off.
That is unsafe for M3: the database can still enforce its enabled gate while
JavaScript silently chooses a legacy seat-count/cascade path. The M3 reader now
distinguishes a successful missing/off read from a failed read. The latter throws,
and bid/proxy handlers read before committing anything. Existing off behavior is
preserved. Regressions were observed failing before the change.

A manual bid could commit before its optional proxy was rejected. Returning the
proxy's HTTP 400 then told both clients the manual bid failed. The normal success
response now carries that existing localized error as a warning; no new copy or
layout. Executed route and formatter regressions cover the distinction.

Route tests execute registered production handlers with the real M3 helpers and
an isolated database boundary double. SQL rules and real concurrent connections
are tested separately. Source-text assertions alone do not establish route behavior.

The PG17 test previously discarded individual INSERT outcomes. It now requires
one accepted request per round and verifies that every other rejection came from
the intended gate, then emits counts for the PR verification record.

Executable proxy-route coverage exposed a second timing gap: after M3 had
atomically recorded an opening bid, a newer higher bid could be overwritten by
the legacy unconditional leader update. The enabled proxy route now uses the
same conditional leader sync as the manual bid route. A higher-rival interleave
was observed RED (price lowered) and GREEN (higher leader/price preserved).

Known gap retained from the reviewed PR: market_commitment_6181 has no
FEATURE_REGISTRY entry, so check-flag-liveness does not track it. This is stated
in the PR; no production flag change or new activation decision was made.
# Follow-up validation

The follow-up uses the actual cascade, executable handlers, SQL transaction
boundaries and a real PG17 lock barrier. Off-mode remains covered separately.
Review mapping and detailed evidence are kept in the owner's private context;
public PR communication contains aggregate status only.
