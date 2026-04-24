# NOW — Aktuel arbejdsstatus

## Aktiv næste slice
- `Slice 3 — Min aktivitet` — implementeret og deployed
- ActivityPage ombygget til 6-fane-struktur: Kræver handling (default), Auktioner, Transfers, Lån, Ønskeliste, Historik.
- Kompakte handlingsrækker med statusbadge, modpart, beløb, tid og deep-links.
- Lån og Ønskeliste er nye faner. Historik samler alt afsluttet. Kræver handling aggregerer tilbud, modbud, bekræftelser og lejeforslag.

## Næste slice derefter
- `Slice 4 — Markedsregler og rytterflader`
- Fokus: `Point` → `Værdi` i UI, minimum `Værdi` ved normal auktionsstart, `Garanteret salg` som 50%-undtagelse, aktiv auktionsstatus på rytterliste og rytterside, transfer-tidspunkt, ryttertype, ønskeliste-alerts.

## Blockers / investigations
- Blocker: `dyn_cyclist`-integrationen mangler stadig et eksempelark til endelig datakontrakt og kolonnemapping.
- Follow-up: Evne-filter/slider kræver frisk live-reproduktion; ingen statisk root cause fundet.
