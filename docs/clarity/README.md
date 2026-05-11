# Clarity weekly review — manuel template

> Loop I fra `docs/AI_LOOPS.md`. Konverterer Microsoft Clarity-data til actionable issues.
> Manuel-vej indtil videre; scripted Data Export API kan komme som opfølgning hvis denne flow viser sig at være for friktion-fyldt.

## Forudsætninger (alle på plads pr. 2026-05-11)

- Clarity loader kun for brugere der har accepteret `analytics`-samtykke ([#297](https://github.com/NicolaiDolmer/issues/297))
- Custom-tags sat post-login: `manager_id`, `division`, `season_number` — filtrer dashboardet på disse for at se en bestemt division eller manager-segment
- `data-clarity-mask` på email + Discord ID; passwords auto-maskeres af Clarity SDK

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
