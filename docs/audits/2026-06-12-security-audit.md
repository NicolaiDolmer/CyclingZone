# Security-audit — 2026-06-12 (dagbølge 3, audit:security)

Nat-audit-sporet uden issue. Scope: (a) npm audit, (b) grep-sweep for farlige mønstre,
(c) RLS-gennemgang af nyeste `database/*.sql`, (d) secret-scan af tracked filer.
Kun entydige small-fixes i samme PR — resten som prioriterede fund nederst.

## Samlet vurdering

**Grøn med ét fix.** Ingen dependency-sårbarheder, ingen secrets i tracked filer,
RLS-disciplinen i de nyeste migrationer er god, og auth-middleware-dækningen er
komplet og test-håndhævet. Ét reelt fund (PostgREST-filterinjektion via rå
URL-params i to `.or()`-interpolationer) er fixet i denne PR med UUID-guard +
kontrakt-test.

## (a) npm audit

| Pakke-rod | Resultat | Dependencies |
|---|---|---|
| `frontend/` | **0 sårbarheder** (info/low/moderate/high/critical alle 0) | 442 (82 prod) |
| `backend/` | **0 sårbarheder** | 291 (215 prod) |

Ingen bumps nødvendige.

## (b) Grep-sweep for farlige mønstre

### eval / new Function
- **1 fund:** `scripts/insert_new_riders.mjs:30` — `new Function("return " + body)()`
  parser `REGION_TO_ISO`-dict ud af den lokale `scripts/import_riders.py`.
  Lokal engangs-importscript, input = egen tracked fil (ikke bruger-/netværksdata).
  **Risiko: lav.** Anbefaling (P3): flyt mappingen til en delt JSON-fil og
  `JSON.parse` i begge scripts. Ikke fixet her (rører to scripts + py-paritet).
- Frontend + backend runtime-kode: **0 fund.**

### dangerouslySetInnerHTML / innerHTML / document.write
- `frontend/src`: **0 fund.** React-escaping er eneste render-vej.

### SQL-streng-interpolation
- Ingen rå SQL i backend-runtime — alt går gennem Supabase query-builder
  (parameteriseret af PostgREST). Python-scripts: ingen f-string-SQL.
- **FUND (fixet):** PostgREST-*filterinjektion* — to ruter sendte rå URL-params
  direkte ind i `.or()`-filterstrenge:
  - `GET /api/riders/:id/history` → `riderHistory.js`
    (`.or(\`offered_rider_id.eq.${riderId},requested_rider_id.eq.${riderId}\`)`)
  - `GET /api/teams/:id/transfer-history` → `teamTransferHistory.js` (4× `.or()`)

  En crafted `:id` (fx `x,id.gt.00000000-0000-0000-0000-000000000000`) kunne
  injicere ekstra or-betingelser og enumerere handler på tværs af ALLE
  ryttere/hold i ét kald. Afgrænsning: status-whitelists (`.in("status", ...)`)
  AND'es ovenpå, så kun allerede-offentlige statusser kunne læses bredt —
  privat pending/rejected-data var IKKE eksponeret. Severity: **lav-moderat**
  (bred enumeration af offentlige data, kræver auth-token).

  **Fix i denne PR:** UUID-regex-guard (400 ved ugyldigt format) på begge ruter
  i `backend/routes/api.js` + kontrakt-test `backend/lib/orFilterParamGuard.test.js`
  (samme stil som `adminRouteOwnership.test.js`) der fejler hvis guarden fjernes.
- Øvrige `.or()`-interpolationer verificeret sikre: `inboxPending.js` /
  `squadEnforcement.js` bruger server-deriverede værdier (`req.team.id` /
  ISO-timestamps), `/managers/:teamId` eksistens-tjekker teamId mod `teams`
  (404) før `.or()`.
- `.ilike("name", \`%${q}%\`)` med bruger-`q` (api.js 4968/5990 m.fl.): kun
  LIKE-wildcards (`%`/`_`) kan injiceres — påvirker søge-semantik, ikke
  data-adgang. **P4, ingen handling.**

