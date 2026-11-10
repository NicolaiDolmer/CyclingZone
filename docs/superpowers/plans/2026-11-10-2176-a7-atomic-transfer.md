# A7: atomic transfer payment

Owner mandate: [A7](https://github.com/NicolaiDolmer/CyclingZone/issues/2176#issuecomment-6771740734), reaffirmed by the direct 10 November request. Refs #2176.
SSOT: `docs/TRANSFER_MARKET_RULES.md` sections 5.1 and 8.1; existing finance/escrow contracts remain authoritative.

## Design and execution

The current claim commits ownership before JavaScript debits the buyer. A competing auction can reserve the still-visible balance. Extend the locked claim with a new service-only RPC that commits ownership and both finance legs together when the money gate is on. For a parked escrow sale, call the existing escrow RPC in that same transaction. Keep canonical audit payloads and idempotency keys. Off preserves the existing claim and payment sequence. Do not change swap behavior, flags, player copy or rollout.

This implements the owner's atomic-payment option. A separate unpaid-purchase reservation would add a second commitment lifecycle and recovery path; it is unnecessary here.

- [x] Reproduce the existing PG17 baseline before product changes; add failing SQL and caller regressions.
- [x] Add `auto_accept_claim_transfer_paid` in a new additive, idempotent migration; take the existing ordered team locks, recheck escrow/refund and price/ownership, then pay or hold escrow before commit. Any payment failure rolls ownership back.
- [x] Prepare the existing audit payloads before the claim. Pass them and the escrow restoration image to the RPC; skip later payment only on its explicit `payment_handled` result. Existing off paths and audit fields remain intact.
- [x] Verify both race orderings, immediate and parked transfers, escrow on/off, failed audit rollback, insufficient funds, duplicate/refunded deals and service-only permissions. Run native PG17 with independent connections and positively observe server stop; run required FULL tier and preflight under the shared semaphore.
- [ ] Update market SSOT and bug learning, obtain independent review, guarded commit and immediate push, create a separate PR with `Refs #2176`. No merge/apply/activation.

## Beta boundary

Beta work is stopped before implementation pending the owner decision on [rule 4](https://github.com/NicolaiDolmer/CyclingZone/issues/2176#issuecomment-6774810345). No beta changes belong in A7.

## Review focus

Payment errors must not leave a free rider or an unbacked reservation. A parked sale must not credit its seller early. Refunded escrow cannot be revived. No post-claim JavaScript payment may run after an atomic payment. Canonical finance keys and existing contract/graduation restoration must survive.

Evidence so far: initial PG17 baseline 800 attempts; A7 native negative control reproduced the gap; fixed 3 modes x 2 deterministic orderings and 240 concurrent attempts, no overbooking/deadlocks; PG17 stopped (pg_ctl status). Targeted 155/155, SQL 5/5. Independent review found one rollback-test gap, corrected with a trigger that proves debit/ownership before the forced audit failure. FULL first stopped on an unchanged wave-policy timing test; retry passed that group (173 pass, 1 skip). Backend isolated economy tests: 145 pass. Both remaining backend batches completed: 17,790 pass, 2 environment-dependent email failures, 14 skips and 12 existing TODO tests (plus the 145 isolated economy passes). The email file passes 13/13 after removing EMAIL_UNSUB_SECRET from the child test environment. The original FULL invocation is not reported green. Frontend: 5,522 pass, build exit 0. Preflight green, compiler budgets unchanged.
