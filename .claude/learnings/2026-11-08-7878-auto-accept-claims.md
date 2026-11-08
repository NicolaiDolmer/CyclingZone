# #7878: distinguish flag failure and close cross-path ownership races

Independent review of 484f908e6 plus main 00805056e found two P1s: a failed
generic flag read selected the unlocked legacy release path, and an ordinary
transfer could pass its seller-floor read before an auto-accept start and move
ownership afterwards. The prior release/start race was already fixed.

Regression-first evidence: all flag-error entry points rejected the old code;
the transfer race test observed a successful deal where refusal was required.
The module now reads the flag freshly and propagates lookup errors. Confirmed
off/missing still selects legacy behavior. The service-only transfer claim RPC
locks teams in the existing order, then the rider, rechecks seller floor,
buyer seats and same-rider auction state before ownership/parking. An explicit
contract/graduate whitelist preserves omitted fields and existing update shape.
Refusal stops before payment and downstream cleanup. This is ownership/floor/
seat atomicity; the existing later payment flow has not become one transaction.

PGlite proves actual SQL and both serial orders, not concurrent connections.
The old PR-body pgbench claim had no reproducible harness in the located
artifacts. Replace it with measured command/output from the committed opt-in
PG17 test, which checks every returned status and final state and observes
server shutdown. CI without AUTO_ACCEPT_PG_BIN explicitly skips that proof.

Registry now links market-auto-accept to its flag and SSOT. No flag activation,
production SQL, new player copy, merge or relaxed verification baseline.
