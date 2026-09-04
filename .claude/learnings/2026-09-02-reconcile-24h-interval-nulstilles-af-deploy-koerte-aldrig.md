# 2026-09-02: Alunta-reconcilen kørte aldrig, fordi et 24-timers setInterval nulstilles ved hvert deploy

## Hvad skete

- Den eneste betalende kunde (månedsplan) mistede Pro-mærket ved midnat 1/9. Alunta sagde samtidig `active` med ny periode til 30/9.
- Vores `subscriptions`-række stod med `current_period_end = 31/8` og var ikke rørt siden 25/7. `computeIsPro()` krævede periodeslut i fremtiden og gav false.
- Reconcilen (#2736), som skulle synke Aluntas periode ind dagligt, var registreret som `setInterval(..., 24h)` uden boot-run. Uret måles fra proces-start og nulstilles ved hvert deploy. Backend'en deployer typisk flere gange om dagen, så intervallet nåede aldrig 24 timer. Cron-monitoren fangede det ikke, fordi dens 24h-margin netop er designet til at tilgive deploy-genstarter.
- Dry-run 2/9 bekræftede at feltudtrækket mod Aluntas svar var korrekt hele tiden. Koden virkede; den blev bare aldrig kaldt.

## Rod-årsag

To lag:
1. **Kadence uden boot-run.** Forfalds-vagten (#4514) og fairplay-sweepet fik begge en boot-run med kommentaren "24h-intervallet nulstilles ved hvert deploy". Reconcilen blev registreret før den læring og fik ingen.
2. **Hårdt udløb på en cache.** `current_period_end` er en kopi af Aluntas sandhed, men entitlementet behandlede den som et løfte. Én time-lag i cachen kostede en betalende kunde synlig Pro.

## Rettelse (PR fix/4541)

- Reconcile hver time + ved boot, monitor `CRON_MONITOR_60MIN`.
- `computeIsPro()` giver `active`/`past_due` 3 døgns respit efter cached periodeslut. `cancelled` æres præcis til periodeslut. `inactive` slår igennem med det samme.
- Forward-guard: Alunta `active` med periode udløbet ud over respitten → Sentry-alarm (`alunta-reconcile-active-but-expired`).
- `updated_at` stemples ved reelle ændringer (#4542). Kontrakten er verificeret og dokumenteret (#4541).

## Læring

1. **Et `setInterval` på 24 timer er ikke en daglig cron på en service der deployer dagligt.** Hver 24h-registrering i `cron.js` skal have en boot-run, eller flyttes til en kalender-styret kørsel.
2. **En cache må aldrig være den hårde grænse for en betalt ret.** Læg respit på cachen og lad kildens egen status (Alunta `ended`) være det der slukker.
3. **"Kører dagligt" i en doc er en påstand.** Mål det i Railway-loggen (der var ingen `Alunta-reconcile`-linje i 7 dage) før du stoler på det.
4. **Verificér kontrakten samme dag flaget flippes.** `alunta_reconcile_enabled` blev sat 3/8 uden den dry-run tjeklisten krævede; advarslen "UVERIFICERET KONTRAKT" stod i koden i en måned.
