# Injury duration follows the season axis

Refs #5462. The initial implementation copied the duration roll directly onto
the race-day axis, shortening injuries in calendar time. The owner clarified
the intended duration on 21 September. Read both calendar targets; never embed
their quotient as another constant. Count the end day inclusively without an
extra tick. Keep the flag-off payload and date arithmetic unchanged.

Review also caught old coordinates surviving date fallback. On season rollover,
drop the previous axis but preserve the injury date. A new crash without a
usable axis must clear stale coordinates when the feature is enabled; omitted
upsert columns otherwise preserve the older injury's meaning.

Tests cover both writers, different axis ratios, inclusive boundaries, rollover,
unknown axes, and legacy flag-off payloads. No production writes or flag flips.

Verification lesson: verify-local and Playwright must not build into the same dist directory concurrently, even with separate semaphore slots. A production build replaced the e2e bundle mid-run and removed its i18n test hook. The clean Android rerun after builds completed passed all runnable tests.
