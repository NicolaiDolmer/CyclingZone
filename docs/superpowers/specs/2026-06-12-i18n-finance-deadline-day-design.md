# Finance and Deadline Day i18n Design

## Goal

Close #1352 and #1353 without rewriting production data: recognized legacy finance
transactions and Deadline Day warnings must render in the viewer's selected language.

## Finance Legacy Transactions

Add a small pure frontend resolver that converts known legacy transaction descriptions
and existing transaction types into `backendMessages` codes and parameters before
`FinancePage` considers raw prose.

Resolution order:

1. Use existing `metadata.code` and `metadata.params`.
2. Recognize known historical Danish descriptions and extract safe parameters such as
   season or race name.
3. Fall back to the localized `transactions.type.<type>` label.
4. Use raw legacy prose only for an unknown transaction type that cannot be classified.

Known sponsor, salary, prize, transfer, loan, interest, bonus, emergency-loan, and
admin-adjustment rows must therefore never show Danish prose in the English UI.
Fixture-driven unit tests cover representative historical forms and the unknown-row
fallback.

## Deadline Day

`DeadlineDayBanner` uses the existing `dashboard` namespace for its label and localized
countdown units. Hours render as `h` in English and `t` in Danish; the minute/second-only
clock remains numeric.

The backend warning builder emits:

- a notification type;
- stable `titleCode` and `messageCode`;
- locale-neutral params, including the ISO close timestamp;
- Danish fallback title/message for old clients and operational readability.

`NotificationsPage` already renders notification metadata through `backendMessages`, so
each recipient sees the warning in their current language. Date formatting happens in
the frontend locale rather than being frozen as `da-DK` by the cron.

The three thresholds, 24 hours, 2 hours, and 30 minutes, receive explicit EN and DA
translations and boundary tests. Existing notification deduplication and delivery
semantics remain unchanged.

## Final Whistle Tone Cleanup

Replace the em-dash constructions identified in #1353 in `deadlineDayReport.js` with
commas or colons. The Discord report remains Danish because the issue only requires
recipient-specific in-app warnings and banner localization.

## Player Documentation

Add one bilingual Patch Notes entry covering corrected English Finance history and
localized Deadline Day countdown/warnings. Help/FAQ changes are unnecessary because no
game mechanic or rule changes.

## Verification

- Focused frontend unit tests for the legacy finance resolver and countdown formatting.
- `backend/lib/deadlineDayReport.test.js` for structured warning metadata at all three
  thresholds.
- Frontend and backend test suites relevant to the touched files.
- `npm run check:i18n`, including the leak guard and tone guard.
- Frontend build and `git diff --check`.
