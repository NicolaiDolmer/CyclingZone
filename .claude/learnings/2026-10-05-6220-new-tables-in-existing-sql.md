# New tables in an existing SQL file, 5 October

Refs #708 #6220. The first legacy-noise fix disabled every CREATE TABLE check
for modified files, allowing a genuinely new table to bypass its access/RLS
contract. Detect existing table names from the base, but audit new tables
against the complete current file, not just added statements.

Unchanged legacy exposures remain grandfathered. Unsupported unchanged names
must not block unrelated new-table checks. Dropping then recreating a legacy
table fails closed for explicit review: old privileges and policies cannot
satisfy the replacement's contract.

Evidence: initial new-table regressions failed before correction; fresh
read-only review reproduced the recreation and mixed-case legacy gaps.
Final 26 tests pass, including actual PGlite role checks and repeat template
apply. No live database write or production permission change.
