# Login landing evidence (#5250)

Baseline: compiled frontend at c4f394eb0. After: this PR. Same browser dimensions, fixed test clock and synthetic saved Supabase session, with token refresh deliberately held pending. No production player data. Capture script serves unmodified build output, uses browser screenshots, and stops both browser and local server.

Before shows the public prerender while auth is unresolved; after shows the shared static grey transition. This reproduces the fallback app path, not deployed Vercel proxy behavior or a production latency measurement. Middleware is covered separately by request/response tests and must be verified on Vercel preview.

Raw screenshots and observations are retained. The annotated comparison only places labels and screenshot frames around these captures. Full dashboard reserved-space work belongs to #2230.

Reproduce: build baseline or branch with the e2e env from frontend/playwright.config.js, then `node scripts/capture-auth-landing.mjs before` / `after`. Run auth-landing.spec.ts on all three Playwright projects for legacy login, refresh, quiet unresolved state, expired login, direct links and anonymous root.

Bundle follow-up (same Node/dependencies/Vite command, separate empty output directories): 1427.864 -> 1425.421 KiB gzip; 2502 bytes / 2.443 KiB saved. Entry + static modulepreloads: 333.637 -> 330.875 KiB. Budget remains 1359 KiB + unchanged 5% margin (1426.950 KiB ceiling). `bundle-measurement.json` contains byte counts. CookieBanner chunk is not preloaded and is requested only when consent UI is open; small UI primitives that were already entry dependencies share compression. These are build-byte measurements, not production latency claims.
