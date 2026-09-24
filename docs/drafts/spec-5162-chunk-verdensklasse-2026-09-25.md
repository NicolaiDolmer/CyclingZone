# Spec: chunk-fejlen, verdensklasse-A (spor 5: gamle assets bevares, retention efter målt klient-alder)

> Cloud-session 24/9-c. Byggeklar spec, ingen kode. Refs #5162 (epic), #5159/#5173 (spor 1, merget), #5160/#5165/#5170 (spor 2 + rod-årsag, merget), #5161/#5168 (spor 4, merget), #4595, #2423.
> Linjenumre er fra `main` @ `8c684dc` (24/9 kl. ca. 13).
> **Timing (ejer 24/9):** første spor lige EFTER S4-sporene er i prod (kalender, parkering + hent tilbage, træning pr. løbsdag, ungdomsløb), så udgivelses-flowet ikke ændres midt i sæsonskiftet.

## Formål (én linje)

En spiller med en åben fane fra deploy A kan hente A's chunks efter deploy B, så længe A stadig bruges af nogen, uden tvungen genindlæsning; selvhelbredelsen (#5159) er nødnet, ikke plan.

## Ejer-beslutninger (citeret)

- **24/9 kl. ca. 09:05** ([#5162-kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/5162#issuecomment-5809330919)):
  > "Spor 5 bygges som verdensklasse-A: gamle hash-filer bevares på stabilt origin med retention styret af målt alder på aktive klientversioner (ikke fast antal dage), + måling pr. deploy (spor 6) + selvhelbredelsen (#5159) som nødnet. A→B-browserprøve før merge, stopregel < 3 events/døgn over 72 t. [...] Skew Protection forbliver slukket (ejer 11/9). Sentry 24/9: CYCLINGZONE-56 = 12 events / 9 spillere på 16 t (mange deploys i nat)."
- **11/9** (epic-body, proces-afsnit): "Symptom navngives aldrig som rodårsag uden kæden build → HTML → modulreference → HTTP/cache → recovery → faktisk ankomst; tests skal bevise virkning, ikke tilstedeværelse af kode; 'to udgivelser i en rigtig browser' er et obligatorisk leverancebevis."
- **Codex-audit 11/9**, plan 3 (`docs/audits/2026-09-11-codex-audit-chunk-fejl.md:194`): "Bevar gamle assets som den primære driftssikring [...] gamle hash-URL'er fortsat kan findes på samme origin, eller et særskilt stabilt asset-origin med styret retention. [...] En release-mappe i `chunkFileNames` alene bevarer ingen filer på det næste Vercel-deploy. Oprydning skal følge målt alder på aktive klientversioner og en aftalt understøttelsesperiode."

## Hvad der findes i dag (main @ 8c684dc)

| Lag | Status | Hvor |
|---|---|---|
| Stabile chunk-navne ved uændret frontend (spor 2 + rod-årsag) | **bygget**: 0 af 195 chunks roterer på et docs-deploy | `frontend/vite-plugins/skew-defines.js`, CI-job `build-determinism-two-builds` (`.github/workflows/ci.yml:336-381`), `scripts/compare-build-manifests.mjs` |
| Indholds-id til opdateringsbeslutningen (H4) | **bygget** | `frontend/vite-plugins/frontend-content-id.js` (`<meta name="cz-frontend">`, `dist/version.json`), `frontend/src/lib/releaseWatch.js:22-40, 48-58, 78, 108` |
| Reload-koordination (B1 + M1-M3) | **bygget** | `frontend/src/lib/reloadGate.js:29-133` (`useReloadBlock`), `releaseWatch.js` |
| Boot-vagt med build-genereret liste (H2) | **bygget** | `frontend/vite-plugins/boot-assets-manifest.js`, `frontend/public/chunk-selfheal.js` |
| Telemetri for reload attempted/arrived (M4) | **delvist**: `releaseWatch.js` melder om reloadet landede; ingen samlet fejl-pr.-deploy-måling | `releaseWatch.js` (M4-noten), `deploy-verify.yml:402-441` (chunk-fejl-budget 25/døgn, hård grænse 1.000) |
| **Gamle assets efter deploy** | **mangler**: `/assets/(.*)` får `max-age=31536000, immutable` (`frontend/vercel.json:84-88`), og et deploy erstatter hele `dist/`. En chunk fra deploy A svarer 404 på B (audit E2). Asset-miss-proben måler kun at 404 er 404, ikke at A's filer findes | `scripts/check-asset-miss-behaviour.mjs:8-33`, `deploy-verify.yml:309` |
| Skew Protection | **slukket** (ejer 11/9). `__vdpl`-cookien pinner assets, ikke dokumentet, i rigtige browsere | `.claude/learnings/2026-09-04-vercel-vdpl-cookie-pinner-assets-men-ikke-dokumentet.md`, `frontend/vite.config.js:116-125` |

Kilden til hullet er derfor **ikke** kode i appen: det er at Vercel serverer præcis ét builds filer pr. deploy. Alt ovenfor gør fejlen sjældnere og reparerer den; ingenting gør, at A's fil findes efter B.

## Design (verdensklasse-A)

### A. "Carry-forward" på samme origin (anbefalet form af "stabilt origin")

Hvert build tager de tidligere releases' `assets/*` med i sit eget `dist/assets/`, så URL'erne fra A stadig svarer 200 på B **på samme origin** (cyclingzone.org), med de samme immutable-headere, uden CORS, uden `crossorigin` på script-tags, og uden at røre `chunkFileNames`.

1. **Release-lager** (nyt): en privat Supabase Storage-bucket `frontend-release-assets` (samme projekt som prod-DB; service-nøglen findes allerede i Vercel-build-env til `types:gen`? **verificér**, ellers en `SUPABASE_SERVICE_ROLE_KEY`-build-env som Vercel-secret, ejer-oprettet). Pr. release skrives `releases/<cz-frontend-id>/manifest.json` (filnavne + sha256 + byte-størrelse + `built_at`) og selve filerne under `releases/<id>/assets/<navn>`. Hash-navnene er unikke pr. indhold, så to releases der deler en chunk deler også navnet; lageret dedupliker på navn.
2. **Upload efter build** (nyt `scripts/upload-release-assets.mjs`, kaldt sidst i `frontend/package.json:11`'s `build`): læser `dist/version.json` (`frontend`-id) og `dist/assets/`, uploader manglende filer + manifest. Idempotent: findes manifestet, springes over. Fejler uploadet, **fejler buildet** (ellers har det næste deploy intet at bære med, og hullet er tilbage uden at nogen ser det).
3. **Carry-forward før upload** (nyt `scripts/carry-forward-assets.mjs`, kaldt lige efter `vite build` og før `prerender.mjs`): læser `retention.json` fra bucketen (skrevet af punkt 4), henter manifesterne for de releases der er "aktive", og kopierer de filer der mangler i `dist/assets/` ned. Kun `assets/` (hashede filer); `app.html`, `version.json`, `public/` er pr. definition nyeste. Filer der allerede findes med samme navn springes over (samme hash = samme indhold; verificér sha256 én gang pr. fil).
4. **Retention efter målt alder** (nyt `scripts/measure-client-release-age.mjs`, kørt af `deploy-verify.yml` efter hvert prod-deploy og af en daglig cron): måler fordelingen af `cz-frontend`-id'er hos aktive klienter de sidste 7 døgn (kilde: PostHog `$pageview`-properties eller Sentry `release`-tag på events; **vælg PostHog**, fordi Sentry kun ser fejlende sessioner). Skriver `retention.json` = alle release-id'er der er set hos ≥ 1 aktiv klient inden for de sidste `max(72 t, p99-alder + 24 t)`, plus altid de 3 nyeste releases (gulv, så en telemetri-pause ikke tømmer listen). Loft: 30 releases (ops-værn; overskrides det, alarm i Sentry, ikke stille beskæring).
5. **Beviset i CI + deploy-verify:**
   - `build-determinism-two-builds` (`ci.yml:336`) udvides: build B med carry-forward af build A's manifest skal indeholde alle A's assets (kontrakt-test i `scripts/compare-build-manifests.test.mjs`).
   - `scripts/check-asset-miss-behaviour.mjs` får `--carry-forward-of=<manifest-url>`: efter deploy B hentes 5 tilfældige chunk-URL'er fra A's manifest på `https://cyclingzone.org/assets/...` og skal svare 200 med `content-type: text/javascript` (ikke 200 + text/html fra SPA-rewriten, `frontend/vercel.json:45-47`). Kaldes i `deploy-verify.yml:309` ved siden af den eksisterende probe.
   - **A→B-browserprøve (obligatorisk, ejer):** Playwright-spec `frontend/e2e/release-carry-forward.spec.js` mod to rigtige preview-deploys af samme PR (A = PR-head, B = PR-head + tom docs-commit): åbn A-fanen, deploy B, naviger i A-fanen til en route hvis chunk ikke var hentet → chunken hentes fra B og svarer 200 uden reload. Chromium + WebKit. Køres manuelt før merge, resultatet i PR-body.
6. **Måling pr. deploy (spor 6):** `deploy-verify.yml:402-441` udvides fra "chunk-fejl seneste 24 t" til en tabel pr. release: events / aktive sessioner (PostHog) / alder ved fejl. Stopreglen (ejer): **< 3 events/døgn over 72 t** efter det første prod-deploy med carry-forward; ellers standses videre deploys af udgivelses-flowet, og rapporten går til ejeren.

### B. Hvad der bevidst IKKE bygges

- **Ikke** Skew Protection (ejer 11/9). **Ikke** service worker (audit plan 5). **Ikke** et separat CDN-origin: det kræver `crossorigin`-attributter, CORS-headere og ændrer `chunk-selfheal.js`'s URL-liste; samme-origin-carry-forward giver samme garanti uden.
- **Ikke** en release-mappe i `chunkFileNames` (audit: bevarer intet på næste deploy).

## Kodeændringer (fil:linje, i rækkefølge)

1. `scripts/upload-release-assets.mjs` (ny) + `.test.mjs`: manifest-form, dedup på navn, idempotens, fejl = build-fejl. Bucket-navn og sti i én konstant-fil `scripts/lib/releaseAssetsStore.mjs` (ny).
2. `scripts/carry-forward-assets.mjs` (ny) + `.test.mjs`: læser `retention.json`, kopierer manglende filer, verificerer sha256, logger "N filer fra M releases båret videre". Offline/uden nøgle (lokal `npm run build`, CI's markør-build): **springer over med en tydelig loglinje**, fejler ikke (ellers kan ingen bygge lokalt).
3. `frontend/package.json:11`: `"build": "vite build && node ../scripts/carry-forward-assets.mjs && vite build --ssr ... && node scripts/prerender.mjs && node ../scripts/upload-release-assets.mjs"`. Prerender EFTER carry-forward, så `app.html` ikke afhænger af det (det gør den heller ikke i dag).
4. `frontend/vite-plugins/frontend-content-id.js`: indholds-id'et må **ikke** medregne båret-videre-filer (ellers roterer id'et med retention-listen). Filtrér på Rollups eget bundle (allerede sådan: id'et regnes af de emitterede assets, ikke af `dist/`-mappen; **verificér** i testen `frontend-content-id.test.js`).
5. `scripts/measure-client-release-age.mjs` (ny) + `.test.mjs`: PostHog HogQL (`mcp__PostHog__exec` findes til prøven; scriptet bruger PostHog's API-nøgle fra Infisical), skriver `retention.json` til bucketen. Kald fra `deploy-verify.yml` + ny cron-slug `release-retention` i `backend/cron.js` (daglig, read-only mod PostHog, skriv kun til bucketen).
6. `scripts/check-asset-miss-behaviour.mjs:33` + `deploy-verify.yml:309`: carry-forward-proben.
7. `.github/workflows/ci.yml:336-381` + `scripts/compare-build-manifests.mjs`: "B indeholder A".
8. `frontend/e2e/release-carry-forward.spec.js` (ny, manuel før merge, ikke i CI's e2e-shards: kræver to deploys).
9. `docs/DEPLOYMENT.md` (§assets/immutable, ny §"Carry-forward og retention"), `docs/FEATURE_REGISTRY.yml` (område chunk/udgivelse), `.claude/learnings/<dato>-carry-forward.md` ved merge.
10. `frontend/public/locales/*/help.json`: ingen ændring (spilleren ser ingen forskel; L1's beskrivelse af slutadfærden hører til PR-body + `docs/DEPLOYMENT.md`).

## Tests

- `scripts/upload-release-assets.test.mjs`: manifest-form; eksisterende manifest = no-op; upload-fejl kaster.
- `scripts/carry-forward-assets.test.mjs`: filer fra 2 releases kopieres, dublet-navn springes over, sha256-mismatch kaster, uden nøgle = spring over + log.
- `scripts/measure-client-release-age.test.mjs`: p99-beregning, gulv 3 nyeste, loft 30 + alarm, tom telemetri giver kun gulvet.
- `scripts/compare-build-manifests.test.mjs`: "B ⊇ A's assets".
- `scripts/check-asset-miss-behaviour.test.mjs`: 200 + text/html regnes som FEJL (SPA-rewrite), 200 + text/javascript som OK.
- `frontend/vite-plugins/frontend-content-id.test.js`: id'et ændrer sig ikke når `dist/assets/` får ekstra filer.
- Manuel A→B (punkt 5) + 72 t-måling (punkt 6) er merge-gaten, ikke en unit-test.

## Risici

1. **Build-størrelse og Vercel-loft.** 30 releases × ca. 200 chunks kan give tusindvis af filer i `dist/assets/`. Mål efter første uge: er p99-alderen < 72 t, er listen typisk 3-6 releases. Vercels grænse for antal filer pr. deploy skal slås op før byg (ingen evidens her).
2. **Nøgle i Vercel-build.** Upload kræver en skrive-nøgle til bucketen i Vercels build-env. Ejeren opretter den (hard rule: Claude håndterer aldrig nøgler). Uden nøgle: lokalt build virker (punkt 2), prod-build FEJLER bevidst.
3. **Første deploy efter merge bærer intet** (der findes endnu ingen manifester). Derfor: merge → første deploy skriver kun manifest → først det andet deploy beskytter det første. Stopreglen måles fra det andet deploy.
4. **Telemetri-hul.** Er PostHog nede, holder gulvet (3 nyeste) listen i live; alarm ved tom måling.
5. **Retention må ikke blive et fast tal.** Ejerens ord: "ikke fast antal dage". Gulvet på 72 t er et ops-værn, ikke reglen; reglen er p99 + 24 t.
6. **Samspil med #5159's reload-politik:** når gamle chunks findes, skal `releaseWatch.js` fortsat kun opdatere ved sikkert punkt; carry-forward gør et udskudt reload ufarligt, det fjerner ikke banneret.
7. **Golden-diff af prerender:** `app.html` må ikke ændre sig af carry-forward (test i punkt 4).

## Spor-opdeling (parallelt, uden fil-overlap)

| Spor | Filer (eneste ejer) | Afhænger af |
|---|---|---|
| **K1** lager + upload | `scripts/lib/releaseAssetsStore.mjs`, `scripts/upload-release-assets.mjs` (+ test), `frontend/package.json` (kun `build`-linjen), `docs/DEPLOYMENT.md` | ejerens bucket + build-nøgle |
| **K2** carry-forward | `scripts/carry-forward-assets.mjs` (+ test), `frontend/vite-plugins/frontend-content-id.js` (+ test), `scripts/compare-build-manifests.mjs` (+ test), `.github/workflows/ci.yml` (kun `build-determinism-two-builds`) | K1's manifest-form (kan stubbes) |
| **K3** retention-måling | `scripts/measure-client-release-age.mjs` (+ test), `backend/cron.js` (ny slug), `.github/workflows/deploy-verify.yml` (kun retention-trin) | K1 |
| **K4** bevis + måling pr. deploy | `scripts/check-asset-miss-behaviour.mjs` (+ test), `.github/workflows/deploy-verify.yml` (kun probe + chunk-fejl-tabel), `frontend/e2e/release-carry-forward.spec.js` | K2 i prod (preview-deploys) |

Ingen af filerne overlapper med S4-sporene (kalender, træning, ungdom, struktur) eller motor-runde 2. K3 og K4 rører begge `deploy-verify.yml` i forskellige trin: K4 merges efter K3, og rebaser.

## Ejer-port før byg

1. Bucket + nøgle (K1). 2. Valg af telemetri-kilde (anbefaling: PostHog). 3. Bekræft gulv 72 t / loft 30 som ops-værn. 4. Timing: efter S4-sporene (ejer 24/9).
