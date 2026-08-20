# Session-prompt: Udrulning af den store udviklings-opdatering (fortsættelse af merge-dagen 19/8)

> Skrevet 19/8 aften som handoff. Ejeren besluttede 19/8 at trin 7 (PR #3798) bundles med
> hele #3721-pakken og skibes som ÉN stor opdatering, GENNEMTESTET af betatestere først.
> Testerne er inviteret ind på det delte staging-link og kigger nu. Denne session åbner
> med tester-feedback og kører derefter udrulningskæden helt i mål.

Læs docs/NOW.md først. Branchen feat/3746-trin7-potentiale-som-fart (worktree
C:/Dev/CyclingZone-worktrees/3746-trin7) bærer HELE bundlet, commit 66e301d58:
trin 7 (lofter+prognose+engangspanel) + udrulnings-komms (prognose-overskrift #3803,
indbakke-script notifyTransition3746.mjs #3980) + #3721 (træningssidens 3 faner m.
Development-glyf-fane, holdsidens Development-tabel, profil-dedup) + main-merge 19/8
+ gate-fixes (bundle-budget 880->890 dokumenteret, level-correction-tabeller flag-gated).

Fuld verifikation kørt 19/8: backend 6.560 ✓, frontend 2.219 ✓, e2e 520 ✓ (mobil-/team-
snapshots refreshed pga. ny fane, legitimt), lint/build/i18n ✓, patch note 7.148 valideret.
Screenshots i pr-screens/3721-*.png. Staging (Railway cz-staging-3746) kører bundlet:
https://web-production-aea1d.up.railway.app - testkonto trin7-tester@staging.cyclingzone.invalid.

## Blok 1: Tester-feedback + ejerens to udestående svar

1. **Triagér testernes feedback** (ejeren paster DM'er / læs Discord-sweep). Fund på
   staging kan rettes på branchen FØR merge - det er hele pointen med gennemtesten.
2. **Ejerens udestående svar** (spurgt 19/8, ubesvaret ved close-out):
   a) Visuelt go på screenshot-pakken (7 billeder sendt i sessionen).
   b) Weekly rhythm-panelet: W1 flyttede det ned under rapporten i stedet for at slette
      (det er en ægte ugeplan-editor, ikke FAQ - deviation flagget). OK eller helt væk?
3. Tjek CI på #3798 er helt grøn efter gate-fix-pushen (66e301d58). To fails var kendt
   klasse: main var selv 2,8 KB over bundle-loftet, og liveness-auditen flagede #3449's
   bevidst tomme gate-tabeller - begge fikset ved roden i bundlet.

## Blok 2: Merge + udrulningskæden (ved ejer-go, i ét stræk)

1. **Merge #3798** (squash). Verificér med `gh pr view 3798 --json mergedAt` OG læs
   indholdet på main. Flip labels på #3746/#3794/#3788/#3787/#3651/#3679/#3714/#3785
   per #3803 punkt 4; #3721/#3979/#3980 kommenteres/lukkes efter verifikation.
2. **Migration:** database/2026-08-18-3746-dev-transition-dismiss.sql post-merge
   (idempotent, #2642-rammer, post-verify i headeren).
3. **Backfill (#3803 punkt 2):** `node backend/scripts/dev/lofterApply3746.mjs` dry-run
   mod prod -> VIS TALLENE TIL EJEREN (ærligt tal: 4.247 pladser/2.134 ryttere over nyt
   loft) -> først ved hans ja: `--apply --jeg-har-set-dry-runnet`. Backup-tabel
   verificeres før skrivning; rollback i database/2026-08-16-3746-recompute-ability-caps.sql.
4. **Voksen-baseline-refit (#3803 punkt 3):** `node backend/scripts/fitRiderTypesBaseline.js
   --caps` mod de NYE prod-caps, commit riderTypesBaseline.json.
5. **Indbakke-besked (#3980):** `node backend/scripts/dev/notifyTransition3746.mjs` dry-run
   mod prod -> vis modtagertal -> ved ja: `--apply`. Idempotent via titleCode-lookup.
6. **Prod-verifikation:** engangspanel på ejerens egen konto, loft-visning profil/scouting/
   holdside, de nye faner, ingen 500'er i Railway-loggen, Sentry stille.
7. **Kommunikation:** ejeren poster docs/discord/2026-08-16-trin7-potentiale-fart.md
   (verificér den stadig matcher det shippede - #3721-fladerne kan fortjene en linje).
8. **Oprydning NÅR ejeren melder testen færdig:** Supabase-branch staging-3746-trin7 +
   Railway-projekt cz-staging-3746 slettes (koster penge). IKKE før.

## Blok 3: resten af køen (efter kæden)

- **#3512 A/B (arketype-prior, CONFLICTING draft):** genopliv vs. parkér - NY vinkel:
  kør scorecardet om mod den NYE baseline fra refit-trinnet før valget (rod-årsagen bag
  dens gate-fejl var baseline-fittet). Forelæg ejeren med tal.
- **#3985** (etapetype væk fra etape-faner, plausibel #3914-regression) - lille fix-kandidat.
- **#3981** (digest-mail-forskydning) - investigation, spiller-screenshots i #dansk-snak 19/8.
- Småbølge #3944/#3945/#3956 hvis luft; #3952 radius-eksempler KUN med ejer-go.

## Regler (de der bed i dag)

Én beslutning ad gangen m. anbefaling; kontekst IND i beslutningskortet. UI merges ALDRIG
uden ejer-visuelt go. Ejer-kommandoer = PS 5.1 (`;`, `C:\`-stier). DA-udkast ALTID med æøå.
Migrationer post-merge (idempotent+verify). Prod-mutationer: dry-run -> tal -> ejer-go ->
apply -> uafhængig verify. Discord-guard-klassen: start ALDRIG staging-backend uden at
verificere guard + webhook-nulling (#3961). Worker-prompter: verificér filmål og læg
ejer-beslutninger i issue-KOMMENTARER før spawn (W2 afviste to gange på stale kilder - korrekt).
Close-out: NOW.md (budget!), labels, token-hygiejne, baggrundsprocesser NED.
