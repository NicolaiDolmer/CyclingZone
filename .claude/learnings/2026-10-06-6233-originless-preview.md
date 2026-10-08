# Preview comparisons need the whole PR and whole repository

Refs #6233. Vercel's originless clone made the old fetch fail, so independent
PRs always built. Its frontend-scoped diff also omitted shared inputs when
fetch did succeed. The CLI now fetches the verified public repository directly
with bounds and classifies the cumulative whole-repo PR diff through the same
safe input rule as production. Failed or missing metadata builds.

The first CLI adjustment accidentally chose preview mode without branch
metadata. The old fail-closed CLI regression caught a zero exit; missing branch
metadata now explicitly builds. All 14 decision tests, including an actual originless Git fixture, and tools typecheck pass.
