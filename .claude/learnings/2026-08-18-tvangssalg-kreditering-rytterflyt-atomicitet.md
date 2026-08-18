# Postmortem · 2026-08-18 · Tvangssalg: kreditering og rytter-disposition kunne ende i uenighed efter en crash (#2982)

## Hvad skete der?

`processTeamSeasonPayroll`'s gældsloft-tvangssalg (`backend/lib/economyEngine.js`,
gren 2c) gjorde fire ting pr. rytter i rækkefølge: (1) kreditér holdets balance
via `creditTeam`/`increment_balance_with_audit`, (2) flyt rytteren væk fra
holdet (`riders.team_id`-update), (3) ryd fremtidige `race_entries` + luk
`transfer_listings`, (4) afdrag lån med provenuet. Trin 1 og trin 2 var to
separate Supabase-kald, ikke én transaktion.

Krediteringen bar en idempotency-nøgle (`forced_debt_sale:<team>:<season>:<rider>`,
#2920) for at gøre cron-genkørsler sikre. Men hvis processen crashede (eller et
af trin 2-4 kastede — netværks-hikke, en `throwIfSupabaseError`) EFTER trin 1
var landet men FØR trin 2 nåede igennem, endte holdet med pengene bogført OG
rytteren stadig på holdet. Enhver senere kørsel af samme sæson ramte
idempotency-nøglens 23505-skip på trin 1 og gjorde derefter `continue` —
sprang resten af dispositionen over UBETINGET, for evigt, uden varsel (ingen
notifikation sendes bevidst på skip-grenen, #2976).

Fundet under kode-review af #2976 (PR #2981), ikke ramt i prod: `0`
tvangssalg bogført i prod ved fund (25/7) og stadig `0` ved fix (18/8,
verificeret read-only mod `finance_transactions`).

## Root cause

Idempotency-skip blev fejlfortolket som "hele operationen er allerede udført",
mens den kun garanterede at ÉT specifikt trin (krediteringen) var udført. De to
mutationer (kreditering + disposition) delte en nøgle uden at dele en
transaktion — den ene kunne lykkes uden den anden.

## Fix

`backend/lib/economyEngine.js`: på et 23505-skip fra krediteringen tjekkes nu
om rytteren FAKTISK stadig ejes af holdet (via det roster-snapshot
`processTeamSeasonPayroll` allerede har fra `loadHumanSeasonEndTeams` ved
starten af kørslen):

- Rytteren er væk fra holdet → hele salget (kreditering + disposition) nåede i
  mål i en tidligere kørsel. Intet at gøre, som før.
- Rytteren er STADIG på holdet → krediteringen landede, men dispositionen gjorde
  ikke. Fuldfør nu (rytterflyt + oprydning + lånafdrag) UDEN at kreditere igen.
  Dette er også hvor `notifyManagerSafe`-salgsbeskeden nu rent faktisk sendes —
  før forblev holdet tavst i denne tilstand.

Ingen ny migration/RPC: dette er en idempotent to-fase-genoptagelse i
JS-laget, ikke en Postgres-transaktion. `creditTeam`/`increment_balance_with_audit`
er stadig den eneste penge-mutation og forbliver uændret; kun beslutningen om
hvad der sker EFTER et skip er ændret.

Tilføjet: `backend/scripts/detectForcedDebtSaleDrift2982.js` — read-only
sweep der finder `forced_debt_sale`-posteringer hvor rytteren (udledt af
idempotency-nøglen) stadig ejes af det krediterede hold. Ingen mutation;
fixet gør drift-klassen selvhelende ved holdets næste sæson-payroll.

## Test

`backend/lib/economyEngine.test.js`:
- `#2982 · crash mellem kreditering og rytterflyt: næste kørsel fuldfører
  dispositionen (lån afdraget), uden at bogføre penge to gange` — simulerer
  præcis den navngivne crash (rytterflyt kaster i kørsel 1, EFTER
  krediteringen er landet), beviser kørsel 2 fuldfører uden dobbelt-kreditering.
- To EKSISTERENDE tests (`#2920 · dobbeltkørsel...`, `#2976 · cron-genkørsel
  sender ikke salgs-beskeden to gange`) havde en fixture-fejl der utilsigtet
  kodede den GAMLE buggede opførsel som "korrekt": begge genbrugte samme
  statiske rytter-liste på tværs af to kørsler, som om en fuldt gennemført
  disposition i kørsel 1 ikke ændrer roster-snapshottet i kørsel 2 (i
  virkeligheden ville en frisk `loadHumanSeasonEndTeams`-forespørgsel IKKE
  længere finde rytteren på holdet). Rettet til at afspejle ægte DB-tilstand
  efter en fuldt gennemført kørsel.

## Læring

En idempotency-nøgle på ÉT trin i en flertrins-mutation garanterer kun at DET
trin ikke gentages — den siger intet om de EFTERFØLGENDE trin. Når en skip
bruges som signal for "spring resten over", skal koden selv verificere om
"resten" faktisk blev udført (her: et billigt in-memory-tjek af data der
allerede var hentet), i stedet for at antage det. Samme mønster er værd at
lede efter andre steder hvor en penge-mutation efterfølges af en
ikke-transaktionel disposition (se `squadEnforcement.js executeAutoSale`,
som spejler denne kode 1:1 men UDEN idempotency-nøgle overhovedet — ikke
rørt i denne PR, ude af scope for #2982, men samme klasse).
