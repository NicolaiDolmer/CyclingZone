# Axe scan provenance must not depend on build output during collection

Date: 2026-11-11. Issue #7993, PR #8006. Caught by independent PR review before merge.

Problem: axe-quality.spec.ts computed the compiled-app fingerprint at module scope. A fresh worktree has no frontend/dist; Playwright loads specs before its configured local webServer build, so ordinary test discovery threw ENOENT.

Evidence: temporarily relocated only the owned dist directory, ran the axe spec with --list, and restored the directory in finally. Before: exit 1, zero tests. After: exit 0, 27 tests. The complete axe suite subsequently passed 27/27 without retries; pure ratchet tests passed 7/7.

Fix: initialize the fingerprint in the file-level beforeAll hook, after server setup. Every worker, including replacement workers, initializes it before emitting scan evidence.

Prevention: test infrastructure must remain collectable without generated output. Compiled-app provenance belongs in execution setup, not spec discovery. Fresh-checkout discovery and the raw post-fix scans are recorded in docs/metrics/7993-axe-verification.json. No product UI, baseline allowance or test threshold changed.
