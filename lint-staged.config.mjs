// Lint-staged config for pre-commit hook.
// Uses project-level npm scripts to keep ESLint config resolution simple in a monorepo.
// Runs full-directory lint for whichever side has staged changes (mirrors pre-push behaviour).
export default {
  "frontend/**/*.{js,jsx}": () => "npm run lint --prefix frontend",
  "backend/**/*.js": () => "npm run lint --prefix backend",
};
