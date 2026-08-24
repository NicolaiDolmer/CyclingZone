# En migration kan bestå sin egen gate og alligevel bryde en regel den ikke kender

**Dato:** 24/8 2026, 21:20-22:05 · **Issues:** #4203, #4075, #4176 · **PR:** #4208 (merged), rollback i `database/2026-08-24-4203-rollback-monument-byttet.sql`

## Hvad der skete

Ejer-direktiv 24/8: Monumenterne skal ud af Grand Tour-vinduerne. En session byggede byttet, en anden målte prisen, og migrationen kørte i prod 21:20. Fem post-verify-trin var grønne, heriblandt trin 3b: *intet Monument ligger inde i et GT-vindue*. Ejer-kravet var opfyldt.

35 minutter senere fejlede den daglige kalender-invariant-audit mod prod med ét brud. Alle fire flyttede Monumenter delte nu løbsdag med 1-2 andre løb:

| Monument | Løbsdag | Delte dagen med |
|---|---|---|
| Milano-Riviera | 9 | Tour du Léman, Tour of South Australia |
| De Vlaamse Ronde | 31 | Tour des Émirats, Tour de la Vistule |
| L'Enfer du Nord | 35 | Tour des Volcans d'Auvergne |
| La Doyenne des Ardennes | 42 | Vuelta Vasca |

#4075 er ejer-låst 21/8: et Monument har sin **egen, eksklusive** løbsdag, så hver eneste rytter kan stille op. Migrationen flyttede Monumenterne ud af den ene regels overtrædelse og direkte ind i den andens.

## Rod-årsagen

Migrationens post-verify tjekkede **den regel migrationen selv handlede om**. Den kendte ikke #4075, selvom invarianten `calendar_monument_exclusive_game_day` var tilføjet i prod-verifikationen samme dag (PR #4169).

Det er samme fejlklasse som postmortem'en fra tidligere samme aften beskriver: *et fund uden gate stopper ingenting*. Her er varianten skarpere: **en gate der kun måler sin egen regel er blind for resten, og en migration der bestod sine egne fem trin fik grønt lys til prod.**

Det var ikke tilfældigt at det blev opdaget: `calendar-invariant-audit.yml` måler kalender-invarianterne mod prod på hver PR og hver nat. Uden den var bruddet gået upåagtet indtil en spiller opdagede at han ikke kunne stille op til et Monument.

## Hvorfor det ikke kunne fikses fremad

Målt efter bruddet: Division 1 har 40 løbsdage med kun ét løb, men **kun 6 af dem ligger uden for et GT-vindue**, og der skulle bruges fire. De tre Grand Tours fylder 70 % af divisionens sæson (56 af 80 løbsdage), med nul mellemrum mellem Tour og Vuelta.

De to ejer-regler kan altså ikke begge holdes i sæson 3's kalender. Det er ikke placeringen af Monumenterne der er problemet, det er komprimeringen. Ejer-beslutning: rul tilbage, tag det rigtigt sammen med GT-komprimeringen under #4176.

## Anden fejl: `created_at` er ikke en pålidelig markør

Rollbacken slettede udtagelser på de otte flyttede løb ud fra `created_at > migrationstidspunkt`, med den antagelse at et nyt tidsstempel betød "lavet af assistenten efter byttet".

Det holder ikke. `raceEntryGeneratorSweep` **omskriver** rækker i stedet for at lade dem ligge, så `created_at` blev fornyet på udtagelser der havde eksisteret hele tiden. Det er præcis den churn #4191 handler om, målt samme aften: 1.035.981 inserts på en tabel med 135.539 levende rækker.

Resultatet var at rollbacken fjernede 64 legitime udtagelser på Le Mur de Huy og tilsvarende på tre andre endagsløb. De fire står nu med 16-33 ryttere, mens alle andre D1-endagsløb på samme afstand har 101-128.

**Lære:** i en tabel der churner kan `created_at` ikke bruges til at skelne "ny" fra "gammel". Brug en eksplicit markør (en backup-tabel, en kolonne, et batch-id), eller sammenlign mod en tilstand du selv har gemt.

## Tredje fejl: rollback efter at et reaktivt system har reageret

Assistenten omfordelte rytterne inden for minutter efter byttet. Da rollbacken kom 40 minutter senere, gav den kalenderen tilbage, men ikke rytterne: naboløbene på de gamle løbsdage havde taget pladserne, og generatoren omfordeler ikke eksisterende auto-udtagelser af sig selv.

**Lære:** når et indgreb rører noget et reaktivt system overvåger, er vinduet for en ren rollback så længe det tager systemet at reagere. Efter det er en rollback ikke længere en rollback, men en ny mutation med sine egne følger. Mål hvad systemet har nået at gøre, FØR du beslutter om du ruller tilbage eller fikser fremad.

## Fjerde ting, der virkede

Migrationen rullede rent tilbage ved første fejlforsøg (mellemtilstand ramte `no_rider_double_booking_day`, som er UMIDDELBAR selvom den er DEFERRABLE). Transaktionen efterlod intet delvist. Andet forsøg med `set constraints ... deferred` gik igennem. Backup-tabellerne (`backup_4203_removed_entries`, `backup_4203_old_schedule`) gjorde tilbagerulningen mulig overhovedet.

**Lære:** de tre ting der reddede aftenen var alle bygget FØR de blev brugt: den daglige invariant-audit mod prod, backup-tabellerne i migrationen, og at hele migrationen kørte i én transaktion.

## Hvad der bør ændres

1. **En migration der rører kalenderen skal køre HELE invariant-sættet i sin post-verify**, ikke kun den regel den selv handler om. `detectCalendarViolations` findes allerede og dækker seks invarianter.
2. **GT-komprimeringen skal afgøres** (#4176) før Monumenterne flyttes igen. Så længe tre Grand Tours fylder 70 % af D1, er der ikke plads.
3. **De fire tynde endagsløb** (Le Mur de Huy 16, Taunus-Klassiker 25, La Classique Bretonne 32, Grand Prix du Saint-Laurent 33) mangler stadig at blive fyldt op. Ejeren vil se dem selv først; forslaget er at rydde auto-udtagelserne på løbsdag 34, 39, 41 og 42 og lade generatoren fordele forfra (506 auto ryddes, 58 manuelle bevares).
