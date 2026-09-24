# Spec: billedstationen (#5565): ægte-data-billeder af alle UI-PR'er fra én fast lokal origin med ét login

> Cloud-session 24/9-c. Byggeklar spec, ingen kode. Refs #5565, #5589 (første kunde), læring `.claude/learnings/2026-09-24-pr-shots-fake-clock-logout.md`. Hard rule 26 (visuelt bevis før release), TASTE/PAGE_TEMPLATES (billeder desktop + mobil).
> Linjenumre er fra `main` @ `8c684dc`. Prototypen (`tools/pr-shots-v2.mjs`) er IKKE i repoet (orkestratorens scratchpad, nævnt i læringen).

## Formål (én linje)

Hver UI-PR får før/efter-billeder med ægte data (desktop 1440 + mobil 390) fra `http://localhost:5173` mod prod-API'et, med ét login der aldrig kan ryge, før ejeren spørges om go.

## Ejer-beslutninger (citeret)

- **23/9** (issue-body, ejer-ja til status quo-forslag 2): "aegte-data-billeder af UI-PR'er kraevede et login pr. Vercel-preview-URL. Det var den stoerste ventetid for UI-PR'er [...] Prototypen [...] fotograferede 9 UI-PR'er paa ca. 10 min, og billederne fandt 2 reelle fejl som CI, e2e og reviewer ikke fangede."
- **24/9** (arbejdsform, docs-PR `cloud/docs-arbejdsform-2026-09-24`): "go fra telefonen: hvert UI-kort får Vercel-preview-link + billeder."
- **Læring 24/9** (fake-clock-logout): "1. Skru aldrig browser-uret TILBAGE i en profil med en rigtig session. [...] 2. Skrive-vagten skal også fange `signOut` på klientsiden [...] Billedstationen (#5565) bør åbne en KOPI af profilen pr. kørsel (eller gemme `sb-*-auth-token` og lægge den tilbage bagefter). 3. Tjek login-status med en kort probe FØR en lang billedserie."

## Forudsætninger der findes i dag

| Del | Hvor |
|---|---|
| `http://localhost:5173` er i backendens CORS-allowlist | `backend/server.js:52-55` (`ALLOWED_ORIGINS`, `isAllowedOrigin`) |
| Vite preview kan serve et build på fast port | `frontend/package.json:11` (`build`), `vite preview --port 5173 --strictPort` |
| Playwright + Chromium er installeret (e2e) | `frontend/playwright.config.*`; headed Edge kræver `channel: "msedge"` (læringen) |
| Skærmbilleder pr. PR er allerede kravet | AGENTS.md hard rule 26 (`pr-screens/`), `docs/AI_OPS_REFERENCE.md:46-49` (TIER TARGETED/WAVE) |
| Prod-API'et og Supabase-auth | `VITE_API_URL`, `VITE_SUPABASE_*` fra `frontend/.env*` (læses aldrig af scriptet; buildet bruger dem) |

## Design

**Ét script, tre kommandoer:** `node scripts/pr-shots.mjs <login|shoot|compose> ...` (ESM, Node 24, ingen nye afhængigheder: Playwright fra `frontend/node_modules`, billed-sammensætning som HTML renderet af Playwright).

### `login`
- Åbner Edge (`chromium.launchPersistentContext(MASTER_PROFILE, { channel: "msedge", headless: false })`) på `http://localhost:5173/login` (kræver en kørende preview af `main`; scriptet starter den selv hvis porten er fri).
- Ejeren taster selv. Scriptet poller `localStorage` for `sb-<ref>-auth-token` og afslutter, når sessionen findes, med linjen "Login gemt i <profil>, udløber <dato>".
- `MASTER_PROFILE` = `%LOCALAPPDATA%\cz-pr-shots-profile` (uden for repoet, aldrig committet; `.gitignore` rører ikke, fordi stien ligger udenfor).

