# Side-mount racer asynkron bootstrap — tomt spil ved allerførste login (#2102)

**Dato:** 2026-07-02 · **PR:** #2107 · **Ramte:** Team CSC (samme spiller som #2104)

## Hvad skete

#2069 flyttede hold-oprettelse fra SetupWizard-modal (blokerende) til en stille
auto-bootstrap i Layout's session-effekt. Men `<Outlet/>` renderer med det samme,
så DashboardPage mountede parallelt, fandt intet hold i sin egen fetch
(`if (!teamData) return;` — bailer stille, refetcher aldrig; realtime dækker kun
seasons/race_results) og stod tomt resten af sessionen. Topbaren (Layouts egen
state) viste holdnavn+saldo → "holdet findes men spillet er tomt".
Prod-timing: confirm 14:19:13Z → team-række 14:19:15.5Z — Dashboardets query
ramte i det ~2 sekunders vindue.

## Læringer (generaliserbare)

- **Flytter man en blokerende setup-modal til en stille baggrunds-bootstrap,
  arver man ALLE de mount-races modalen skjulte.** Modalen var også en barriere:
  intet mountede før holdet fandtes. Fjern barrieren → find hver side der
  antager "holdet findes ved mount".
- **Engangs-fetch + stille bail (`if (!data) return;`) er en tidsindstillet
  fælde** i sider der kan mounte før deres forudsætning findes. Enten refetch
  ved forudsætnings-ændring, eller garantér forudsætningen før mount.
- Fixet her er bevidst det mindste: én hård reload efter succesfuld bootstrap
  (kun splinternye brugere, én gang, sessionStorage-guard mod loop). En
  team-context med suspense var pænere men rører alle ruter.

## Forward-guards

- sessionStorage-guard (`cz-bootstrap-reloaded`) gør et reload-loop umuligt
  selv hvis teamData-læsning fejler mens PUT-upsert lykkes.
- Relateret postmortem samme dag: [2026-07-02-global-season-clock-vs-new-team-grace.md]
  (#2104 — samme spiller, samme onboarding-session, to uafhængige klasser af fejl).
