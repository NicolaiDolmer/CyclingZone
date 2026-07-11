# 2026-07-11 — loans.last_interest_season_id: FK-hul fanget af audit-gaten (og hvorfor den virkede)

## Hvad skete
PR #2338 (#1895 ugerytme) fejlede CI-jobbet `audit` (reset-FK). Fejlen var IKKE PR'ens:
`loans.last_interest_season_id → seasons` (NO ACTION, fra rente-påløbs-arbejdet i v6.83-toget,
PR #2333-perioden) manglede både null-håndtering i `resetBetaSeasons` og entry i
`BLOCKING_FK_BASELINE`. Enhver PR der triggede auditen var rød, og en beta-reset ville
være væltet på FK-constraint ved sæson-delete.

## Rod-årsag
Rente-migrationen tilføjede en ny nullable season-FK på `loans` uden at røre
betaResetService — præcis crash-klassen fra 18/6-relaunchen. Forward-guarden
(audit-reset-fk-coverage.js, #1464-sporet) fangede den som designet; den bed bare først
da en senere PR triggede jobbet, ikke i den PR der introducerede kolonnen.

## Fix
PR #2340: null-before-delete i `resetBetaSeasons` (samme mønster som `loans.season_id`,
#2301) + baseline-entry.

## Læring / forward-guard
1. **Auditen virker** — dette er anden gang loans-FK-klassen fanges maskinelt, nul prod-skade.
2. **Hul:** audit-jobbet kører kun på PR'er der matcher dets path-filter — migrations-PR'en
   der TILFØJEDE kolonnen slap igennem uden at trigge den. Overvej at udvide workflow-triggeren
   til `database/**` (enhver ny .sql) så fejlen lander i den PR der skaber den, ikke en tilfældig
   senere PR.
3. Stacked-PR-mekanik: pre-eksisterende main-fejl skal fixes i egen lille PR mod main og
   merges IND i feature-branchen — ikke lappes i feature-PR'en (så holder begge grønne).