### `shoot <label> <worktree> <routes...> [--widths=1440,390] [--click=<tekst|css:sel>...] [--dry-run]`
1. **Login-probe først** (læring 3): åbn `/dashboard` i en KOPI af profilen (se 4) og tjek at `sb-*-auth-token` findes OG at et kald til `/api/me` (eller den route dashboardet laver først) svarer 200. Ellers stop med "Kør `login` først". Ingen lang serie på et dødt login.
2. **Build fra worktreets egen frontend-mappe** (`cwd = <worktree>/frontend`, ellers mister Tailwind sin config, jf. `.claude/learnings/2026-09-20-tailwind-content-glob-tsx.md`): `npm run build` → `vite preview --port 5173 --strictPort`. Er porten optaget: stop, aldrig en anden port (origin er kontrakten).
3. **Skrive-vagt** (`context.route`): alle `POST/PUT/PATCH/DELETE` mod `VITE_API_URL` og mod Supabase REST/RPC (`/rest/v1/`, `/rpc/`) besvares lokalt med 204; `POST /auth/v1/logout` besvares 204 **og** logges som "signOut forsøgt" (fordi supabase-js rydder den lokale session alligevel, læring 2). GET'er går til prod. `page.on("request")` tæller blokerede skrivninger og skriver dem i rapporten.
4. **Profil-kopi pr. kørsel** (læring 2): `fs.cp(MASTER_PROFILE, tmpProfile, { recursive: true })` før serien; efter serien slettes kopien. Mesterprofilen rører scriptet aldrig efter `login`. Fordel over "gem token og læg tilbage": et uheldigt `signOut` kan ikke ramme mesteren, uanset hvad appen gør.
5. **Aldrig et falsk ur** (læring 1): ingen `page.clock.install` og ingen `Date`-overskrivning. Tilstande der kræver "et andet tidspunkt" (fx dagens løb er afgjort) fremkaldes med **GET-route-mocks** af datasvarene (`--mock=<route>=<json-fil>`), aldrig med uret. Scriptet afviser en `--shot-at`-parameter med en fejl der peger på læringen.
6. **Billeder:** pr. route × bredde: `page.setViewportSize`, vent på `networkidle` + `data-testid`-ankre hvis givet, `fullPage: true`. Valgfri klik-sekvens før billedet (`--click="Taktik"` = tekst, `--click=css:[data-testid=x]`); rapporten skriver hvor hvert klik landede (element-tekst + url efter klik), så et forkert klik ses i loggen og ikke først på billedet.
7. **Output:** `<OneDrive>/private-handoffs/pr-shots/<label>/<route>-<bredde>.png` + `report.json` (build-sha, routes, blokerede skrivninger, klik-log, login-udløb). Aldrig i repoet (ægte spillernavne).
8. `--dry-run`: printer planen (build-mappe, port, routes × bredder, mocks, klik) uden at starte browser eller build.

### `compose <label> [--before=main]`
- Ét samlet før/efter-billede pr. PR: `compose.html` (to kolonner: `main` = før, `<label>` = efter; én række pr. route × bredde; mobil skaleret 0,5) renderet af Playwright til `<label>/before-after.png`. "Før" tages med `shoot main <main-worktree> <samme routes>` (én gang pr. dag, genbruges).

### Dokumentation
- `docs/AI_OPS_REFERENCE.md` (§verifikations-tiers, :46-49): "hver UI-PR får billederne (desktop + mobil, før/efter) FØR ejeren spørges; go-kortet linker til `before-after.png` + Vercel-preview".
- `docs/NIGHT_WAVE_RUNBOOK.md` trin 5 peger allerede på `scripts/pr-shots.mjs` (docs-PR 24/9).

## Kodeændringer (fil:linje, i rækkefølge)

