# Youth auction reservations and settlement (#8034)

Native PG17 exposed three differences between the bid gate and the finalizer. During the season gap the finalizer uses the acquisition season, a youth reservation can change squad as age changes, and older leads can lack a stored squad. The competing acquisition succeeded when the wrong squad held the reservation.

Use the effective destination for reserved-capacity reads. Run the actual finalizer after the conflicting acquisition to verify ownership, terminal state and the ledger together. Include both bid transports.

A deferred one-for-one swap temporarily shows two registration rows for the same place. Test finalization both before registration and after only the incoming leg registers. The winning reservation uses registered capacity at both limits, and a new acquisition still uses the ordinary admission count. An interrupted youth senior purchase can also leave ownership applied and the debit outstanding. A retry must finish the original payment without reopening the capacity check.
