# Wireframes: træningens retning (2/9 2026)

Lo-fi wireframes til ejerens #the-roadbook-opslag om træning
(`docs/discord/2026-09-02-roadbook-traening-en.md`). Begge bærer stemplet "Wireframe, not final"
og er tegnet i gråtoner med vilje: de viser struktur og valg, ikke design. Den endelige side
følger `docs/design/PAGE_TEMPLATES.md` + `TASTE.md` og #4613 (overblik først, faner ud).

| Fil | Viser | Issue |
|---|---|---|
| `wireframe-1-program-week.html/.png` | Program-fanen: default-programmer til venstre, ugen som session pr. ugedag pr. rytter, override og løbsdag markeret, punch og climbing som to sessioner, "Form" som planlagt session | #4629 #4630 #4631 #4633 |
| `wireframe-2-race-day-choice.html/.png` | Today-fanen: ryttere der kører løb vælger intention (grupetto til all-out) i stedet for træning; ryttere der træner får dagens session fra programmet; assistent-knapper | #4632 #4522 #4613 |

Render igen efter ændring (fra `frontend/`):

```
npx playwright screenshot --viewport-size=1280,860 --full-page "file:///C:/Dev/CyclingZone/docs/design/wireframes-training-2026-09-02/wireframe-1-program-week.html" ../docs/design/wireframes-training-2026-09-02/wireframe-1-program-week.png
```

Navne og tal i wireframes er opdigtede eksempler, ikke prod-data.
