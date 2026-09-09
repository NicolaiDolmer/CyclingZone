# Security alerts: dependency patches and incomplete escaping

GitHub confirmed Dependabot alerts 43-46 and CodeQL alerts 357-359 open on
2026-09-09. Marketing pinned Next.js 16.3.1; its lockfile also retained vulnerable
sharp and js-yaml versions. The reviewed advisories specify Next.js 16.3.3,
sharp 0.35.4 and js-yaml 4.3.2 as the applicable patched versions.

The Monday report matched Hattrick/self-referral with substring checks, so
lookalike hosts were counted as genuine channels. The inventory generator
escaped pipe delimiters without first escaping input backslashes. Both bugs
were reproduced with failing tests before the fixes; the 11 focused tests pass.
These are reporting/document formatting paths, not authentication checks.

Keep boundary cases in the existing tests, and update the lockfile as well as
the direct dependency. Do not dismiss GitHub alerts to make the page green:
main scanning and deployed versions still need verification after merge.

Patch notes are unnecessary: dependency security maintenance and internal
report/document correctness introduce no player-facing feature or copy change.
FEATURE_REGISTRY is unchanged: no feature lifecycle or flag changes.
