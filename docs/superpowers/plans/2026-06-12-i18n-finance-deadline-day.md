# Finance and Deadline Day i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure recognized legacy finance transactions and Deadline Day countdowns and warnings render in the viewer's selected language.

**Architecture:** Add two focused pure frontend helpers: one resolves legacy finance rows to translation metadata, and one formats the banner countdown through injected translations. Change the Deadline Day cron payload to persist `backendMessages` codes and locale-neutral params while retaining Danish fallback prose.

**Tech Stack:** React 18, i18next, Node.js test runner, JSON locale namespaces.

---

### Task 1: Resolve Legacy Finance Transactions

**Files:**
- Create: `frontend/src/lib/legacyFinanceMessage.js`
- Create: `frontend/src/lib/legacyFinanceMessage.test.js`
- Modify: `frontend/src/pages/FinancePage.jsx`
- Modify: `frontend/public/locales/en/backendMessages.json`
- Modify: `frontend/public/locales/da/backendMessages.json`

- [x] Write fixture tests proving known Danish sponsor, salary, prize, transfer, loan, interest, bonus, emergency-loan, and admin rows resolve to stable codes and params.
- [x] Run `node --test src/lib/legacyFinanceMessage.test.js` from `frontend/` and verify the missing-module failure.
- [x] Implement `resolveLegacyFinanceMessage(tx)` with metadata-first resolution, recognized description patterns, type fallback, and raw fallback only for unknown types.
- [x] Wire the resolver into `FinancePage` before `renderBackendMessage`.
- [x] Add matching EN/DA `backendMessages` keys and rerun the focused test.

### Task 2: Localize the Deadline Day Banner

**Files:**
- Create: `frontend/src/lib/deadlineDayCountdown.js`
- Create: `frontend/src/lib/deadlineDayCountdown.test.js`
- Modify: `frontend/src/components/DeadlineDayBanner.jsx`
- Modify: `frontend/public/locales/en/dashboard.json`
- Modify: `frontend/public/locales/da/dashboard.json`

- [x] Write tests for English `1h 05m 09s`, Danish `1t 05m 09s`, and minute-only `05:09`.
- [x] Run `node --test src/lib/deadlineDayCountdown.test.js` from `frontend/` and verify the missing-module failure.
- [x] Implement the pure formatter using an injected `t` function.
- [x] Use `useTranslation("dashboard")` in the banner and replace hardcoded label/countdown units with locale keys.
- [x] Add matching EN/DA keys and rerun the focused test.

### Task 3: Persist Structured Deadline Day Warning Metadata

**Files:**
- Modify: `backend/lib/deadlineDayReport.test.js`
- Modify: `backend/lib/deadlineDayReport.js`
- Modify: `frontend/public/locales/en/backendMessages.json`
- Modify: `frontend/public/locales/da/backendMessages.json`

- [x] Change tests to require `titleCode`, `messageCode`, and ISO `closesAt` params for 24h, 2h, and 30min payloads.
- [x] Run `node --test --import ./test-setup.js lib/deadlineDayReport.test.js` from `backend/` and verify the metadata assertions fail.
- [x] Implement stable warning codes/params and pass them as notification metadata while retaining Danish fallback title/message.
- [x] Add EN/DA warning translations and rerun the focused backend test.
- [x] Replace the issue-scoped em-dash constructions in `deadlineDayReport.js`.

### Task 4: Player-Facing Documentation and Verification

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx`

- [x] Add a bilingual patch-notes entry for #1352 and #1353; state that Help/FAQ is unchanged because mechanics are unchanged.
- [x] Run focused frontend and backend tests.
- [x] Run `npm run check:i18n` from the repo root.
- [x] Run `npm run build` from `frontend/`.
- [x] Run `git diff --check`.
- [x] Update `docs/NOW.md`, `docs/FEATURE_STATUS.md`, and issue status/comments for slice close-out.
- [x] Commit and push the complete implementation.
