# Ability-led rider value with market input

Status: Codex session closed at owner request; Claude Code review required before continuing. Owner directions confirmed; calculation and numeric calibration still proposed. **Not approved to build, merge or activate.** See [handoff](../../sessions/2026-09-22-codex-5443-claude-handoff.md).

Sources of truth: [ECONOMY_RULES.md](../../ECONOMY_RULES.md), [RACE_ENGINE_RULES.md](../../RACE_ENGINE_RULES.md), [PROGRESSION_RULES.md](../../PROGRESSION_RULES.md), [TRAINING_RULES.md](../../TRAINING_RULES.md), [CALENDAR_RULES.md](../../CALENDAR_RULES.md), and [TRANSFER_MARKET_RULES.md](../../TRANSFER_MARKET_RULES.md). Owner discussion: #5443 and #5435. This proposal does not silently replace their live contracts.

## Owner-confirmed directions, 22 September

- Type does not set price. Equal abilities, age and other approved relevant inputs must give equal foundation regardless of `primary_type`, `valuation_type` or `best_role`.
- Market evidence participates from the first activation and becomes more important over time. No starting/final weight, timetable or evidence threshold for this replacement calculation is approved; historical model decisions are not erased.
- **Choice A:** include own results and contribution as a helper under equal conditions, without counting the same team result twice.
- **Choice A:** evaluate a common representative season programme, using riders where their abilities contribute best. Do not count only their best profiles or use their actual club, division or selection.
- **Choice A:** the programme follows the planned in-game race supply and stays fixed during the season. Use the new v4 race engine where supported. Disclose gaps instead of silently substituting v3 evidence.
- **Choice A:** a common market level plus local differences. Qualified market observations inform the common level; close comparisons influence individual riders more where evidence supports them. Thinly traded riders must still receive actual market influence through the common component.
- **Choice A:** no separate fixed elite floor in the new calculation. Exceptional sporting ability may still produce a high value, but no elite minimum is guaranteed. This does not approve a particular premium, coefficient or before/after price.
- **Choice A, clarified as future abilities:** use a separate, common type-free career forecast inside valuation. It estimates future abilities for pricing only; it does not change actual training or rider development. Preserve potential pending the later training-score transition.
- Training score must eventually replace potential in the valuation model. Timing, history requirements and replacement calculation are not approved. The existing potential-rate decision remains in force until that transition.
- Displayed rating remains best role now; badge remains natural identity. Coordinate the eventual value and display switch. Equal displayed ratings do not imply identical ability profiles or prices.
- Cash and aggregate rider valuations are different quantities and are reported separately. Neither current aggregate valuation nor the historical total is an approved calibration target.
- No production writes, model/visibility flips, rating-golden changes or merge. A direction choice is not approval of all technical or economic assumptions. Production implementation waits for explicit **godkendt til build**; merge separately requires **merge**.

## Verified current dependencies

`riderValuation.js` selects ability weights and a separate price term using type. `riderCareerNpv.js` also uses type when building projected ability caps and signature-dependent development/decline. Removing the direct price term is insufficient.

Precision correction: `peakAgeForType` accepts a type, but the current `PROGRESSION_CONFIG.peakAgeByType` is null, so actual peak age is already shared. Do not describe a type-dependent current peak age as a measured fact.

`marketValueModel.js` uses both a type price term and same-type evidence matching. Both must change. Its existing zero-support behavior would prevent the owner's common-market effect for thinly traded riders.

The old best-role refit is diagnostic history, not the selected solution. Its v3/S3 simulation and partial population coverage cannot certify a v4-based, population-wide replacement.

## Proposed calculation boundaries

### Performance and career foundation

Measure abilities through the actual v4 engine on a pinned common programme and fixed reference contexts. Use synthetic identities, equal effort/condition and identical opportunities. The reference programme must avoid overweighting repeated divisional copies, respect overlapping race days and stage-race commitments, and cover both specialists and versatility.

