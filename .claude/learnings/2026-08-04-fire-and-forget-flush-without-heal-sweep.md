# En fire-and-forget-flush uden heal-sweep er en tidsindstillet fælde

**Dato:** 2026-08-04 · **Issue:** #3330 · **Type:** bug/anti-mønster

## Symptom

Vasco Fernandes stod med `team_id` på Lidl–Leffe Pro Drinking og `pending_team_id`
på Team Hansen Pro Cycling siden 22/6 — over 40 dage. Køberen havde betalt fuldt
ud; rytteren blev aldrig leveret. En spiller opdagede det selv og rapporterede det
i Discord 4/8 ("I have traded this player... he still hasnt joined his new team").
`riders.pending_team_id != null` er i hele spillet én række på det tidspunkt — et
enkelt, isoleret spøgelse, ikke et bulk-problem.

## Rod-årsag

`stageRaceTransferDefer.js` (#1995) parkerer et holdskifte på `pending_team_id`
når en rytter handles midt i et aktivt fleretape-løb, så etapepoint ikke splittes
mellem sælger og køber. Flushen (`flushDeferredTransfersForRace`) kaldes **kun**
fra `raceRunner.js` når DET KONKRETE løb finaliseres, og **kun** for det løbs egne
`race_entries`. Det er en helt korrekt trigger for det normale forløb — men den
har ingen søster-mekanisme der spørger "er der en parkeret rytter et sted i
systemet, som INGEN aktivt løb længere vil trigge en flush for?". Falder flushen
på gulvet af en hvilken som helst grund (løbet finaliseres ad en anden vej,
rytteren fjernes fra `race_entries` før finalisering, en admin-genkørsel springer
et løb over), er der intet tilbage i hele kodebasen der nogensinde rører den
rytters `pending_team_id` igen. Ingen retry, ingen timeout, ingen alarm.

Værre: `ownershipInvariantWatch.js` regnede `pending_team_id != null` som
**gyldigt ejerskab** (samme betingelse som `team_id != null` for invariant A/B).
Det er korrekt for DE invarianter (en rytter midt i en betalt handel skal
naturligvis ikke kunne komme på en ungdomsauktion) — men det betød at INTET i
overvågningen nogensinde flaggede en rytter der var faldet i limbo. Vagten
vurderede aktivt en ødelagt tilstand som sund.

## Hvorfor det er et generelt anti-mønster

Et flush/cleanup-kald der kun trigges af ÉN specifik opstrøms-hændelse (her:
"dette løb finaliserede") er strukturelt en fire-and-forget-operation, selvom
koden ser synkron og pålidelig ud. Alt der kan få den opstrøms-hændelse til
aldrig at ske for netop denne række — en race condition, en alternativ kode-sti,
en fremtidig refaktor af finaliserings-logikken, en manuel admin-handling — efterlader
tilstanden permanent uafsluttet. Jo sjældnere triggeren rammer (her: kun ved
løbs-finalisering for lige netop DE ryttere), jo længere kan et enkelt tabt
kald ligge uopdaget, fordi ingen anden kode-sti nogensinde falder over det.

Mønsteret i denne kodebase for at lukke det hul er **heal-sweep + forward-guard
som par**, ikke enten-eller:
- **Heal-sweep** (periodisk, idempotent, samme diskriminator som den primære
  trigger) reparerer proaktivt uden at vente på en bruger-rapport.
- **Forward-guard** (invariant-vagt) alarmerer hvis heal-sweepen SELV fejler
  eller er slukket — en ren tidsbaseret backstop der ikke er afhængig af den
  samme logik som det den overvåger.

Uden heal-sweepen venter man på en tilfældig bruger til at opdage limbo'en.
Uden forward-guarden opdager man aldrig hvis heal-sweepen selv går i stå.

## Fix (#3330)

1. `deferredTransferHealSweep.js` — periodisk sweep (5-min-kadence, samme
   mønster som `starterSquadHealSweep`/`academyHealSweep`/`aiTeamTrimHealSweep`):
   finder ALLE ryttere med `pending_team_id != null` og flusher dem der IKKE er
   i et aktivt fleretape-løb (`getRidersInActiveStageRace` — samme diskriminator
   som den oprindelige flush bruger). TOCTOU-guarden delt via en ny eksporteret
   `flushParkedRider()`-kerne i `stageRaceTransferDefer.js`, så race-scoped flush
   og heal-sweep aldrig kan drifte fra hinanden.
2. `ownershipInvariantWatch.js` invariant E: `pending_team_id` parkeret længere
   end `PENDING_TRANSFER_STALE_HOURS` (48t, konservativt længere end det
   længste fleretape-løb kan tage) flagges nu som invariant-brud, ikke som
   gyldigt ejerskab. Målt mod `riders.updated_at`, som nu stemples eksplicit
   ved parkering i alle fire skrive-steder (`squadEnforcement.js`,
   `transferExecution.js` × 2, `auctionFinalization.js`) — riders har ingen
   auto-touch-trigger i Postgres, så uden den eksplicitte stempling ville
   `updated_at` bare afspejle row-creation-tidspunktet og gøre alderstjekket
   enten altid eller aldrig sandt. En LEGACY parkeret række (som Vasco, stemplet
   FØR denne PR) har en gammel `updated_at` og fanges derfor korrekt uden nogen
   data-reparation eller backfill.

## Læring, der generaliserer

**Et cleanup-kald der kun trigges af ét opstrøms-event er ikke "godt nok fordi
det normalt virker" — det er en garanti for at det EN dag ikke gør, uden at
nogen ved det.** Enhver "park state X, flush det senere via event Y"-mekanisme
skal have en søster-sweep der spørger "er der noget parkeret som event Y aldrig
kommer til at ramme?", og en tidsbaseret vagt der er UAFHÆNGIG af samme logik
som selve mekanismen — ellers overvåger man kun at koden kører, ikke at
tilstanden rent faktisk konvergerer.

## Verifikation

- 28 nye/opdaterede unit-tests (8 i `deferredTransferHealSweep.test.js`, 8 nye
  invariant-E-tests i `ownershipInvariantWatch.test.js`, 11 uændrede i
  `stageRaceTransferDefer.test.js` efter refaktor til delt `flushParkedRider`).
  Fuld backend-suite: 5246/5246.
- Read-only prod-probe (service-klient, INGEN writes): bekræftede at Vasco
  Fernandes er den ENESTE rytter med `pending_team_id != null` i hele
  databasen, `updated_at = 2026-06-22 13:48:45+00` (>40 dage gammel — ville
  korrekt flagges af den nye invariant E). Team Hansen Pro Cycling har 29/30
  senior-pladser besat (plads til præcis Vasco) og 8/8 akademi-pladser (fyldt,
  men irrelevant — Vasco er senior). Data-reparationen (selve flushet af Vasco)
  er ejer-gated og håndteres separat — denne PR rører INGEN prod-data.
