# 2026-08-11 · En vagt kan forfalde uden at fejle, hvis dens kendetegn er lånt fra en anden tilstand

**Issue:** #3570 (reparationen, kørt i prod 11/8) · commit [`3d360712`](https://github.com/NicolaiDolmer/CyclingZone/commit/3d36071260e271e79029e750ae918b20009f64b1)

## Hvad skete der

`repair3570Rollback.sql`s A0-blok, tre spærrer i `sikreBackup()` og en fjerde i `runRepair3570()` afgjorde alle samme spørgsmål — «er reparationen allerede kørt?» — ud fra samme kendetegn: «flere end 50 levende ryttere har et `archetype_draw`». Sandt da 6 havde ét.

Så landede #3606 (gemmer det trukne anlæg på alle otte fødselsstier). Fra det øjeblik fødtes hver ny rytter med et `archetype_draw`, og tallet begyndte at vokse af sig selv — uden at nogen rørte spærren eller reparationen. 10/8 kl. 19:47 blev 722 nye ryttere oprettet på 34 sekunder; tallet stod på 740. Spærren kunne ikke længere skelne «reparationen er kørt» fra «der er født nye ryttere», og det var dens eneste opgave. Reparationen var dermed ublokerbar af helt almindelig vækst, og sikkerhedskopien kunne ikke tages.

## Rod-årsag

Spærren fejlede ikke. Den gjorde præcis hvad der stod i den. Det var **præmissen** der udløb: kendetegnet «kun en håndfuld ryttere har et draw» var lånt fra en verdenstilstand (fødselskoden satte aldrig et draw) som en helt anden PR ændrede, uden at spærren vidste det og uden at nogen tænkte de to hang sammen. Ingen test fangede det, fordi alle fixtures brugte den gamle verdenstilstand. Fundet blev ved at MÅLE prod (fire `SELECT`), ikke ved at læse koden.

Og fordi kendetegnet var kopieret ind fire steder i stedet for udledt ét sted, ville en rettelse af det ene sted have givet falsk tryghed — de tre andre ville stadig have fyret forkert (eller værre: slet ikke fyret, og ladet en halv reparation blive brugt som rollback-kilde).

## Det generaliserbare mønster

**En vagt hvis kendetegn afhænger af en tilstand andre systemer kan ændre, forfalder uden at fejle.** Den ser ikke ud til at trænge til gennemgang — den kompilerer, den kører grønt i CI, den har endda en kommentar der forklarer hvorfor tallet er som det er. Den bliver først forkert i produktion, i det øjeblik nogen har brug for at den virker.

Konkret at lede efter i denne kodebase: en konstant der tæller/begrænser **rækker mod en fast tærskel**, hvor tærsklen implicit antager en øvre grænse for en population **ingen kode faktisk håndhæver**. Spørgsmålet der afslører det: "hvis en anden PR øger antallet af rækker der matcher dette filter, ved forfatteren af den PR at den rører denne vagt?" Svaret er typisk nej — de er ikke i samme fil, ofte ikke samme modul.

## Andre eksempler i repoet

Søgte bredt (`count(*)`/`COUNT(*)` mod SQL, `> X_THRESHOLD`/`_MAX`/`_LIMIT`/`_BASELINE` i backend/) efter samme klasse: en fast tærskel der antager en population som en anden skrivevej kan inflatere.

- **Fundet, samme dag:** `INTAKE_EXPIRY_MAX_PER_DAY = 30` i [`backend/lib/academyIntakeExpirySweep.js`](../../backend/lib/academyIntakeExpirySweep.js) (fixet i commit `6ba6042a`). Kvoten antog en stabil tilstrømning af intake-tilbud; søndags-dryppet og #3576-kompensationskuldet ændrede tilstrømningen uden at røre kvoten, og køen voksede ~90/uge af sig selv indtil den blev målt. Samme rod: en konstant tunet mod en population, som en anden skrivevej senere gjorde ubegrænset. Rettelsen der landede (adaptiv STEADY/CATCHUP baseret på et *målt* efterslæb) er den samme fix-klasse som `foerPlanen()`: læs den faktiske tilstand i stedet for at stole på et engangs-øjebliksbillede.
- **Ikke fundet en tredje.** De øvrige `_THRESHOLD`/`_MAX`/`_LIMIT`-konstanter jeg gennemgik (`POOL_TARGET_SIZE`-feltcap i `raceRunner.js`, `ALL_SKIPPED_STREAK_THRESHOLD` i `discordDmRateGuard.js`, ratio-baserede board-tærskler) er enten hårde caps designet til at virke uanset populations-størrelse, eller selv-nulstillende pr. kørsel — de har ikke den samme sårbarhed. Skriver det eksplicit i stedet for at antage der er flere.

## Forward-guard

Når du skriver en spærre der tæller rækker mod en fast tærskel for at udlede en tilstand ("er X allerede sket"): spørg om tærsklen er en **grænse kodebasen håndhæver**, eller en **observation fra det øjeblik du skrev den**. Er det sidste, skriv det i kommentaren som en eksplicit antagelse ("sandt fordi ingen skriver Y endnu") — så en senere PR der ændrer Y kan finde spærren via søgning, ikke kun via en prod-hændelse.

Ligger kendetegnet flere steder (som her: fire kopier), ret dem alle i samme commit med samme skæringspunkt — se `PLAN_SNAPSHOT_TAGET` i `repair3570Apply.mjs`. At rette ét sted og tro man er færdig er værre end at rette ingen, fordi det ser løst ud.

## Beslægtet, men ikke samme fejl

Samme dag ramte to "dokumentet/testen driver fra virkeligheden"-fejl, der IKKE er denne klasse (ingen skjult tilstandsafhængighed — bare drift):
- `21-isoler-a0.mjs`s fixture manglede `created_at` og blev rød af selve rettelsen, fordi fixturen var holdt op med at ligne prods skema.
- `KOEREBOG.md` sagde `psql "$DATABASE_URL"` om en variabel der i Infisicals prod-miljø hedder `SUPABASE_DB_URL`.

Begge er dokumentation/fixtures der ikke fulgte med koden — værd at nævne, men adskilt fra guard-forfaldet: her var det IKKE en ekstern skrivevej der ændrede tilstanden vagten målte, bare en tekst der aldrig blev opdateret.

## Forslag til `AGENTS.md` / `docs/GUARDRAILS_CORE.md` (ikke tilføjet)

> Skriver du en spærre der tæller rækker mod en fast tærskel for at udlede en tilstand: dokumentér om tærsklen er en håndhævet grænse eller en engangs-observation — og hvis observation, hvilken skrivevej der kan gøre den forkert.
