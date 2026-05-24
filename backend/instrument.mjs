// Pre-loaded via `node --import ./instrument.mjs server.js` så Sentry.init() køres
// FØR Express + andre app-moduler loades. Det er Sentry's officielle ESM-pattern
// for at OpenTelemetry-auto-instrumentation kan wrappe Express-routes ved
// module-load-time.
//
// Refs: https://docs.sentry.io/platforms/javascript/guides/express/install/esm/

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initSentry } from "./lib/sentry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Læs .env før initSentry så process.env.SENTRY_DSN er tilgængelig.
// På Railway/Vercel er env vars allerede sat af platformen — dotenv overskriver
// ikke eksisterende values (override: false er default).
dotenv.config({ path: join(__dirname, ".env"), quiet: true });

initSentry();
