# Profile ability projection (#5423)

The profile maintained its own ability column list while other surfaces used the registry. A new ability could therefore be missing from only the profile.

The profile now derives its explicit projection from ABILITY_KEYS, preserving hidden-column protection. A source regression test rejects direct ability reads with handwritten ability columns. Authenticated SELECT on both newer mental ability columns was verified read-only before the change.

Current display recipes do not weight these two abilities, so this correction does not change the visible rating. Golden ratings remain untouched.
