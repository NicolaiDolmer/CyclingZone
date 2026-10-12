# #6490: native locks og CRLF efter frisk checkout

## Måling

- L1–L3's lokale PGlite-tests og review bestod, men L4's native PG17-sessioner
  reproducerede counter-deadlocks (40P01) ved blandet UPSERT og ved flere statements.
- Hver AFTER-event sorterede keys i C-orden. Det er ikke en global låseorden på
  tværs af UPDATE/INSERT-events eller hele transaktionen.
- En lokal per-report membership-spike bestod begge konflikter. Det er alene
  mekanismebevis; den godkendte repræsentation er endnu ikke ændret.
- L4's friske Windows-worktree gjorde manual-SQL til CRLF. Reader-switchens
  definition blev LF-normaliseret, men dens søge-/erstatningsfragmenter blev ikke.
  Tre tests fejlede i FULL, selv om den oprindelige L3-worktree havde været grøn.

## Rettelse og status

Begge SQL-fragmenter normaliseres nu med samme chr(13)-fjernelse som definitionen.
En eksplicit LF/CRLF-test reproducerede fejlen og verificerer gentaget switch,
rollback, definitioner og ACL. Fingerprint-kontrollerne er uændrede. Fikset har
uafhængigt review; den endelige FULL-status dokumenteres på leverancens PR.

Counter-deadlocken er ikke erklæret rettet. [Bevis og ejer-addendum](../../docs/snapshots/6490/README.md)
er den delte fortsættelse. Ingen prod/staging-writes, indeksfjernelse eller aktivering.

## Læring

Test den påståede låseorden med separate native sessions og observerede barriers;
enkelt-session-tests kan ikke bevise concurrency. Medtag flere events/statements.
Test tekstbaserede SQL-rewrites med både LF og CRLF som faktiske inputbytes,
ikke kun det aktuelle checkouts implicitte format. Intet nyt CI-vagtsystem nødvendigt.
