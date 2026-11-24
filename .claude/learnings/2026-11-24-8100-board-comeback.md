# #8100 Board judgment after a comeback

The parking filter treated a returning team as fully eligible as soon as the team row was unparked. The return also left active historical punishments in place.

Record the receiving season at unpark and use it in each scheduled judgment. Expire only active punishments predating the pause. Tie the reset and release of forced listings to the same transaction as unpark. A local PostgreSQL fixture verifies the change in status and a replay.

Fable follow-up: season end captures the parking timestamp before judgment and applies it after judgment. Reset active penalties on return, since their timestamps need not precede the captured value. A paused forced listing must be withdrawn as well. In the deployment window, preserve a valid receiving-season marker or keep the signup parked.
