# Testing — Verifikations-infrastruktur (#203)

> Filed under [#203](https://github.com/NicolaiDolmer/CyclingZone/issues/203). Lukker
> "manual-test-only"-gappet for auktions-cluster så AI kan verificere AC'er
> end-to-end uden manuel klik.

## Backend unit-tests — WebSocket polyfill (#552)

CI kører Node 20, som mangler native `WebSocket`. `@supabase/realtime-js` init'er
eagerly ved `createClient()`, så enhver test-fil der direkte eller transitivt
importerer `@supabase/supabase-js` crasher med:

```
Error: Node.js 20 detected without native WebSocket support.
```

Fix: [`backend/test-setup.js`](../backend/test-setup.js) polyfiller `globalThis.WebSocket`
via `ws` (allerede dep). Køres via `--import` flag i `backend/package.json`'s
test script.

**Forward-guard:** nye test-filer der importerer supabase (direkte eller transitivt
via fx `discordNotifier.js`) virker automatisk uden ekstra arbejde. Polyfillen
fjernes når CI opgraderes til Node 22+ (har native `WebSocket`).

Alternativt pattern (kun hvis polyfillen ikke matcher): extract pure functions til
separat modul uden supabase-import. Eksempel: [`backend/lib/discordDmTarget.js`](../backend/lib/discordDmTarget.js).

## Test-konti

3 dedikerede konti i prod-Supabase (markeret `is_test_account=true`, default 800K balance):

| email | username | rolle |
|---|---|---|
| `test-a@cyclingzone.dev` | `test-a` | byder |
| `test-b@cyclingzone.dev` | `test-b` | byder (race-condition partner) |
| `test-seller@cyclingzone.dev` | `test-seller` | sælger der opretter auktioner |

Alle har `is_test_account=true` så de udelukkes fra:

- `season_standings` (rank_in_division skalerer kun på rigtige managers)
- TeamsPage / StandingsPage / HallOfFamePage / HeadToHeadPage / DashboardPage / SeasonPreviewPage
- `betaResetService` (auto-balance-reset rammer dem ikke)
- `boardAutoAccept` + `boardMidSeason` (ingen DNA / mid-season events)

Ægte managere er uændret — `is_test_account` defaulter til `false`.

### Manuel preview/test-login (UI-verify før merge) — #767

PR-previews (`cycling-zone-git-<branch>-…vercel.app`) bygges med Vercel
`Preview`-target, som peger på **samme Supabase som prod** — der findes kun ét
Supabase-projekt (`ghwvkxzhsbbltzfnuhhz`), ingen separat staging. Konsekvens:

- Login i en preview bruger prod-auth. Enhver prod-konto (inkl. de 3 test-konti)
  virker i preview med samme credentials.
- Preview-deploys er **ikke** SSO-beskyttede (HTTP 200 direkte), og
  `Preview`-target har `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` /
  `VITE_API_URL`. Login-infrastrukturen er altså intakt ud af boksen.

**Sådan logger du ind i en preview for at verificere PR-features:**

1. Åbn PR-preview-URL'en (Vercel-kommentaren på PR'en, eller en hvilken som helst
   `…vercel.app`-deploy).
2. Email: `test-a@cyclingzone.dev` · password: `TEST_ACCOUNT_PASSWORD`
   (hentes fra Infisical / `backend/.env`, aldrig committet — repo er publicly
   viewable).
3. Du lander på `/dashboard` som authenticated manager (test-a, Division 3,
   800K balance) og kan klikke featuren igennem.

> ⚠️ Test-handlinger i en preview rører **prod-data** (delt DB). test-a er
> `is_test_account=true`, så den udelukkes fra ranglister/board-events, men
> undgå destruktive admin-handlinger via en test-konto i preview.

Hvis login fejler med "invalid credentials": passwordet på test-konti er ikke
synket. Læg `TEST_ACCOUNT_PASSWORD` i `backend/.env` (fra Infisical) og kør
`node scripts/setup-test-accounts.mjs` — idempotent, sætter samme password på
alle 3 konti.

> 🔑 **Hvis login fejler med "Legacy API keys are disabled":** Supabase har
> deaktiveret de gamle JWT-baserede `anon`-keys (legacy). Den `VITE_SUPABASE_ANON_KEY`
> der bruges er stadig den gamle legacy-key. Fix: udskift den med den **publishable
> key** (`sb_publishable_…`, hentes i Supabase-dashboard → Project Settings → API Keys)
> i **både** Vercel `Preview`-target **og** Infisical `dev`-env. Prod-target er
> allerede migreret (key `cyclingzone_frontend_2026_05`). Publishable keys er
> design-mæssigt offentlige (ligger i frontend-bundlen), men sættes via dashboardet
> — agent-sessioner blokeres af `block-dangerous-secret-commands.sh` fra at røre
> Infisical/Vercel-secrets direkte.

## Required env (`backend/.env`, ikke i Git)

```
SUPABASE_URL=https://ghwvkxzhsbbltzfnuhhz.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>
SUPABASE_ANON_KEY=<publishable key sb_publishable_… — legacy JWT er DISABLED>
TEST_ACCOUNT_PASSWORD=<fælles password for de 3 test-konti>
DISCORD_DM_TARGET=webhook    # default for prod-backend
```

