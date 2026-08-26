# Guard og håndhævelse skal dele mængde-semantik (og fejl-oversætteren skal kende begge)

**Dato:** 2026-08-27 · **Issue:** #4283 · **Kontekst:** beredskabsgennemgang af holdudtagelsen natten før S3-start.

## Hvad skete

#4217 ændrede binding-mængden fra "de faktiske etape-dage" til "hele spændet min..max
game_day" (GT-hviledage bindes). Ændringen blev ført igennem i `race_entry_days_rebuild`
(håndhævelsen) og `raceBindingWindow` (JS-pre-flight), men IKKE i
`replace_race_selection`-RPC'ens egen guard, der stadig joinede mod
`race_stage_schedule` (kun faktiske etape-dage). Konsekvens: en konflikt der alene ramte
en hviledag slap forbi guarden, blev fanget af constrainten som rå 23505 — og
`saveSelection`s fejl-oversætter kendte kun RPC'ens egen `RAISE`-streng, så spilleren
fik en opak 500 i stedet for den navngivne 409.

Sekundært fund i samme gennemgang: `loadFieldBindingContext` (runtime-autofyldet)
manglede withdrawn-filteret som søsterfunktionen `loadTeamBindingContext` fik i #1823 —
to parallelle implementeringer af samme regel driver fra hinanden.

## Læring

1. **Når en invariants MÆNGDE ændres, så grep for ALLE steder mængden er materialiseret**
   — ikke kun rebuild-funktionen og JS-siden. En guard/pre-flight er en kopi af mængden
   og skal migreres i samme PR. Søg på constraint-/tabelnavnet i `pg_get_functiondef`
   over alle funktioner, ikke kun i repoets SQL-filer.
2. **Fejl-oversættere skal genkende ALLE lag der kan afvise** — `saveSelection` matchede
   kun RPC'ens egen fejlstreng, selvom `isRiderDayInvariantViolation` fandtes præcis til
   constraint-laget. Enhver catch der oversætter til en navngiven brugerfejl bør spørge:
   "hvilke ANDRE fejlformer kan samme rod-årsag ankomme i?"
3. **Søster-funktioner (samme regel, to kaldeveje) er drift-magneter** — #1823-filteret
   nåede aldrig autofyld-stien. Ved regel-fixes: find søsteren (grep efter tabellen)
   og patch begge, eller udtræk fælles helper.

## Forward-guard

- Adfærdstest med rød/grøn-bevis: `raceRunnerWithdrawnBinding.test.js`.
- Migration `2026-08-27-4283-selection-guard-spaend.sql` bringer RPC-guarden på
  spænd-semantik, så alle tre lag deler mængde.
