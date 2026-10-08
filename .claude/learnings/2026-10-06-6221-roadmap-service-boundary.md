# Roadmap admin RPCs need a backend boundary

Refs #6221 #6174. SECURITY DEFINER body checks prevented non-admin writes,
but authenticated users could still invoke the three public RPC endpoints.
The advisor findings were confirmed by read-only production privilege checks.

Move browser consumers to requireAdmin backend routes before revoking client
EXECUTE. Service callers also need function-body support: admin stats and split
previously relied on the browser's admin identity. The forward migration gives
service-only execute and explicit service body gates without changing the
operation's data rules. Tests execute actual role privileges, repeated apply,
stats/split/resync and unauthorized HTTP requests. Production apply remains with Claude.
