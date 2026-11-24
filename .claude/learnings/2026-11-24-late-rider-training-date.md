# Postmortem · 2026-11-24 · Sent hentede ryttere mistede træningsdatoen (#8606)

## Hvad skete der?
22/11 meldte to managere, at træningen udeblev. Hold A hentede fire akademiryttere kl. 19:13 dansk tid; de fik ingen træning den dag, heller ikke da manageren trykkede Træn. Hold B så "Trænet i dag kl. 19:01 (af assistenten)", men ingen stigninger, før manageren selv trykkede Træn kl. 19:41.

## Root cause
To årsager, kun den første kostede træning.
1. `register_training_date_work` fryser datoens trup ved første registrering. #6439 dækker en rytter, der skifter hold midt på datoen (han træner i den trup han stod i), men en rytter i **ingen** trup (nyt akademioptag, fri agent) blev aldrig taget med: Træn nu udvider ikke truppen, og aftenkørslen sprang `complete` over. Da #7982 (20/11) flyttede registreringen til dagens første etape, gik vinduet fra "efter aftenkørslen" til "hele eftermiddagen": efter 20/11 mistede de fleste akademioptag deres første dato. Målt siden 29/9: flere hundrede rytter-datoer på menneskehold (tal på #8606).
2. Træningssiden viser seneste kørsel (`todayRun`) som dagens træning. Efter #7982 er det løbssessionen for de ryttere, der kørte, ikke hele dagen. Ingen træning tabt (alle rytter-datoer 22/11 er komplette); overskriften er en visningssag og kræver ejer-beslutning.

## Fix
- `database/2026-11-24-8606-late-rider-training-date.sql`: `admit_late_training_date_riders` tager en rytter ind i holdets frosne trup, kun når det kan bevises, at ingen anden har ham på datoen; starttilstanden er hans tilstand nu, og en `complete` dato bliver `partial`.
- `backend/lib/trainingDateClose.js`: aftenkørslen kalder den for holdets ryttere uden for truppen (også på en `complete` dato), og cachen husker rytter og hold (`riderTeams`), så en rytter hentet efter aftenkørslen findes af samme proces.
- `backend/lib/trainingLateRider8606.pglite.test.js`: mod prods afregnings-kæde i PGlite (den rigtige `commit_training_date_tick`).

## Forhindret-fremover
- Testen kører den rigtige commit: kontrollen viser fejlen (`Rider outside frozen date roster`), og efter optagelse afregnes alle fem sessioner uden at røre de andres kvitteringer. Negative tilfælde (anden trup, kvittering, lås, senere afregning, uafsluttet tidligere dato, efter fristen) tages ikke ind.
- `docs/TRAINING_RULES.md` "Sent hentede ryttere mister aldrig datoen".

## Læring
En regel om en frossen trup skal svare på tre tilfælde, ikke to: rytteren er i truppen, rytteren er i en anden trup, og rytteren er i ingen trup. #7832 løste "nyt hold", #6439 "skiftet hold"; "ny rytter" faldt mellem dem. Når en ændring flytter et tidspunkt (her registreringen til første etape, #7982), så mål hvad der falder i det nye vindue, før kontakten tændes.
