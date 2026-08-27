# Udeluk de legitime NULL-grene, før du kalder det et hul (#4299)

**Dato:** 27/8-2026 · **Udfald:** issue oprettet og lukket samme formiddag som falsk positiv

## Hvad skete der

Under den daglige triage fandt jeg én udtagelse i sæson 3 uden `binding_span` og uden
rækker i `race_entry_days`. Jeg konkluderede at både DB-constrainten og appens guard var
blinde for rækken, oprettede et `priority:high`-issue dagen før sæsonstart, og anbefalede
en migration med `binding_span NOT NULL`.

Alt tre var forkert. Rækken var korrekt ubunden: holdet var afmeldt fra løbet, og et
afmeldt hold binder per design ikke rytteren (#1823). Da afmeldingen blev fjernet,
byggede trigger 3 bindingen op af sig selv.

## De to fejl

**1. Jeg læste et mønster ind i tal fra min egen query.** Jeg så "14 af 15 entries er
bundet, 1 er ikke" og læste det som én trup hvor én rytter blev glemt. De 15 entries
tilhørte tre forskellige hold: 7 + 7 + 1. `race_entry_days_rebuild` er scopet pr.
`(race_id, team_id)`, så de to andre hold kunne per konstruktion ikke rammes. Der var
aldrig et 14-mod-1-mønster, kun tre uafhængige gem hvoraf det ene bestod af én række.

**2. Jeg behandlede NULL som en fejltilstand uden at læse funktionen der sætter den.**
`race_entries_binding_span()` returnerer bevidst NULL i fire tilfælde: færdigkørt løb,
afmeldt hold, delvist backfillet schedule, tom schedule. NULL betyder "binder ikke", ikke
"vi glemte at binde". En `NOT NULL`-constraint ville have gjort tre legitime tilstande
umulige at repræsentere.

## Hvad der ville have lukket sagen på to minutter

Funktionen har fire grene. Tre af dem kunne udelukkes fra data jeg allerede havde hentet:
løbets status var `scheduled`, dets schedule havde `game_day = 0` sat otte timer før
udtagelsen, og der var ingen sentinel. Tilbage stod én gren. Havde jeg læst funktionen
først i stedet for sidst, var der aldrig blevet skrevet et issue.

## Reglen

Når en måling siger "denne række mangler X", så læs den funktion der sætter X, og udeluk
dens legitime tomme grene, **før** der skrives noget om et hul. Et felt der er nullable
uden default og uden NOT NULL er sjældent en forglemmelse i et system der har været
gennem fire migrationer om netop den invariant. Det er som regel et designvalg med en
funktion bagved der forklarer hvornår tomt er det rigtige svar.

Beslægtet: [[feedback_runtime_verify_first]] handler om at verificere før man kalder noget
en regression. Det her er skridtet inden: verificér at det du ser overhovedet ER en
afvigelse, før du beskriver den som en.

## Hvad der holdt

Prod-målingerne selv var korrekte hele vejen, og den afsluttende kontrol (0 udtagelser
uden binding, 0 løb med ufuldstændig schedule) er den samme query der ville have fanget et
ægte hul. Fejlen lå i fortolkningen, ikke i målingen.

Refs #4299 #4173 #1823 #3420
