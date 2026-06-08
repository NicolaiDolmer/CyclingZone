# Living World Backlog Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved Living World Product Doctrine into a durable GitHub hierarchy, prioritized evidence loop, and aligned planning documentation without creating a competing roadmap.

**Architecture:** The doctrine remains the product compass, while GitHub issues remain the execution source of truth. One new product-direction epic will connect existing implementation epics, missing cross-cutting work will be added as narrowly scoped issues, and contradictory backlog items will be reframed or deprioritized rather than duplicated.

**Tech Stack:** GitHub Issues and milestones via `gh`, Markdown planning documents, repository Git workflow, PowerShell verification scripts.

---

## Scope Boundary

This plan changes planning state only. It does not implement gameplay systems.

Each major gameplay system still requires its own approved design and implementation plan before code changes:

- Today / manager inbox;
- race calendar and assistant planning;
- active training;
- academy and youth development;
- organizer invitations and divisions;
- living-world feed and social relationships;
- world history and club museum.

## Target Structure

Create one new product-direction epic:

`[Product] Living World & Club Dynasty — product doctrine and evidence roadmap`

The epic links these existing execution owners:

- launch independence: #1105;
- race engine: #1102 and #1021;
- race results and stories: #959;
- progression and lifecycle: #1136;
- active training: #931;
- academy: #932;
- Junior and U23 racing: #958;
- transfers and auctions: existing market issues, including #58 and #26;
- Today surface: #62, #977, and #976;
- player behavior instrumentation: #135 and #306;
- popularity and social attention: #957;
- world history: #1106 and a reframed #1139;
- board simplification evidence: #1141;
- monetization fairness: #1142.

The epic is not placed in the TdF Launch milestone. It uses `priority:high`, `type:docs` or `type:feature` according to repository convention, and `cat:founder`. It explicitly states that milestone commitments remain owned by child epics.

### Task 1: Create the Living World product-direction epic

**Files:**
- Reference: `docs/superpowers/specs/2026-06-08-living-world-product-doctrine-design.md`
- No repository file modifications
- GitHub: create one issue

- [ ] **Step 1: Prepare the exact issue body**

Use this body:

```markdown
## Product direction

CyclingZone is a persistent multiplayer cycling dynasty game. The player builds a club and follows riders across accelerated generations while a shared world continues around them.

Approved doctrine: [`docs/superpowers/specs/2026-06-08-living-world-product-doctrine-design.md`](https://github.com/NicolaiDolmer/CyclingZone/blob/main/docs/superpowers/specs/2026-06-08-living-world-product-doctrine-design.md)

## Success behavior

- Managers return several times per week without daily compulsion.
- Managers talk about races, riders, transfers, rivalries, and the world.
- Managers plan future races, seasons, rider careers, and club development.
- Managers use and enjoy races, training, youth development, and transfers/auctions.
- Feature suggestions come from meaningful use, not merely imagined scope.

## Four product engines

1. Races create credible, discussable stories.
2. Training creates visible long-term choices.
3. Youth development creates attachment and generational renewal.
4. Transfers and auctions connect managers through a shared market.

## Existing execution owners

- [ ] #1105 — independent Season 1 relaunch
- [ ] #1102 / #1021 — launch and full race engine
- [ ] #959 — race result depth and race stories
- [ ] #1136 — progression and lifecycle
- [ ] #931 — active training
- [ ] #932 — academy and youth intake
- [ ] #958 — Junior and U23 racing, after simple youth development proves valuable
- [ ] #62 / #977 / #976 — unified Today / manager inbox direction
- [ ] #135 / #306 — player behavior instrumentation
- [ ] #957 — rider popularity and social attention
- [ ] #1106 / #1139 — persistent world history and recognition
- [ ] #1141 — board simplification evidence
- [ ] #1142 — fair-premium boundary

## Governance

This issue owns product alignment, not implementation. Existing epics own delivery.

Every linked major issue should state:

1. Which product engine it strengthens.
2. Which player behavior should change.
3. What evidence justifies expansion.
4. What evidence causes simplification or removal.

Review after meaningful playtests and every 30-day game season. Do not add depth before the simpler loop demonstrates use and enjoyment.
```

- [ ] **Step 2: Create the epic**

Run:

```powershell
gh issue create `
  --title "[Product] Living World & Club Dynasty — product doctrine and evidence roadmap" `
  --body-file $bodyFile `
  --label "claude:todo,priority:high,type:docs,cat:founder"