1. `scripts/pr-shots.mjs` (ny): CLI + de tre kommandoer. Rene dele udskilt i `scripts/lib/prShots.mjs` (ny): `parseArgs`, `slugify`, `planShoot` (til `--dry-run`), `composeHtml`, `isWriteRequest`, `isSignOutRequest`.
2. `scripts/lib/prShots.test.mjs` (ny, `node --test`): se Tests.
3. `docs/AI_OPS_REFERENCE.md:46-49`: én linje pr. tier om billederne.
4. `.claude/learnings/2026-09-24-pr-shots-fake-clock-logout.md`: tilføj "Rettet i #5565: profil-kopi pr. kørsel, signOut-log, ingen `--shot-at`".
5. **Ingen** ændring i `frontend/`, backend, e2e-config eller CI. Scriptet er et lokalt ops-værktøj.

## Tests (`scripts/lib/prShots.test.mjs`)

- `parseArgs`: `shoot lbl wt /a /b --widths=1440,390 --click=Taktik --click=css:[x] --mock=/api/x=f.json --dry-run` → objekt; ukendt flag fejler; `--shot-at` fejler med læringens tekst.
- `slugify("feat/5589-today-stages")` → `feat-5589-today-stages`.
- `planShoot`: routes × bredder i deterministisk rækkefølge; port 5173 fast; build-cwd = `<worktree>/frontend`.
- `isWriteRequest`: `POST /rest/v1/x` = true, `GET /rest/v1/x` = false, `POST https://api.posthog.com/e` = false (telemetri må gå igennem? **Nej**: blokér også PostHog/Sentry POSTs, så billedkørsler ikke tæller som spillere; test det).
- `isSignOutRequest`: `/auth/v1/logout` true, `/auth/v1/token` false.
- `composeHtml`: to kolonner, én række pr. route, mobil får `width:50%`; ingen em-dash i overskrifter.
- Dry-run integration: `node scripts/pr-shots.mjs shoot x . /dashboard --dry-run` printer plan, exit 0, starter ingen proces (test kører den som child-process og tjekker at port 5173 ikke åbnes).

## Risici

1. **Edge-kanalen.** `channel: "msedge"` kræver Edge på DOLMERPC (findes). Fallback: `--channel=chrome`. Playwrights egen Chromium er ikke installeret til headed (læringen).
2. **Prod-API-belastning.** Hver route laver de kald appen normalt laver, som én spiller. 9 PR'er × 4 routes × 2 bredder ≈ 72 sidevisninger. Ingen skrivninger. Acceptabelt; ingen parallelle kørsler (porten er én).
3. **Personhenførbare billeder.** Ægte hold- og spillernavne: kun OneDrive private-handoffs, aldrig i PR eller repo. Go-kortet får billederne via OneDrive-link eller som vedhæftning i chatten, ikke på GitHub. Vercel-preview-linket kan derimod godt stå på GitHub.
4. **Session-udløb.** Supabase-refresh-token holder typisk uger; proben (punkt 1) fanger udløb før en serie. `login` tager 1 min for ejeren.
5. **Build-tid.** ca. 1-2 min pr. worktree; "før"-billederne af `main` genbruges pr. dag.
6. **Mocks kan lyve.** En GET-mock viser en tilstand, ikke prod; rapporten markerer billeder taget med mocks tydeligt ("MOCK: /api/x"), og go-kortet skal sige det.

## Spor-opdeling

Ét spor, én PR (`feat/5565-pr-shots`): filerne ovenfor. Ingen overlap med S4-spor, motor-runde 2 eller chunk-spor 5 (`deploy-verify.yml` røres ikke).

## Acceptance (fra issuet + læringen)

- [ ] `node --test scripts/lib/prShots.test.mjs` grøn; `--dry-run` viser plan uden browser.
- [ ] `login` én gang; `shoot` af én åben UI-PR giver desktop + mobil-billeder og en rapport med 0 skrivninger sluppet igennem.
- [ ] Mesterprofilen er stadig logget ind efter en kørsel hvor appen forsøgte `signOut` (fremkaldt test: mock `/api/me` → 401).
- [ ] `compose` giver ét før/efter-billede.
- [ ] Første kunde: #5589 (Today's stages) fotograferet med ægte data uden at skrue på uret.
