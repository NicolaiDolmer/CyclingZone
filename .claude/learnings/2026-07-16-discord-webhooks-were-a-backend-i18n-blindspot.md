# Discord-webhook-templates lå helt uden for i18n-guard-dækningen

**Dato:** 2026-07-16 · **Refs:** #2520 (dansk Discord i EN-first server)

## Symptom

Alle spillervendte Discord-webhooks (auktion, transfer, resultat, board-DM)
var på dansk, selvom Discord-serveren er EN-first (dansk hører til i en
separat 🇩🇰-kategori). Fundet via manuel sweep 16/7 (@bobby2106).

## Hvorfor slap det igennem eksisterende guards

- `i18n-check-leaks.mjs` + `i18n-check-lib-strings.mjs` og core-smoke's
  "translated manager pages do not leak..."-test scanner **kun frontend**
  (`frontend/src/**` + locale-JSON). Discord-embeds bygges server-side i
  `backend/lib/*.js` og sendes direkte til Discord's REST-API — de rammer
  aldrig i18next, og dermed aldrig noget frontend-leak-scan.
- Backend HAR et separat, allerede-fixet mønster for spillervendt tekst
  (`transferNotifications.js`, #2174): EN-first fallback + i18n-kode/params
  til frontend-rendering af in-app-notifikationer. Discord-embed-builderne
  (`discordNotifier.js`, `adminSimulateRace.js`, `pcmResultsImport.js`,
  `deadlineDayReport.js`, `boardMidSeason.js`) fulgte ALDRIG dette mønster —
  de sender rå strenge direkte til Discord, uden om i18n-laget helt.
- Ingen backend-test asserter sprog på Discord-embed-output; kun struktur
  (felter findes, DNF-linje vises korrekt osv.).

## Fix

Oversat samtlige spillervendte Discord-embed-builders til engelsk (se PR for
#2520). Interne #ops-alarmer (stall-watchdog, bot-token-check, DM-outbox-død)
er bevidst IKKE rørt — de er staff-only per issue-scope og skal forblive
dansk.

## Læring (generaliserbar)

- **"Spillervendt tekst" er bredere end "frontend-tekst".** Enhver kanal der
  viser tekst til en manager — frontend-UI, in-app-notifikationer, e-mails,
  Discord-DM'er/webhooks — er en separat overflade der kan lække sprog
  uafhængigt af de andre. Et i18n-audit af "alt spillervendt" må eksplicit
  liste alle output-kanaler, ikke kun antage frontend-guards dækker det.
- **Backend-til-Discord er et blindt hjørne for BEGGE lejre:** frontend-i18n-
  guards ser den aldrig (ikke frontend-kode), og backend-tests tjekker typisk
  kun struktur, ikke sprog. Et fremtidigt statisk check kunne grep'e
  `backend/lib/*iscord*.js`/`*Embed*`-buildere for æ/ø/å + danske stopord
  (samme stopords-liste som `i18n-check-leaks.mjs` detektor A) — bevidst ikke
  bygget her (lav ROI: Discord-templates ændres sjældent), men nævnt som
  mulig forward-guard hvis der opstår en ny leak-runde.
- **Find alle afsendere systematisk ved i18n-sweeps:** grep efter selve
  brugerteksten (fx "Ny Auktion", "afviklet") frem for kun modul-navne —
  flere templates (PCM-import, Final Whistle, mid-season board-DM) blev
  først fundet ved at grep'e efter output-strenge, ikke ved at læse
  `discordNotifier.js` alene.
