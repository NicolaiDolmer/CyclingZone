# Frontend Env And Required i18n Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block server-only environment variable names from frontend env files and make all declared player-facing i18n/tone guards mandatory for pull requests.

**Architecture:** Add a small Node module that parses dotenv key names without exposing values, with a CLI used by local health checks and secret bootstrap. Remove the pull-request path filter from the existing i18n workflow so every required job always reports, then update main branch protection with the exact job contexts.

**Tech Stack:** Node.js 24, `node:test`, PowerShell, GitHub Actions, GitHub branch protection.

---

### Task 1: Frontend env key guard

**Files:**
- Create: `scripts/check-frontend-env-keys.mjs`
- Create: `scripts/check-frontend-env-keys.test.mjs`
- Modify: `package.json`

- [ ] Write tests for allowed Vite keys, blocked server-only keys, comments/blank lines, and value redaction.
- [ ] Run the test and confirm it fails because the module is missing.
- [ ] Implement key-only dotenv parsing and the CLI.
- [ ] Run the focused test and confirm it passes.

### Task 2: Local integration

**Files:**
- Modify: `scripts/agent-doctor.ps1`
- Modify: `scripts/seed-infisical.ps1`
- Modify: `scripts/codex-session-start.ps1`

- [ ] Add `frontend-env-keys` to agent-doctor without printing values.
- [ ] Refuse frontend secret seeding when server-only keys are present.
- [ ] Ensure session start surfaces the doctor failure.
- [ ] Run focused PowerShell and Node verification.

### Task 3: Required i18n checks

**Files:**
- Modify: `.github/workflows/i18n-check.yml`

- [ ] Remove the pull-request path filter so all jobs report on every PR.
- [ ] Keep push-to-main path filtering to avoid unnecessary post-merge runs.
- [ ] Validate workflow syntax and run the complete local i18n command.

### Task 4: Repository enforcement and close-out

**Files:**
- Modify: `docs/NOW.md`
- GitHub: issue `#1337`
- GitHub: main branch protection

- [ ] Add `namespace-inline`, `nav-strings`, `page-untranslated`, `lib-strings`, `leak-check`, and `tone-em-dash` as required contexts.
- [ ] Verify branch protection returns the complete expected context list.
- [ ] Record the completed owner-rest in `docs/NOW.md` and update/close `#1337`.
- [ ] Commit and push the focused change set.