Evaluate own-result and helper assignments separately before aggregation. A helper's contribution is a paired change in team outcome, not the finishing-position gap between helper and captain. Count the team outcome once; do not add another premium for a benefit already included. Multiple reference team strengths, leader profiles and explicit team orders are needed because protection can saturate and helpers can lose contact.

Use continuous abilities rather than rounded displayed rating or a winning role label. Check how small improvements affect output, including near role ties. A local point perturbation is a sensitivity check, not a proven training strategy.

Career projection must also be type-free. Preserve the agreed potential growth-rate treatment until the training-score replacement is separately specified. A new treatment of projected headroom and decline is still required; reusing type-derived caps or merely relabelling them would violate the direction. Do not change live training, caps or progression as an incidental part of valuation design.

Reference-team calibration, programme mix, expected development paths and conversion of sporting contribution to money remain unresolved. No population-total target or monetary scale is inferred. Existing salary/CPV selection remains a separate contract, not an automatic consequence of changing prices.

### Market component

Use verified payments, auction outcomes and competing bids with inputs known at the observation time. Similarity is based on abilities, performance and age, never an exact type label.

The proposed common-market level must account for the changing mix of riders sold: a week with many cheap young riders must not automatically imply a price fall for every rider. Local demand should vary smoothly, and sparse local evidence should pull its estimate toward the common relationship rather than turn all market influence off.

Distinguish competitive human willingness to pay from mechanical bank prices and sale constraints. Repeated counterparties, automatic bid increments and seller-linked bidding are not independent observations. Bank-origin auctions with genuine competition still need their asking-price constraint recorded; a competitive outcome alone does not prove absence of anchoring or manipulation.

Unsuccessful auctions are uncertain negative evidence conditional on exposure and asking price, not universal hard upper bounds. Losing bids are actual observed bids, not exact private maximum willingness to pay. Do not count a sale and its losing bids as independent completed transactions.

Price movement must be checked for discontinuities and counterintuitive ability responses as well as predictive error. The diagnostic model with the smallest typical error is not automatically the production choice.

Report actual common and local influence separately, including what changes when market observations change while rider abilities stay fixed. Local evidence weights are not the same as the final market share of valuation. Compare proposed starting influence and paths to greater influence only after the foundation and market component can be evaluated together. No percentages are selected here.

### Potential-to-training-score transition

The destination is confirmed: training score replaces potential. The design must specify a comparable history input, minimum usable evidence, sparse-history/cold-start handling and a way to separate growth capacity from training opportunity. Account for age, race days and training conditions instead of treating an unadjusted recent gain as innate potential. Do not silently move the date or remove potential before this replacement is validated.

## Evidence completed in this session

### Payment and history audit

A read-only production query and subsequent private export reconciled participant-qualified auctions with buyer payments and direct transfers with matching buyer/seller payments. The direct-transfer legacy analysis uses initial `offer_amount`; execution can use a counteroffer. Actual mismatches were measured. Offer `updated_at` can also differ materially from payment time. The new analysis uses payment amount, timestamp and season. No production transaction behavior was changed.

Historical ability evidence exists but coverage is uneven. Admit only snapshots dated before the transaction day and created no later than payment; do not silently substitute current abilities. Date-only history leaves same-day observations ambiguous. Report stale snapshots and cross-season cases separately. Current participant flags and birthdates are still current-state inputs, not a reconstructed historical eligibility record.

The owner explicitly approved the private export to the existing task's `balance-internals` directory. It rejects non-GET requests, uses stable keyset pagination and chunked ID filters, omits names/messages/credentials, and refuses to overwrite the frozen raw artifact. Counts, values, private IDs and hashes are in the private reports.

### Type-free market comparisons

Two market-only diagnostics were compared with a common training-price median: a regularized ability/age relationship and nearest comparable transactions. Hyperparameters were selected on an earlier inner time split, with later observations excluded from fitting. Both improved prediction against that weak reference. This is not proof of improvement over the old production valuation on the same transactions.

The neighbour method has abrupt changes when the comparable set changes. The regularized method is continuous but includes negative ability responses. Neither is approved as the final calculation.

