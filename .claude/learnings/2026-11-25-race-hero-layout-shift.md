# Race hero layout shift

The spoiler namespace gate passed a null fallback inside a compact hero control. The shared gate treats null as a request for the route loader, whose height is 60vh. Loading the namespace inserted that route-sized loader into one header row and then removed it.

Pass an explicit compact fallback at the call site. Reserve the geometry of asynchronous controls in the hero so their arrival does not move the result panel. The delayed-namespace browser regression test checks the size of the inline skeleton. Keep the shared gate's route fallback for route-level callers.

Refs #8709.
