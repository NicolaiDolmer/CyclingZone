# Startprompt: natsession 2/10 (race-motor + løfter)

```
/loop Natsession 2/10 i C:\Dev\CyclingZone. Ejeren sover; ingen ejer-svar før morgen. Fokus: race-motoren, ejerens løfter til spillerne og spillernes vigtigste klager. Giro della Penisola (17 etaper) kører etape 1 i dag kl. 11.00 og etape 2 kl. 17.00.

START
1. Læs CLAUDE.md, docs/NOW.md, docs/NIGHT_WAVE_RUNBOOK.md (FØR enhver bølge) og den seneste kommentar på #6013. Sæt dig som Working agent i NOW.md.
2. Bølgelåsen: .claude/run/wave-active.json ejes af hovedsessionen 1/10 (waveId 47f874c9-...). Overskriv den ALDRIG og start ikke en ny bølge, mens den kører. Nye spor lægges ind med `node scripts/wave-policy.mjs enqueue --wave-id <waveId> --tracks-file <fil>` (ejerskab må ikke overlappe kørende spor). Først når bølgen er færdig og markøren er væk, må du starte en ny via `Workflow({ scriptPath: "C:\Dev\CyclingZone\.claude\workflows\wave.js", args: { tracks: [...] } })`. Maks 4 laner; `model` eksplicit på hvert spor.
3. Self-pace med ScheduleWakeup: ca. 20-30 min mellem tjek, når du venter på laner/CI; aldrig blokerende polling.

STATUS VED START (verificér selv, stol ikke på listen)
- #6032 (#5957 "løbene føles tilfældige", finalens dagsform/reserve skaleret med evnen): ejer-"merge" givet 2/10 ca. 00.15, sendt gennem scripts/merge-queue.ps1. Klassificeret som beregningsfejl → gælder fra næste ikke-kørte etape. TJEK: merget, main-CI grøn, Railway-deploy SUCCESS og "Deploy verify" grøn FØR kl. 11.00. Hvis ikke merget/deployet: find årsagen og få den igennem (ejer-go foreligger). Genafspil af 208 S4-etaper (privat: balance-internals/5957/replay-s4-2026-10-02.png): flad 0,31→0,59 (S3 0,80), rullende/kuperet over S3, brosten uændret.
- Bølgens spor: #6030 bundle (PR #6031), #5955 B GC-reaktion bremser lad-gå (PR #6033, slukket), #5911 aftenafregning (PR #6044), #6034 "Flat +10%"-copy (løfte), #6046 brosten (i kø). #6035 (løfte: vælg rytter før program) venter på at #6030 frigiver frontend/src/components/training/; en baggrunds-retry i hovedsessionen køer den automatisk.
- Replay-cache med alle S4-kørsler: C:\Dev\CyclingZone-worktrees\replay-5957-main\balance-internals\5957\replay-cache.json. Brug `backend/scripts/dev/replay5957.mjs` før/efter til ALLE motor-rettelser i nat (samme 208 etaper).

NATTENS OPGAVER (prioriteret)
A. Motor, spillernes klager:
  1. #6046 brosten: sørg for at lanen kører; resultat = PR + replay før/efter + klassifikation.
  2. Resten af hullet på flad (0,59 mod S3 0,80): find næste årsag med replay. Kandidater: udbrud på 7-8 ryttere mod ca. 2 i S3 (#5914/#5951), manglende bunch-tid i samme gruppe (#4702/#3917). Nyt issue + spor.
  3. Spillercases fra Discord 1/10 (på #5957): rytter der tabte 21 min i sit første hele løb (ez4prebren), U23-sejr med 6 min (robsteren), løbsfilmen siger "Caught before the line" uden at nævne hvem (mandia). Genafspil efter #6032; ret det der stadig er galt (filmteksten skal nævne aktøren).
  4. #5955 B (PR #6033): merge efter den stående regel (motor bag slukket v4: grøn CI + rent diff-tjek + CodeRabbit), derefter genkør kalibreringen oven på #6032. Byg spillerfladerne til orders_gc_v1 (taktikkort, løbsfilm, Hjælp en+da) som PR med før/efter-billede; INTET tændes.
B. Ejerens løfter:
  5. #6034 "Flat +10%" og #6035 "vælg rytter først": PR'er med før/efter-billede (1440 + 390).
  6. Train now-flip: ejeren vil se "Trænet nu"-visningen virke i prod før flip. Find i prod (read-only) et beta-hold, der har trykket Train now på 2/10 før aftenafregningen, og dokumentér rapportdata. Tryk ALDRIG Train now på ejerens hold. Forbered flip-kortet med skærmbillede.
  7. #5992 formplanlæggeren (peak mod kørte løb, U23/junior vises): PR med billede.

REGLER I NAT
- Ingen prod-skrivninger, ingen flag-flip, ingen migration-apply, ingen merge af noget der ændrer spillersynlig adfærd eller tekst (ejer-"merge" kræves; kun de stående regler i CLAUDE.md gælder). #6032 er undtaget: ejer-go givet.
- Spillertekst: kun fakta, docs/TONE_OF_VOICE.md læst helt, ingen opfundne meta-/følelsessætninger, ingen em-dash, EN+DA.
- Balance-tal kun privat (balance-internals/), aldrig i PR-body/issues.
- Loop-guard: 2 CI-fejl på samme symptom → stop sporet og notér det.
- Workers rører aldrig docs/NOW.md; bølge = ingen patch note pr. PR.

MORGENPAKKE (klar senest kl. 08.30, ejeren læser den ved opvågning)
- Ét kort pr. beslutning, i prioriteret rækkefølge, hvert med ÉT samlet før/efter-billede (sendt som fil) og nøgletal i selve spørgsmålet: #6046 brosten, næste flad-rettelse, #6033-flader, Train now-flip, #6034, #6035, #5992, #6044.
- Status på #6032 i prod: deploy + Giroens etape 1 (efter kl. 11: mål korrelationen på etapen).
- Opdatér docs/NOW.md (Next action + Working agent), kommentér issues, flip claude:done efter merge, kør close-out-scripts (token-hygiejne, close-out-cleanup, status-board).
```
