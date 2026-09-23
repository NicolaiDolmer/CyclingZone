# Claude-session 23/9 (b): efter natbølgen (ejeren kopierer alt i kodeblokken)

```
Du arbejder i C:\Dev\CyclingZone (github.com/NicolaiDolmer/CyclingZone). Svar på dansk. Ny session; al state ligger i filer og på GitHub.

SÅDAN TALER DU MED MIG
* Hverdagsord. Ingen tekniske gloser uden forklaring i samme sætning. Korte beskeder.
* Ét spørgsmål ad gangen, én sætning, anbefaling først, ja/nej hvis muligt. Nøgletal står i selve spørgsmålet (jeg ser ikke altid teksten før kortet).
* Nævn ALDRIG datoer eller "kan ikke nå" som argument. Du udskyder intet. Rækkefølgen er min.
* Byg, vis fremdrift og skærmbilleder. Ingen lange lister.

FØRSTE SKRIDT
* Tjek om bølge-markøren stadig sidder fast (`.claude/run/wave-active.json`, boot-drift #5533). Gør den: bed mig køre `node scripts/wave-policy.mjs recover --owner-override` i min egen terminal. Slet/ret aldrig markøren selv, og brug ikke `recover` som genvej.

FASTE REGLER
* Byg KUN via bølger: Workflow({ scriptPath: "C:\Dev\CyclingZone\.claude\workflows\wave.js", args: <objektet> }). Læs args-filen med Read, send objektet. model eksplicit pr. spor; skift aldrig opus/sonnet uden at sige det.
* Merge: kun på mit ordrette "merge", UNDTAGEN kategori 1-3 (Dependabot patch/minor, docs uden spillertekst, CI/scripts/test-only), som du selv merger når CI er helt grøn (ejer 22/9, #5508). UI-PR = ægte-data-billeder desktop 1440 + mobil 390 sendt som fil FØR du beder om merge. Merge via `scripts/merge-queue.ps1 -Pr "N"`, én ad gangen, aldrig mens en bølge kører. Efter merge: claude:done straks.
* Intet PR-loft længere (#5510). Lanerne (4) og verifikations-semaforen (2) er bremsen.
* Ingen --apply, ingen flag-flip, intet skrevet til prod uden mit go. Migrationer applies af CI; du post-verificerer.
* Spillerklager bygges først når issuet har en prod-måling der viser klagen (#5509). "Færdig" = kan tændes og er testet tændt (#5507).
* Ingen hold-/rytternavne eller private tal i repo/issues/PR-bodies. Private tal: `C:\Users\Nicolai\OneDrive\CyclingZone-context\private-handoffs\`.
* Worker-briefs: hard rule 31 (nye frontend-filer inkl. e2e i .ts/.tsx) og CI-vagt #4479 (nævn aldrig en testfil der ikke findes) står i hvert spor.

LÆS FØRST
1. docs/NOW.md øverste blok.
2. OneDrive private-handoffs/2026-09-23-morgenrapport.md (PR-tabel + mine 10 valg).
3. docs/drafts/wave-2026-09-23-b4.json (12 spor) og wave-2026-09-23-b5-carry.json.

OPGAVER I RÆKKEFØLGE
1. Stil mig morgenrapportens valg ét ad gangen (værdier #5497 først, så grupetto #5521, TTT #5524, #5529-reglen, Quad9, træningsklager, sprinter-data, roadmap).
2. Ægte-data-billeder af UI-PR'erne (#5526 #5527 #5528 #5514 #5513) i ét login, ét samlet før/efter-billede pr. PR, så mine "merge".
3. Merge #5523 (kategori 2) og S4-kalender-PR #5522 på mit "merge", derefter kalenderens --apply på mit "kør" (tændingsplan #5506 trin 1).
4. Bølge 4 (b4.json): løbsforsinkelser #3624 først. Derefter bølge 5 fra carry-filen + det jeg siger ja til i valgene.
5. Samlet patch note v7.295 (#5481) når UI-rettelserne er merget og live (kladde i sessionens scratchpad; kun det der er live). Discord-tekst KUN EN som udkast.
6. #5533 (boot-drift) som kategori 3-spor, så markøren ikke sidder fast igen.

UDFORDR STATUS QUO (sideløbende, i pauserne). Bevis fra natten 23/9, bekræft eller afkræft med data:
* Én bølge ad gangen: bølge 3's lange opus-spor holdt tre laner tomme i halen, og én fejl (markøren) stoppede resten af natten. Forslag: mål hale-tomgang pr. bølge og overvej rullende admission (nyt spor ind når en lane frigives, uden ny bølge).
* Reviewer på sonnet: fangede #5513's .js-brud, men gav et forkert BLOKERENDE på #5532 (kolonnen er NOT NULL). Forslag: reviewer på opus + skal verificere mod skema/prod før "blokerende".
* Ægte-data-billeder er den største ventetid for UI-PR'er (hver preview-URL kræver sit eget login). Forslag: én fast lokal origin (vite mod prod-API) så ét login dækker alle PR'er.
* 11 åbne ejer-valg om tændingsplanen og 10 i morgenrapporten: beslutninger hober sig op hurtigere end de tages. Forslag: fast daglig 15-minutters beslutningsblok med kortene klar.
Højst 4 forslag, hvert med "i dag / bevis / forslag / pris", stillet ÉT ad gangen. Genåbn ingen låste beslutninger.

MINE GO-PUNKTER (spørg kun her)
"merge" pr. PR (undtagen kategori 1-3) · "godkendt til build" på #5497 · "kør" på kalender-apply, #4857-backfill og #5405-apply · alle flag-flips · ratingGolden · owner-override af markøren · ja/nej til hvert status quo-forslag.

NÅR DU STOPPER
Opdatér docs/NOW.md (maks 1.200 tokens, Next action + Working agent nulstillet), kør `pwsh -File scripts/check-agent-token-hygiene.ps1`, status som kommentar på hvert issue du har rørt, claude:done på det der er merget, `pwsh -File scripts/close-out-cleanup.ps1`. Skriv en ny sessions-prompt i samme stil. Sidste linje: "Ny session anbefales: <hvad næste session starter med>".

FØRSTE SVAR: tre linjer: sidder markøren fast (ja/nej), hvor mange nat-PR'er venter, og hvad du går i gang med.
```

Ny session anbefales: frigiv bølge-markøren (owner-override), stil morgenrapportens værdivalg (#5497), og start bølge 4 med løbsforsinkelserne (#3624).
