# A7: a lock must include the financial effect

Refs #2176. The deployed transfer claim checked available balance under the shared team locks but committed ownership before JavaScript debited the buyer. A subsequent auction start could reserve the still-visible money. A read/check under a lock is insufficient when the protected effect happens in a later transaction.

The new service-only claim wraps the existing ownership/price checks and the existing audited payment or escrow RPCs in one transaction. Payment failure rolls back ownership. JavaScript skips its two legacy payment calls only after an explicit `payment_handled` receipt. Both flags off retain the original flow; no flag is changed here.

Regression evidence: real SQL tests cover immediate/parked/escrow payment, audit-failure rollback, refunds and permissions. Native PG17 checks the old failing ordering as a negative control, both fixed orderings and concurrent independent connections. Do not claim a green race result from a single-connection emulator.

Beta rollout is a separate owner decision on #2176: public participation and globally counted financial commitments cannot be reconciled by changing only the flag reader.
