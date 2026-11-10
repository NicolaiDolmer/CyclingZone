# #7737: provisional condition cannot be treated as an opening

PR1 introduced a durable instant stamp and provisional form/fatigue writes.
Existing stage/live readers assumed rider_condition was always the prior
evening's opening and added date loads to it. A synthetic cross-consumer test
failed against the exact PR1 base before implementation.

Reconstruct stamped dates from the frozen opening, receipts and canonical ledger
through the existing settlement helper. Read settled condition once; preserve
injury fields and honor durable stamps after OFF. Evidence failures must throw.
Legacy frozen fixtures are retained without regenerating expected digests; their
generic database fake now models absence of the newer stamp table explicitly.

No production reads/writes, migration edits, activation, UI or player text.
Targeted evidence and remaining parent verification belong in the handoff.


## Independent review recovery
- A durable stamp is written before the free-slot loop, so readers must support a press interrupted between real engine commits.
- Resume missing free slots automatically before stage entrant/ability reads; keep GET read-only and never manufacture a second freeze.
- A current-team date-work lookup is not authoritative after transfer: carry the lock-owning team's frozen opening into the full forecast loader.
- OFF exceptions are per stamped rider, not per nonempty roster map.
- Regressions first failed on incomplete receipts, transferred forecast and mixed OFF fields; targeted evidence is recorded in the parent handoff.
