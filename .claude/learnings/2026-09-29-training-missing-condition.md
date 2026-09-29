# Training registration lost the legacy missing-condition fallback

Refs #5928. Production Sentry investigation on 29 September found two separate
failures: the legacy evening sweep still entered the normalized motor; registered
riders without `rider_condition` were quarantined before the legacy neutral
fallback could be used. Read-only evidence: 84 riders on 17 teams, all without a
condition row or opening, no date receipts or race loads; 64 academy, 20 other.

The normalized motor correctly rejected incompatible legacy calls before writes.
Fix ownership at the caller, not by weakening that guard. Registration must freeze
the effective starting state, including first-use default semantics, atomically.
Protect historical evidence and already frozen work from implicit reconstruction.
Test actual PostgreSQL registration, first full date and duplicate retries.

The alarm's old wording called every quarantine missing race evidence. Report
reconciliation generically and preserve bounded, serialized reasons through the
cron/Sentry wrapper depth. Do not interpret [Object] as proof of a race failure.

Forward registration is not repair of the 84 existing quarantines. Any recovery
needs separate verified openings and an explicit, idempotent owner-approved path.
