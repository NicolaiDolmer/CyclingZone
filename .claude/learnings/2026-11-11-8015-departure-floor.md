# #8015: zero means disabled, not a senior-count threshold

Owner approved all owned rider types for beta auto-price and unrestricted departure to zero on 11 November.
The auto-price functions still rejected academy riders. Separately, passing zero to the old senior-only floor arithmetic still rejected youth-only teams because the calculation subtracted the departing youth rider from zero seniors.

The forward migration transforms current pg_get_functiondef definitions without replacing unrelated beta/payment logic. Academy rejection is removed, and an explicit positive-floor condition preserves legacy caller compatibility while zero disables the branch. Matching accepts CRLF definitions. JS uses the same disabled semantics.

Regression evidence covers last-rider departure, expiry of an entire human roster, academy listing/start without early graduation, atomic graduation/payment at sale, retries, unchanged function privileges and migration idempotence. Native PG17 accepts a private read-only production-definition snapshot; no production writes are needed.

Do not repurpose the race minimum or remove informational risk calculations. Upper squad caps, ownership, cash reservations and active-race deferral remain separate contracts. Player copy is handed to Claude in the PR body under the owner's explicit handoff.

The full backend run found a VM route fixture missing the newly imported policy symbols and retaining the old release expectation. Route-extraction tests must inject the actual new imports, then assert the disabled floor and last-available-rider behavior under both flag states. No additional application change was required.
