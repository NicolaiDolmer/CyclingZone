# Terminal API errors need a bounded lane recovery

Refs #6227. A builder ended with API 529 after pushed WIP; manual follow-up was
needed and the ordinary review was skipped. The failure and a local waiting
window expiry must have different outcomes.

Resume once only after terminal API evidence, in the same worktree/branch.
Keep elapsed budget, measure existing WIP/PR before continuing, and pass the
result through normal independent review. A local timeout retains the same
writer; an ambiguous response timeout never authorizes another writer.

The tests execute the actual workflow source with fake agents and clocks:
single recovery, second failure, retained review/fix, same writer after timeout,
and the original window/probe charged against the cap. No live wave, agent,
staging measurement or production call was used for this verification.
