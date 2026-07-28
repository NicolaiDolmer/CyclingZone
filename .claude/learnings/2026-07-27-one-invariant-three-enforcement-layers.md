# Én invariant, tre håndhævelses-lag — jeg fiksede det første og kaldte det løst

**Dato:** 2026-07-27
**Issues:** #3041 → #3070 → #3076 (lag 1-3), #3077, #3079
**Ramte:** 102 af 156 ægte hold. Managere kunne ikke gemme holdudtagelse på sæson 2's første løbsdag.

## Hvad der skete

Efter S1→S2-cutoveret rapporterede seks managere i Discord at ryttere stod som "optaget" af løb de ikke kunne flytte dem fra, og at truppen ikke kunne gemmes.

Rodårsagen var reel og enkel: binding-nøglen er `race_stage_schedule.game_day`, som er **sæson-relativ** og nulstilles hver sæson. I prod spænder både S1 og S2 `game_day` 0..~100000. En sæson-1-entry på game_day 4 overlappede derfor et sæson-2-etapeløb der spændte game_day 0-6.

Jeg fandt det i `loadTeamBindingContext`, verificerede omfanget mod prod (102 hold, 838 ryttere, 16 løb), skrev en test, merged fixet og rapporterede problemet som løst.

**Det var en tredjedel af fejlen.**

Samme invariant håndhæves tre steder:

| Lag | Hvad det ødelagde |
|---|---|
| `loadTeamBindingContext` (app pre-flight) | Ryttere grånede i UI'et |
| `replace_race_selection` (Postgres-funktion, under advisory-låsen) | **Selve gemningen blev afvist** |
| `loadFieldBindingContext` (raceRunner auto-fill) | Ryttere udelodes af startfeltet |

Efter mit første fix blev oplevelsen **værre**: rytterne så nu ledige ud, men gemningen fejlede stadig. Manageren fik ingen forklaring på hvorfor.

## Hvorfor jeg missede det

Jeg havde læst beviset. `raceSelection.js:101-107` siger ordret at RPC'en har sin egen binding-guard under advisory-låsen, med en kommentar der forklarer hvorfor den findes (#2256, TOCTOU). Jeg læste hen over den, fordi jeg allerede havde fundet en årsag der forklarede symptomet.

Det er fejlmekanikken: **en tilstrækkelig forklaring føles som den fulde forklaring.** Omfanget var stort nok (102 hold) til at bekræfte hypotesen, så jeg holdt op med at lede.

## Hvad der virkede

Ejeren afviste "quickfixes" som arbejdsform og bad om at problemet blev forstået til bunds. Det tvang et sweep i stedet for endnu et punktfix:

- alle DB-funktioner der rører `game_day` (`pg_get_functiondef ilike '%game_day%'`) → fandt lag 2
- alle kaldere af `raceBindingWindow` → fandt lag 3, og bekræftede at `raceEntryGenerator` og de tre `api.js`-veje allerede var sæson-scoped

Sweepet tog under ti minutter. Det ville have taget de samme ti minutter før det første fix.

## Regel jeg tager med

**Når en invariant håndhæves ét sted, så find alle steder den håndhæves, før noget meldes løst.** Konkret sweep:

1. Grep efter den funktion/det udtryk der bærer invarianten, i alle lag — app, DB-funktioner, cron/motor.
2. Læs kommentarerne omkring dit fund. Hvis en af dem nævner en søster-guard, er den en kandidat, ikke en fodnote.
3. Verificér de kodeveje du *ikke* ændrer, og skriv eksplicit at de er tjekket. "Der er ikke et fjerde lag" er en påstand der kræver evidens.

Samme dag ramte den beslægtede fejlklasse to gange mere: alders-formlen fandtes i fire kopier, hvoraf to allerede var divergeret (#3071 frontend, #3081 peak-assistenten). Begge duplikater havde en pæn begrundelse i en kommentar. Det blev til #3085, som fjernede grunden til at kopiere i stedet for at forbyde det.

**Fællesnævneren:** en invariant der er skrevet ned flere steder, holder kun indtil det øjeblik hvor de to steder ikke længere er ens. Sæsonskiftet var det øjeblik for begge.

## Verifikation der holdt

For lag 2 kørte jeg guardens `EXISTS` mod prod i begge varianter, read-only: **180 blokerede hold/løb-kombinationer før, 0 efter.** Efter apply verificerede jeg mod den live funktionsdefinition, ikke mod workflow-status.

Men det var stadig mine egne målinger. Den ægte bekræftelse kom fra managere der skrev at de kunne gemme igen. Det er forskellen på "jeg har målt at guarden ikke længere blokerer" og "det virker".
