# i18n Guardrail Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing i18n and tone guards easier to run locally, remove stale guard metadata, and add regression coverage for the em-dash policy.

**Architecture:** Keep every existing guard as an independent CLI. Extract pure scanning functions from the em-dash CLI so Node's built-in test runner can exercise representative locale and JSX source fixtures without touching production files. Add one root npm script that runs the same seven checks as CI in sequence.

**Tech Stack:** Node.js 24, ES modules, `node:test`, npm scripts.

---

### Task 1: Add em-dash guard regression tests

**Files:**

- Create: `scripts/tone-check-em-dash.test.mjs`
- Modify: `scripts/tone-check-em-dash.mjs`

- [x] Write tests that require exported locale-value and prose-source scanners.
- [x] Run `node --test scripts/tone-check-em-dash.test.mjs` and confirm it fails because the exports do not exist.
- [x] Extract the minimal pure scanners while preserving CLI output and exit behavior.
- [x] Run `node --test scripts/tone-check-em-dash.test.mjs` and confirm all tests pass.

### Task 2: Add one local i18n command

**Files:**

- Modify: `package.json`

- [x] Add `check:i18n` with the same seven guard commands used by `.github/workflows/i18n-check.yml`.
- [x] Run `npm run check:i18n` and confirm the complete guard suite passes.

### Task 3: Remove stale guard metadata

**Files:**

- Modify: `scripts/i18n-check-lib-strings.mjs`

- [x] Remove the obsolete `RiderDevelopmentTab.jsx` entry from `KNOWN_TODO`.
- [x] Run `node scripts/i18n-check-lib-strings.mjs` and confirm no unknown leaks are reported.

### Task 4: Verify and publish

**Files:**

- No additional production files.

- [x] Run the focused tests, full i18n suite, formatting check on changed files, and relevant package tests.
- [x] Review `git diff` and confirm the existing untracked roadmap image is excluded.
- [x] Commit the scoped changes and push the branch.
