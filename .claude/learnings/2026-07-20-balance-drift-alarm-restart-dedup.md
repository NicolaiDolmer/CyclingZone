# Balance-drift-alarm spammede Discord: in-memory/boot-dedup overlevede ikke restart

**Dato:** 2026-07-20 · **Issues:** #2730 (fix), #2731 (ægte balance-brud) · **PR:** #2733

## Symptom

Discord-ops-kanalen ("Captain Hook"-webhook) blev spammet med ét alarm-ping pr. deploy — 8 pings på ~70 min under aktiv udvikling. Ejeren troede det var Sentrys native Discord-integration; det var det ikke (Sentry-botten postede kun 2 gange på 2 dage).

## Root cause

Balance-drift-vagten (#2414) alarmerer ved et 3+ dages bånd-brud. `maxRiderWinRate` havde været rødt 4+ dage (siden 16/7 — et ægte engine-signal, #2731). Vagten er **boot-kørt** (`cron.js`) OG på 24h-timer. 24h-timeren nulstilles ved hver deploy, og der deployes mange gange/dag → boot-kørslen fyrede alarmen på **hver eneste deploy** for det samme uændrede brud.

Der var ingen dedup overhovedet på denne alarm — men selv en in-memory dedup ville have fejlet, fordi en proces-restart nulstiller den. **Præcis samme klasse fejl som CYCLINGZONE-31/#2434** (per-tick capture uden persisteret dedup).

## Hvordan det blev fundet

1. Sentry viste kun ~5 events på 48t → error-alarmerne var IKKE den løbende spam. Det store 12k-event-burst (CYCLINGZONE-31) var allerede fixet (#2434).
2. Læste de faktiske Discord-beskeder → afsender var "Captain Hook" (app-webhook), content = ejerens rå bruger-ID `328608731585839107` → matchede `withOpsMention` i `opsWebhook.js`.
3. **Korrelerede Railway-deploy-tider med webhook-posterne** → 1:1, ~40-60s efter hver deploy. Smoking gun.
4. `race_balance_drift_daily.computed_at` for 07-19 = `13:02:53.84`, webhook-post `13:02:54.09` (0,25s efter) → bekræftede kilden entydigt.

## Fix

Edge-triggered dedup: persistér sidst-alarmerede brud-signatur (`metric@since`, sorteret) i ny `ops_alert_state`-tabel; alarmér kun når signaturen ÆNDRER sig. Ren logik (`evaluateBreachAlert`) unit-testet (9 cases), I/O-wiring i `balanceDriftWatch.js` med fail-safe-stilhed ved state-læsefejl.

## Læringer

1. **Verificér den ægte spamkilde før du fixer.** Spørgsmålet nævnte "Sentry", men den løbende spam var appens egen webhook. Sentry var en næsten-red-herring. Deploy↔post-korrelation afgjorde det.
2. **Enhver alarm der kan fyre ved boot skal have PERSISTERET (ikke in-memory) dedup** — ellers gør deploy-frekvensen den til en spam-maskine. Samme lektie som #2434; mønsteret gælder også stall-watchdog (in-memory `seenKeys` nulstilles ved restart) og de øvrige boot-kørte 24h-alarmer (bot-token, season-count).
3. **En korrekt alarm kan stadig være støj.** Bruddet var ægte (#2731), men at gentage den samme sande alarm hvert deploy er ubrugeligt signal. Edge-triggering (alarmér på TILSTANDS-skift, ikke på tilstand) er den rigtige alarm-hygiejne.
4. **Følg-op:** overvej at give stall-watchdog og de andre boot-alarmer samme `ops_alert_state`-baserede dedup (genbrugbar tabel er bygget til det).
