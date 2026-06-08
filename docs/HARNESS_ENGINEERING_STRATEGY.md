# Harness engineering strategy - CyclingZone launch quality

_Created 2026-06-08 by Codex after Manus relaunch planning review._

## Why this matters

CyclingZone is now moving from "features exist" to "the game can be trusted at launch speed".
Harness engineering is the discipline that turns rules, assumptions and design targets into
repeatable checks. A good harness has inputs, a runner, an oracle, a report and a feedback loop.

The goal is not more bureaucracy. The goal is that the system catches regressions before players
or Nicolai do.

## World-class target

By TdF launch, every high-risk launch track should have at least one executable harness:

| Track | Harness | Oracle | Where it reports |
|---|---|---|---|
| Race engine (#1102) | Season dry-run + distribution report | Winner types match target bands, deterministic seeds, flag-off PCM fallback unchanged | `backend/scripts/out/`, GitHub issue comment |
| Progression (#1136/#1137) | Multi-season progression preview | Young riders grow, veterans decline softly, retirement bounded, no ability explosions | Markdown/HTML preview + tests |
| Relaunch (#1103) | Dry-run control tower | Reset -> fictional population -> abilities -> value -> season 1, no legacy active riders, founder badge survives reset | CLI summary + preview DB checklist |
| Economy/value (#1101) | Value cutover audit | `base_value` drives market/salary, no zero values, UCI points not player-facing | CLI report + tests |
| Discord DM (#1115) | Token + delivery canary | Bot token valid, DM path tested, failures alert before users notice | Cron/Sentry/Discord alert |
| Agent workflow | Session/start/close audits | No local-only source of truth, patch notes discipline, runtime evidence before TODOs | `agent-doctor`, cross-PC audit, CI |

## Harness design standard

Every new harness should state:

1. **Input:** fixture, seed, issue, database state or prompt.
2. **Runner:** exact command, CI job, hook or cron.
3. **Oracle:** objective pass/fail condition.
4. **Report:** human-readable output with enough context to act.
5. **Feedback loop:** what happens on failure: issue, alert, test, postmortem or block.

If a check has no oracle, it is only a dashboard. If it has no feedback loop, it is only a report.

## Launch implementation order

1. **Race calibration gate (#1102).**
   Promote `backend/scripts/simulateSeasonDryRun.js` from cockpit to gate:
   - fixed seeds for reproducible snapshots
   - target bands per terrain/type
   - mountain sub-distribution for climber/GC/baroudeur
   - explicit flag-off fallback verification

2. **Relaunch dry-run gate (#1103).**
   Build `backend/scripts/relaunchSeason1.js` so dry-run is default and produces a single summary:
   - users preserved
   - active riders are fictional only
   - `base_value`, abilities and types populated
   - founder badge assigned and reset-safe
   - rollback path documented

3. **Progression simulation gate (#1136).**
   Extend `previewRiderProgression.js` into a multi-season harness:
   - 10-season cohorts by type, potentiale and age
   - ability deltas by season
   - retirement histogram
   - value movement after progression
   - fail on outlier growth/decline beyond configured thresholds

4. **Discord canary (#1115).**
   Add a non-spam test target and make the guard answer two questions:
   - can the bot authenticate?
   - can the production runtime deliver one controlled DM or safe equivalent?

5. **Agent close-out gate.**
   Extend `agent-doctor`/cross-PC audit toward a close-out mode:
   - uncommitted local-only artifacts listed separately from tracked docs
   - docs/NOW or issue-comment required for lasting handoff
   - patch-notes status explicit for user-facing diffs

## Codex review of Manus plan

Manus' plan is directionally strong: it correctly identifies #1115, #1103, #1101, #1102,
#1136 and #679 as the launch control set. The best parts are the runtime-anchored briefs and
the insistence on permanent guards for Discord.

Required corrections before treating it as an execution contract:

- #1137 L0 progression is already merged on `main` as of `cdeab9ce`; the next work is calibration,
  visibility (#918) and L1/L2, not re-implementing L0.
- #1102 already has a dry-run harness in `simulateSeasonDryRun.js`; the next work is gate hardening,
  tuning and runtime wiring, not starting the simulator from scratch.
- #1101 cutover remains blocked by owner verification of shadow values. Do not cut over purely from
  the brief.
- #679 is partly manual Discord-admin work. Keep it in GitHub, but do not let it block backend launch
  gates unless Discord acquisition becomes the launch-critical path.
- The plan should be an index, not a second backlog. Canonical status stays in GitHub issues,
  `docs/NOW.md`, and targeted slice docs.

## Definition of done for this harness program

- Each launch-critical issue has an explicit harness command or manual checklist.
- At least race, progression and relaunch have deterministic dry-run reports.
- Harness failures create or update GitHub state, not local-only notes.
- CI/local hooks can distinguish product failure from missing external status.
- The launch decision is based on green gates plus known accepted risks, not vibes.
