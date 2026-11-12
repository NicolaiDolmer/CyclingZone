# #7864 shared captain in the team plans

Real Chromium screenshots (desktop 1280 px, mobile 375 px) of a synthetic hilly stage
with mocked responses and the flag on. Team: captain, shared captain, free role and two
domestiques. "Ride for GC" is selected in every shot. No production data.

- `*-before-*`: main before this PR. The shared captain and the free role get
  "Stay sheltered, then Ride in easy in the last 10 km"; the cards say everyone rides
  for the GC leader and promise the lowest fatigue tonight; Danish copy button is singular.
- `*-after-*`: this PR. The shared captain rides the captain's plan, the free role
  rides his own role suggestion (the break, then ride for a result), and the card texts
  say only what the plans do.
- `*-cards`: the five team plan cards and the same-type copy button.
- `*-plan`: the stage plan rows with the shared captain in view.

Spec: `frontend/tests/e2e/tactics-ready7864-cocaptain.spec.ts`
(`CZ_SHOT_PHASE=before` was used once against the old code for the before shots).
