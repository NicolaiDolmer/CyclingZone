# Clarity weekly review — manuel template

> Loop I fra `docs/AI_LOOPS.md`. Konverterer Microsoft Clarity-data til actionable issues.
> Manuel-vej indtil videre; scripted Data Export API kan komme som opfølgning hvis denne flow viser sig at være for friktion-fyldt.

## Forudsætninger (alle på plads pr. 2026-05-11)

- Clarity loader kun for brugere der har accepteret `analytics`-samtykke ([#297](https://github.com/NicolaiDolmer/issues/297))
- Custom-tags sat post-login: `manager_id`, `division`, `season_number` — filtrer dashboardet på disse for at se en bestemt division eller manager-segment
- Custom-tag `entry_referrer=self` sættes automatisk når en session ankommer med cyclingzone.org som referrer til cyclingzone.org (se "Syntetisk trafik" nedenfor, [#3819](https://github.com/NicolaiDolmer/CyclingZone/issues/3819))
- `data-clarity-mask` på email + Discord ID; passwords auto-maskeres af Clarity SDK

## Sandhedskilde for bruger-/sessionstal (#3819)

Clarity er behavioural analytics (heatmaps, recordings, dead/rage-clicks) —
**ikke** en pålidelig kilde til unikke brugere/sessions. 17/8 viste Clarity
~4.000 "unikke brugere" på én dag mod 35 ægte indloggede brugere i backenden
(115x oppustet, se [#3819](https://github.com/NicolaiDolmer/CyclingZone/issues/3819)
for fuld diagnose). Brug altid `player_events` som sandhed for bruger- og
sessionstal; brug Clarity kun til friktions-mønstre (dead clicks, rage
clicks, JS-fejl), hvor det relative billede stadig holder.

**Kanonisk SQL** (kør mod prod, read-only):

```sql
select date_trunc('day', created_at) as day,
  count(distinct user_id) filter (where user_id is not null) as unique_users,
  count(*) filter (where event_name = 'session_started') as session_started,
  count(*) as total_events
from player_events
where created_at >= '<start-dato>' and created_at < '<slut-dato>'
group by 1 order by 1;
```

Verificeret 17/8 mod issuets tal (3/8: 35 unikke brugere, 633
`session_started` — matcher).

### Syntetisk trafik / self-referral-spikes

Hvis en uge/dag ser ud til at "kollapse" eller "eksplodere" i Clarity, tjek
først for en synthetic-trafik-spike før du konkluderer noget om ægte
spilleradfærd:

1. Sammenlign Clarity-dagen mod `player_events` (SQL ovenfor) — afviger de
   med en faktor >2-3x, er det sandsynligvis syntetisk trafik, ikke ægte brugere.
2. Kendetegn fra #3819: **self-referral** (cyclingzone.org → cyclingzone.org
   uden ægte indgangskilde), **1 session = 1 "ny" bruger** (ingen
   cookie-persistens), **fingerprint-mismatch** (fx "SamsungInternet på Linux
   PC", "ChromeMobile på iOS Tablet" — kombinationer der ikke findes på
   rigtige enheder).
3. Frontend tagger nu automatisk self-referral-entries med custom-tag
   `entry_referrer=self` (leveret i #3819). For at ekskludere dem fra en
   given uges tal i dashboardet:
   - Åbn https://clarity.microsoft.com/ → projekt "Cycling Zone" → **Filters**
   - Under **Custom tags**, vælg `entry_referrer` → værdi `self` →
     afkryds **Exclude selection** → **Apply**
   - Dashboard/Recordings/Heatmaps opdaterer nu til at udelukke
     self-referral-sessions for den valgte periode
4. Hvis kilden viser sig at være få, stabile IPv4-adresser (kryds-tjek mod
   Vercel-logs for samme dag): **Settings → IP blocking → Block IP address**
   (kun IPv4, ingen VPN/dynamiske IP'er — se Clarity-dokumentationen). Dette
   er en manuel, ejer-udført handling — Claude kan ikke ændre Clarity-projektets
   indstillinger.
5. Marker perioden som ubrugelig til uge-over-uge-sammenligning i din weekly
   note (se "Arkiverede rapporter" nedenfor) i stedet for at rapportere det
   oppustede tal videre.

## Cadence

- **Mandag morgen** (eller når du har 30 min ledige):
  1. Åbn https://clarity.microsoft.com/ → projekt "Cycling Zone"
  2. Tidsfilter: sidste 7 dage
  3. Gennemgå rapporten herunder

## Rapport-skabelon

Kopiér dette ind i en Claude-session som ny prompt:

```
Cycling Zone — Clarity weekly review uge <UGE-NR>, periode <START> til <SLUT>.

## Dashboard-tal
- Sessions: <antal>
- Unique visitors: <antal>
- Dead clicks rate: <%>
- Rage clicks rate: <%>
- JS errors: <antal>

## Top 3 dead-clicks (element + side)
1. <element-beskrivelse>, side <URL>, <X> sessions
2. ...
3. ...

## Top 3 rage-clicks (element + side)
1. ...
2. ...
3. ...

## Insights flag (Clarity foreslår selv 5-10 ugentligt)
- <fx "Excessive scrolling on /finance">
- ...

## Min hypotese
<1-2 sætninger pr. observation: hvorfor sker dette, hvilken brugerintention misforstås?>

## Forslag
Filer et issue for hver konkret observation:
- gh issue create --label "claude:todo,priority:low,type:bug" eller type:feature
- Brug labels: needs-design hvis UX-løsning er uklar; quick-win hvis fix er <1 time
```

Claude skal:
1. Verificere at observationerne ikke allerede er fanget i åbne issues (`gh issue list --search "<keyword>"`)
2. Foreslå minimal fix pr. observation
3. Liste hvilke der opretter issues for (med foreslået label-sæt)
4. Spørge før den faktisk opretter dem

## Hvornår skifter vi til scripted weekly?

Skift til API-vej når **mindst én** af følgende rammer:
- Det tager > 30 min hver uge at lave reviewet manuelt
- Vi misser uger > 2 gange i træk
- Vi vil sammenligne uger automatisk (regression-detektion)
- Vi vil have Discord-alarm når dead-click-raten stiger > 20% ugevis

Når den dag kommer: åbn opfølger-issue til [#297](https://github.com/NicolaiDolmer/CyclingZone/issues/297) med titel "Loop I phase 2 — scripted weekly via Data Export API". Token bestilles fra Clarity → Settings → Data Export → "Generate token". Estimat: 1 session.

## Arkiverede rapporter

Hver weekly-rapport gemmes som `weekly-YYYY-MM-DD.md` i denne mappe. Format-ramme:

```markdown
# Clarity weekly — <dato>

Periode: <start> til <slut>. Sessions: N. Dead-click-rate: X%.

## Observationer
1. ...

## Issues oprettet
- #N — <titel>
- ...

## Næste uges fokus
<én linje hypotese du vil tjekke>
```
