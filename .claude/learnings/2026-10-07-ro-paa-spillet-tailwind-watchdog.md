# 2026-10-07 · Ro på spillet, Tailwind 4 live, watchdog-markør, roadmap-stemmer

## Hvad gik godt
- **To uafhængige reviews fandt hver sin ting.** Claudes 9-punkts-review + pixel-sammenligning missede afstandsregressionen (16 → 4 px på handelsfanen); Codex' review fandt den. Rettelsen blev generel (`restoreV3Space` for alle `space-x/y`), ikke to kaldsteder. Tailwind 4 gik live uden nye Sentry-fejl.
- **Spillerklager → data → prioritet.** Klage-analyse (91 aktive, 14 dage) + Discord-sweeps gav "Ro på spillet" og konkrete issues; kendte fejl (21 rækker) og roadmap blev synket samme dag.
- **Dag 2-faldet var et målebrud** (`users.last_seen` overskrives); robust D2 viste 43-50 % de seneste uger. Mål før man jagter et tal.

## Hvad gik galt
- **Migration omdøbt, markør ikke fulgt med.** Ved forfremmelse `proposals/2026-10-04-…` → `database/2026-10-07-…` pegede `WATCHDOG_RESULT_MIGRATION` stadig på det gamle navn; watchdogen stoppede fail-closed i ~1 time (Sentry CYCLINGZONE-97 + Discord-heartbeat). Regel: ved omdøbning af en migration, grep det gamle filnavn i hele repoet. Ny test: markøren skal navngive en fil der findes (#6317). Merge-køen skal vente på cron check-in efter backend-merge (#6318).
- **Ejeren sendt ud i Vercel-env uden at tjekke den nemme vej.** Branch fandtes ikke på GitHub endnu; en tidligere variabel uden branch-scope ville have ramt alle previews. Lokal A→B-prøve med `CZ_RELEASE_ASSETS_LOCAL_DIR` krævede intet af ejeren. Regel: tjek først om et manuelt ejer-trin kan undgås; giv altid fulde trin + direkte links i selve beskeden.
- **Roadmap-hubben (4/10) oprettede nye punkter uden at flytte stemmerne** fra de skjulte gamle; spillere blev spurgt igen og troede, de ikke blev hørt (#6324).
- **Baggrunds-ventetråde hang** (ventede på noget der allerede var sket). Brug korte, selvafsluttende ventetjek.
