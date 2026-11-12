# #6584: offline fallback must survive a failed navigation preload

The service worker treated an optional navigation-preload rejection as a definitive network failure. Its shared catch returned the offline page without attempting the original authenticated request. The offline page also requested a favicon that was installed into Cache Storage but excluded by the navigation-only fetch handler.

Fix: catch the preload rejection separately, preserve the original request for normal fetch, and restrict image fallback to the exact same-origin offline favicon. All app bundles, API/Supabase requests and other images remain outside the worker. The existing retry button receives the shared mobile/coarse-pointer target floor; copy is unchanged.

Prevention: execute the actual worker in deterministic VM tests covering rejected/successful preload, authenticated request preservation, offline language selection, old-cache cleanup and excluded resource paths. Browser evidence separately verifies image loading and physical button geometry. No production state or flags changed.
