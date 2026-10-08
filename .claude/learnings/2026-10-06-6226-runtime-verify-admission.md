# Fair verification needs persistent waiting identity

Refs #6226. A global two-slot semaphore allowed Codex to hold both places while
Claude lanes waited. Add runtime/worktree to reservations and persistent waiting
records; determine admission atomically, including the competing waiter.

Codex stays at one, Claude may borrow the second while alone, and the wave's
runtime gets first eligible admission. Do not preempt running work. Unknown
legacy owners must not be guessed from labels. Preserve existing deferred-delete
and pinned-reader handling; a separate waiting queue alone does not replace the
legacy ticket/delete invariants. Nested reuse must fail fast, not deadlock.

Native process/barrier tests use private slot maps; no live wave or shared-slot
fixture test, staging measurement or production call is needed.