```

Expected: one new issue URL. Record its number as `$livingWorldEpic`.

- [ ] **Step 3: Verify the epic**

Run:

```powershell
gh issue view $livingWorldEpic --json number,title,body,labels,milestone,url
```

Expected: no milestone, all four labels, doctrine link, and all listed issue references.

### Task 2: Resolve the premium-academy decision

**Files:**
- Reference: `docs/superpowers/specs/2026-06-08-living-world-product-doctrine-design.md`
- GitHub: update #1142

- [ ] **Step 1: Replace the unresolved decision with the approved rule**

Edit #1142 so its decision section states:

```markdown
## Beslutning — godkendt 2026-06-08

Alle managers får samme forventede sportslige værdi fra ungdomssystemet.

Premium må give:

- bedre overblik og historik;
- flere visnings-, sammenlignings- og automatiseringsmuligheder;
- kosmetisk præsentation og supporter-identitet;
- sidegrades med samme forventede talentkvalitet og samlede output.

Premium må ikke give:

- højere forventet talentniveau;
- flere netto-værdifulde ryttere;
- hurtigere netto-udvikling;
- sportslige eller økonomiske fordele over tid.

Enhver sportsnær premium-idé kræver spillerresearch og en eksplicit fairness-review før implementation.
```

- [ ] **Step 2: Update issue state**

Run:

```powershell
gh issue edit 1142 --remove-label "needs-decision" --remove-label "claude:todo" --add-label "claude:done"
```

Expected: #1142 no longer blocks academy design as an owner decision. It remains open until its fair-premium copy follow-up is delivered, or is closed if the issue body contains no remaining implementation work.

- [ ] **Step 3: Add doctrine evidence**

Run:

```powershell
gh issue comment 1142 --body "Ejerbeslutning godkendt 2026-06-08: lige forventet sportslig værdi. Premium må give information, præsentation, automation og sidegrades, men aldrig bedre forventet ungdomsoutput. Kilde: Living World Product Doctrine."
```

Expected: comment appears once.

### Task 3: Reframe the youth roadmap into testable layers

**Files:**
- GitHub: update #932, #958, and #1136

- [ ] **Step 1: Update #932 as the academy execution owner**

Add these explicit layers to #932:

```markdown
## Godkendt lagdeling 2026-06-08

1. Sæsonbaseret intake med 1-3 seriøse klubkandidater.
2. Separat kombineret akademitrup uden for seniorgrænsen på 30.
3. Simpelt simuleret udviklingsprogram.
4. Afviste kandidater går på offentlig ungdomsauktion og derefter free agency, hvis usolgt.
5. Seniorpromotion kræver seniorplads og kontrakt.

Junior- og U23-hold samt fulde ungdomskalendere er senere lag i #958.
```

- [ ] **Step 2: Reframe #958**

Change the title to:

```text
[Epic] Junior + U23 pathway — separate teams and calendars after academy validation
```

Replace its proposed order with:

```markdown
## Entry gate

Do not implement full shared youth calendars until #932 demonstrates that managers use and value intake, academy retention, development, promotion, and youth auctions.

## Layers

1. Optional paid establishment and operating cost for separate Junior and U23 teams.
2. Separate rosters and age gates: Junior/U19 = 17-18, U23 = 19-22.
3. Simple simulated development events.
4. Shared calendars and rankings only after player demand and sufficient population.
```

- [ ] **Step 3: Align #1136**

Comment on #1136:

```text
Doctrine alignment 2026-06-08: #932 owns the first playable academy loop. #958 is explicitly later and gated by academy usage/value evidence. Youth calendars are not launch scope.
```

- [ ] **Step 4: Verify no contradictory milestone**

Run:

```powershell
gh issue view 958 --json title,body,milestone,labels
gh issue view 932 --json title,body,milestone,labels
```

Expected: #932 remains launch-critical according to current milestone decisions; #958 remains Later / Unscheduled.

### Task 4: Align training with progressive depth

**Files:**
- GitHub: update #931 and #1136

- [ ] **Step 1: Replace broad training scope in #931 with three layers**

Use:

```markdown
## Godkendt produktretning 2026-06-08

### First playable layer

- club training strategy;
- development plans for selected key riders;
- visible trade-offs between permanent growth, form, recovery, and risk;
- assistant recommendations with explanations.

### Later

- individual plans for every rider;
- staff automation;
- retraining/respecialization, primarily for younger riders.

