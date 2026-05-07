# 2026-05-07 — Auktionsvinduer beregnet 2 timer forkert (UTC vs CEST)

## Bug
Auktioner sluttede 2 timer senere end danske managere forventede. Vindue var dokumenteret som 18:00–00:00 dansk tid, men kørte 18:00–00:00 **UTC** = 20:00–02:00 CEST.

## Root cause
`backend/lib/auctionEngine.js` brugte JS native `setHours()`, `getDay()`, `setDate()` til vinduesberegning. Disse opererer på server-process-tidszone — Railway-prod kører i UTC. Resultatet: vinduerne 16–22 UTC = 18–00 CEST var 2 timer forkert.

DB (`calculated_end TIMESTAMPTZ`) og finalization (`now.toISOString()`) var allerede UTC-korrekte — fejlen var udelukkende i window-konstruktionen.

## Fix
`auctionEngine.js` rewritten med `Intl.DateTimeFormat({ timeZone: 'Europe/Copenhagen' })` til at læse current dansk wall-clock time, og bygge datoer eksplicit i Copenhagen-TZ (DST-korrekt CEST/CET). UI: `Countdown` og admin-auktionsliste viser nu absolut sluttidspunkt med TZ-label (f.eks. "21:00 CEST") under nedtælling.

## Læring
**JS native `Date`-metoder (`setHours`, `getDay`, `getDate`) bruger server-process-TZ — aldrig stol på dem til business-logik der har en bestemt brugerrettet tidszone.** Brug `Intl.DateTimeFormat` med eksplicit `timeZone`-option, eller en lib som `date-fns-tz`/`luxon`. Audit alle `setHours`/`getDay`-callsites i backend ved tidszone-bugs — finalization-paths kan være korrekte selv når window-paths er forkerte.

Sekundær: UI bør altid vise TZ-label ved deadlines (`21:00 CEST` ikke bare `21:00`) — det giver managers mulighed for at fange forkerte beregninger uden at skulle læse kildekode.
