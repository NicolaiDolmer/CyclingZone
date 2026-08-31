# Discord-DM: 400 faldt uden for dead-connection-tælleren (#3483)

**Dato:** 31/8 2026 (natbølge) · **Issue:** #3483 · **Opfølger på:** #3130

## Symptom

En spiller stod som "Discord tilsluttet" i indstillingerne, fik aldrig en DM, og
mistede undervejs en `board_critical`-besked i fuld tavshed. Auto-afkoblingen fra
#3130 rørte ham aldrig: 23 dage efter første observation stod
`discord_dm_failure_count` stadig på 0 og `discord_disconnected_at` på null.
Samme tick loggede digest-kørslen "0 fejl", fordi vagten tæller leverings-forsøg,
ikke droppede modtagere.

## Rod-årsag

`classifyDmFailure` i `backend/lib/discordDmDelivery.js` har to permanente
modtager-grene, ikke én:

- 403 → `recipient-blocked` (spilleren har forladt serveren / lukket DMs)
- 400/404 → `bad-request` (Discord-kode 50033 "Invalid Recipient(s)")

Men begge kaldesteder sammenlignede med den ene streng direkte:

- `discordNotifier.js:473` — `if (result.failure?.reason === "recipient-blocked")`
- `discordDmOutbox.js:142` — samme sammenligning før `onRecipientBlocked?.()`

Da 400/404-grenen blev tilføjet til klassifikationen, fulgte kaldestederne ikke
med. Fejlklassen er altså ikke "nogen glemte et tal", men **duplikeret viden om
en enum spredt over tre filer, hvor kun den ene af dem var kilden**.

400-grenen var den farligste af de to, ikke den mildeste: 403 selvhelbreder,
fordi `clearDmFailureCount` nulstiller tælleren ved næste vellykkede levering,
mens en 400-kobling hverken kunne tælle op eller nulstilles. Den var permanent.

## Fix

Listen over reasons der tæller som en død modtager-kobling bor nu ét sted:
`PERMANENT_RECIPIENT_FAILURE_REASONS` i `discordDmDelivery.js`, læst via
`isPermanentRecipientFailure(reason)`. Begge kaldesteder bruger prædikatet.

`token-invalid` (401) er bevidst holdt udenfor: det er vores egen bot-token, ikke
modtageren. Talte den med, ville ét roteret token afkoble alle spillere i flok
efter tre notifikationer.

Callbacken `onRecipientBlocked` er omdøbt til `onPermanentRecipientFailure`, så
navnet ikke fastholder 403-antagelsen for den næste der læser koden.

## Forward-guard

`backend/lib/discordDeadConnectionCallSites.test.js` scanner `backend/lib` og
`backend/routes` statisk og fejler hvis et kaldested igen sammenligner en
DM-reason med en enkelt hardkodet streng. Regexen er verificeret mod den præcise
gamle linje. Derudover fire regressionstests på drain-stien: 403 og 400 og 404
tæller op, 401 tæller ikke.

## Læring

Når en klassifikations-funktion får en ny gren, er de STEDER der forgrener på
resultatet en del af ændringen. En enum med to medlemmer og tre `=== "streng"`
sammenligninger spredt i koden er en fejl der venter på at ske. Eksportér
prædikatet sammen med klassifikationen, og lad en statisk guard håndhæve at ingen
går uden om det.

---

## Efterskrift: adversarisk review af PR #4460 fandt den spejlvendte fejl

Den oprindelige rettelse ovenfor var rigtig, men ufuldstændig, og manglen var
farligere end den fejl den rettede.

### Rod-årsag 2

`classifyDmFailure` klassificerede udelukkende på HTTP-status. En DM-levering
har to trin mod Discord:

1. `openDm` — `POST /users/@me/channels`, body er kun `{ recipient_id }`.
2. `postDm` — `POST /channels/:id/messages`, body er VORES embed-payload.

Et 400 fra trin 1 handler om modtageren (kode 50033 "Invalid Recipient(s)") og
er en ægte død kobling. Et 400 fra trin 2 er vores egen payload der er afvist
(kode 50035 "Invalid Form Body"). De blev klassificeret ens som `bad-request`,
og `bad-request` tæller på dead-connection-tælleren.

