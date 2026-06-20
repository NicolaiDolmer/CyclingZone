# Onboarding / første-oplevelse audit — 2026-06-20

> Natbølge-audit (forever-relaunch retention): 4 scannere over nye-spiller-rejsen (signup → team → første trup → første spil-loop) + synthesis. Fund verificeret mod faktisk kode (LoginPage, SetupWizardModal, OnboardingModal/ProgressCard/Tour, DashboardPage, RidersEmptyState, teamProfileEngine, starterSquadAllocator, api.js) + prod. Auditten overdrev på flere punkter (fx "tre kritiske localStorage-bugs") — kun det verificerede er medtaget.

## Bundlinje

Rejsen er IKKE en smooth pipeline — den har **ét reelt, arkitektonisk dead-end (R1)** plus 2-3 ægte forvirrings-punkter, fordi onboarding-UI'et er bygget til relaunch-managere (der FÅR en trup), ikke til nye spillere der signer op bagefter. **Størstedelen af retention-værdien ligger i ÉN backend-fix (R1), som er Railway-deploybar nu.**

## R1 — Nye hold får INGEN starttrup → tom-trup dead-end [KRITISK · backend · #1560]

Det vigtigste fund i hele natbølgen. Verificeret mod kode + prod. **→ sporet som #1560 med fuld fix-retning.** Kort: `PUT /api/teams/my` allokerer ingen ryttere; `runStarterSquadAllocation` kører kun ved relaunch. Næste nye signup efter relaunch sidder fast i en købs-cirkel. Ikke aktivt live (alle 22 nuværende hold har 8 ryttere fra relaunch), men hård forever-relaunch-blocker.

## Øvrige retention-risici (mest frontend → venter Vercel-reset)

| # | Fund | Fil:linje | Type |
|---|------|-----------|------|
| R2 | Signup-success sender til login selvom brugeren ALLEREDE er logget ind (session findes); copy "check email to confirm" kan være misvisende | `LoginPage.jsx:247-283`, `supabase.ts:15` | dead-end/friktion, frontend. **Ejer-spørgsmål: er email-confirm slået TIL eller FRA i Supabase Auth?** Det afgør om det er redundant copy eller et ægte ekstra skridt. |
| R3 | OnboardingProgressCard kan dismisses PERMANENT (localStorage) — luk ved uheld dag 1 = guide væk for altid | `DashboardPage.jsx:80-81,294,411` | friktion→dead-end, frontend. Fix: vis igen så længe `completed_count < total_count`. |
| R4 | Onboarding-narrativ "køb din første rytter" matcher ikke virkeligheden (relaunch-managere FÅR trup; post-launch-signups rammer R1-cirklen). `RidersEmptyState` tjekker ikke om markedet har købbare ryttere | `OnboardingModal.jsx:5-9`, `RidersEmptyState.jsx:66` | forvirring, frontend-copy. Beting tom-tilstande på squad-state (efter R1 løst). |

## Tomme tilstande der mangler guidance

- **T1** Marked tomt → CTA filtrerer en tom liste, ingen "markedet åbner snart"-variant (`RidersPage.jsx:367`). Lav-med (mest relevant hvis R1 ikke løses).
- **T2** Ingen "første løb"-timeline prominent på Dashboard; nye spillere ved ikke hvornår de kan stille op / at 8 ryttere kræves. Polish.
- **T3** Ingen post-setup success-bekræftelse (`SetupWizardModal.onComplete:52` redirecter uden toast). Billig at fikse.

## Små friktionspunkter (polish)

- **F1** maxLength-inkonsistens: LoginPage team 30 / manager 50 vs SetupWizardModal 40 på begge (`LoginPage:300,317` vs `SetupWizardModal:83,96`). Backend håndhæver kun min-længder.
- **F2** `signupPartial`-copy ved 5s-timeout antyder ufærdig signup selvom holdet typisk ER oprettet (`LoginPage:162-170`). Hæv timeout + blødere copy.
- **F3** Bootstrap-5xx viser generisk "kunne ikke initialiseres" selvom kontoen findes (`LoginPage:188-192`). Differentiér + log til Sentry.
- **F4** Email/password-realtidsvalidering, ingen confirm-password — konventionelle små-ting.

## Solidt (ros)

SetupWizardModal er et rent, fokuseret 2-trins flow; OnboardingProgressCard giver konkret step-guidance med deep-links; signup bootstrapper holdet med aktiv session (ingen dobbelt-login teknisk nødvendig — kun copy'en fejler); NextActionsCard-konceptet er godt.

## Anbefaling

1. **R1 (#1560) — løs før forever-relaunch.** Eneste arkitektoniske dead-end; Railway-deploybar; men balance-følsom (#1487) → ejer + simulér-før-ship.
2. R2-R4 + T1-T3: saml i ét "onboarding-polish"-issue når Vercel-deploy er tilbage (mest frontend). Afklar R2's email-confirm-spørgsmål.
3. F1-F4: lavest prioritet.
