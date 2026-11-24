# #8100 Board judgment after a comeback

The parking filter treated a returning team as fully eligible as soon as the team row was unparked. The return also left active historical punishments in place.

Record the receiving season at unpark and use it in each scheduled judgment. Expire only active punishments predating the pause. Tie the reset and release of forced listings to the same transaction as unpark. A local PostgreSQL fixture verifies the change in status and a replay.
