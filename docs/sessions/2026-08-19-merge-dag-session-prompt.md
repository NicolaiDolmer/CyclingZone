# Session-prompt: Merge-dag 19/8 (trin 7-udrulning + PR-koeen)

> Skrevet 18/8 sent aften som handoff fra spilleroplevelses-sessionen. Ejerens bestilling:
> "det vigtigste foerst, faa merget nogle af de PR'er vi har liggende, verdensklasse og
> grundigt testet". Loen-sessionen (#3393/#3449, prompt i 2026-08-19-loen-design-session-prompt.md)
> og kalender-sessionen (#3862) har EGNE bookinger og fortraenges ikke - denne session
> forbereder dem kun (rebase/konflikt-status), den designer ikke.

Laes docs/NOW.md foerst. Alt trin 7-arbejde ligger faerdigt og CI-groent; sessionen aabner
med ejerens test og koerer derefter merge-kaeden helt i maal, foer den roerer noget andet.

## Blok 1: Trin 7 i maal (PR #3798) - dagens vigtigste

Status fra 18/8: PR'en er rebase't paa main, HELT CI-groen (inkl. 3 vagt-fejl og 1 aegte
spec-fejl fanget og fikset ved roden), fuld lokal suite koert (backend 6301, frontend 2187,
e2e 505, preflight). Overgangs-designet er ejer-godkendt som mockup og verificeret paa
AEGTE data: loft ved siden af prognosen (hero-sub, scouting-loftmaerker, tooltips) +
engangspanel paa dashboardet med holdets egne loft foer/nu + prognose.

1. **Ejer-test.** Lokal staging m. aegte branch-data: start launch-configs `staging-backend`
   (:3001) + `staging-frontend` (:5173) hvis de ikke koerer (worktree
   C:/Dev/CyclingZone-worktrees/3746-trin7, Supabase-branch staging-3746-trin7, backfill
   allerede koert der). Ejeren logger ind med egen konto; testkonto:
   trin7-tester@staging.cyclingzone.invalid / Trin7-Staging-2026 (holdet "AI Slipstream
   Continental 2", 12 ryttere, alle lofter haevet). Delbart link:
   https://web-production-aea1d.up.railway.app venter kun paa ejerens to `railway up`-
   kommandoer (staar i chatten 18/8; Railway-projekt cz-staging-3746 er faerdigkonfigureret,
   klassifikatoren blokerer agent-deploys). Under testen: spoerg om #3803's delvalg
   (omdoeb "Potentiale pr. ryttertype"-overskriften til prognose-sprog, 2 min).
2. **Merge ved go.** Verificer merge med `gh pr view 3798 --json mergedAt` OG laes
   indholdet paa main (laerestreg 15/8). Flip labels paa #3746/#3794/#3788/#3787/#3651/
   #3679/#3714/#3785 per #3803 punkt 4.
3. **Migration:** database/2026-08-18-3746-dev-transition-dismiss.sql applies post-merge
   (idempotent, #2642-rammer, post-verify i filens header).
4. **Backfill (#3803 punkt 2):** `node backend/scripts/dev/lofterApply3746.mjs` dry-run
   mod prod -> VIS TALLENE TIL EJEREN -> foerst ved hans ja: `--apply --jeg-har-set-dry-runnet`.
   Backup-tabel verificeres foer skrivning; rollback-SQL ligger i
   database/2026-08-16-3746-recompute-ability-caps.sql. OBS: brug det aerlige tal
   4.247 pladser/2.134 ryttere over nyt loft, ikke designmaalingens 894/553.
5. **Voksen-baseline-refit (#3803 punkt 3):** `node backend/scripts/fitRiderTypesBaseline.js --caps`
   mod de NYE prod-caps, commit riderTypesBaseline.json.
6. **Verifikation i prod:** engangspanelet aktivt for et rigtigt hold (ejerens egen konto),
   loft-visningen paa profil/scouting, ingen 500'er i Railway-loggen, Sentry stille.
7. **Kommunikation:** ejeren poster docs/discord/2026-08-16-trin7-potentiale-fart.md
   (omskrevet 18/8 til loft-mod-loft, ingen medianer - panelet viser aegte tal).
   Patch 7.145 + help er allerede i PR'en.
8. **Oprydning:** Supabase-branchen staging-3746-trin7 + Railway-projektet cz-staging-3746
   slettes FOERST naar ejeren siger at staging-testen er faerdig (koster penge at lade koere).

## Blok 2: PR-koeen (efter trin 7 er i maal)

- **#3959** (withSupabaseRetry paa achievements + races/distribution, 525-blip): lille og
  ikke-UI. Verificer scope mod #3953, koer targeted tests, merge hvis CI groen.
  Merge-gaten gaelder: var problem+loesning aftalt? (525-blippen er kendt driftsstoej -
  tjek issuet; ellers vis ejeren foerst.)
- **#3862 kalender-pakken (draft):** roeres IKKE her ud over rebase-tjek - den hoerer til
  kalender-sessionen (bufferdag 24/8 er besluttet, regenerering skal koeres der).
- **#3393 + #3449 (drafts, loen-sporet):** BEGGE staar CONFLICTING/uafklaret. Rebase dem
  mod main saa loen-sessionen starter rent, men ingen design-beslutninger - de hoerer til
  loen-prompten (niveau-korrektionen "koerende x 0,422" er sessionens aabning).
- **#3512 (draft, CONFLICTING, arketype-prior):** forelaeg ejeren A/B: genopliv (rebase er
  stoerre) eller park (luk draft, behold branch). Anbefaling afhaenger af om
  launch-populationen stadig er planlagt foer S3-cutover - tjek #3458-traaden foerst.
- **Smaa Blok 3-rester fra spilleroplevelses-prompten** hvis der er luft: #3944/#3945/#3956
  (mobil-sortering + popularitet) som EEN lille boelge; #3952 radius-eksempler (KUN
  foer/efter-screenshots, ingen boelge uden ejer-go).

## Regler (uaendrede, men de bider)

Een beslutning ad gangen med anbefaling. Merge-gate = forudgaaende enighed; UI merges
ALDRIG uden ejer-visuelt go. Fuld lokal suite foer push ved TIER FULL; `node --test` i
frontend er obligatorisk; lint foer frontend-push. Loop-guard: 2 CI-fails samme symptom
-> stop og spoerg. Migrationer applies post-merge (idempotent + post-verify). Patch notes
+ help ved alt spillervendt. Ingen em-dash i spillervendt copy. Verificer tal mod prod
foer de bruges i beskeder. Close-out: NOW.md (budget!), labels, token-hygiejne.
