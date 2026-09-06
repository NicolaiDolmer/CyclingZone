# Mockups: traeningssidens tre retninger (6/9 2026)

Tre standalone HTML-mockups af den nye traeningsside (#4613), bygget 6/9 ud fra spillerens almindelige dag, TASTE-tjekket (16/17 hver). Til ejerens side-om-side-opslag til spillerne (`docs/drafts/discord-training-mockups-2026-09-06.md`). Navne og tal er opdigtede.

| Fil | Forside er | Issues |
|---|---|---|
| `m1-today-board.html` | Dagens tavle: Racing today (intention pr. rytter) + Training today (session fra program) | #4613 #4632 #4629 #4801 |
| `m2-week-board.html` | Ugetavlen: ugen som gitter, programmer i venstre spalte, loebsdag som moerk pille | #4613 #4629 #4632 #4801 |
| `m3-squad-list-plus.html` | Trup-listen: draft #4736 + Program-kolonne + loebsintention i dagens celle | #4613 #4736 #4629 #4632 #4801 |

Alle tre viser +1-loftet (#4801) i Development-udsnittet nederst. `side-by-side-*.png` er samlet af `compose-*.html`.

Render igen (fra `frontend/`): `npx playwright screenshot --viewport-size=1280,900 --full-page "file:///C:/Dev/CyclingZone/docs/design/mockups-training-2026-09-06/<fil>.html" ../docs/design/mockups-training-2026-09-06/<fil>-desktop.png`
