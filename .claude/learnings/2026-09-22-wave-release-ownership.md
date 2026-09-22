# Wave IDs are not ownership proof

Refs #5467. Ordinary release previously accepted a public wave ID and a claim
that children had stopped. Record the admitted process identity and require its
live process tree before releasing. Owner PID, creation identity, boot and
session provenance must not be rewritten into a recoverable history.

A workflow resume also needs its exact admitted run, not merely the same session.
Bind it only from the original invocation's harness response; unknown metadata
keeps resume disabled. The first harmless docs lane verifies real client wiring.

An idle check cannot exclude a concurrent admission. Hold the shared state mutex
through the actual merge subprocess and every retry. Fixture tests exercise both
directions of exclusion; no real wave was released and no PR was merged.
