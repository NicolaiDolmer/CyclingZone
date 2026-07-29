# En 100 %-rate uden minimums-sample er ikke et signal (#3072 / CYCLINGZONE-40)

**Dato:** 2026-07-29 · **Fundet af:** daglig Sentry/Railway-triage · **Klasse:** falsk-positiv alarm

## Symptom

Sentry-issue CYCLINGZONE-40 fyrede gentagne gange fra 26/7 og frem:

> Discord DM: alle **1** forsøgte "auction_won"-DM'er blev skippet (no-recipient) i 3 kørsler i træk

Ingen spiller var påvirket. Leveringen virkede. Alarmen åd Sentry-kvote (samme kvote-pres som
#2892/#2900) og stjal triage-opmærksomhed fra ægte fund.

## Rod-årsag

`backend/lib/discordDmRateGuard.js` evaluerede `allSkipped = bucket.skipped === bucket.attempted`
**uden nogen minimums-sample-størrelse**. Guarden var designet til #2569-klassen ("alt fejler
tavst i 14 dage") og antog implicit at en cron-kørsel har mange DM'er i sig.

Den antagelse holder ikke i prod: kun **7-17 %** af brugerne har koblet `discord_id` (målt 27/7 —
29 af 170 brugere; 12 af 162 auktionsvindere seneste døgn). En auktions-finalizer-tick afslutter
typisk **1** auktion. Sandsynligheden for at den ene vinder mangler Discord er ~83-93 %, og for tre
sådanne kørsler i træk ~57 % — altså **mere sandsynligt end ikke**. Alarmen målte baseline, ikke
en regression.

## Fix

`MIN_SAMPLE_SIZE = 5`: en 100 %-skip-kørsel med færre end 5 forsøg er NEUTRAL — den hverken
forlænger eller nulstiller streak'en, præcis som den eksisterende `attempted === 0`-gren (#2440).

Asymmetrien er bevidst og er pointen: en kørsel med mindst én **leveret** DM nulstiller stadig
streak'en uanset sample-størrelse. Positiv evidens ("leveringen virker") er gyldig ved n=1; det
negative udsagn ("alle blev skippet") er det ikke.

## Læring — generaliserbar

**En rate-baseret alarm skal kende sin baseline, ellers alarmerer den på baselinen.**

Checkliste før man shipper en "X % af Y fejlede"-vagt:

1. **Hvad er n pr. evaluering i prod?** Ikke i testen — i prod. Er n=1 muligt, er 100 % ikke et signal.
2. **Hvad er den forventede skip-/fejl-rate uden nogen defekt?** Er den ikke ~0, skal tærsklen
   ligge over baselinen, ikke på 100 %.
3. **Er n under minimums-samplet: er "neutral" eller "reset" det rigtige?** Neutral for negativ
   evidens, reset for positiv. Vælg eksplicit — default'en er sjældent rigtig for begge.
4. **Skriv en test der kører 20 lav-volumen-kørsler i træk og kræver 0 alarmer.** Den fanger
   fælden; en test med `attempted: 1` der forventer capture *indkoder* den.

Punkt 4 bed her: fem eksisterende tests brugte `attempted = 1` og forventede en capture. De
dokumenterede den fejlagtige adfærd som ønsket. Testene er nu skrevet med eksplicit sample-størrelse
(`runTick(type, { attempted, skipped })`), så antagelsen er synlig i stedet for implicit.

## Åben opfølgning

`#3072`'s sekundære forslag — sammenhold skip-raten med den faktiske Discord-dæknings-baseline i
stedet for en absolut 100 %-tærskel — er **ikke** implementeret. Det kræver et DB-opslag i et modul
der i dag er rent tællende. Minimums-samplet fjerner støjen ved nuværende volumen; baseline-
sammenligningen bliver først værd at bygge når Discord-dækningen (og dermed n) vokser.

## Relateret

- #2571 — guarden blev bygget her
- #2569 — hændelsen guarden skal fange (`.claude/learnings/2026-07-17-silent-param-drop-board-dm.md`)
- #2440 — samme støj-fælde, tom kørsel talt som fejl
- #2892 / #2900 — Sentry-kvotepres