### Research-gated depth

- detailed schedules;
- camps and altitude;
- training load and planned peaks;
- equipment-specific optimization.

Expansion requires evidence that managers create, revisit, and understand the simpler plans.
```

- [ ] **Step 2: Add success evidence to #931**

Add acceptance evidence:

```markdown
- Managers create a plan for at least one key rider.
- Managers can explain the plan's principal trade-off.
- Managers revisit plans after races, development changes, or season goals.
- Development outcomes create stories and future planning rather than a solved optimal template.
```

- [ ] **Step 3: Link #931 from the product epic**

Comment on #931 with the new epic URL and note that it strengthens the Training engine.

### Task 5: Establish the Today surface as the convergence point

**Files:**
- GitHub: update #62, #977, and #976
- GitHub: create one issue only if none of these can own the combined scope

- [ ] **Step 1: Inspect the full bodies**

Run:

```powershell
gh issue view 62 --json title,body,labels,milestone
gh issue view 977 --json title,body,labels,milestone
gh issue view 976 --json title,body,labels,milestone
```

Expected: determine whether #62 can become the parent direction without losing existing acceptance criteria.

- [ ] **Step 2: Prefer updating #62**

Rename #62 to:

```text
[Epic] Today / Manager Inbox — what happened, what changed, what needs action
```

Add:

```markdown
## Four questions

1. What happened while I was away?
2. What changed for my riders and club?
3. What deserves a decision now?
4. What should I prepare next?

## Inputs

- race results and short stories;
- rider development and health;
- transfers, auctions, and negotiations;
- deadlines and irreversible decisions;
- assistant race-calendar recommendations;
- world stories and club milestones.

This is a convergence direction for dashboard, notifications, Inbox, Min Aktivitet, and Næste træk. It is not permission for one oversized implementation slice.
```

- [ ] **Step 3: Clarify child relationships**

Comment on #977:

```text
Child of #62 direction: economy risk and Deadline Day remain one input to Today / Manager Inbox, not a separate competing dashboard.
```

Comment on #976:

```text
Child of #62 direction: Min Aktivitet should converge into contextual Inbox/Transfers views. Keep free-form community chat on Discord.
```

- [ ] **Step 4: Verify priority**

Set #62 to `priority:high` only after the launch-critical race and progression slices have executable coverage. Do not add it to the TdF Launch milestone unless the owner explicitly changes launch scope.

### Task 6: Create the race-calendar design issue

**Files:**
- GitHub: create one design issue
- Link: #1102, #1021, #959, #1125, #1126, and the product epic

- [ ] **Step 1: Create the issue**

Title:

```text
[Design] Shared race calendar — selection, overlap, fatigue, qualification, and assistant planning
```

Body:

```markdown
## Product engine

Races: create credible stories and future planning in a shared world.

## Approved direction

- Around 150 race days/stages per 30-day season.
- Multiple concurrent events, potentially around five stages per real day.
- One team selection at the start of a stage race.
- Six to eight riders depending on category.
- Roughly 60 race days as an upper workload for a typical rider.
- Managers choose races; an assistant proposes a complete editable plan.
- Fatigue and role scarcity are the first overlap constraints.
- Staff, vehicles, equipment, rentals, and travel zones follow later.
- Large races use rankings, qualification, organizer invitations, and wildcards.

## Design deliverable

Produce a standalone approved spec covering calendar data, race entry, lineup locking, overlap validation, fatigue warnings, assistant recommendation explanations, organizer decisions, and instrumentation.

## Evidence

- Managers edit and adopt assistant plans.
- Managers deliberately prioritize races and riders.
- Overlaps create understandable trade-offs rather than accidental failure.
- Managers discuss race choices and consequences.

## Related

#1102 #1021 #959 #1125 #1126
```

Labels:

```text
claude:todo,priority:high,type:investigation,cat:user-feature,needs-contract
```

Milestone: Post-launch polish unless launch scope is explicitly changed.

- [ ] **Step 2: Verify no duplicate owns this complete contract**

Search:

```powershell
gh issue list --state open --search '"assistant planning" OR "race calendar" OR "løbsplanlægning"' --limit 100
```

Expected: if a complete owner exists, update it instead and close the newly created duplicate immediately with a cross-reference.

### Task 7: Create the product-evidence issue

**Files:**
- GitHub: update #135 if it can own the work; otherwise create one child issue under #135
- Link: #306 and the product epic

- [ ] **Step 1: Inspect instrumentation ownership**

Run:

```powershell
gh issue view 135 --json title,body,labels,milestone
gh issue view 306 --json title,body,labels,milestone
```

- [ ] **Step 2: Add the doctrine scorecard to #135**

Add:

```markdown
## Living World scorecard

