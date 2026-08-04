# Postmortem · 2026-08-04 · #3172 recurrence: concurrency theory disproven, fixed with --test-isolation=none

## Hvad skete der?
PR #3222 (2026-08-03 eftermiddag) fixede #3172 ved at køre
`lib/economyEngine.test.js` alene FØRST i egen pass, ud fra teorien at
"Unable to deserialize cloned data due to invalid or unsupported version"
kun opstod når mange testfil-workers strømmede IPC-data samtidigt til
parent-processen. 5 lokale stress-runs var grønne, og fixet blev merget.

Samme aften (3/8) fejlede backend-tests-jobbet igen 2 gange med PRÆCIS samme
fejl, BEGGE gange i selve Pass 1 — den isolerede kørsel af filen ALENE, uden
en eneste anden worker aktiv:
- Run 30836291715, attempt 1, 17:20 (branch fix/2041-clarity-stitching) —
  maskeret i `gh run list`, fordi en automatisk/manuel re-run (attempt 2)
  bagefter var grøn, så run'ets SLUT-konklusion viste "success". Fundet kun
  ved at scanne `run_attempt > 1` via GitHub REST API direkte.
- Run 30840936886, 18:22 (branch feat/3188-datatable-sort) — synlig direkte
  i `gh run list --status failure`.

## Rod-årsag (korrigeret)
Concurrency-teorien fra #3222 var forkert. Buggen (nodejs/node#64061, en
signed/unsigned-fejl i test-runnerens `processRawBuffer`) trigges af selve
STØRRELSEN/FORMEN af `economyEngine.test.js`'s IPC-payload — ikke af
samtidig trafik fra andre workers. At isolere filen fra andre workers
reducerede sandsynligvis kun TIMINGEN af buffer-chunks nok til at sænke
frekvensen, men fjernede aldrig selve den sårbare kodesti: filen kører
STADIG som en separat child-worker der streamer resultater tilbage via
socket + structured-clone, uanset om den er alene eller ej.

## Fix
`backend/scripts/run-tests.js` Pass 1 kører nu med
`--test-isolation=none`, som får node:test til at eksekvere filen i SAMME
proces som `node --test`-invokeringen i stedet for at spawne en
child-worker. Uden en child-worker er der intet IPC-round-trip for denne
fil, så `processRawBuffer`/`FileTest.parseMessage` (begge i hver eneste
crash-stack-trace) kaldes aldrig for filen — bug-klassen kan strukturelt
ikke trigges, uanset payload-størrelse eller samtidig CI-belastning.

Scope bevidst begrænset til Pass 1 (kun denne ene fil). Pass 2 (~340 øvrige
filer) beholder standard proces-pr-fil isolation uændret — at slå isolation
fra for HELE suiten ville risikere global-state-lækage mellem urelaterede
testfiler, en langt større blast radius end nødvendigt for ét payload.

## Verifikation
- 25/25 kørsler af `node --test --test-isolation=none lib/economyEngine.test.js`
  lokalt: grønt hver gang, 105/105 tests.
- 25/25 kørsler med standard isolation (baseline, ingen lokal reproduktion —
  ventet, buggen er sjælden og primært set på CI's Ubuntu-runner).
- Bekræftet exit-kode-korrekthed: en kunstigt fejlende test under
  `--test-isolation=none` exit'er stadig 1 (fejl undertrykkes ikke).
- Bekræftet strukturelt: uden isolation vises INGEN "✔/✖ lib/economyEngine.test.js
  (Xms)"-wrapper-linje i output (den linje der kom fra `FileTest.parseMessage`
  i alle crash-traces) — beviser den sårbare kodesti er bypasset, ikke bare
  undgået ved timing.
- 4× fuld `npm test` (4988/4988) grønt lokalt efter ændringen.

## Læring
En "kør den isoleret"-fix er kun en RIGTIG fix hvis isolationen faktisk
fjerner den mekanisme buggen lever i. Her fjernede "isoleret proces" kun
KONKURRENCEN om IPC-båndbredde, men beholdt selve IPC-mekanismen (socket +
structured-clone) som buggen sidder i — deraf den falske tryghed fra 5/5
lokale grønne stress-runs (samme sjældne-timing-problem som i CI, bare
lavere sandsynlighed lokalt). Når rod-årsagen er en bug i en SPECIFIK
kode-mekanisme (her: cross-process IPC-deserialisering), er den robuste fix
at fjerne selve mekanismen for det sårbare payload (`--test-isolation=none`),
ikke at ændre hvornår/med-hvem den kører. Bonus: `gh run list` viser kun
SIDSTE attempt's konklusion — en flake der bliver maskeret af en efterfølgende
grøn re-run er usynlig uden at tjekke `run_attempt > 1` via GitHub's REST API
direkte (`gh api .../runs?created=...`).
