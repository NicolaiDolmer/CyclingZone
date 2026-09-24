# Injury duration follows the season axis

Refs #5462. The initial implementation copied the duration roll directly onto
the race-day axis, shortening injuries in calendar time. The owner clarified
the intended duration on 21 September. Read both calendar targets; never embed
their quotient as another constant. Owner clarification on 22 September: the
injury-day session has already completed, so the full scaled number of subsequent
training ticks must be lost. Keep the flag-off payload and date arithmetic unchanged.

Review also caught old coordinates surviving date fallback. On season rollover,
drop the previous axis but preserve the injury date. A new crash without a
usable axis must clear stale coordinates when the feature is enabled; omitted
upsert columns otherwise preserve the older injury's meaning.

Tests cover both writers, different axis ratios, inclusive boundaries, rollover,
unknown axes, and legacy flag-off payloads. No production writes or flag flips.

Independent review also caught migration-order and rollback gaps: shared team
queries must use only columns already deployed, and a stale race-day count cannot
revive an injury without injured_until. A delayed crash keeps the later of the
fallback and axis dates. If the date fallback owns the injury, clear axis metadata
so a following training tick cannot shorten it again. Cover the writer-to-tick
sequence, not only the date comparison in isolation.

Verification lesson: verify-local and Playwright must not build into the same dist directory concurrently, even with separate semaphore slots. A production build replaced the e2e bundle mid-run and removed its i18n test hook. The clean Android rerun after builds completed passed all runnable tests.
