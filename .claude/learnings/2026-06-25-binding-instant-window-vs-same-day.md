# Race-binding: instant-vindue lod samme-dag-løb dobbeltbooke (#1823)

**Dato:** 2026-06-25 · **Slice:** race-hub S1+S2a · **PR:** #1838

## Symptom
"Auto-udfyld dobbeltallokerer ryttere ved overlap" — samme rytter i to overlappende løbs trupper (kun 8 ryttere brugt til 12 pladser).

## Rod-årsag (og hvorfor den var skjult)
Et løbs binding-vindue var `[min(scheduled_at), max(scheduled_at)]`. Et **endagsløb er et nul-bredt instant**. To samme-CET-dag-løb på forskellige klokkeslæt (fx Hamburger 22:00 + La Corsa etape 1 23:00) producerer disjunkte instant-vinduer → `windowsOverlap` = false → den (korrekte) binding-bevidste generator regnede dem som ikke-konflikt og satte de stærkeste ryttere i begge.

Prod-repro (read-only): **798 dobbeltbookede par, 0 med ægte tidsoverlap** — kernen `assignTeamAcrossRaces` var korrekt; selve vindue-DEFINITIONEN var fejlen.

## To meta-lektioner

1. **Spec-hærdningens gættede rod-årsager var BEGGE forkerte.** Design-hardening-workflowen pegede på (a) manglende `race_stage_schedule`-rækker og (b) regenerate-auto-lock-hul. Prod-repro modbeviste begge (alle løb havde vinduer; 0 ægte-overlap-par). **"Reproducér FØRST mod prod" ([[feedback_runtime_verify_first]]) fangede det et statisk gæt ikke kunne.** En grøn unit-test (`assignTeamAcrossRaces` overlap-case) gav falsk tryghed fordi den testede ms-vinduer der FAKTISK overlappede — den ramte aldrig instant-vs-samme-dag-tilfældet.

2. **Fix = dag-granulært binding-vindue, ikke tidspunkt.** Designet siger "én rytter pr. løbsdag". `raceBindingWindow` mapper hvert scheduled_at til en CET-dag-ordinal (via `copenhagenDateString`, DST-robust — dagen udledes af en Intl-formatter, ikke af UTC-offset). `windowsOverlap` er unit-agnostisk, så generatoren, PUT-guarden og bindingMap fik fixet uden ændring. Display (kolonner/tidslinje) beholdt ms-vinduet — to vindue-begreber, adskilt med vilje.

## Adversariel verifikation betalte sig
En 6-skeptiker + kritiker-workflow (efter grøn implementering) fandt **5 fund de almindelige CI-gates IKKE fanger**: FitBar refererede top-level `fit.*`-nøgler mens strengene lå under `racehub.fit.*` → tooltips viste rå nøgler (i18n-parity-checket var grønt fordi begge sprog havde de DØDE nøgler); `setRole`-kaptajn-fallback kunne emit'e `selection_role_overlap`; et "trup låst"-løb var stadig "selectable" → dead-end CTA; schedule-fetch havde det kendte PostgREST-1000-cap-footgun ([[reference_postgrest_1000_row_cap_in_scripts]], [2026-05-30-pcm-matcher-1000-row-pagination]). **Lektion: en grøn test-suite + grønne gates ≠ korrekt; en adversariel "prøv at modbevise hver fix"-runde fanger den klasse af huller CI er blind for.**

## Forward-guard
- `raceBinding.test.js`: regression-test med Hamburger+La Corsa-instant-tider (samme CET-dag → MÅ overlappe).
- `raceEntryGenerator.test.js`: end-to-end samme-dag-dobbeltbooking-test.
- Binding bruger ALDRIG raceTimeWindow (ms) — kun raceBindingWindow (dag-ordinal). Display bruger ms.
</content>
