# First participation must share the transaction envelope

Refs #2176. Owner approved scoped M3 option A on 10 November 2026.

A non-beta team can acquire its first protected obligation by bidding on an
existing public auto-accept auction. A scope read in JavaScript before another
purchase cannot establish that no obligation will exist when payment commits.

In M3 beta, serialize the market writers under the existing ordered team and
balance locks, then re-evaluate financial scope in the transaction. Keep the
restriction scoped even though the transport covers a currently unprotected
writer. Preserve the old pure affordability predicate for legacy callers.

Ownership or assignment creation followed by a separately rejected debit can
leave a free asset. Beta transfer, cash swap, release-with-fee and scouting must
commit the asset and canonical payment together. Skip the old payment only on
an explicit successful payment receipt. Audit failures must roll back both.

Verification uses actual migrations twice in PGlite and independent native PG17
connections. The former separate release/debit sequence is retained only as a
negative control: it reproduces the free-asset failure while the atomic path
preserves ownership on refusal. Synthetic evidence is not production evidence.

No flags are changed and no production migration is applied in this slice.

## Review follow-up, 11 November

A ledger type can represent both a new discretionary acquisition and settlement
of an existing obligation. Classify the canonical settlement reason separately;
otherwise a reservation can be counted twice against the post-payment balance.
Exercise both youth placements, scoped and public participants, and retain a
negative control for a new intake purchase. Use actual SQL and audit keys.

Viewer-dependent API projection also needs a direct Data API boundary. Revoke
legacy table and sensitive-column SELECT grants before allowing the established
public columns; preserve server-role reads. Test PUBLIC and explicit column
grants, column selection, wildcard selection and filtering as both client roles.

An explicit test clock is useful only when the entry point forwards it through
cooldown, ownership timestamps and notification helpers. Assert the actual RPC
timestamp and count any accidental wall-clock reads in the new swap regression.

Browser evidence must wait for the relevant lifecycle. Login's URL change can
precede dashboard effects, so a profile request counter must wait for the
dashboard's existing request before attaching. Explicit language selection
must follow profile/bootstrap synchronization. For fixed mobile navigation,
scroll the real control into view and retain normal hit-testing; never force
the click or widen the budget. Position screenshots on the expanded form and
state that camera choice in their evidence notes.

When replacing a trigger function, compare against later migrations as well as
its original definition. A proxy upsert executes BEFORE INSERT before reaching
ON CONFLICT's UPDATE path. The UPDATE-only lowered-ceiling shortcut therefore
does not preserve the release-only exception on its own. Read the standing
ceiling under the team advisory lock and retain that INSERT shortcut. Test the
real proxy RPC with an already overcommitted team, an equal-ceiling retry and
a rejected increase in both global and beta M3 scope.