## Scripts

### `scripts/setup-test-accounts.mjs`

Idempotent — kan køres ubegrænset. Opretter konto i `auth.users`, sikrer `public.users`-row, opretter/opdaterer team-row med `is_test_account=true` + 800K balance.

```bash
node scripts/setup-test-accounts.mjs --dry-run    # preview
node scripts/setup-test-accounts.mjs              # live
```

### `scripts/get-test-token.mjs`

Mint Supabase JWT for et test-account via `signInWithPassword` (anon-key, ikke service-role).

```bash
node scripts/get-test-token.mjs --email=test-a@cyclingzone.dev
node scripts/get-test-token.mjs --email=test-a@cyclingzone.dev --json
```

### `scripts/smoke-test-prod.mjs`

End-to-end smoke-test mod `cyclingzone-production.up.railway.app`. 3 scenarier dækker AC'erne fra #192/#193/#194.

```bash
node scripts/smoke-test-prod.mjs --test=all
node scripts/smoke-test-prod.mjs --test=owner-check        # #192
node scripts/smoke-test-prod.mjs --test=reserved-balance   # #193
node scripts/smoke-test-prod.mjs --test=race-confirm       # #194
```

Hvert scenario:

1. Setup state via service-role-key (balance reset, free-agent-rytter til test-seller, opret auktion)
2. Kald backend som test-konto (signInWithPassword JWT)
3. Asserter HTTP-status + dansk fejl
4. Cleanup (cancel auktioner, frigør rytter, reset balance)

Exit code 0 = alle grønne, 1 = mindst én fejl.

### `scripts/railway-tail.ps1`

Wrapper omkring `railway logs --json` med regex-filter og time-window. Kræver Railway CLI installeret (se script-header for install).

```pwsh
pwsh -File scripts/railway-tail.ps1 -Pattern '\[resolveProxyBids\]' -SinceMinutes 10
pwsh -File scripts/railway-tail.ps1 -Pattern '\[discord-dm:stdout\]' -SinceMinutes 2
```

Bruges efter smoke-test til at verificere runtime-effekter (logging, DM-routing).

## Discord DM-routing (`DISCORD_DM_TARGET`)

| target | adfærd |
|---|---|
| `webhook` (default) | ægte Discord DM via bot — eksisterende prod-adfærd |
| `stdout` | log JSON-line `[discord-dm:stdout] {teamId, type, title, ...}`; ingen netværk |
| `test-channel` | embed til `DISCORD_TEST_CHANNEL_WEBHOOK_URL` |

**Test-konti tvinger ALTID `stdout`** uanset env — så smoke-tests aldrig spammer
ægte managers, selv hvis env-var er sat forkert i prod.

Ægte managers respekterer env-var (default `webhook` = uændret adfærd).

## Smoke-test scenario-detaljer

### #192 owner-check (`PATCH /api/auctions/:id/proxy`)

- Setup: test-seller ejer rytter X, opretter auktion på X
- Test: test-seller forsøger at sætte proxy på egen auktion
- Forventet: HTTP 400 + `"Du kan ikke sætte autobud på din egen rytter"`
- Pre-fix: ingen owner-check → proxy kunne sættes

### #193 reserved-balance (`POST /api/auctions/:id/bid`)

- Setup: test-a har 800K balance, leder auktion-1 ved 50K + proxy 200K, leder auktion-2 ved 80K (ingen proxy)
- Test: test-a byder 600K på auktion-3
- Forventet: HTTP 400 + `"Du har 520.000 CZ$ tilbage efter eksisterende bud"`
  - Reserved = max(50K, 200K) + max(80K, 0) = 280K
  - Available = 800K - 280K = 520K
- Pre-fix: reserved tæller kun `current_price` → forkert beregning

### #194 race-confirm (`POST /api/auctions/:id/bid`)

- Setup: 1 auktion ved current_price 50K, ingen leader
- Test: test-a + test-b sender samtidigt POST /bid med `expected_current_price=50000, amount=60000`
- Forventet: én får 200, én får 409 + `{ error: "price_changed", currentPrice, minimumBid }`
- Pre-fix: ingen 409 — begge bud kunne lande

## Risiko-noter

- **Test-seller får midlertidigt ejerskab** af 1-3 free-agent ryttere under smoke-test. Cleanup setter dem tilbage til `team_id=null`. Hvis script crasher mellem setup og cleanup: kør `scripts/smoke-test-prod.mjs --test=all` igen — pre-cleanup nulstiller alle test-auktioner.
- **Service-role-key må aldrig committes** — kun læses fra `backend/.env`. Per [#201](https://github.com/NicolaiDolmer/CyclingZone/issues/201) bør keyen roteres post-merge så historisk Git-eksponering elimineres.
- **DISCORD_DM_TARGET skal stå `webhook` i prod** — ægte managers skal modtage DMs som vanligt. Test-konti er undtaget via `is_test_account=true`-tjek i `resolveDmTarget`.
