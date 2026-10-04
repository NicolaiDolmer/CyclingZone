# #6115: orphan offers after ownership changes

Cause: transfer/swap and auction helpers clean up offers outside the ownership
write; AI acquisitions, release and other paths could leave old negotiations open.
Owner decision A: close open deals on an actual ownership change, no new expiry rule.
Fix: separate null-safe AFTER UPDATE rider trigger, invoker rights, existing open
status set and both swap positions. All three writes commit or roll back together.
Regression: PostgreSQL write boundaries, no-op/null/terminal/repeat, failure rollback,
role/RLS behaviour and both #6119 ownership triggers in either apply order.
Lesson: an ownership invariant belongs at the database write boundary; keep
independent lifecycle triggers separate and test their actual SQL together.
No historical repair performed; prod apply remains owner-gated.
