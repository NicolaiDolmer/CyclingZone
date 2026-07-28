# To grunde til at låse, ét `else` — og 4 ryttere kørte to løb

**Dato:** 2026-07-28 (fundet i sæson-audit, S2)
**Issue:** #3113 (P0) · **PR:** #3116
**Berørt:** `backend/lib/raceEntryGenerator.js`

## Symptom

6 ryttere på 2 ægte hold var udtaget til to tidsoverlappende løb — brud på den låste
ejer-regel "1 rytter = 1 løb pr. løbsdag i ALLE tiers". 4 af dem **nåede at køre begge
løb** på game_day 0-1 og fik dobbelt point- og præmieeksponering.

## Hvad jeg troede, og hvad der faktisk var galt

Issuet havde allerede en velargumenteret rodårsag: `lockedWindows` seedes kun fra
manuelle entries + startede løb, så en auto-fyldt entry i et ikke-startet løb er usynlig
for næste sweep-kørsel. Plausibelt, og skrevet af en session der havde læst koden.

Det var ikke det, der ramte de 4 ryttere. Jeg fandt det først da jeg holdt de faktiske
`created_at`- og `is_auto_filled`-værdier op mod skip-grenen:

```js
if (isWithdrawn || fullManual || isStarted || isCleared) {
  if (hasManual) lockedWindows.push({ window, riderIds: manualRiders });
  else if (isStarted) lockedWindows.push({ window, riderIds: startedRidersByRaceTeam.get(key) || [] });
}
```

`hasManual` og `isStarted` er **ikke gensidigt udelukkende**. Et igangværende løb kan
sagtens have en delvis manuel trup. Team Brutalistes Hauts Plateaux var startet OG havde
1 manuel rytter (Lie) + 4 auto. `hasManual`-grenen vandt, låste kun Lie, og de 4
auto-fyldte stod som "frie" til det overlappende Tour de Malaisie.

To grunde til at låse er ikke et valg mellem to grene. Det er en **union**.

Det andet par (Aquila) havde en helt tredje form: `if (!picks.length) continue;` sprang
enheder med nul nye picks over i staging, så deres forældede auto-rækker aldrig blev
diffet væk. Tour du Danube stod tilbage med præcis ÉN entry — signaturen på en residual,
ikke på en tildeling.

## Læring

**Et velskrevet issue er en hypotese, ikke et fund.** Rodårsagen i #3113 var argumenteret
ud fra koden alene og lød rigtig. Den forklarede bare ikke de rækker der faktisk lå i
databasen. Det der afgjorde sagen var at slå `created_at` + `is_auto_filled` op for de
konkrete 12 entries og spørge "hvilken gren kan producere PRÆCIS dette?". Symptomet havde
to forskellige former; jeg havde fundet ét fix og kaldt det færdigt, hvis jeg var stoppet
ved issuets tekst. Samme klasse som `feedback_evidence_before_fix`.

**`else if` på to uafhængige prædikater er en bug der venter.** `hasManual` og `isStarted`
besvarer to forskellige spørgsmål om samme løb. Skrevet som `if/else if` bliver den ene
grund til at låse tavst spist af den anden. Der var ingen test der ramte kombinationen,
fordi hver af de to grene havde sin egen test (#1825 testede startet-uden-manuel, top-up
testede manuel-uden-startet) — og begge var grønne. **Når to guards deler en
`else`-kæde, så test krydsfeltet, ikke kun akserne.**

**En "spring over"-gren skal stadig rydde op.** `if (!picks.length) continue` læser som en
harmløs optimering ("ingenting at skrive"). Men i en diff-baseret skriver betyder "intet
ønsket" netop at alt eksisterende skal væk. At springe enheden over gjorde tom-tildeling
til en tavs bevaring af gammel state.

## Forward-guard

Ny `riderDoubleBookingWatch`: daglig read-only invariant-vagt der alarmerer hvis nogen
rytter står i to overlappende løb i den aktive sæson — uanset hvilken kodevej der
introducerede det. Rod-årsagen her lå i sweep'en, men den næste kan ligge i
spiller-auto-fill, en reschedule eller en import. Vagten binder via samme
`raceBindingWindow` som save-guarden, så vagt og afvisning aldrig kan være uenige.

Den skelner `actionable` (mindst ét løb ikke afviklet → kan stadig rettes billigt) fra
historik (kræver ejer-gated tilbagerulning). Auditen 28/7 fandt bruddet **tre dage** efter
det opstod, og på det tidspunkt var de 4 ryttere allerede kørt. Forskellen mellem de to
tal er hele værdien af at opdage det samme dag.