Konsekvens: en payload-fejl er ikke bruger-specifik. Den rammer hver eneste
modtager af den notifikation i samme runde. Tre sådanne notifikationer ville
have nulstillet `discord_id` for alle 31 tilknyttede spillere på én gang —
præcis den flok-afkobling som 401 `token-invalid` bevidst holdes udenfor for at
undgå. Hele argumentet i den oprindelige PR hang på Discord-kode 50033, men
koden blev aldrig læst ud af svaret.

Og fejlklassen var åben, ikke teoretisk: `buildEmbed` i `discordNotifier.js`
interpolerede rytter-, hold- og brugernavne direkte ind i `title` og
`description` og videresendte felt-værdier fra kaldere uden noget loft mod
Discords embed-grænser (title 256, description 4096, field value 1024, max 25
fields).

### Fix 2

- `classifyDmFailure(status, { step, discordCode })` er nu trin-bevidst. Kun
  400/404 fra `openDm` bliver `bad-request`. Fra `postDm` bliver det
  `payload-rejected`, som står udenfor `PERMANENT_RECIPIENT_FAILURE_REASONS`.
- Discords fejlkode læses nu faktisk (`parseDiscordErrorCode`) og bruges som
  ekstra værn: kode 50035 er aldrig en modtager-fejl, heller ikke fra `openDm`.
- `failure.step` bæres med ud i returværdien, så logs og Sentry viser hvilket
  trin der fejlede uden at parse fejl-strengen.
- `discordNotifier.js` forgrenede på `reason === "token-invalid"` for at afgøre
  "vores fejl vs. modtagerens". Det er den SPEJLVENDTE udgave af den oprindelige
  #3483-fejl: da `payload-rejected` kom til, ville den være faldet ned i
  modtager-grenen. Betingelsen er nu det negerede prædikat
  `!isPermanentRecipientFailure(...)`, så nye ikke-modtager-reasons automatisk
  alarmerer i stedet for at afkoble spillere.
- Nyt pure modul `discordEmbedLimits.js` (`clampEmbed`, `clampEmbedPayload`)
  lukker fejlklassen ved kilden. Brugt i `buildEmbed` og i outbox'ens
  dead-alarm, hvis `description` voksede lineært med batch-størrelsen.

### Forward-guard 2

`discordDeadConnectionCallSites.test.js` var for snæver på to måder, som reviewet
fangede: den scannede kun `backend/lib` og `backend/routes`, og den kørte
linje-for-linje, så prettiers flerlinjede form af en lang betingelse slap
igennem. Den scanner nu hele `backend/` (pånær node_modules og build-mapper) med
en regex der matcher på tværs af linjeskift og i begge retninger, og den dækker
nu også `token-invalid` — altså begge halvdele af fejlklassen. Guarden har sin
egen selvtest, så en for snæver regex ikke kan se ud som en grøn guard.

### Prod-måling 31/8 (read-only)

Den oprindelige PR-body påstod nul rækker med både `discord_dm_failure_count > 0`
og `discord_disconnected_at` sat. Første halvdel holdt, anden halvdel var forkert:

| mål | værdi |
|---|---|
| brugere med `discord_id` sat | 31 |
| `discord_dm_failure_count > 0` | 0 |
| `discord_disconnected_at` sat | 4 (8/8 til 15/8 2026) |
| af de 4: gentilsluttet siden | 0 |

Auto-afkoblingen har altså allerede fyret fire gange i prod. Det gør
flok-afkoblingen til en reel risiko på en levende mekanisme, ikke en hypotese.

### Læring 2

To ting.

For det første: når en fejlklassifikation begrunder sig i en leverandør-fejlkode,
så LÆS koden. Argumentet i den oprindelige PR-body var korrekt om 50033, men
koden blev aldrig læst, så 50035 arvede samme behandling i stilhed. En kommentar
er ikke en implementering.

For det andet: når et fix indfører et prædikat ("er dette modtagerens fejl?"),
så skal BEGGE grene forgrene på prædikatet. Vi flyttede den ene side til
`isPermanentRecipientFailure()` og lod den anden stå som en hardkodet streng —
og efterlod dermed præcis den samme fælde, bare vendt om. Forward-guarden skal
dække begge sider af et sådant prædikat, ikke kun den side der lige blev rettet.
