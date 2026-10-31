# Valgkort #3984: samlet indstillings-område + nationalitet

Mockup: [`mockup-3984-indstillinger.png`](mockup-3984-indstillinger.png) (kilde: `mockup-3984-indstillinger.html`).
Løfte: direktivet 19/8, nævnt i roadbooken 15/9, planlagt 5/10 (roadmap Next).

## Problemet i én sætning

Du vil have ét sted til manager, ét til hold og ét til almindelige indstillinger, og du vil kunne vælge land for både manager og hold, men i dag er indstillingerne delt i fem faner der ikke følger de tre områder, og der findes slet ikke noget land på manager eller hold.

## Hvad der allerede er aftalt (genåbnes ikke)

- Indstillinger ligger på `/profile` og er allerede delt i faner (#5402, direktiv 18/9): Konto, Notifikationer, Præferencer, Privatliv, Beta. Fanerne bliver. Spørgsmålet er kun hvilke sektioner der bor hvor.
- Siden følger skabelon T1 (`docs/design/PAGE_TEMPLATES.md`).
- Nationalitet vælges af spilleren selv for både manager og hold (#1108 er lukket som dublet af dette issue).
- Bestyrelsen skal "på længere sigt" huske landet. Designet af hvordan bestyrelsen bruger det hører hjemme i #1239 (Board-DNA v2), ikke her.
- Placeringen skal følge menu-audittens struktur (#3104).

## Hvad der findes i koden i dag

- `teams` har `manager_name` og holdnavn. Der er ingen kolonne for land på hverken manager eller hold.
- Landelisten findes i `countries` (nøgle `iso2`, danske og engelske navne), og `Flag`-komponenten kan tegne flag.
- Sektionerne bor i `frontend/src/lib/settingsTabs.ts` (`SETTINGS_SECTION_TAB`), så en omlægning er en kort ændring af den tabel plus tekster.

## To muligheder

**A. Tre områder: Manager, Hold, Generelt (+ Beta).** Fanerne omdøbes og sektionerne flyttes, så de matcher dit direktiv. Landevalget bor i Manager (managerens land) og Hold (holdets land).

- Manager: brugernavn, e-mail, "Skift adgangskode" (et link til den eksisterende `/reset-password`-flow; profilsiden har i dag ingen adgangskode-kontrol), managernavn, managerens land, Discord, abonnement.
- Hold: holdnavn, holdets land, assistent.
- Generelt: notifikationer, udseende og sprog, privatliv.
- Gamle links (`?tab=account`, `?tab=notifications` og ankre som `#discord`) skal blive ved at virke.

**B. Behold de nuværende faner, tilføj kun landevalget.** To nye felter i Hold-kortet på Konto-fanen. Resten står som i dag, og omlægningen venter til menu-auditten (#3104).

## Anbefaling: A

Det er det du bad om, og det er næsten gratis at bygge nu, fordi fanerne og linkene allerede findes og kun skal flyttes. B giver landevalget hurtigt, men lader strukturen stå, og så skal vi flytte det samme to gange. Bestyrelses-koblingen er i begge tilfælde et separat, senere skridt.

## Byg-plan A (samme dag)

Ét spor, ingen flag nødvendigt (landene er ren lagring og påvirker ikke spillet endnu).

1. Migration (additiv, ikke destruktiv, apply efter merge jf. #2642): to kolonner på `teams`, `manager_nationality_code` og `team_nationality_code`, begge nullable og med fremmednøgle til `countries(iso2)`. Opdatér `database/schema-snapshot.json`.
2. Backend: `/api/teams/my` (PUT) tager imod de to felter og validerer mod aktive lande. Test i `backend/`.
3. `frontend/src/lib/settingsTabs.ts`: nye faner `manager`, `team`, `general`, `beta`; ny `SETTINGS_SECTION_TAB`; en kort tabel der oversætter gamle `?tab=`-værdier til de nye. Kendte ankre (`#discord` m.fl.) afgør fanen før den oversatte gamle `?tab=`, så et kombineret link som `/profile?tab=notifications#discord` (fra `DashboardPage.jsx`) åbner Manager-fanen og ruller til Discord. Alternativt opdateres det interne link i samme PR. Opdatér testen med netop det kombinerede link.
4. `frontend/src/pages/ProfilePage.jsx`: flyt kortene mellem `TabPanel`s; to landevælgere (søgbar liste med `Flag`, danske og engelske landenavne via `countryUtils`); et "Skift adgangskode"-link i Manager-fanen der sender en nulstillingsmail (samme kald som `LoginPage.jsx`'s `resetPasswordForEmail`) og fører til den eksisterende `ResetPasswordPage.jsx`. Ingen ny adgangskode-logik. Brug kun eksisterende primitiver (`Card`, `Field`, `Tabs`).
5. Tekster: `frontend/public/locales/{da,en}/profile.json` (fanenavne, "Managerens land", "Holdets land").
6. Ikke med: bestyrelsen læser landet. UI-teksten må ikke love det, før #1239 er bygget.
7. Patch note EN + DA samt en linje i `help.json`, ved close-out.
8. Verifikation: TIER FULL (migration + delt side): `scripts/verify-local.ps1`, backend-test af `PUT /api/teams/my` (gyldigt land gemmes, ukendt land afvises, tomt felt nulstiller), `settingsTabs`-testen (gamle `?tab=`-links lander rigtigt), hele `npm run test:e2e` og snapshots i alle tre Playwright-projekter. **Ejeren ser på preview (Android):** de tre faner, at landevalget gemmes og vises med flag, at "Skift adgangskode" sender mailen, og at gamle links som `/profile?tab=notifications` og `/profile?tab=notifications#discord` stadig åbner det rigtige sted.

Berørte filer: én migrationsfil, `backend/routes/api.js`, `settingsTabs.ts` (+ test), `ProfilePage.jsx`, to `profile.json`, schema-snapshot.

## Byg-plan B (samme dag)

Samme migration, backend og landevælger som A, men trin 3 udgår og trin 4 flytter ikke noget: de to felter lægges i Hold-kortet på Konto-fanen. Mindre diff, ingen link-oversættelse.

## Hvad der ikke er afklaret og ikke afgøres her

Hvad bestyrelsen skal bruge landet til (mål, præferencer, rytterrekruttering). Det er et selvstændigt designkort under #1239.
