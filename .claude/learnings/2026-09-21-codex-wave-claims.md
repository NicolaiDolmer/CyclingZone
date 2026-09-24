# Codex session visibility and wave admission (#4016, #5467)

Cause: Claude's active-session reader used only the Claude harness registry. Native Codex children inherited the parent's cwd, and the prior five-PR limit lived in prose.

Change: a common atomic wave-admission module, a Codex CLI entry with explicit cwd/sandbox, and runtime-neutral session claims read by Claude. A Codex session claim ends at SessionEnd, not the turn-level Stop event.

Evidence: synthetic registry tests, whole-hook tests, two real fixture workers plus independent reviewers, observed owned interruption, and a denied read-only write. Details: `docs/audits/2026-09-21-codex-wave-capability.md`.

Lesson: mock tests prove policy; a real process probe is still required for cwd, permissions, cancellation and terminal state. An elapsed TTL is not evidence that a writer stopped. Do not equate a successful shell exit with successful commands inside it.
