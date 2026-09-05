# Boardroom · overblik + faner (#4557), 5/9 2026

Skærmbilleder til den visuelle gennemgang af PR "feat(boardroom): overblik + faner,
bonustilbud og DNA-valg flyttet ind fra den gamle side (#4557)".

Taget mod dev-previewen `/ui/boardroom` (DEV-only route, `BoardroomPreviewPage.jsx`)
med den samme fixture som CI's e2e bruger:
`frontend/src/pages/boardroom/__fixtures__/boardRoom.json` + `dnaSuggestions.json`.
Ingen ægte spillerdata, ingen opdigtede tal — fixturen er den kontrakt-form
`GET /api/board/room` returnerer.

| Fil | Viewport | Rute | Scroller? |
|---|---|---|---|
| `overview-desktop.png` | 1280x900 | `/ui/boardroom` | Nej |
| `mandate-desktop.png` | 1280x900 | `?tab=mandate` | Nej |
| `vision-desktop.png` | 1280x900 | `?tab=vision` | Nej |
| `board-desktop.png` | 1280x900 | `?tab=board` | Nej |
| `overview-no-dna-desktop.png` | 1280x900 | `?variant=no-dna` | Ja (varianten har ét kort mere) |
| `overview-mobile.png` | 390x844 | `/ui/boardroom` | Ja |
| `board-mobile.png` | 390x844 | `?tab=board` | Ja |

"Scroller?" er målt som `document.documentElement.scrollHeight > window.innerHeight`.

Facit: `docs/design/mockups-boardroom-additions-2026-09-06/boardroom-tabs.html`
(ejer-godkendt 6/9).
