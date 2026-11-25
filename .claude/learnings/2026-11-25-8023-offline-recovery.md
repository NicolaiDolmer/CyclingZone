# Offline recovery when the browser stays online (#8023)

A dropped navigation can show the service worker’s offline page while `navigator.onLine` stays true. That page needs to confirm the original route is reachable when a visible tab resumes. The browser’s network-status event alone cannot do that.

Test both halves of recovery. HEAD may succeed while the following navigation fails again. The new offline document also needs a retry delay, including when tab storage reads work and writes fail. Keep fixtures for both documents and test the real service worker against a loopback route whose connection can be dropped separately from the browser’s network state.
