# Security alerts: transitive dependency and test code (2026-09-29)

## Root cause

- `backend/package-lock.json` locked `ip-address@10.4.0` through `express-rate-limit`. The upstream NAT64 local-use classifier defect affected versions through 10.5.0. The current `express-rate-limit` path uses IP subnet/key functions, not the affected private/loopback classifiers, but the vulnerable package remained in the runtime dependency tree.
- CodeQL flagged an HTML-tag regex assertion in `scripts/lib/prShots.test.mjs` and source-code construction with interpolated temporary paths in `scripts/wave-policy.test.mjs`. Both findings were in test code.

## Fix and verification

- Updated only `ip-address` in the backend lockfile to 10.7.2. Replaced the regex assertion with literal escaped/raw HTML assertions and passed subprocess paths as argv instead of embedding them in code.
- Targeted tests, PR preflight, PR CI, main CI, deploy verify, and independent CodeRabbit review passed. GitHub marks all three alerts fixed after merge of PR #5925; Vercel reported `READY` for the merge commit.

## Learning

For security alerts, check the exact dependency path and whether production code reaches the affected API. Fix test-code scanner findings at their source and verify alert state after the next main scan; do not dismiss them solely because they appear in tests.
