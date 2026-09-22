# Joint calendar selection is a separate proposal

Refs #5405. Owner decision 22 September: preserve joint variant selection,
generator versioning and reconstruction as a separate draft, not part of the
approved finale calibration. This branch is based on the narrow calibration PR.

The proposal must use the same selected profiles for scorecard, gate and writing,
refuse writes when the bounded search is exhausted, and reconstruct persisted
variants before any backfill. Unknown provenance fails closed. No production
calendar, flag or schema was changed. Approval is still pending.
