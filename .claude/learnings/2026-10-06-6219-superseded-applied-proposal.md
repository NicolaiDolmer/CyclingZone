# Applied proposals can be superseded before promotion

Refs #6219. The compensation proposal remained under proposals after its
ledger and replacement writer were registered in production. Reapplying the
old proposal would replace the current writer with the old implementation.
The object inventory alone did not distinguish those definitions.

Compare registered migrations and the current live function before moving an
applied proposal. If the current state already has canonical migrations,
remove the superseded proposal and test those migrations directly. Do not
create a second migration or rewrite production history to silence an audit.
Runtime observations and limits are in docs/audits/6219-applied-proposal-reconciliation.md.
