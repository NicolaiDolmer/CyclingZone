# Claude-session 24/9-b: bølge C0b (natten) → motor-runde 2 + bølge C (ejeren kopierer alt i kodeblokken)

```
Du arbejder i C:\Dev\CyclingZone (github.com/NicolaiDolmer/CyclingZone). Svar på dansk. Ny session; al state ligger i filer og på GitHub. Forrige session (23/9-c) er lukket.

SÅDAN TALER DU MED MIG
* Hverdagsord. Ingen tekniske gloser uden forklaring i samme sætning. Korte beskeder.
* Ét spørgsmål ad gangen, anbefaling først, ja/nej hvis muligt. Nøgletal står I SELVE SPØRGSMÅLET.
* Nævn ALDRIG datoer eller "kan ikke nå" som argument. Du udskyder intet. Rækkefølgen er min.
* Ejer-kommandoer: ét klik (kodeblok tagget bash, aldrig interaktive prompts). Links direkte til siden.
* Før du foreslår et Discord-opslag: læs kanalen LIGE FØR (mcp__discord__discord_read_messages), og sig hvornår du læste den.

MÅLET
Følg bølge C0b til dørs i nat, og byg motoren videre. Kæde: C0b (9 spor) → motor-runde 2 + bølge C (rullende optag, når #5562 er merget) → runde 3-4 → D (løfterne) → E. Args til C0b: OneDrive private-handoffs\wave-2026-09-23-bC0b.json (læs med Read, send objektet; privat fordi motorsporene står der).

FØRST
1. node scripts/wave-policy.mjs assert-idle skal være idle. Tjek at C0a's PR'er er merget: gh pr view 5587 5564 5556 5554 5521 5588 --json state (se NOW.md; det der ikke er merget, tager du som go-kort, og merge-køen skal være færdig før bølgen).
2. pwsh -File scripts/preflight-night-wave.ps1 -Fix -StartKeepAwake skal sige [GO]. Start C0b fra DENNE session (bølgen ejes af den session der starter den). Rækkefølge i filen: #5589 dashboard-fejlen først (brand: 69 hold manglede vinderen 23/9), så #5562, motor-runde 1 (#5576 #5570 #5571), #5246 (#5557-rettespor, blocker rettet), #2761 Discord-kort, #4592 parkeret økonomi (A med løn), #452 tilmeldingskortet øverst.
3. Når C0b er færdig: merge #5562 FØRST (kategori 3). Derefter kan merge-køen merge PR'er uden fil-overlap mens bølger kører. Post-verificér #5589 i prod: Bad At Names' dashboard viser vinder på alle afsluttede kort.

MINE GO-PUNKTER I C0b-RESULTATET
* #5589: "merge" (brand-fejl, billede af dashboardet før/efter med ægte data).
* #2761 Discord-kort: billede → min tekst-go → "kør" på sendDiscordInviteBackfill.mjs --execute (212 managers; kun efter dry-run-tal).
* #4592 parkeret økonomi: "merge" før "Afslut sæson" 27/9.
* #452 tilmeldingskortet øverst: billede desktop + mobil → "merge".
* Motor-runde 1: #5576 ITT (flip-blokker) "merge"; #2789 er merget i C0a.

BØLGE C + MOTOR-RUNDE 2 (efter C0b; rullende optag når #5562 er merget)
* Runde 2: B2 #5577 sejrstype (UI, preview-go), B4 #5580 indsats model 3 (min realisme-kontrol med måltal FØR merge; beslutning 23/9 på PR #5521), B8 #5059 ordrer synlige (UI), B9 #5572 population (flyt ikke gaten/§7b uden mit go). Plus #5579 (kræver #5521 merget; dens gate er rød med egne defaults). tuning.ts, index.ts, segmentLoop.ts, headToHeadAnchors.js: én lane ad gangen.
* Bølge C: docs/drafts/wave-2026-09-23-bC.json (11 spor). Udvid #5568 med pladsvisningen fra #5547-reviewet (api.js ca. 18336 max 8, RiderManageActions.jsx:120, help.json "Academy size (8 places)"); api.js ejes også af #5415, så læg dem ikke i samme bølge eller flyt linjen.
* Spec-agenter (READ-ONLY, opus) læser issue + kode + åbne/mergede PR'er før hver bølge; diff-tjek med READ-ONLY-agent før hvert go-kort (fandt 3 fejl 23/9).

FASTE REGLER
* Byg KUN via wave.js; model eksplicit pr. spor. Under en bølge er Workflow blokeret; kun READ-ONLY:-agenter.
* Merge: kun på mit ordrette "merge", undtagen kategori 1-3. UI-PR = ægte-data-billeder desktop + mobil som fil FØR jeg spørges. Billedværktøj: OneDrive tools\pr-shots-v2.mjs (kør fra PowerShell, ikke Git Bash: /ruter bliver til Windows-stier). Den blokerer alle skrivninger fra test-browseren og har SHOT_DEMO=nobeta (almindelig telefonvisning), SHOT_DEMO=signup, SHOT_SCROLLTO="tekst" og SHOT_VP="1440x900,390x844,844x390". Saml billeder med tools\compose-marks.mjs (røde rammer via beforeMarks/afterMarks i procent). Billedstationen #5565 erstatter den, når den er merget.
* Ingen --apply, ingen flag-flip, intet skrevet til prod uden mit "kør" med tal. Migrationer applies af CI; post-verificér straks.
* Spillervendt tekst: EN først, DA under, jeg/du, ingen em-dash, kort. Discord KUN EN. Patch note pr. merge-dag (samlet, én PR).

MORGENBLOK 08:30 (ét kort ad gangen, se OneDrive private-handoffs\2026-09-24-morgenrapport.md)
S4-kalender "kør" (hvis ikke gjort) · træningsside-flips efter Android-test · Discord-invite · #5558 roadmap · #5268 · #5497 · #5538/#5539/#5540 · #5323 · #4514 · #4269 token · 6 UI-tjek (#5471 #5472 #5417 #5386 #5313 #5486).

NÅR DU STOPPER
Opdatér docs/NOW.md (maks 1.200 tokens, Next action + Working agent nulstillet), pwsh -File scripts/check-agent-token-hygiene.ps1, status på hvert rørt issue, claude:done på det merget, pwsh -File scripts/close-out-cleanup.ps1. Morgenrapport i OneDrive private-handoffs. Ny sessions-prompt i samme stil. Sidste linje: "Ny session anbefales: <hvad næste session starter med>".

FØRSTE SVAR: tre linjer: er markøren idle (ja/nej), hvilke C0a-PR'er der mangler merge, og om C0b er startet.
```

Ny session anbefales: preflight → start bølge C0b (#5589 dashboard-fejlen først) → merge #5562 først efter bølgen → motor-runde 2 + bølge C med rullende optag.