After owner choice A, a smooth common-relationship/local-residual diagnostic was evaluated on multiple forward time splits. It avoids the neighbour-boundary jumps in the measured perturbations, but errors remain material and downward ability responses remain. It does not yet satisfy a complete price-quality contract. Forward validation is exploratory; the latest period had already been observed in the preceding comparison and is not a fresh final holdout.

A further smooth, nonnegative-coefficient ability-response diagnostic was evaluated on the same forward splits. It eliminated decreasing responses in the measured perturbations without a material deterioration in overall predictive error relative to the earlier regularized relationship. The constrained feature construction is monotone in abilities at fixed age. This is a market-only feasibility result, not the complete common-level/local-evidence calculation, a monetary calibration or a fresh untouched holdout. Private recipe/readout: `analyzeMonotoneMarket.mjs` and `ability-market-monotone.json`.
These market-only comparisons do not remove potential from the career foundation, implement training-score replacement, or establish activation weights. The local correction share reported by the smooth diagnostic is not the eventual combined model's market influence.

### Actual v4 pilot

A narrow feasibility probe was followed by an expanded pilot with synthetic identities, different fixed reference-team strengths, multiple seeds, a realistic field size and paired helper/free-role assignments. Both call `simulateStageV4` directly. Relabelling natural/valuation/best role and overriding actual club identity produced identical output in the checked cases.

Own-result changes are measurable. Stronger helpers do not consistently improve captain finishing rank in these setups. This is not evidence that helpers have no value: protection can saturate, position is an incomplete measure, and explicit leadout orders are not yet included. The pilot uses pinned proxy routes, not a finished S4 reference programme, and omits accumulated stage-race fatigue/GC and career development. Report unfinished outcomes separately when extending it. Do not map these rank deltas directly into currency.

## Career and training-score dependency audit

The existing pure career functions were exercised with identical current abilities, age and potential, varying only type. Projected abilities diverged for young riders and in later decline. Peak age itself stayed identical, as expected from the shared configuration. The private diagnostic is `probeCareerTypeDependence.mjs` / `ability-career-type-dependence.json`. This is a forecast-code diagnostic, not a completed training strategy or a proposed new development curve.

The type-free price direction cannot be achieved by reusing this forecast unchanged. There is also a real modelling distinction: equal-input valuation under common future opportunities is not an exact reproduction of the existing type-dependent training rules. The proposed valuation forecast must say which it represents.

`trainingScore.js:trainingScoreFactors` includes type-based focus match as well as potential, age, condition, coach, facility, intensity and noise. An otherwise identical synthetic session changes score when only type changes. Replacing potential with a raw score mean would import type and training environment into value through a different input.

The score-writing path stores score/session and a short contribution summary, not the full factor vector; the inspected daily report does not restore all missing factors. The live score schema was checked read-only because the checked-in schema snapshot does not yet include that table. Coverage was measured as of the same frozen evidence cutoff: history is short and incomplete, especially for unattached riders. No sufficiency threshold is approved; a week in the coverage report is descriptive only. Do not silently create a collection migration or alter visible scoring in this task.

Private coverage readout: `ability-training-score-coverage.json`. The later replacement needs a comparable measure of growth capacity under common conditions, with explicit historical reconstruction limits and cold-start handling. Preserve potential until that replacement is actually validated.

### Confirmed modelling choice

The owner chose A after explicitly clarifying that the forecast concerns future abilities used to calculate value today. Use a separate type-free standard career forecast for valuation, retaining the approved potential-rate treatment and equal future opportunities. It is an explicit approximation relative to the current type-dependent training system. Actual training and ability development remain outside this task. The choice does not approve specific forecast rates, allocation assumptions or production implementation.
## Common opportunity budget and reference programme

The forecast must account for one activity per race day, stage-race commitment, recovery and training opportunity costs under the common season axis. Do not grant every ability a full season's focused training simultaneously. Preserve any legitimately modelled background development, but distinguish it from focused training. Actual manager selection, club facilities and division must not choose a different valuation forecast for otherwise identical approved inputs.

