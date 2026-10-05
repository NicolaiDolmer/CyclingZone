# Frontend production build selection

Refs #6202. Owner mandate: 5 October, prepare a PR that builds main only for
frontend changes or inputs it depends on. This replaces the former unconditional
main-build rule when the owner merges the PR. No dashboard setting changes or
production deployment are part of this work.

`frontend/vercel.json` calls `frontend/scripts/vercel-ignore-build.ts` only for
main. Existing Dependabot and preview behavior is retained. Vercel exit 0 means
skip; exit 1 means build. The Node version is the frontend's existing Node 24
requirement (the build already invokes a TypeScript script directly).

The comparison base is `VERCEL_GIT_PREVIOUS_SHA`, the last successful deployment
for this project and branch, not HEAD's parent. If the commit is absent from a
shallow checkout, the script tries one bounded fetch of that exact SHA. Missing
metadata, Git errors or a failed fetch build conservatively. Same-commit
redeploys build so environment/configuration changes can still be released.
Rename detection is disabled so a move out of frontend still rebuilds it.

All frontend files build, including public assets, locales, config and tests.
Root scripts, manifests/lockfiles, shared packages, toolchain settings and
unknown paths also build. Only known independent directories (backend,
database, docs, marketing, screenshots and agent/GitHub metadata) and named
root documentation files skip. Keep actual build dependencies out of this
exclusion set. The import-coverage test checks literal relative source imports;
dynamic filesystem reads and new build commands still need diff review.

Current build inputs were checked in frontend/package.json, vite.config.js,
vite-plugins, generate-indexnow-key.ts and prerender.mjs: source/public/template
reads stay inside frontend except the imported pure projection in backend/lib/raceParticipationHistory.ts, which is an explicit build input. Build changes that introduce outside inputs must
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