- weekly active managers;
- visits per active manager;
- D7 and D30 return;
- future-race or future-season planning actions;
- race report and replay consumption;
- training plan creation and revision;
- youth intake, academy retention, promotion, auction, and sale;
- transfer bids, negotiations, auctions, and manager interactions;
- Discord and in-product discussion themes;
- inactivity and return reasons.

Segment all core measures by new, established, returning, and division where sample size permits.
```

- [ ] **Step 3: Add the evidence contract**

Every major feature event should identify:

```text
engine, player_behavior, feature_layer, season_id, manager_age_segment
```

Do not add personal message content or private strategy to analytics.

- [ ] **Step 4: Link #306**

Comment that remaining generic events should be prioritized against the Living World scorecard, not instrumented merely because they exist.

### Task 8: Reframe removals and long-term hypotheses

**Files:**
- GitHub: update #1139, #775, #1109, #1112, #936, #1089, and related swap issues found by search

- [ ] **Step 1: Reframe #1139**

Change its direction from temporary hiding to:

```markdown
## Approved direction 2026-06-08

- Remove login streak pressure.
- Manager XP must not grant gameplay power.
- Preserve only subtle cosmetic reputation and career history.
- Replace the current Hall of Fame concept with world history and, later, a club museum.
```

- [ ] **Step 2: Resolve #775 against the new direction**

Comment:

```text
Product direction changed: do not invest in repairing the current Hall of Fame as the long-term solution. Verify whether a minimal bug fix is still required while visible; otherwise fold this into #1139 and close as superseded.
```

Do not close #775 without runtime verification of whether the page remains visible.

- [ ] **Step 3: Deprioritize manager power systems**

Comment on #1109:

```text
Doctrine conflict: manager abilities must not become a parallel power progression system. Reframe as optional role-play, automation preference, or cosmetic career identity before implementation.
```

Keep #1109 in Later / Unscheduled and set `priority:low`.

Comment on #1112:

```text
Manager reputation may remain as visible history and social recognition, but must not grant sporting or economic power.
```

- [ ] **Step 4: Gate 3D race visualization**

Comment on #936:

```text
Research gate: first validate demand for reports, replays, and 2-5 minute recaps. Full 3D visualization is not committed scope and requires evidence of broad demand plus sustainable production cost.
```

Keep Later / Unscheduled and `priority:low`.

- [ ] **Step 5: Reduce swap investment**

Search:

```powershell
gh issue list --state open --search "swap OR byttehandel OR bytte in:title" --limit 100
```

For each non-bug feature issue, add:

```text
Doctrine direction: swaps are deprioritized unless usage demonstrates a distinct need. Preserve correctness and exploit prevention, but do not expand the feature.
```

Keep #1089 high priority because it is a correctness bug affecting active auctions.

### Task 9: Align current planning documents

**Files:**
- Modify: `docs/NOW.md`
- Modify: `docs/MASTER_PLAN.md`
- Modify: `docs/LAUNCH_ROADMAP.md`
- Modify: `docs/strategy/TDF_2026_LAUNCH_PLAN.md` only if it contradicts current launch scope
- Modify: `docs/FEATURE_STATUS.md` only for changed planning status
- Reference: `docs/superpowers/specs/2026-06-08-living-world-product-doctrine-design.md`

- [ ] **Step 1: Add doctrine pointer to NOW**

Keep `docs/NOW.md` below its enforced line limit. Add one compact line:

```markdown
**Produktkompas:** Living World Product Doctrine er godkendt 8/6; GitHub-epic #<number> styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.
```

- [ ] **Step 2: Correct stale issue counts**

Replace any exact open-issue count presented as current with either a freshly measured count or wording that does not become stale.

- [ ] **Step 3: Mark old plans as historical where necessary**

In `docs/MASTER_PLAN.md` and `docs/LAUNCH_ROADMAP.md`, add a concise top note pointing to:

- current launch execution: #1105 and `docs/strategy/TDF_2026_LAUNCH_PLAN.md`;
- long-term product direction: the Living World doctrine and its GitHub epic.

Do not rewrite historical detail unless it directly contradicts current action.

- [ ] **Step 4: Update FEATURE_STATUS only for real status changes**

Record planning status, not implementation status:

```text
Living World doctrine: design approved
Backlog governance: product epic created and linked
```

Do not mark gameplay features as implemented.

- [ ] **Step 5: Explain patch-note decision**

No patch note is required because this task changes planning and GitHub metadata only, with no user-facing runtime behavior.

### Task 10: Verify and clean local-only forensic state

**Files:**
- Inspect: `.codex.local/followup-board-i18n.md`
- Inspect: `.codex.local/issue-473.json`
- Inspect: `.codex.local/issue-675.json`
- Inspect: `.codex.local/issue-676.json`
- Inspect: `.codex.local/issue-680.json`
- Inspect: `.codex.local/issue-681.json`
- Inspect: `.codex.local/issue675-branch-diagnostics.txt`
- Inspect: `.codex.local/nowmsg.txt`
- Inspect: `.codex.local/nowmsg2.txt`
- Inspect: `.codex.local/prbody.md`

- [ ] **Step 1: Classify every file**

For each file, record:

```text
regenerable snapshot | already in GitHub | unique persistent content
```

- [ ] **Step 2: Verify issue snapshots**

For every `issue-N.json`, compare the issue number and relevant content with:

```powershell
gh issue view N --json number,title,body,comments,state
```

Expected: if GitHub contains all durable information, mark the local file safe to remove.

- [ ] **Step 3: Promote unique content**

If any file contains unique durable information, add it to the relevant GitHub issue or repository document before removal.

- [ ] **Step 4: Request approval before deletion**

Present the exact safe-to-remove path list to the owner. Do not recursively delete `.codex.local`.

- [ ] **Step 5: Remove approved files and rerun audit**

Use `Remove-Item -LiteralPath` for each approved file, then:

```powershell
pwsh -File scripts/cross-pc-forensic-audit.ps1
```

Expected: no local-only-content errors. The hardcoded-user-path warning may remain as a separate maintenance item.

### Task 11: Final verification and handoff

**Files:**
- Modify: `docs/NOW.md`
- GitHub: comment on the Living World epic

- [ ] **Step 1: Verify repository state**

Run:

```powershell
git diff --check
git status -sb
```

Expected: only intended planning-document changes.

- [ ] **Step 2: Verify GitHub structure**

Run:

```powershell
gh issue view $livingWorldEpic --json title,body,labels,milestone,url
gh issue view 1142 --json body,labels
gh issue view 932 --json body,milestone
gh issue view 958 --json title,body,milestone
gh issue view 931 --json body,milestone
gh issue view 62 --json title,body,milestone
gh issue view 135 --json body
gh issue view 1139 --json body
```

Expected: doctrine decisions are represented once, linked to existing owners, and no long-term epic has accidentally entered the TdF Launch milestone.

- [ ] **Step 3: Commit planning-document changes**

Run:

```powershell
git add docs/NOW.md docs/MASTER_PLAN.md docs/LAUNCH_ROADMAP.md docs/FEATURE_STATUS.md
git commit -m "align planning docs with living world doctrine"
git push origin main
```

Only stage files that actually changed. Auto-push is mandatory.

- [ ] **Step 4: Add durable session handoff**

Comment on the Living World epic:

```markdown
## Backlog governance pass complete

- Product doctrine committed and linked.
- Existing epics aligned; duplicate implementation owners avoided.
- Missing cross-cutting design/evidence issues created.
- Contradictory long-term directions reframed.
- Planning docs point to this epic.

Next review: after the next meaningful playtest or 30-day game-season evidence review.
```

- [ ] **Step 5: Update plan status**

Mark the current task plan complete only after GitHub writes, document commit, push, and forensic audit are all verified.

## Plan Self-Review

- Spec coverage: all doctrine sections map either to an existing epic, a narrowly scoped design issue, a research gate, or an explicit removal/deprioritization.
- Duplication control: the plan prefers updating #62, #135, #931, #932, #958, #1139, and #1142 before creating new issues.
- Launch protection: the new product epic has no milestone; #958 and speculative depth remain outside TdF Launch.
- Fairness: #1142 receives an explicit owner decision and loses `needs-decision`.
- Persistence: the doctrine is committed; GitHub owns execution; NOW points to the epic; local-only state receives a separate verified cleanup.
- Patch notes: intentionally omitted because no runtime behavior changes.
