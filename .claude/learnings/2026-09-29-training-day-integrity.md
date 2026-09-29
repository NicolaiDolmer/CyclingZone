# Training day integrity (#5888)

Three independent representations drifted: one-day races write GC rather than stage results; saved selections can contain riders omitted from the actual start field; the old race-gap recovery writer survived the switch to recovery per training tick.

Fix: classify one-day GC using race metadata, validate training bindings against the immutable first-stage field, preserve legitimate abandonment without blocking teammates, and give race-day training exclusive ownership of gap recovery. Preserve unknown bindings and flag-off behavior. Query failures must never manufacture DNS or enable a second recovery writer.

Regression coverage uses synthetic riders and fixed dates: senior/U23/junior GC, tour-GC rejection, DNS program continuation in manager and assistant ticks, injury precedence, retries, malformed/missing snapshots, legacy object snapshots, missing results, and recovery ownership in both race orchestration paths. No production data repair or balance changes are part of this patch.

Lesson: test the producer's real result shape and actual start field, not only a convenient stage-result fixture. A cadence change must also audit every existing condition writer.

Independent review caught a new over-strict check: a starter without a ranked result can be a legitimate DNF. Removed that check after observing failing DNF regressions; query failures still fail closed. DNS release here is training-only; selection and persistent booking repair remain explicit follow-up.
