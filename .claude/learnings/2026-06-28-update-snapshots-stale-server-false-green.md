# `--update-snapshots` + reused stale server = false-green baseline

**Dato:** 2026-06-28
**Kontekst:** Fix af pre-eksisterende frontend-smoke-fejl (calendar + race-hub specs ude af sync med shippet UI, PR #1959).

## Hvad skete der

Efter at have rettet stale locators i `calendar.spec.js` regenererede jeg snapshots med
`npx playwright test calendar.spec.js --update-snapshots`. Den rapporterede **27 passed**,
og en efterfølgende ren kørsel var også grøn. False-green.

Den committede baseline var stadig fra **#1945** (gammel `<div role="group">`-rendering med
"din leder"/"N etaper"), mens koden på disk var **#1946** (per-etape `<Link>`). En **orphaned
preview-server** fra en tidligere kørsel kørte stadig på worktreens hash-afledte port, og
`webServer.reuseExistingServer: true` (lokalt) genbrugte den i stedet for at bygge frisk.
`--update-snapshots` sammenlignede den nye render mod den gamle baseline → "matchede" →
PNG'erne blev aldrig genskrevet (mtime = checkout-tid, git-rene).

I CI (`reuseExistingServer: false`, frisk build) ville snapshot-testen have fejlet med pixel-diff.

## Hvordan det blev fanget

**Visuel inspektion** af det "regenererede" snapshot: det viste "din leder" — tekst koden
ikke længere producerer (og hvis i18n-nøgle jeg netop havde slettet). Den umulige tilstand
(link-assertions passerede = ny kode, MEN render = gammel) afslørede at serveren ikke var den
build jeg troede.

## Forward-guard

1. **Ved snapshot-regenerering: tving frisk server.** Brug en isoleret `PW_PORT` der
   garanteret er ledig (intet at genbruge), ELLER bekræft ingen lytter på worktree-porten først.
   `PW_PORT=<ledig> npx playwright test <spec> --update-snapshots`.
2. **Verificér det regenererede snapshot visuelt** før commit — `--update-snapshots` der
   rapporterer "passed" beviser IKKE at PNG'en blev skrevet. Tjek `git status` + mtime; en
   uændret PNG efter `--update` betyder render matchede den GAMLE baseline.
3. Den eksisterende worktree-identity-guard (`checkWorktreeIdentity`) fanger kun *cross*-worktree
   reuse, ikke *same*-worktree *stale-build* reuse. Den dækker ikke dette hul.

Cluster: false-green via delt/genbrugt server — bidt 2026-05-31, 2026-06-10, #536, #1342.
