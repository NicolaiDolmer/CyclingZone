# Claude-session: PR-afslutning + bølgekæde C0 → C → D → E (ejeren kopierer alt i kodeblokken)

```
Du arbejder i C:\Dev\CyclingZone (github.com/NicolaiDolmer/CyclingZone). Svar på dansk. Ny session; al state ligger i filer og på GitHub.

SÅDAN TALER DU MED MIG
* Hverdagsord. Ingen tekniske gloser uden forklaring i samme sætning. Korte beskeder.
* Ét spørgsmål ad gangen, anbefaling først, ja/nej hvis muligt. Nøgletal står I SELVE SPØRGSMÅLET.
* Nævn ALDRIG datoer eller "kan ikke nå" som argument. Du udskyder intet. Rækkefølgen er min.
* Ejer-kommandoer: ét klik (kodeblok tagget bash, aldrig interaktive prompts via Run-knappen). Links direkte til den side jeg skal bruge.

MÅLET FOR SESSIONEN
Få de åbne PR'er fulgt til dørs OG byg videre samtidig. Kæde: bølge C0 (#5562 alene) → bølge C (11 spor) → bølge D (løfterne) → bølge E (mobil/hastighed/vækst). Args: docs/drafts/wave-2026-09-23-bC0.json og -bC.json (læs med Read, send objektet). D og E skriver du selv (se nedenfor).

FØRST (maks 30 min med mig)
0. PARALLEL START: forrige session (orkestratoren fra 23/9) kører stadig merge-køen færdig og en opfølgning på #5564. Start ALDRIG en bølge, preflight -Fix eller close-out-cleanup, før PR #5569 (patch note v7.295, sidst i køen) er merget: gh pr view 5569 --json state. Rør ikke #5564, før dens opfølgning har pushet og CI er grøn. Start med punkt 3 (go-kort), og tag punkt 1-2 når #5569 er merget.
1. Markøren: node scripts/wave-policy.mjs assert-idle skal være idle. Er den ikke: bed mig om én klik-kommando (recover med --wave-id/--owner hvis ejer-sessionen er død; aldrig --owner-override via Run-knap).
2. Preflight: pwsh -File scripts/preflight-night-wave.ps1 -Fix -StartKeepAwake skal sige [GO]. Start bølge C0 (#5562: merges under bølger uden fil-overlap, tungeste spor først, rullende optag, reviewer på opus).
3. PR-afslutning, ét go-kort ad gangen, bygget på DIFFEN og ægte-data-billeder: #5564 træningssiden (#5485, 3 A-valg), #5556 Stats-akademifilter, #5558 roadmap-tekster, #5563 flag-endpoint + Hjælp, #5549 U23-sider (bag flag), #5557 late-fill-log, #5555 Discord-invite-script (dry-run), #5554 apiFetch B (draft: gør færdig eller luk). Kategori 3 merger du selv: #5559 e2e-typecheck (+ tilføj #5489-testlinjen i ci.yml bagefter), #5523 flip-rapport. Billeder: prototypen C:\Users\Nicolai\OneDrive\CyclingZone-context\tools\pr-shots-prototype.mjs (Edge-profil, ét login; build fra worktreets frontend-mappe; SHOT_VP, SHOT_CLICKS, compose; OUT = OneDrive private-handoffs/pr-shots). Tjek flag-tilstanden i prod før du viser et billede, og sig hvad der er beta.
4. Når #5562 er merget (kategori 3) og pullet: start bølge C, og kør merge-køen med godkendte PR'er SAMTIDIG (merge-queue må nu merge PR'er uden fil-overlap med bølgen).

BØLGE D (løfterne i roadbooken først; tjek FØRST at intet er lavet eller har en åben PR)
* #5238 formpas dagen før løb (ejer-beslutning 14/9 på #4633; forudsætning #3763).
* Ugeplanen sætter sessionen pr. løbsdag (løfte 21; opret issue først, søg dubletter).
* U23/junior-ligaerne S4 stillinger, S5 rytterrangliste, S6 op/nedrykning fra docs/superpowers/plans/2026-09-23-u23-junior-ranglister-plan.md (under #4620). S3 seed er ejer-gated.
* #5456 Vifteøvelser/Brostenssektorer ned på vo2max-familiens vægtsum (ejer-retning A 23/9, spillervendt tal = merge kun på mit go).
* #5418 skadeadvarsel fra træthed 70 (to trin), kun efter #5564 er merget (samme fil).
* Motor-sporene fra min designsession (se #4914/#4915 og OneDrive private-handoffs/2026-09-23-race-engine-design.md).
* IKKE #4263: den er #5443 trin 2 (søndags-kvittering) og venter på mit #5497-valg.
BØLGE E: #5402 indstillinger i faner, #5124 rest (sæsonmatricen på mobil), #5177 rest, #5304 click-ids, #5474 sæsonpause-kommunikation.

FASTE REGLER
* Byg KUN via wave.js; model eksplicit pr. spor. Spor-beskrivelser skrives af READ-ONLY-agenter (opus) der læser issue + kode + åbne/mergede PR'er FØR bølgen (virkede 23/9: fandt dubletter og allerede løste dele).
* Merge: kun på mit ordrette "merge", undtagen kategori 1-3. UI-PR = ægte-data-billeder desktop + mobil som fil FØR jeg spørges. Flag-gatede flader: sig det og vis mock eller "ikke synlig fordi X".
* Ingen --apply, ingen flag-flip, intet skrevet til prod uden mit "kør" med tal. Migrationer applies af CI ved merge; du post-verificerer straks.
* Spillerklager starter med prod-måling. Private tal kun i OneDrive private-handoffs.
* Spillervendt tekst: EN først, DA under, jeg/du, ingen em-dash, kort. Discord KUN EN. Patch note pr. merge-dag (samlet, én PR).
* Deploy verify læser nu Railway via API (RAILWAY_TOKEN sat 23/9, #5489): en rød deploy-verify er en rigtig fejl, undersøg den.

UDFORDR STATUS QUO (i pauserne, højst 4, ét ad gangen, "i dag / bevis / forslag / pris")
* WIP-grænse: 27 åbne PR'er 23/9 kl. 17. Forslag: ny bølge starter kun når åbne PR'er ≤ 12.
* Ejer-trin som ét klik: morgenen 23/9 gik tabt, fordi bekræftelsessætningen ikke havde en knap og Run-knappen sendte et tomt linjeskift ind i en interaktiv prompt. Forslag: alle ejer-trin uden interaktive prompts (flag i stedet), og en test af hver knap-kommando før den sendes.
* Patch notes: 23/9 blev 10 spillervendte merges samlet manuelt. Forslag: close-out-scriptet foreslår v7.x-entries fra PR-bodies' "Patch note"-afsnit, jeg godkender i ét kort.
* Spec-agenter før hver bølge (READ-ONLY): gør det til fast fase 0 i wave.js.

MINE GO-PUNKTER
"merge" pr. PR (undtagen kategori 1-3) · "kør" på kalender-apply (#5405) og #4857-backfill · alle flag-flips (training_score_visible, training_mobile_table, youth_squad_pages, race_engine_v4 m.fl.) · #5497 "godkendt til build" · owner-override af markøren · ja/nej til hvert status quo-forslag.

NÅR DU STOPPER
Opdatér docs/NOW.md (maks 1.200 tokens, Next action + Working agent nulstillet), kør pwsh -File scripts/check-agent-token-hygiene.ps1, status på hvert rørt issue, claude:done på det der er merget, pwsh -File scripts/close-out-cleanup.ps1. Morgenrapport i OneDrive private-handoffs (hvad der er bygget, én linje pr. PR, mine valg sorteret efter S4-kritikalitet, hvad der stoppede) + kortene til morgenblokken kl. 08:30. Skriv en ny sessions-prompt i samme stil. Sidste linje: "Ny session anbefales: <hvad næste session starter med>".

FØRSTE SVAR: tre linjer: er markøren idle (ja/nej), hvor mange åbne PR'er og hvor mange af dem kan merges i dag, og hvad du går i gang med.
```

Ny session anbefales: preflight → bølge C0 (#5562) → go-kort på de 9 ventende PR'er med ægte-data-billeder → bølge C.
