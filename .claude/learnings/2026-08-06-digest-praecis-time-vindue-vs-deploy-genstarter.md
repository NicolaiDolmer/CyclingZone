# Digest-gate på præcis time + interval-nulstilling ved deploy = hel dag sprunget over

**Dato:** 2026-08-06 · **Feature:** Discord-race-digest (#3400), første produktionskørsel

## Hvad skete

Digestens gate krævede `copenhagenHour(now) === 20`, og cron-intervallet (60 min) nulstilles ved hvert Railway-deploy. Aftenens deploys (20:40, 20:51, 22:07 CPH) betød at intet levende process-tick ramte time 20 → 0 DM sendt, dagen tabt. Opdaget ved det planlagte første-kørsels-tjek.

## Rod-årsag

Præcis-time-vinduer antager en stabil proces. På en deploy-tung platform (auto-deploy ved hvert main-push) er "processen har levet en fuld time inde i time X" IKKE garanteret. Featuren HAVDE allerede den rigtige byggesten (persisteret dedup-log læst før send) — gaten brugte den bare ikke som primær garanti.

## Fix (PR #3475)

Gate ændret til `< 20` (kør ved første tick EFTER vinduets start); én-gang-pr.-dag-garantien bæres af dedup-loggen alene. Catch-up-test tilføjet.

## Læring (forward-guard)

- **Tidsvinduer i cron-jobs skal være "efter T + persisteret dedup", aldrig "præcis i time T"** — gennemgå andre time-gatede sweeps for samme mønster (email-digest kl. 19 har formentlig samme sårbarhed: `emailRaceDigestSweep.js` — tjek + fix i opfølgning).
- Første-kørsels-verifikation af nye crons skal stå i planen (det gjorde den — det var sådan buggen blev fanget samme aften i stedet for efter en uges tavshed).
- GitHub-nedbrud samme aften: admin-merge med fuld lokal verifikation er den rigtige nødprocedure når blokeringen beviseligt er ekstern infrastruktur (brugt på #3464/#3465/#3475 efter ejer-ønske om at shippe).
