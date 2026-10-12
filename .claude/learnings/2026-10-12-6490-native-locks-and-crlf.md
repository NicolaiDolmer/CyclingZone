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

## M2: marker-write kræver aktive sessionstriggere

En konkret negativ test viste, at et backfill-kald i `session_replication_role=replica`
kunne sætte source-markøren uden at oprette refs. Kaldet afvises nu før skrivning,
og source-/ref-tabeller låses før kontraktkontrollen. Testen beviser uændret markør
og ingen refs ved afvisning. En ekstra negativ test bekræfter, at en manglende
source-PK heller ikke kan certificeres: batchgrænsen afhænger af unikke source-id'er.
PGlite blev positivt identificeret som PG18.3; dens NOT NULL-katalogrækker accepteres
uden at svække attributkravene. Native PG17 er stadig det særskilte L4-bevis.