### Express-ruter uden auth-middleware
- 163 route-registreringer i `backend/routes/api.js` gennemgået: **alle**
  skrive- og admin-endpoints har `requireAuth`/`requireAdmin` (de to multi-line
  admin-imports har `requireAdmin` på næste linje).
- Bevidst offentlige: `GET /api/race-pool` (read-only katalog, cached) og
  `GET /health`. Acceptabelt.
- Forsvar i dybden til stede: `helmet()`, CORS-allowlist, `trust proxy 1`,
  `express.json({ limit: "10mb" })`, `adminApiLimiter` på hele `/admin`-præfikset,
  `adminWriteLimiter` på admin-writes, og `adminRouteOwnership.test.js`
  håndhæver at admin-ruter bor i api-routeren.

## (c) RLS i nyeste database/*.sql

Statisk gennemgang af alle filer siden 2026-06-10 + live-verifikation via
`backend/scripts/audit-rls-coverage.js` (read-only RPC mod prod):

- `2026-06-11-roadmap-items-votes.sql`: **forbillede.** RLS på begge tabeller,
  idempotente DROP/CREATE-policies, admin-gate via `public.is_admin()`,
  vote-synlighed låst til egen række, `security_invoker`-view så aggregat
  respekterer RLS. Ingen huller fundet.
- `2026-06-10-discord-dm-outbox.sql`: RLS enabled uden policies = default-deny
  for anon/authenticated; kun service_role (backend) rører tabellen.
  **Intentionelt og korrekt** (dokumenteret i filen).
- Øvrige nye filer (board-anchor, teams-unique, voting-seed, rollover,
  potentiale-column-privilege, star-*, value-cutover, zombie-cleanup):
  ALTER/seed/grants — ingen nye tabeller, ingen RLS-behov.
- **Live-resultat:** 63 tabeller scannet, **0 kritiske fund**, alle
  required-policies til stede; 9 backend-only tabeller med default-deny
  (intentionelt, service_role bypasser).

## (d) Secret-scan af tracked filer

Mønstre scannet via `git grep` (kun tracked filer, ingen env-dumps):
JWT (`eyJ...`), `sk-`, `ghp_`/`github_pat_`, `AKIA`, `xox*-`, `sbp_`,
`sb_secret_`, `BEGIN PRIVATE KEY`, generiske hardcodede creds
(`key/secret/token/password = "<20+ tegn>"`).

- **0 fund.**
- `frontend/.env.production` (tracked): kun publishable værdier
  (`sb_publishable_...` anon key, public URLs, Clarity-projekt-id) — by design
  klient-synlige. OK.
- `backend/.env.example` / `frontend/.env.example`: kun key-navne/placeholders.
- Supabase-projekt-ref i `relaunchOrchestrator.test.js` er en URL (public), ikke en secret.

## Fixes i denne PR

1. UUID-guard på `GET /api/riders/:id/history` + `GET /api/teams/:id/transfer-history`
   (`backend/routes/api.js`) — blokerer filterinjektion i `.or()`-strenge.
2. `backend/lib/orFilterParamGuard.test.js` — kontrakt-test der låser guarden fast.

Verifikation: fuld backend-suite **1393/1393 pass** (CI-ækvivalent dummy-env),
eslint 0 errors på ændrede filer, npm audit 0+0.

## Prioriterede fund (ingen issues oprettet — orkestrator beslutter)

| Prio | Fund | Anbefaling |
|---|---|---|
| P3 | `scripts/insert_new_riders.mjs` bruger `new Function` til at parse mapping ud af py-fil | Flyt `REGION_TO_ISO` til delt JSON; `JSON.parse` i både .mjs og .py |
| P3 | `riderHistory.js`/`teamTransferHistory.js` sluger Supabase-fejl stille (`res.data \|\| []`) — fejl ligner tom historik | Tjek `res.error` og kast/logg (observability, ikke direkte security) |
| P3 | Ingen generel `:id`-param-validering — hver rute validerer ad hoc | Overvej fælles UUID-param-middleware som defense-in-depth for alle `:id`-ruter |
| P4 | `.ilike` med bruger-input tillader LIKE-wildcards | Escape `%`/`_` hvis søge-semantik nogensinde driller; ellers ingen handling |
