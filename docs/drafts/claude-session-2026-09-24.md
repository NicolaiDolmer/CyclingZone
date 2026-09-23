# Claude-session: 6-timers bølge (ejeren kopierer alt i kodeblokken)

```
Du arbejder i C:\Dev\CyclingZone (github.com/NicolaiDolmer/CyclingZone). Svar på dansk. Ny session; al state ligger i filer og på GitHub.

SÅDAN TALER DU MED MIG
* Hverdagsord. Ingen tekniske gloser uden forklaring i samme sætning. Korte beskeder.
* Ét spørgsmål ad gangen, én sætning, anbefaling først, ja/nej hvis muligt. Nøgletal står I SELVE SPØRGSMÅLET (jeg ser ikke altid teksten før kortet).
* Nævn ALDRIG datoer eller "kan ikke nå" som argument. Du udskyder intet. Rækkefølgen er min.
* Byg, vis fremdrift og skærmbilleder. Ingen lange lister.

MÅLET FOR SESSIONEN
Én bølgekæde på cirka 6 timer, der kører mens jeg er væk: bølge 0 (markør-rettelsen) → bølge A (12 tunge spor) → bølge B (11 lettere spor). Args-filerne ligger klar: docs/drafts/wave-2026-09-24-b0.json, -bA.json, -bB.json. Læs dem med Read og send objektet (ikke stien).

FØR JEG GÅR (maks 15 min med mig)
1. Tjek bølge-markøren (.claude/run/wave-active.json). Findes den fra en tidligere bølge: bed mig køre `Set-Location C:\Dev\CyclingZone; node scripts\wave-policy.mjs recover --owner-override` og skrive bekræftelsessætningen i terminalen. Slet/ret aldrig markøren selv.
2. Preflight: `pwsh -File scripts/preflight-night-wave.ps1 -Fix -StartKeepAwake` skal sige [GO].
3. Stil mig de åbne valg fra OneDrive private-handoffs/2026-09-23-morgenrapport.md ét ad gangen, KUN dem der ændrer hvad der bygges i nat: (a) værdier #5497 (grænserne i den nye normal → "godkendt til build"?), (b) træningssiden #5485 (3 små valg på billedet docs/design/mockups/5485/5485-foer-efter.png), (c) grupetto #5521 (a/b), (d) træningsklager #5456/#5418 (vægt + advarsel), (e) Quad9 #5323 (A/B). Hvert ja bliver et byggespor i bølge B i stedet for et af de lette sonnet-spor (#4875, #5075, #5534 først ud). Et nej/ubesvaret bygges ikke.
4. Vis mig planen i ÉT kort (spørgsmålet selv indeholder bølge 0/A/B med issue-numre) og få "go". Launch bølge 0 i samme tur som go.

KÆDEN (sådan kører du)
* Bølge 0: #5533 (stabil boot-identitet). Når den er grøn: merge den selv (kategori 3), `git pull` i hoved-checkoutet (hooken læser wave-policy.mjs derfra), og tjek at `node scripts/wave-policy.mjs assert-idle` er idle.
* Bølge A: 12 spor, U23-vagterne (#5535 S1, #5536 S2, #5537 S9) kræver at A2 (PR #5525) er merget OG applied (races.squad findes i prod); ellers erstat dem med #4948, #5386, #5375 fra bølge B og sig det.
* Mellem bølger: merge kun kategori 1-3 (Dependabot patch/minor, docs uden spillertekst, CI/scripts/test-only) via `scripts/merge-queue.ps1 -Pr "N"`, én ad gangen, aldrig mens en bølge kører. Tjek boot-drift før hver bølge: `(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks` mod markørens bootId.
* Bølge B: 11 spor (+ ejer-godkendte byggespor fra valgene).
* Undervejs: PR-vagt med Monitor (re-arm hver 30. min), opfølgninger med WAVE-FOLLOWUP: i samme worktree ved rød CI, reviewer-BEMÆRKNINGER samles til issues samme nat (dublet-søg først), undersøgelsesrapporter gemmes i OneDrive private-handoffs + opsummering på issuet (ingen private tal i repo).

FASTE REGLER
* Byg KUN via wave.js. model eksplicit pr. spor; skift aldrig opus/sonnet uden at sige det.
* Merge: kun på mit ordrette "merge", undtagen kategori 1-3. UI-PR = ægte-data-billeder desktop 1440 + mobil 390 som fil FØR jeg bliver spurgt.
* Ingen --apply, ingen flag-flip, intet skrevet til prod. Migrationer applies af CI ved merge; du post-verificerer.
* Spillerklager bygges først med prod-måling af klagen (#5509). "Færdig" = kan tændes og er testet tændt (#5507).
* Ingen hold-/rytternavne eller private tal i repo/issues/PR-bodies (private tal: C:\Users\Nicolai\OneDrive\CyclingZone-context\private-handoffs\).
* Spillervendt tekst: EN først, DA under, jeg/du, ingen em-dash, kort på fladen. Discord KUN EN.

MORGENRAPPORT NÅR KÆDEN ER FÆRDIG
Én fil i OneDrive private-handoffs (send den med SendUserFile): 1) hvad der blev bygget, 2) tabel med én linje pr. PR (hvad / kræver), 3) mine valg sorteret efter S4-kritikalitet, anbefaling først, 4) hvad der stoppede og hvorfor. Træningssidens og UI-PR'ernes billeder samlet.

UDFORDR STATUS QUO (i pauserne; bevis fra 22-23/9, bekræft eller afkræft med data)
* Én bølge ad gangen giver tomme laner i halen: i bølge 3 stod tre laner tomme mens de sidste opus-spor blev færdige. Forslag: mål hale-tomgangen pr. bølge i nat, og foreslå rullende optag (nyt spor ind når en lane frigives).
* Reviewer på sonnet: fangede .js/.ts-brud, men gav et forkert BLOKERENDE på #5532 (kolonnen er NOT NULL i prod). Forslag: reviewer på opus + skal slå skema/prod op før "blokerende".
* Ægte-data-billeder er den største ventetid for UI-PR'er (hver preview-URL kræver sit eget login). Forslag: én fast lokal origin (vite mod prod-API), så ét login dækker alle PR'er.
* Beslutninger hober sig op (11 i morgenrapporten + 11 i tændingsplanen). Forslag: fast daglig 15-minutters beslutningsblok med kortene klar.
Højst 4 forslag, hvert med "i dag / bevis / forslag / pris", stillet ÉT ad gangen. Genåbn ingen låste beslutninger.

MINE GO-PUNKTER (spørg kun her)
"merge" pr. PR (undtagen kategori 1-3) · "godkendt til build" på #5497 · "kør" på kalender-apply (#5405), #4857-backfill og #4619-backfill · alle flag-flips · ratingGolden · owner-override af markøren · ja/nej til hvert status quo-forslag.

NÅR DU STOPPER
Opdatér docs/NOW.md (maks 1.200 tokens, Next action + Working agent nulstillet), kør `pwsh -File scripts/check-agent-token-hygiene.ps1`, status på hvert rørt issue, claude:done på det der er merget, `pwsh -File scripts/close-out-cleanup.ps1`. Skriv en ny sessions-prompt i samme stil med nyt status quo-afsnit. Sidste linje: "Ny session anbefales: <hvad næste session starter med>".

FØRSTE SVAR: tre linjer: findes markøren (ja/nej), er A2 (#5525) merget og applied (ja/nej), og hvad du går i gang med.
```

Ny session anbefales: tjek markøren, stil de 5 bygge-relevante valg fra morgenrapporten, og start kæden med bølge 0 (#5533).
