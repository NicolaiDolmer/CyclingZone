# Sentry-samples som nestede objekter gør en vagt blind (11/9-2026)

## Hvad skete der

Den daglige Sentry/Railway-triage 11/9 fandt **CYCLINGZONE-5M**: ownership-vagtens
invariant G alarmerede på *"1 akademirytter over graduerings-alderen uden aktiv
auktion (#4495)"*. Kortets `extra` var:

```
{ "count": 1, "sample": ["[Object]"] }
```

For at finde ud af HVILKEN rytter der var ramt krævede det fire SQL-opslag mod prod
— og yderligere fire for at afkræfte de nemme rod-årsagshypoteser. Vagten havde
gjort sit arbejde; kortet kunne bare ikke sige hvem.

## Rod-årsag

Sentry-SDK'ens `normalizeDepth` (default 3) kollapser nestede strukturer til
strengen `"[Object]"`. Alle fem invariant-captures i `ownershipInvariantWatch.js`
sendte `extra.sample` som et **array af objekter**, og blev derfor ubrugelige
præcis når de var relevante.

Invariant F (#4664) i **samme fil** var allerede immun — den sender flade strenge,
med en kommentar der forklarer hvorfor, skrevet efter CYCLINGZONE-5G kostede det
samme opslag. De fem øvrige blev bare aldrig konverteret.

## Fix

PR #5132: alle fem samples er nu `key=value`-strenge. `stuckGraduates` fik
desuden `grads=` med — statuslisten er selve diagnosen (`grads=none` = override-
vinduet blev aldrig åbnet, `grads=sold` = #4495's kerne-case), og uden den kan de
to historier ikke skelnes uden et DB-opslag.

Forward-guard: en test der løber **alle** captures igennem og fejler hvis bare ét
sample-element ikke er en `string`. Fremtidige invarianter arver guarden gratis.

## Læring

**En kommentar der forklarer en fejlklasse ét sted i filen forhindrer den ikke ni
linjer længere nede.** Rettelsen efter CYCLINGZONE-5G (og #4594/#4902) blev
dokumenteret grundigt dér hvor den blev lavet — men ikke håndhævet. Den næste
fire captures i samme fil gentog fejlen, og #5017 noterede backwards-checket som
et ✅-punkt der aldrig blev kørt.

Gentagelses-vagt hører i en **test**, ikke i en kommentar. En kommentar oplyser
den der læser netop de linjer; en test rammer alle der tilføjer en ny.

**Sekundært:** telemetriens kvalitet afgør om en vagt er værd at have. En vagt der
rapporterer et tal uden id'er flytter bare arbejdet fra runtime til triage-tid.
Når en vagt skrives, skal spørgsmålet "kan jeg handle på kortet alene?" besvares
med ja — ellers er den halvfærdig.

## Afledt fund

Selve bruddet bag alarmen er **ikke** #4495 igen: rytteren har ingen
`academy_graduation`-række overhovedet, dvs. han faldt ud af graduerings-flowet
ved sæson-transitionen og **kan aldrig komme ind igen** — `detectGraduates` kører
kun ved sæsonskifte, og graduerings-sweepet auto-resolverer kun eksisterende
pending-rækker. Opsamlet i #5133 (ejer-gated: reparationen rører en spillers trup).

Refs #5017 #5132 #5133 #4495 #4664
