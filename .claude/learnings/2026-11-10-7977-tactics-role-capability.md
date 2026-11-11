# Tactics role choices inferred capability from existing assignments

Refs #7977. Owner mandate: #7911 comment 6770932258.

The tactics picker offered Shared captain and Luxury helper only when the lineup already contained that role. This confused a race's capability with a team's current choices: eligible teams without a preselected special role could not choose one in Tactics, although the existing stage-role validator allowed it.

GET stage-roles now returns `special_roles_allowed` from the same `raceAllowsCoCaptain` predicate used by lineup selection and PUT validation. The frontend follows an explicit boolean; invalid present values fail closed. Responses without the new field retain the old per-role roster fallback for rolling deployments. Existing selected values still render through the unchanged picker, and server validation remains authoritative.

The positive regression failed on desktop and both mobile browser projects before the UI correction. Pure tests cover approval without preselection, refusal despite roster roles, invalid values, and old responses. A contract test runs actual stage-role validation with the shared capability. Browser tests choose both roles, save/reload, preserve the other stage and verify unsupported races remain restricted, using fixed time and synthetic fixtures.

No new role mechanics, flags, migrations or production writes. Existing player labels/explanations are reused. Patch-note EN proposal belongs in the PR under `Claude-tekst mangler`; Claude/owner supplies DA before merge. Screenshots are actual rendered UI with marked synthetic data, not a production verification claim.
