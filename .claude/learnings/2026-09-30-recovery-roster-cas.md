# Compare the fields the operation consumes

The approved #5928 transaction stopped before writes because full-row roster CAS
included squad and dismissed-UI-suggestion metadata. The training engine selects
neither field. Read-only comparison showed that its actual inputs were unchanged.

Roster CAS now mirrors the engine's explicit select. Ownership, retirement,
identity and progression inputs still reject changes. Unused metadata is never
written. PostgreSQL tests prove its preservation through apply and rollback and
rejection of changed potential, ownership or retirement. Eleven tests passed;
independent review was clean. The immutable approved numeric proposal is unchanged.

Use freshness checks on consumed and mutated state; do not freeze unrelated UI
preferences. A stopped transaction is evidence of no completed data repair.
Patch notes are unnecessary for the operator-only guard correction.
