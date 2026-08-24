# Et orakel der genberegner skal bruge ALLE de publicerede kolonner

**Dato:** 2026-08-24 · **Issue:** [#4197](https://github.com/NicolaiDolmer/CyclingZone/issues/4197) · **PR:** [#4210](https://github.com/NicolaiDolmer/CyclingZone/pull/4210)

## Hvad skete der

Et strukturelt orakel meldte "GC-vinderen har ikke feltets laveste tid" på 3 af 50
seeds. Det er ikke et kalibreringsbånd men en engine-invariant, og kommentaren
ved den kalder en inverteret GC "en prod-katastrofe". Alarmen så alvorlig ud.

Motoren var korrekt. Oraklet regnede forkert.

## Rodårsagen

Oraklets værdi ligger i at det genberegner klassementet **uafhængigt** af
motoren, ud fra de publicerede resultat-rækker. Det er den rigtige idé. Fejlen
var at det kun genberegnede ud fra én af de kolonner der bestemmer resultatet:

```
oraklet:  cumtid = Σ etape-gab
motoren:  cumtid = Σ (etape-gab − bonussekunder)
```

Bonussekunder er en publiceret kolonne på præcis de samme rækker. Oraklet læste
`finish_time` og ignorerede `bonus_seconds`, og genberegnede dermed en anden
størrelse end den det sammenlignede med.

## Hvorfor det tog så lang tid at opdage

Tre lag skjulte det:

1. **Bonussekunder findes kun med ruter.** Uden `--routes` er der 0
   bonussekunder, og de to udtryk falder sammen. Standard-gaten kører uden
   ruter, så den var grøn i 400 seeds.
2. **Rute-varianten var permanent rød af en anden grund.** `longDayEnduranceLift`
   står på `>3pp` mens den målte middelværdi er 3,01 — et møntkast der fejler på
   24 af 50 seeds. Når et tjek altid er rødt, holder man op med at læse det, og
   så gemmer der sig andet i støjen.
3. **En misvisende kommentar i motoren.** `raceRunner.js` sagde "sum af
   etape-gaps = GC, altid". Sandt uden ruter, forkert med. Præcis den
   forkortelse forplantede sig til oraklet.

## Reglerne der kom ud af det

**1. Et orakel der genberegner skal bruge alle kolonner der indgår i det
resultat det kontrollerer.** Ellers kontrollerer det noget andet end det tror.
Konkret tjek når man skriver et: skriv motorens formel og oraklets formel op ved
siden af hinanden, og bekræft at de bruger samme input.

**2. Bevis at kontrollen kan fejle, før du tror på at den består.** Her blev
prod-verifikationen kørt to gange: én med korrekt formel (26.493 af 26.493
rækker stemmer) og én med den forkerte (167 af 3.525). Uden den anden kørsel
var "0 afvigelser" ikke værd noget — en forespørgsel der matcher alt beviser
intet.

**3. Et permanent rødt tjek er ikke bare støj, det er et skjulested.** Et tjek
der altid fejler skal enten repareres eller slås fra. At lade det stå rødt gør
det til et sted hvor ægte signaler kan ligge ubemærket i månedsvis.

**4. Svage orakler skal strammes, ikke bare rettes.** "Vinderen har feltets
minimum" ser kun på én rytter — en ombytning på plads 40 var usynlig. Oraklet
låser nu hele GC-rækkefølgen til at være ikke-aftagende i nettotid.

## Datafælde værd at huske

Prod-verifikationen skulle nøgles på `entrant_key`, ikke `rider_id`. **190.346 af
362.534 resultat-rækker har `rider_id = NULL`**, fordi fremmednøglen nulstilles
når AI-hold trimmes ([#1847](https://github.com/NicolaiDolmer/CyclingZone/issues/1847)
bevarer navnet i stedet). Første forsøg dækkede kun 132 af 189 løb — og sagde det
ikke. Det opdagede jeg kun ved at tælle løbene i resultatet og undre mig over at
tallet ikke passede.

Enhver fremtidig forespørgsel mod løbshistorik skal bruge `entrant_key`.

Beslægtet postmortem fra samme dag:
[`2026-08-24-en-gate-kalibreret-mod-tre-heldige-seeds.md`](2026-08-24-en-gate-kalibreret-mod-tre-heldige-seeds.md)
