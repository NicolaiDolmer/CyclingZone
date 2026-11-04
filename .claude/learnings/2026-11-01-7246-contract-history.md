# #7246: contract evidence must survive release

The release patch clears contract_end_season and contract_length. The existing
team-exit ownership trigger recorded names and teams, but discarded the contract.

Extend that trigger with a JSON snapshot from OLD in the same update, rather than
adding a second backend audit insert that can race or duplicate the event. Keep
the existing reason/actor and best-effort policy. Unknown contract fields remain
JSON null; historical events are not assigned invented contracts.

Verification: regression tests fail on the old trigger (meta is null), and execute
the new SQL twice in an isolated test database. A separate local PG17 baseline
confirms the original event loses contract data. No production migration applied.

Patch note and NOW are deferred to Claude's combined close-out by owner instruction.