Reference programme evidence is now available from a GET-only dry run of the actual planner with the same quota derivation as `buildSeasonCalendar.js`: race dates multiplied by the configured tier density. The initial direct-library draft used an older default quota for one tier and is explicitly superseded; it must not be used as the S4 baseline. The corrected capture is `ability-reference-programme-cli-parity.json`, produced by `captureReferenceProgrammeCliParity.mjs`. It inserted no races, preserves the common race-day axis, and includes planned route profiles and schedules. Pool copies are deduplicated. This is planning output, not a production S4 calendar, a completed calendar-quality audit or owner approval of final valuation programme weights.

An expanded v4 probe now samples each profile present in that planning output, includes explicit leadout for sprint finales, and uses multiple fixed reference-team strengths and seeds. Its initial rank-based readout is `ability-v4-planned-programme-pilot.json` / `ability-v4-helper-pairs.json`. Relative places are not monetary contributions. Individual time-trial helper/free-role contrasts are not a valid helper-value interpretation and must be excluded; the follow-up normalizes all individual time-trial roles to solo/free-role use.

The team-points follow-up uses the existing `race_points` scale for each sampled race class, gives unfinished riders no placing points, and counts every reference teammate once. It includes stronger reference leaders as well as the earlier ordinary-strength contexts. This remains stage/single-race evidence, not a full accumulated GC/jersey or career valuation. Official point tables are privately captured in `ability-reference-point-scales.json`; analysis recipe is `probeV4TeamPointContribution.mjs`.

### Monetary-anchor question withdrawn after plan reconciliation

The agent's new A/B card about making the currency scale fully market-led from first activation was unnecessary and has been withdrawn. The owner did not answer or approve it. The existing decision is explicit in [#3448, owner decision 30 August](https://github.com/NicolaiDolmer/CyclingZone/issues/3448#issuecomment-5470259695), [#4449](https://github.com/NicolaiDolmer/CyclingZone/issues/4449), and ECONOMY_RULES section 9.2: simulation anchors the currency level initially; market evidence shapes relative pricing and its authority grows through measured, owner-approved steps.

The approved 22 September requirement moves market participation into the first combined activation. It does not, by itself, authorize handing the full currency level to the market immediately. Likewise, the choice of a common market estimate plus local differences is not blanket authorization to remove the existing level anchor. Preserve those directions within the inherited boundary; if the final mathematics exposes a real incompatibility, show the exact conflict and measured consequences rather than asking the owner to redesign the system from scratch.

The anchor is not an instruction to preserve an old aggregate total. The current request explicitly rejects treating either a historical total or today's total as an approved calibration target. The new type-free foundation must be recalibrated and shown to the owner. Historical activation weights belong to their old model; do not silently activate them on this replacement or claim they were never previously decided.

## Reconciled plan: inheritance versus the authorised delta

This proposal is an amendment to the existing value plan, not a new independent master plan. Read the dated decision chain as a whole: the 14 August foundation was revised on 15 August, developed further on 17 August, and the market rollout was explicitly settled again on 30 August. Later salary and activation decisions override their older versions. The old #5443 issue body contains historical statements that newer comments and ECONOMY_RULES have superseded.

