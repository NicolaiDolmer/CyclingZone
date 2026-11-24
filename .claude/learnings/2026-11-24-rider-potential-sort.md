# Rider database potential sort (#7924)

The rider database paginates before scouting estimates arrive. Sorting a rendered page would miss riders on other pages. Sorting the stored number alone would also disagree with the visible number when the current rating raises it.

The sorted read reuses the authenticated team's visible estimate calculation and applies pagination after ranking the matching rider IDs. Use the public estimate as the test oracle and check both directions, a tie spanning pages, and a different team's estimates.
