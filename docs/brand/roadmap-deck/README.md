# Roadmap-deck — "Vejen frem" (sæson 1)

> Visuelt roadmap til community-deling (Discord). 6 slides, dansk, følger `LAUNCH_MINIMUM.md` + `TONE_OF_VOICE.md`.
> Lavet 2026-06-09. Ejer: Nicolai Dolmer Mikkelsen.

## Hvad er det

Et 6-slide deck der fortæller hvad spillerne kan se frem til, bygget op om kerne-fantasien **"byg ryttere, ikke bare køb dem"**. Bue fra det konkrete (nu) til visionen (snart).

| # | Slide | Fil |
|---|---|---|
| 1 | Intro / brand-anslag | `01-intro.png` |
| 2 | Træning | `02-traening.png` |
| 3 | Ungdomsakademi | `03-ungdomsakademi.png` |
| 4 | Egen race-motor | `04-race-motor.png` |
| 5 | Fans & omdømme | `05-omdomme.png` |
| 6 | Levende verden + CTA | `06-levende-verden.png` |

`deck.html` er den selvstændige, scrollbare web-version (skalerer til vinduet, alle assets inlinet). Åbn i en browser.

## Brand-grundlag (verificeret)

- **Wordmark + monogram:** ægte SVG'er fra `frontend/public/brand/` (`wordmark-ondark.svg`, `monogram-cz.svg`), inlinet. Produceret under #481 (committet 2026-06-04).
- **Font:** DM Sans (den shippede UI-font).
- **Farver:** gul `#e8c547`, navy `#1a1f38`, dark canvas `#0e0f15`, cream `#f0ede6`.
- **Tone:** founder-led "jeg/du", ingen em-dash, gratis-løftet med.

> NB: Det viste logo er det *kommende* officielle mærke (ikke wiret ind i live-UI endnu — logo udskudt til V2 post-TdF per `LAUNCH_MINIMUM.md`). Bevidst valg: et roadmap om fremtiden viser det fremtidige brand.

## Sådan poster du det på Discord

PNG'er kan ikke være klikbare. Læg billederne i ét opslag og **skriv linket som tekst** — Discord gør det automatisk klikbart.

**Foreslået post-tekst:**

> Hej allesammen 👋
>
> Inden sæson 1 går i gang, vil jeg dele hvad jeg arbejder på, og hvad I kan se frem til. Kort fortalt: Cycling Zone skal handle om at *bygge* ryttere, ikke bare købe dem.
>
> Det jeg glæder mig mest til at vise jer:
> 🏋️ **Træning** — udvikl dine egne ryttere over en hel sæson
> 🌱 **Ungdomsakademi** — find talentet før alle andre
> 🚵 **Egen race-motor** — løb afgjort af taktik, ikke terninger
> ⭐ **Fans & omdømme** — byg et navn, ikke bare et resultat
> 📰 **Levende verden** — historier og rivaliteter mellem holdene
>
> Spillet er gratis, og det bliver det ved med at være.
>
> Spil med på https://cyclingzone.org
>
> Sig endelig til hvad I glæder jer mest til, eller hvad I synes mangler.

(Vedhæft de 6 PNG'er i rækkefølge.)

## Sådan regenererer du PNG'erne

1. Åbn `deck.html` i en browser på et 1280×720-canvas (eller brug Playwright).
2. Sæt `--s` til `1` og tag et element-screenshot af hver `.card` (1280×720).