| Area | Existing source/contract | Change authorised in this task |
|---|---|---|
| Currency level versus relative demand | ECONOMY_RULES 9.2; #3448 decision 30 August; #4449 | Keep the initial simulation anchor. Replace the type-based foundation with ability/performance valuation; include market from the first combined activation. No historical aggregate total becomes a target. |
| Evidence strength and participant qualification | [15 August decision 3](../../audits/2026-08-15-oekonomi-beslutninger-1-3.md); #3750; #4449 | Replace type-based comparability. Preserve the existing qualification/manipulation requirements unless explicitly amended; evaluate common and local evidence effects. |
| Market rollout | #4449: measured steps and owner approval | The old formula-first/market-later task ordering is superseded. New weights require new-model measurements and owner choice, not a fresh debate over whether the market belongs. |
| Update cadence and pipeline | ECONOMY_RULES 9.1; #4419 | Keep Sunday pipeline ordering and persistent deduplication. No daily value loop. |
| Extraordinary transition | [5443 runbook](../../runbooks/5443-ekstraordinaer-vaerdikoersel.md); owner decisions 20 September on #5443 | Keep the owner-selected one-time transition without a loss staircase/compensation, before/after review, communication, backup, rollback and explicit execution authorization. Distinguish that event from the ongoing weekly movement guard. Recheck script compatibility with the new model rather than reinventing the release machinery. |
| Salary | ECONOMY_RULES 2; owner decision 20 September on #5443 | Salary/CPV remains separate. Do not revive the superseded market-value salary proposal from the August documents. |
| Career and growth capacity | ECONOMY_RULES 1.1; PROGRESSION_RULES; TRAINING_RULES | Owner approved a type-free valuation-only forecast. Preserve potential-rate treatment until the validated training-score replacement. Actual training remains unchanged. |
| Elite treatment | Existing premium/floor code; this session's explicit owner choice | Remove the separate fixed elite floor in the new model. No numerical replacement premium is approved. |
| Display and delivery | #5435 and the newer #5443 coordination decision | Best role on the card, natural-role badge; coordinated value/display switch. No UI implementation in this session. |
| Required evidence | #5443 and the current task brief | Keep whole-population/rider/team before-after, large losses/gains, effective market influence, non-circular later-transaction validation and realistic abuse probes. No ready PR/build claim from isolated diagnostics. |

### Audit of this session's own evidence

- The payment reconciliation, historical-ability export, continuity probes and type-invariance checks are useful diagnostics. They do not complete the inherited qualification or release gates.
- In particular, the private market comparison has not applied the full inherited repeat-counterparty and price-outlier policy. Its payment-reconciled, participant-screened sample must not be called fully qualified independent market evidence. The aggregate errors are exploratory, not an activation scorecard. Historical-data limitations in applying existing filters must be documented rather than silently omitting them.
- `captureReferenceProgrammeCliParity.mjs` matches the CLI quota derivation but sets `useUniformTierTilt: true`. The latest [22 September handoff](../../drafts/codex-session-2026-09-22-v3.md), calendar item 7, calls for a dry run without uniform tilt and keeps shared variants owner-gated. The captured routes remain experimental inputs, not the approved S4 programme or final calibration baseline. Reconcile that source before another programme-level calibration; do not silently change the calendar task's decisions.
- Existing read-only helper runs completed before this audit. They remain diagnostic, including the support-saturation and team-point comparisons. No additional model-selection run is required to answer the owner's process concern.
- Before any further design card, identify its exact unresolved dependency in this matrix. If a source already decides it, apply the decision; if sources conflict, state their dates and supersession evidence first. The next deliverable is the integrated amended design and remaining concrete calculations, not another series of foundational A/B questions.

## Verification plan before build approval

1. **Input/equality:** identical approved inputs remain identical across type labels, actual club/division, IDs, selection history and best-role ties. Missing data gets an explicit diagnostic status, not an invented zero ability.
2. **Performance:** fixed v4 version, programme, reference contexts and seeds; specialists, versatile riders, helpers and age groups covered. Compare own results, team outcomes, helper contact/availability, leadout and repeated-stage fatigue. Separate unfinished outcomes and sampling uncertainty.
3. **Career:** type-free forecasts, current potential decision preserved, bounded plausible development/decline, no discontinuity from role switches. Training-strategy abuse checks include elapsed race days, opportunity costs and the applicable development rules.
4. **Market:** reconciled executed prices/times, point-in-time features, temporal validation, held-out/new riders, distinct counterparties and coverage by continuous ability/age neighbourhood. Include thin-market uncertainty, unsold exposure limitations, manipulation probes and sensitivity to concentrated buyers.
5. **Combined calculation:** separate common/local market influence, bidirectional price changes, continuity and ability-response checks, before/after rider/team distribution, largest losses/gains, and cash reported separately. No aggregate total is a target without owner approval.
6. **Quality contract:** numeric predictive-error, continuity, calibration and evidence-coverage targets must be proposed with measurements and explicitly approved. Existing regression floors are listed separately and are never called quality approval.
7. **Implementation verification, later:** backend/shared calculation changes require the repo's full verification tier and preflight. Coordinated user-facing display work later requires the specified desktop/mobile evidence and relevant e2e coverage. No preview/UI work is started in this design session.

