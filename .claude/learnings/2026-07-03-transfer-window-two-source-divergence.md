# To accessorer til samme afskaffede state divergerede (transfervindue)

**Dato:** 2026-07-03 · **Issue:** #1996 (del 1, PR #2151)

## Symptom

Transfervinduet blev afskaffet 2026-06-22 ved at hardkode `getTransferWindowOpen()` → `true`. Men en **anden** accessor til samme underliggende state, `getTransferWindowStatus()` (api.js), læste stadig `transfer_windows`-tabellen og returnerede `open:false` (én stale `'closed'`-række). Resultat: to kilder til "er markedet åbent" der modsagde hinanden.

Konkret latent bug: loan accept + buyout brugte `getTransferWindowStatus()` (=false) → `getLoanAgreementAcceptedStatus`/`getLoanBuyoutStatus` returnerede `window_pending`/`buyout_pending`. Lån/købsoptioner blev parkeret "til transfervinduet åbner" — men flushen kørte kun i den admin-vindue-åbning der aldrig sker mere. Deals ville sætte sig fast for evigt. (Prod: 0 hængende — lav lån-volumen reddede den fra at ramme nogen.)

## Root cause

At afskaffe en feature ved at pinne **én** accessor (`getTransferWindowOpen → true`) uden at fjerne/pinne **alle andre** læsere af samme state. Transfers/swaps gik gennem den pinnede accessor (korrekt); lån gik gennem den ikke-pinnede tabel-læser (forkert). Divergensen var usynlig fordi begge stier "virkede" isoleret.

## Fix

Én sandhed: fjern den divergerende accessor (`getTransferWindowStatus`) + de callsites den fodrede + admin open/close-endpoints (som kunne genskabe den modstridende tabel-state). Alle stier kører nu den pinnede altid-åben-adfærd.

## Læring

Når du afskaffer en feature ved at pinne en accessor til en konstant: **audit ALLE læsere af den underliggende state i samme PR** (`grep` tabelnavn + relaterede helper-navne), ikke kun den ene funktion du pinner. En efterladt anden-læser divergerer stille. Samme klasse som cluster `[[feedback_supabase_status_match]]` / label≠live-state: to repræsentationer af samme sandhed skal opdateres sammen eller kollapses til én.

Forward-guard: kommentaren over `getTransferWindowOpen()` dokumenterer nu at den er den eneste sandhed, og admin-endpoints der kunne genskabe divergensen er fjernet.
