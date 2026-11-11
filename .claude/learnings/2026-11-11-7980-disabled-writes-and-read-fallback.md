# Installed capability is not an enabled feature

Refs #7864, PR #7980, Claude marker 6803820273.

The first capability check conflated an installed marker table with an enabled
write path. OFF must choose the original manual writers before reading markers,
even after migration. Raw beta/on still shares atomic locks across viewers.

Storage/protocol failures had been converted to a client-validation code and
returned before captureException. One response boundary now captures 5xx errors
and returns a neutral code; expected 4xx conflicts keep their existing codes.
Optional metadata on GET cannot make existing orders/defaults unavailable.

Regression tests execute the actual route callbacks with injected dependencies
and clock. They reproduced the three P1s before the fix. Native PG17 now covers
eight mixed UUIDs and a held DDL lock: the migration must hit lock_timeout rather
than the test's statement_timeout. Its server is positively checked stopped.
The remaining deferred P2s are collected in #8013. No production apply or flags.
