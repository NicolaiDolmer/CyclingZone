# Unchanged ticks must not rebuild ranking snapshots

Refs #5692. The concurrent-reader fix left periodic full refreshes running when
no source data changed. Staging measured 15 full RPCs across three unchanged
ticks, even though all snapshots were identical.

Capture events transactionally at all seven dependencies, including historical
corrections and present rider ownership. Compare relevant statement-transition
projections so training rating updates and unchanged writes stay quiet.
Claim a captured version, fence completion, retain later arrivals and failed
work. Lease metadata needs an actual DB writer lock as well: a lost HTTP client
can outlive its lease. Completion/heartbeat must acknowledge the same owner.

Result publication must not await the first global refresh. Training deferral
must use durable oldest work age; the previous ten-minute poll/twenty-minute
deferral did not meet the owner five-minute normal target. Rollover still needs
its fresh view before the season-start snapshot; enqueue-only would be wrong.

Supabase RPC builders are lazy. The initial measurement reader finished before
the RPC started; retained as an initial observation, never concurrency proof.
The corrected harness starts the RPC Promise before sampling readers.

No production writes/merges. Staging idle ticks: 15 to 0 full RPCs, 7976.78 to
83.37 ms, identical five-view contents. A real committed event completed in 68.05 s.

Read-only review caught a renew-to-execute gap: a paused owner could resume between a successor's view calls. Token/version fencing now occurs inside each heavy RPC while holding the writer lock. Lease takeover checks that lock too. DB time is captured after row admission; production omits caller time. A paused-owner SQL regression proves zero heavy work after takeover.
