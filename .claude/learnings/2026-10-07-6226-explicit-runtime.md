# Runtime identity and fair admission, 7 October 2026

Refs #6226 / #6282. Optional Codex session variables did not prove child-runtime
identity. The runner now explicitly passes CZ_VERIFY_RUNTIME=codex through its
spawn options. A real subprocess test covers inherited Claude identity and absent
Codex session variables.

Capacity follows the issue: at most one new place per family when another family
runs or waits; a known family may use two alone. The owner can declare -Runtime
manual. Unknown/legacy records remain conservative. Wave priority is preserved;
it is not a bounded-wait promise under continuous wave backlog. No preemption.

Red/green observed for child identity, standalone Codex capacity and manual sharing.
The combined runner/lock suite passed 35 tests in private slot directories. The
first sandbox run lacked CIM access; the native rerun passed. No real wave, live
semaphore mutation, production access or player text change. Independent local
read-only review found no P0-P2. CI retains both main's recovery/probe coverage and
the runtime-lock tests.
