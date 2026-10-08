# Frontend production build selection

Refs #6202. Owner mandate: 5 October, prepare a PR that builds main only for
frontend changes or inputs it depends on. This replaces the former unconditional
main-build rule when the owner merges the PR. No dashboard setting changes or
production deployment are part of this work.

`frontend/vercel.json` calls `frontend/scripts/vercel-ignore-build.ts` for main and previews. Preview changes in #6233 also classify Dependabot inputs. Vercel exit 0 means
skip; exit 1 means build. The Node version is the frontend's existing Node 24
requirement (the build already invokes a TypeScript script directly).

For production the comparison base is `VERCEL_GIT_PREVIOUS_SHA`, the last successful deployment
for this project and branch, not HEAD's parent. If the commit is absent from a
shallow checkout, the script attempts one bounded fetch of that exact SHA. A missing origin or unavailable base causes a full build. Preview uses the separate originless policy below. No remote is added by this PR. Missing
metadata, Git errors or a failed fetch build conservatively. Same-commit
redeploys build so environment/configuration changes can still be released.
Rename detection is disabled so a move out of frontend still rebuilds it.

All frontend files build, including public assets, locales, config and tests.
Root scripts, manifests/lockfiles, shared packages, toolchain settings and
unknown paths also build. All of backend/lib/ is a build input, including new files. Only known independent directories (the rest of backend,
database, docs, marketing, screenshots and agent/GitHub metadata) and named
root documentation files skip. Keep actual build dependencies out of this
exclusion set. The import-coverage test checks literal relative source imports;
dynamic filesystem reads and new build commands still need diff review.

Current build inputs were checked in frontend/package.json, vite.config.js,
vite-plugins, generate-indexnow-key.ts and prerender.mjs: source/public/template
reads stay inside frontend except the imported pure projection in backend/lib/raceParticipationHistory.ts, which is covered by the backend/lib/ rule. Build changes that introduce outside inputs must
update this contract in the same PR. Unknown inputs intentionally favor safety
over maximum savings.

Verification: `node --test frontend/scripts/vercel-ignore-build.test.ts` and
`node scripts/vercel-build-impact.mjs docs/audits/6202-build-replay.json`.
The measurement document separates observed deployment counts, replayed build
decisions and actual post-release usage. True after measurements require the
owner's merge and a comparable window; never label the replay as production
savings. A manual Vercel redeploy can also ignore the Ignored Build Step when
the owner explicitly needs a rebuild.

Sources: [Vercel Ignored Build Step](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel),
[last successful deployment SHA](https://github.com/vercel/vercel/discussions/7251).

## CLI and release verification (#6222 review)

The standalone ignore-build CLI always runs its decision, including through a
junction alias. It defaults to BUILD; pure helpers live in
`frontend/scripts/vercel-build-decision.ts` and have no process-exit side effects.
`verify-deploy.ps1` calls the same conservative path classifier through
`scripts/frontend-deployment-needed.mjs`: Railway remains required; Vercel is
required for frontend/shared/unknown inputs, but not for positively classified
independent paths. Missing local commit/parent history or invalid output requires
Vercel. This classifies the current merge against its first parent; it is not
proof of a skipped build or a new READY deployment. Live smoke checks remain.

The full-history replay is an upper savings bound, not an expected production
reduction. The missing-base/no-origin production case may build every commit.
Preview uses a bounded fetch from the verified public URL; missing common history
still forces a build. Actual build starts,
skips, previous-SHA availability and Usage must be measured after owner release.
Frontend source-map verification follows the same requirement: independent merges do not require maps uploaded for a new SHA when no new frontend build is required. The unchanged GitHub deploy-verify workflow still has its narrower path-prefix check; shared/root-input verification there remains a documented follow-up, not a claim of complete workflow alignment.

The existing frontend-build CI job now typechecks the three build-selection TypeScript tools explicitly with Node types. The normal app typecheck only includes src/**, so its success alone is not tools-typecheck evidence.

Owner safe-variant go: 5 October 23:50, PR #6222. Every backend/lib/ path builds; backend/routes/ alone still skips. There is no individual-file exception.

## Originless preview policy (#6233)
Preview compares the complete PR tree from merge-base(main, HEAD) to HEAD,
over the whole repository, using needsFrontendBuild. A frontend input earlier
in a PR still forces a fresh preview after a later documentation-only commit.
The verified public repository URL is fetched directly with a bounded depth
and command timeout; no origin remote is added or remapped. Missing branch
metadata, missing common history, fetch/Git failure and same-commit manual
redeploy all build conservatively. Rename detection is disabled, preserving
both sides of moves. Production retains its last-successful-deployment base.
The former origin-based preview shell and unconditional Dependabot skip are
removed: a frontend dependency update requires its preview too.
No preview or production deployment is performed by Codex. After merge Claude
measures actual preview starts/skips over a comparable UTC window; unit-test
decisions are not observed production savings.
