# Wireframes: verdensmesterskabet (4/9 2026)

Lo-fi wireframes til epic [#934](https://github.com/NicolaiDolmer/CyclingZone/issues/934) (landshold og VM).
Tegnet i gråtoner med stemplet "Wireframe, not final": de viser struktur og valg, ikke design.
Den endelige side følger `docs/design/PAGE_TEMPLATES.md` (T3 løbsside) + `TASTE.md`.

Lærred (pan/zoom, alle artboards): https://claude.ai/code/artifact/e9ae98f3-b118-4194-9524-1bc1f1c8c0f8

| Fil | Viser | Hænger på |
|---|---|---|
| `Main.dc.html` | VM-løbssiden, Overview-fanen: hero, dine ryttere (udtaget / reserve / ikke udtaget), favoritter, rute, nøgledatoer, stærkeste nationer | #934 #2477 |
| `Nations.dc.html` | Nations-fanen: nationer med pladser, kaptajn, nationsrang, dine ryttere; Danmark foldet ud | #844 |
| `Results.dc.html` | Results-fanen efter løbet: verdensmester-blok, resultatliste med nation, nationsrangliste, øjeblikke | #266 |
| `Touchpoints.dc.html` | Hvor VM dukker op: kalender, dashboard, indbakke, rytterprofil (regnbue-chip), sæsonslut | #266 |
| `DirectionB.dc.html` | Alternativ retning: bedst rangerede manager pr. nation er landstræner og udtager selv | #934 |

Retning A (automatisk udtagelse efter verdensrangliste, manageren styrer ikke landsholdet) er bygget ud.
Retning B ligger ved siden af som skitse, ikke i stedet for.

Navne og tal i wireframes er opdigtede eksempler, ikke prod-data. `[HOST CITY]` og `[TO DECIDE]` er
bevidste pladsholdere.
