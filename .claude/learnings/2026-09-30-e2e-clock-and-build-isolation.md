# #5960: Isolér build og snapshot-testens tid

- Den første fulde e2e-kørsel endte med 1444 beståede, 171 deklarerede skips og 41 fejl under samtidig lokal verifikation.
- Et frontend-build og e2e-serveren delte samme worktrees dist-mappe. Det var et forkert overlap; build og browserverifikation skal køre sekventielt i samme worktree.
- En genkørsel af kun fejlene med én worker bestod 40 tests og efterlod én stabil dashboard-snapshot-afvigelse.
- Den resterende fejl var positivt sporet til vægur-tiden: seedData har en etape 30/9, og dashboardets dato-filter aktiverede kortet efter midnat.
- core-smoke-fixturen stabiliserede locale/CSS, men ikke datoen. Testen fryser nu datoen før login. Golden-billeder og masks er urørte.
- Verifikation: den ændrede snapshot-test bestod desktop-chromium, mobile-chromium og mobile-webkit. Den fulde verify-local og preflight bestod; den endelige preflight genkøres før push.
- Aktiv-dato/holdklassement dækkes fortsat af de særskilte tests, authenticated read-only DB-bevis og isolerede UI-billeder. Den generiske snapshot-fixture skal ikke foregive den dækning.
