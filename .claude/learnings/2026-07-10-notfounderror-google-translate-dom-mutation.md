# NotFoundError insertBefore/removeChild — browser auto-translate mutates React's DOM

**Symptom:** Sentry cluster of 8 grouped issues (CYCLINGZONE-1D/1N/1P/1Q/1R/1S/1T/1V),
`NotFoundError: Failed to execute 'insertBefore'/'removeChild' on 'Node'`, minified
`react-dom.production`, `DOMException.code: 8`. Hit unrelated pages (`/login`,
`/riders/:id`) and unrelated browsers (Chrome Mobile Android, Chrome Windows) —
ruling out a single component/list-key bug.

**Root cause:** Browser-side translators (Google Translate and similar) mutate
text nodes directly in the live DOM. React's commit phase later tries to
insert/remove a node it still thinks is there and throws, because the
translator already replaced/detached it outside React's control. This is a
well-documented class of React bug, not an app logic bug.

**Fix (owner decision, option B on PR #2272):** NOT a global `translate="no"`
on `<html>` — players must still be able to browser-translate static content
into languages beyond EN/DA (international accessibility). Instead,
`translate="no"` is set on the root container of exactly the crash-evidenced
dynamic surfaces (Sentry event URLs): `LoginPage.jsx` (/login),
`DashboardPage.jsx` (/dashboard), `ProfilePage.jsx` (/profile),
`RiderStatsPage.jsx` (/riders/:id), `StandingsPage.jsx` (/standings), plus
`RaceDetailPage.jsx` (live-updating race result lists, same crash class).
This removes the mutation vector where React re-commits text nodes frequently,
while leaving static pages translatable.

**Already in place (no new work needed):** `SentryBoundary`
(`frontend/src/lib/sentry.jsx`, wired in `AppProviders.jsx`) already wraps the
whole app in a `Sentry.ErrorBoundary` with a branded fallback — the events in
question already show `handled: yes` / "During handling of the above
exception, another exception occurred: React ErrorBoundary ...", i.e. players
saw the branded error screen, not a white screen, even before this fix.

**Parked:** CYCLINGZONE-27 (`RangeError: Maximum call stack size exceeded`,
culprit `?(undefined)`) — only 2 occurrences, unsymbolicated stack
(`undefined:38:249`), no first-party frame to anchor a fix on. Revisit if more
events arrive with a usable stack.

Refs #2253
