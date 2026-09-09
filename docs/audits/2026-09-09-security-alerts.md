# Security alert remediation, 9 September 2026

Scope: the owner's Dependabot and CodeQL screenshots, verified against GitHub's
live alert API on main `3759ab2e6`. No alerts dismissed, no production mutations.

| Alerts | Cause | Change |
|---|---|---|
| Dependabot 43, 44 | Marketing Next.js 16.3.1 | Next.js and eslint-config-next 16.3.3 |
| Dependabot 46 | Transitive sharp 0.35.3 | Lockfile resolves sharp 0.35.4 and corresponding native packages |
| Dependabot 45 | Development dependency js-yaml 4.3.1 | Lockfile resolves js-yaml 4.3.2 |
| CodeQL 357, 358 | Substring matching of Hattrick/self-referral domains | Exact hostname or dot-delimited subdomain matching |
| CodeQL 359 | Pipe escaping omitted input backslashes | Escape backslashes before Markdown table pipes |

Dependency patch levels verified in npm and the reviewed advisories:
[Next Windows](https://github.com/advisories/GHSA-p293-qw3h-jr36),
[Next AVIF](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4),
[sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c),
[js-yaml](https://github.com/advisories/GHSA-2883-xcg3-v3hh).

## Verification

- Original channel suite: 7 pass. Added regression cases produced 2 expected
  failures against the original code. After fixes: all 11 focused tests pass.
- Isolated marketing `npm ci --ignore-scripts`: audit reports 0 vulnerabilities.
  Marketing lint: 0 errors, 4 warnings in unchanged files. Production build:
  Next.js 16.3.3, TypeScript passed, all 11 static pages generated.
- `verify-local.ps1`: backend isolated suite 118 pass; remaining backend suite
  9412 pass, 3 skipped; frontend 3181 pass. No unit failures. Frontend build was
  initially blocked by sandbox EPERM writing Vite's cache. The build alone was
  rerun with cache access and passed, including SSR and landing prerender.
- `preflight-pr.ps1`: passed, including backend/frontend warning budgets.
- `check-agent-token-hygiene.ps1`: 0 failures, 9 warnings.
- CodeRabbit 0.7.6 reviewed all 9 implementation/test/document files: 0 findings.
  Review initially blocked by approval review; retry was authorized after GitHub
  verified PUBLIC visibility and the configured CodeRabbit workflow was read.

## Limits and release follow-up

The 10 latest CodeQL analysis API records have empty `warning`/`error` fields,
including JavaScript/TypeScript and Actions on main. Their SARIF responses expose
no invocation diagnostics. This does not explain or clear the UI warning banner.
The screenshot's banner remains unconfirmed through those API surfaces.

CodeQL runs on main push and a weekly schedule, not on this PR. The changes must
be merged through the normal queue, deployments observed, and the exact new
main analysis checked before claiming all 7 alerts closed. No guard bypass is
authorized by this security fix. PR CI results supersede this local evidence.

No player-visible layout/copy or new feature is introduced: no patch note,
visual approval or FEATURE_REGISTRY lifecycle change is required. Channel
matching is documented in `docs/GROWTH_STACK.md` in this same change.
