# RaceSelectionPanel: vandret tabel-overflow skævvred Playwrights mobil-hit-test (#1834)

**Dato:** 2026-06-25 · **Kontekst:** frontend-smoke (Playwright Smoke, advisory) konsistent rød på `race-selection.spec.js` efter den parallelle race-hub-fleet (#1834/#1840) landede samme dag.

## Hvad skete
`race-selection.spec.js:130 › manager kan udtage hold og gemme` fejlede på **mobile-chromium** (393px, Pixel 5) — original + retry, ikke flake:

```
locator.click: Timeout 10000ms exceeded
  - element is visible, enabled and stable
  - <span class="text-cz-1 font-medium">Rider 6</span> from <div class="overflow-x-auto">…</div> subtree intercepts pointer events
  - (skiftevis) <label class="flex flex-col gap-1 text-xs text-cz-3"> from <div class="flex flex-wrap gap-3"> intercepts
```

Knappen "Gem udtagelse" var synlig+enabled+stable og — på failure-screenshottet — visuelt fri (intet tegnet ovenpå). Alligevel ramte `elementFromPoint(knap-center)` en tabel-celle / en rolle-select-label. Testen **bestod lokalt** (Windows 11) men fejlede på CI (windows-latest / Windows Server).

## Rod-årsag
Rytter-listen er en 5-kolonne `<table>` i en `<div class="overflow-x-auto">`. På 393px-viewporten kræver tabellen ~488px men har kun ~359px → wrapper'en bliver en **vandret scroll-container** (målt: `clientW 359` / `scrollW 488`; FORM- og TRÆTHED-kolonnerne klippet af).

Gem-knappen ligger i en søster-sektion *under* tabellen, ved layout-y ~1016 (under 852px-folden). Playwright scroller den ind i view → siden scroller lodret. Under Pixel 5's `isMobile`-emulering (deviceScaleFactor 2.75) skævvrider kombinationen **lodret side-scroll + vandret overflow-container** koordinat-mappingen: `getBoundingClientRect()` (layout-viewport) og `elementFromPoint()` (visual-viewport) divergerer, så hit-testet på knappens center lander oppe i den overflowende tabel-subtree. Bevis: de tidligere klik (checkboxe ved y=400–600, *ingen* scroll) virkede; kun gem-klikket (efter lodret scroll til en under-fold-knap) fejlede.

Skewet er på grænsen og **font-bredde-afhængigt** — CI's Windows-Server-fonts gør tabellen lige bred nok til at vippe over; lokale Win11-fonts holder den under. Reproducerede derfor ikke lokalt (heller ikke med kunstigt lange navne).

## Hvorfor det slap igennem
- `frontend-smoke` er **advisory** (continue-on-error) → blokerede ikke merge, drev stille.
- mobile-webkit droppes i CI (#1342), så kun mobile-chromium fangede mobil-overflow.
- Grøn lokalt → forfatteren så aldrig fejlen; kun CI's font-rendering udløste den.

## Fix
Responsivt panel: på mobil (`<sm`) en **stablet kortliste** (checkbox + navn + badges, derunder en kompakt stat-linje: rute-match/egnethed · form · træthed) der wrapper og *aldrig* overflower vandret; den klassiske tabel beholdes fra `sm` og op. Verificeret: 0 vandrette overflow-offenders i panelet på 393px selv med worst-case lange navne.

`race-detail-upcoming.spec.js:85` brød strict-mode (`getByText("Rute-match")` → 7 træf: 6 mobil-kort + 1 `<th>`); rettet til den **synlige** variant uanset layout: `.filter({ visible: true }).first()`.

## Forward-guard
`race-selection.spec.js` har nu en deterministisk assertion: ingen panel-efterkommer må overflowe vandret på mobil (`scrollWidth>clientWidth` eller `rect.right>viewport`). Det fanger en regression som en **klar, font-uafhængig** fejl FØR den degenererer til et flaky hit-test-timeout. Kort/wrap-layout kan strukturelt ikke overflowe → guarden er stabil på tværs af miljøer.

## Læring
- En vandret scroll-container (`overflow-x-auto` med indhold bredere end viewporten) + `isMobile`-emulering + en under-fold-klik-target = Playwright-hit-test-skew. "Element visible+enabled+stable, men intercepted" på mobil ⇒ mistænk vandret overflow, ikke z-index (screenshottet viste *ingen* visuel overlap).
- Datatunge tabeller hører ikke hjemme i en uændret vandret-scroll på telefon-bredde — responsivt kort-layout er både fixet og den rigtige mobil-UX for en kerne-feature (holdudtagelse, tilgængelig fra dashboard-CTA #1681).
- Advisory CI-gates der driver stille: ledsag fixet med en *required*/deterministisk guard, ellers gentager driften sig (jf. patch-notes-snapshot-drift #1853→#1874).
