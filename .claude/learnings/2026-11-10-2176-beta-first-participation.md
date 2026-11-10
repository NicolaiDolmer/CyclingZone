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
