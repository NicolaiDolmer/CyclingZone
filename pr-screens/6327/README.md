# #6327: Giro e14 film checkpoint

`before-after.png` combines two real screenshots of the existing film component
on the same route and measured e14 checkpoint positions, with synthetic names.
The visible excerpt ends at km 89 and concerns the four-rider descent attack.
Before: +20 seconds relative lead at km 71.4 becomes 39.55 seconds behind the
field at km 89 without contact. After: the actual reconciliation function joins
the groups and emits one actorful catch plus the membership merge at km 89.

This is a reconstructed checkpoint scenario, not an exact historical replay or
a rewritten production result. Historical salted seed and complete historical
state are unavailable. The frontend component and player text are unchanged.
The screenshot uses the real route profile and existing Danish translations;
fixture result rows only supply anonymized name lookup and are not outcome proof.

The executable e14/e16 regression is in
`backend/lib/engine/v4/segmentLoop.descentCrossing6327.test.ts`; pure contact and
finish projection cases are alongside it. Owner 7 October: checkpoint contact
and physical-contact outcomes are provisional until this card is reviewed.
Activation choice B: only together with the approved #6199 time model, and only
for new races under a future revision. No activation is included.