## Private artifact index and reproduction

All paths below are under `balance-internals/2026-09-22-best-role-refit/`; they are private, gitignored measurement artifacts.

| Artifact | Purpose |
|---|---|
| `exportAbilityMarketEvidence.mjs`, `ability-market-raw.json` | GET-only extraction recipe and frozen raw evidence; observation window in source/metadata |
| `analyzeAbilityMarketEvidence.mjs`, `ability-market-analysis.json`, `ability-market-observations.json` | Reconciled observations, time splits, coverage/errors, raw-export SHA-256 |
| `probeAbilityMarketSensitivity.mjs`, `ability-market-local-sensitivity.json` | Local ability perturbations, not a training strategy |
| `analyzeSmoothMarket.mjs`, `ability-market-smooth.json` | Smooth common/local diagnostic across forward time splits |
| `probeV4AbilityContribution.mjs`, `ability-v4-pilot.json` | Narrow engine feasibility probe |
| `probeV4AbilityContributionExpanded.mjs`, `ability-v4-expanded-pilot.json` | Reference-team/seed expansion, engine input hash and limitations |
| `ability-market-history-coverage.json` | Initial SQL coverage readout, before correcting offer timestamps to payment times |

Run local analysis scripts through `scripts/verify-lock.ps1 -Max 2`. The raw exporter and reference-capture scripts need credentials/network; analytical scripts read the frozen local artifacts. Exact raw snapshots are not a substitute for public decision state: confirmed directions, methods, limitations and next steps are recorded here and on #5443/#5435. Never upload the private artifacts to the public repository.

## Confirmed economic choice: no fixed elite floor

Both current valuation model files configure an elite premium and an explicit elite floor (`riderCareerNpv.js:applyElitePremium`). Some active riders in the private population snapshot are above that floor's ability threshold, while none of the payment-reconciled observations with historical abilities reach it. This establishes an evidence gap; it does not establish how many current prices are actually raised by the floor, or justify extrapolating ordinary-rider sale prices to elite riders.

The owner chose A: remove the separate fixed elite floor in the new calculation. Exceptional value must come from the approved ability/performance and market calculation, not a guaranteed elite minimum. Existing production behavior is unchanged until an approved implementation and activation. No elite amount or proposed before/after price is approved.

## Remaining design work and release boundary

- Evaluate a smooth market relationship with sensible ability-response constraints and additional validation, without tuning repeatedly against a claimed untouched holdout.
- Complete helper measurement against the correctly sourced common programme and specify the type-free career projection within the inherited simulation-based currency anchor.
- Compare the combined calculation's initial and increasing market influence, then present a concrete economic choice backed by effective influence and uncertainty. No weights, value totals or quality thresholds are approved yet.
- Specify the later training-score transition and collect a single reviewable calculation/test plan before requesting **godkendt til build**.

No replacement PR is ready. #5444 stays open. Existing NOW changes on this WIP branch must be separated into a `docs(now)` sidecar before a code PR. Patch notes and feature registry are unchanged because this checkpoint changes no player behavior, model, flag or feature status. Full backend verification was not rerun for this documentation-only checkpoint; the earlier unrelated #5488 failure is not fixed here. Token hygiene still reports the pre-existing FEATURE_STATUS budget failure.

Private preservation at close-out: the complete task evidence directory, including the exploratory scripts and original owner request, was copied to the existing OneDrive context private-handoff directory. Every artifact and the manifest were hash-checked after copying. The local OneDrive copy is verified; remote synchronization is not. Claude should start with the private CLAUDE_REVIEW_README.md, which labels invalid/superseded inputs and lists the unfinished checks. No new calculation is authorized merely by this handoff.
