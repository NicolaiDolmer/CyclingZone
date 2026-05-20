// Lint-staged config for pre-commit hook.
//
// IMPORTANT: tasks MUST receive `files` and pass them explicitly to eslint.
// Earlier version `() => "npm run lint --prefix frontend"` returned a fixed
// command without file-args, which made lint-staged treat ALL files matching
// the glob (including untracked ones) as candidates for the index-update
// step — sweeping unrelated user work into the commit. Reproduced 2026-05-20
// in commit 471ceee (reverted in e0e0aeb).
//
// ESLint v10 (flat config) discovers eslint.config.js automatically by
// walking up from the file location, so we can invoke `npx eslint <files>`
// from the repo root without a --prefix.
//
// Trade-off vs. the old "full-directory lint" pattern: pre-commit only
// lints staged files, not the whole frontend/backend dir. Full lint runs
// on the CI side (warning-budget job in ci.yml), so we are not losing
// coverage — only shifting it from local pre-commit to CI.

// JSON.stringify handles double-quotes AND backslashes (CodeQL flagged the
// hand-rolled escaper for missing backslash-escape, which would be incorrect
// for filenames containing literal backslashes on Windows).
const escape = (f) => JSON.stringify(f);

export default {
  "frontend/**/*.{js,jsx}": (files) => `npx eslint ${files.map(escape).join(" ")}`,
  "backend/**/*.js": (files) => `npx eslint ${files.map(escape).join(" ")}`,
};
