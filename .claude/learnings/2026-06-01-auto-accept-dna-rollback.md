# Auto-accept-stien havde samme ikke-atomiske DNA-write som dna-choose (#878)

**Dato:** 2026-06-01
**Område:** `backend/lib/boardAutoAccept.js` · `autoAcceptPendingPlan()`
**Type:** Reliability-hardening (fundet ved backwards-check af #878/#889, ikke prod-incident). Refs #878.

## Symptom (latent)
`autoAcceptPendingPlan` skrev `team_dna_key`/`team_dna_chosen_at` til teams-rækken og kaldte
DEREFTER `regenerateBoardMembersForTeam`. Kastede regenereringen efter team-UPDATE var
committet, stod teamet dna-sat-men-boardless — præcis den lockout-fælde #889 fixede for
`POST /board/dna-choose`. Afbødet af recovery (`chooseDnaForTeam`) + `repairBoardMembersAfterDna`,
men skrivningen selv var ikke atomisk.

## Rod-årsag
Samme to-trins state-mutation uden atomicitet som #878. #889 fixede kun route-stien; cron-stien
(auto-accept) replikerede mønsteret uafhængigt.

## Fix
Wrap `regenerateBoardMembersForTeam` i try/catch; ved fejl rulles `team_dna_key`/
`team_dna_chosen_at` tilbage til null (best-effort) før fejlen re-throwes til cron'ens
per-team-catch. Samme mønster som `chooseDnaForTeam`s førstevalgs-gren. Backend-test verificerer
rollback via `makeFakeSupabase(state, { failInsertOn: "team_board_members" })`.

## Forward-guard
Backwards-check (`team_dna_key:`/`team_dna_chosen_at`-writes) bekræfter nu PRÆCIS to
write-then-regenerate-sites — begge atomiske. Når et fix lukker et mønster i én route, så grep
efter ALLE call-sites af samme afledte-state-skrivning; cron/baggrunds-stier kopierer ofte
route-logik uden at arve fixet. Cross-ref: `2026-06-01-non-atomic-write-then-derive-locks-state.md` (#889).
