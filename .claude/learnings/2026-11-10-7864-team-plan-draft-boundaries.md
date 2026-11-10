# Team-plan drafts must follow the accepted role basis

Refs #7864. Pre-release review findings, not a production incident.

The first preset draft used a named target without accounting for the engine's flat-stage preference for an existing sprint captain. GC/Stage win now adjust that competing role through the existing stage-scoped role function. A test passes the generated roles to the actual engine team-context builder and checks its leader against the named target.

Switching presets retains the original role basis so GC can temporarily release the sprinter and Sprint can restore him. That cache belongs to the current draft, not to the race indefinitely. A successful server reload now clears it. Otherwise, accepting another tab's newer tactics after a conflict could restore the old captain on the next preset click.

The browser regression reproduced the stale captain after a conflict, then passed after the reset: accept the new server draft, choose GC, save, and verify the new captain remains. Manual role changes also reset the cached basis; keeping one's own conflicted draft retains it.

Named decisive points reuse existing route suggestions and validation. Generated plans must be checked against the destination route before any future multi-stage application; copying raw climb indices between routes is not a valid shortcut.

CI integration exposed three contracts: the shared compact profile must remain compact (the tactics parent selects the full card); the preview's public flag allowlist must match the server; and a building registry entry needs its decision and deadline even without a seeded flag. Existing guards were retained and the owning inputs corrected. Bundle comparisons must use matching production builds, because E2E uses mock environment inputs. The measured feature growth is recorded under the budget file's existing policy with its margin unchanged.
