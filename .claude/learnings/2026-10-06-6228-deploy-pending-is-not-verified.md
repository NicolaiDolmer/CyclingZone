# Pending deployment is neither failed nor verified

Refs #6228. The polling deadline returned exit 1 for Railway BUILDING and
the queue called that a red deployment. A longer timeout alone preserves
the same false signal at a later time.

The workflow now records pending without running production probes or posting
success. The queue requires matching SHA/attempt and actual smoke success,
reruns only a completed pending observation, and waits for a strictly newer
attempt. Pending expiry blocks further merges with a distinct temporary exit;
it never reaches the final verified message. Tests use explicit clocks.
