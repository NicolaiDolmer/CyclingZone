# Codex Verification Recipes

Use these recipes as starting points. Runtime evidence wins over docs.

## Onboarding and Test Accounts

- Read `docs/TESTING.md` for current test-account rules.
- Run `npm run codex:doctor` first; fix secret or local-state failures before login testing.
- Use Browser for `/login`, `/dashboard`, create-team/manager flows, and the blocking route from the active issue.
- If credentials fail, do not guess passwords. Verify Infisical/`backend/.env` and run `node scripts/setup-test-accounts.mjs` only when the slice explicitly allows test-account mutation.
- Acceptance: authenticated test user reaches the expected page and no console/API errors explain the reported blocker.

## Admin

- Verify auth guard and API response handling before changing UI state.
- Run local frontend tests/build when admin components change.
- Use Browser to click the affected admin tab and verify loading/error states.
- Acceptance: tab exits loading in success, non-JSON error, and network-error paths.

## Market and Auctions

- Check both API and cron paths for auction finalization; they must delegate through shared finalization code.
- For bid/proxy behavior, prefer existing scripts in `docs/TESTING.md` and backend tests over manual clicking.
- Use Browser only after API-level verification proves the state transition.
- Acceptance: owner state, payment state, squad limits, and transfer-window rules still hold.

## Board and Economy

- Check constants and DB constraints before changing displayed money or board decisions.
- Verify finance transaction types against runtime constraints.
- For UI-only copy/layout work, Browser verification is still required.
- Acceptance: no manager can gain inconsistent board/economy state by refreshing, retrying, or backing out mid-flow.

## Deploy and Production Health

- After commit/push, use Vercel MCP or `gh run list`/deployment checks to confirm the relevant commit deployed.
- Fetch the production or preview URL when a protected Vercel fetch is required.
- For backend health, use the documented Railway health endpoint or runtime logs.
- Acceptance: deployment is green, health endpoint responds, and the changed route/flow is verified against the deployed target when the issue requires `codex:needs-prod-verify`.

## Suggested Automations

Create these only after user review:

- Daily launch-readiness digest: high-priority open issues, failing CI, latest deploy, and Sentry spikes.
- Weekly local-state audit: stale branches, `.codex.local` drift, `.mcp.json` secret check, and untracked Codex artifacts.
- Pre-TdF risk digest: issues tagged launch/TdF/security plus unresolved production verification labels.
