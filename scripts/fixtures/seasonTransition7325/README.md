# Synthetic PG17 dependency subset

This is NOT a production schema copy. The runner loads unchanged production
training-plan DDL, sponsor-contract DDL/unique indexes, balance audit RPC, and
rank-rollover SQL plus the later publication transformation from owning SQL.
Other tables provide an explicit synthetic dependency subset.

Production orchestration and carry-over functions run unchanged. No phase is
replaced by a mock. The SQL transport fails on unsupported shapes; it preserves
SQLSTATE for the real production financial dedupe path.

All JavaScript network access is denied before importing backend modules,
including legacy clients whose dotenv loaders could otherwise restore service
configuration. Synthetic local env values also keep those clients away from
production. Native PG binaries use explicit loopback and verify the live owned
data directory and PG17 version before SQL.

This is not PostgREST, RLS, authenticated HTTP, latest full-schema compatibility,
or external delivery evidence. See the investigation report for measured native
outcomes and exact remaining rider/payroll/board/notification dependency closure.
Existing evidence directories are preserved and rejected for reuse.

The current guarded rerun verifies identity in the same psql session as every
SQL operation, including maintenance database creation and restore. Restore
bytes cannot reconnect the client. Every child attempt uses exclusive stdout,
stderr, result and stop paths, all listed in its evidence manifest. The native
identity regression uses only two controlled local synthetic clusters.
