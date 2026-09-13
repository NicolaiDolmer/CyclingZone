# 2026-09-11 — #4959: puljer laaste paa 25 fordi draenende AI-hold blev ved med at faa nye tilmeldinger

## Hvad skete der

Tre D4-puljer (12, 13, 14) stod paa 25 hold i stedet for ejer-kravet 24 (#2377).
Dry-run'en 7/9 viste 0 kandidater: alle 48 AI-hold var `inflight_entries`-blokeret.
Et AI-hold maa foerst nedlaegges naar det ikke er midt i et loeb, men D4's etapeloeb
overlapper (et nyt hver dag, 3-4 etaper hver), saa vinduet "ingen igangvaerende
entries" aabnede aldrig.

## Rod-aarsag

`raceEntryGenerator.js` trin 5 laeste hold uden at kende `pending_removal_at`, saa et
hold der var markeret til nedlaeggelse blev ved med at blive udtaget til det naeste
loeb. Markoeren var dermed selv-ophaevende: jo laengere holdet ventede, jo flere loeb
kom det i.

## Hvad der allerede var loest da denne session startede

PR #5066 (merget 9/9) lukkede selve draeningen: begge udtagelses-stier
(`raceEntryGenerator` trin 5 og `raceRunner.fillMissingTeamEntries`) filtrerer nu
markerede AI-hold fra, og DB-guarden `guard_draining_ai_obligation`
(`trg_ai_drain_entries`, SQLSTATE 23514) afviser enhver ny `race_entries`-raekke for
dem uanset hvilken kodesti der skriver. Begge dele er gated bag
`ai_team_retire_enabled` + `ai_pool_retirement_v2_enabled`.

En grep efter alle skrivninger mod `race_entries` bekraeftede at kun de to stier
overhovedet tilmelder AI-hold; resten er manager-udtagelser (`is_auto_filled=false`),
oprydning eller rene laesninger.

## Hvad denne PR tilfoejede

1. **Forward-guard hele vejen gennem sweepen.** Guarden sad i generatoren, men intet
   bevis for at prod-vejen (`raceEntryGeneratorSweep`, 5-min-kadence i cron.js) ikke
   omgik den. Testen koerer nu hele sweepen med den aegte generator og et kontrolhold
   der SKAL fyldes, saa testen ikke kan vaere groen fordi sweepen slet ikke koerte.
2. **Beviset for den anden halvdel af reglen:** det markerede hold beholder sine
   eksisterende entries og koerer sine loeb faerdigt. Det er dem der lukker
   inflight-vinduet; ryddede generatoren dem, ville holdet aldrig blive frit.
3. **TOCTOU-haandtering.** Markeres et hold i vinduet mellem hold-laesningen og
   skrivningen, afviser DB-guarden hele batchen. I generatoren taltes det som en
   fejlet enhed (Sentry-alarm hvert tick); i loebsstartens autofyld KASTEDE det, saa
   eet draenende hold kunne tage startfeltet for alle andre hold i loebet med sig.
   Nu springes enheden over hhv. de draenende raekker droppes og resten skrives.
   Matcheren `isDrainingAiObligation` kender kun guardens egne beskeder - 23514
   bruges ogsaa af alle andre CHECK-constraints og maa ikke slugges generelt.
4. **Dry-run siger hvornaar.** `retire-stuck-ai-teams.js --dry-run` sagde kun
   "WAIT <hold>: inflight_entries", saa "venter til i aften" og "fastlaast for evigt"
   saa ens ud. Linjen viser nu den sidste PLANLAGTE etape i de loeb holdet stadig er
   i, i dansk lokaltid, og "unknown" hvis et igangvaerende loeb ingen etape-plan har.

## Laering

- En markoer der ikke ogsaa lukker for NYE forpligtelser er selv-ophaevende. Naar en
  guard siger "kun naar X er tom", skal den sti der fylder X kende markoeren.
- En DB-guard der beskytter en invariant skal have en app-sti der kan TAALE at blive
  afvist. Ellers bytter man en stille datafejl for et haardt nedbrud et andet sted.
- Et ops-vaerktoej der kun siger "blokeret" uden at sige "til hvornaar" kan ikke
  skelne en lovlig ventetid fra en fastlaasning - og det var praecis den skelnen
  ejeren manglede for at kunne beslutte.
