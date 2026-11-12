# Saved stage exceptions need a write boundary

Refs #7864. The native PG17 pre-code baseline reproduced lost role data after
a refused insert, racing replacements, and an order upsert overwriting a
manual save made after the caller's read. A zero-override reset had no durable
distinction from an unplanned stage.

Client filtering is insufficient. Both manual writers and batch confirmation
must share stable sorted stage locks. Compare captured role/roster snapshots
inside the transaction, mark even empty resets, preserve legacy rows, and write
the new roles/order together. A marker must not create an engine overlay.

Fresh route/role validation belongs to each destination. Unknown capabilities,
malformed receipts, network errors and permission errors never authorize a
non-atomic fallback. Production uses the DB clock after lock waits; tests inject
an exact time. Native concurrency includes manual roles, manual orders and
opposing batches, plus actual role privileges and a positively stopped server.

An applied receipt does not justify adopting a newer foreign readback version.
Confirm both role and order data; retain foreign/failed drafts and advance only
confirmed baselines. A lost response may be resolved by matching readback.

Legacy intention-only summaries cannot describe route plans. In the new board,
omit the old untouched/default-effort footer rather than implying that stages
with saved order plans were unchanged. Keep pending stage numbers and actual
save receipts visible. A saved notice from another stage must not hide a local
unsaved manual draft after navigation.
