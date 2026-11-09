# Instant training calculation snapshots

Allowing different slots to commit out of order exposed a lost update: both calculations could read the same development state, then both commit absolute ability patches and receipts. A lock acquired only at commit does not serialize the earlier calculation.

For stamped instant riders, carry the exact receipt-day snapshot with the report and compare it under the existing transaction locks before writes. A changed snapshot rejects the stale calculation for reread/retry; an already committed current slot remains a no-op. Unstamped behavior and RPC signatures remain unchanged.

The regression first failed because the real SQL accepted the stale second update. Coverage includes nonempty development patches on two different slots, recalculation/retry, duplicate replay, transport of the snapshot and native PG17 contenders. Empty ability patches alone cannot prove development safety.
