# Design: mobil 10x ("en af verdens bedste apps")

Status: produkt-design, ejer-valg 19/10 (5 spørgsmål, §1). Ingen kode endnu. SSOT for UI: `docs/design/TASTE.md` + `docs/design/PAGE_TEMPLATES.md`. Relateret: #6915 (kommandopalet = søgning på mobil).

## 0. Udgangspunkt (målt 19/10)
- **63 % af sessionerne er på mobil** (Clarity 17-19/10: 272 mobil, 161 PC, 1 tablet).
- Allerede: PWA (manifest, service worker, install-prompt, push, app-badge), `MobileQuickNav` i bunden, React 19 + Vite 8 + Tailwind 4.
- Mangler: sideovergange, gestures, bottom sheets, haptik, cache/prefetch-navigation, offline-visning.
- Døde klik på mobil (Clarity 17-19/10): /academy 69, /klub 35, /notifications 21, /team 10. Det er de første kandidater til flows.

## 1. Ejer-valg 19/10 (låst)
1. **Teknologi:** native-følelse i den nuværende React-app (én kodebase), derefter samme app i Google Play via Capacitor. Ingen separat React Native-app.
2. **Navigation, tommelfinger-først:** 5 faste faner i bunden (Hjem, Hold, Marked, Løb, Mere) med badges, swipe mellem faner på samme side, swipe-tilbage, søge-knap (#6915) øverst, vigtigste knap altid nederst inden for tommelfingerens rækkevidde.
3. **Fart og bevægelse med mening:** sider åbner øjeblikkeligt fra cache og opdaterer i baggrunden, prefetch ved berøring, skeletter i stedet for spinnere, sideovergange og fjeder-animationer, let haptik ved vigtige handlinger. Krav: < 100 ms følt svartid, målt.
4. **Én-tommel-flows:** hovedhandlinger (udtagelse, træning, bud, taktik) i bottom sheets, under 10 sek. med én hånd. Start med de 3 mest brugte (Clarity).
5. **Måling:** Clarity før/efter (døde klik, rage-klik, tid pr. handling, frafald) + Core Web Vitals på mobil i CI + ejer-test på Android før live + beta-uge pr. større trin.
6. **Timing:** fundamentet bygges som eget spor efter sæsonskiftet. Flows bygges SAMMEN med fokuslistens trænings-, udtagelses- og formforbedringer, så hver side kun redesignes én gang. Play Store til sidst.

## 2. Teknologi-valg (anbefalet, verificeres i fase 0)
| Behov | Valg | Hvorfor |
|---|---|---|
| Øjeblikkelige sider, cache, prefetch, offline-visning | **TanStack Query** (+ persist til IndexedDB) | Industristandard; fjerner spinnere; deler økosystem med #6915 |
| Sideovergange | **View Transitions API** (Chrome Android + Safari 18+), fallback = ingen animation | Native, ingen tung afhængighed |
| Fjeder-animationer | **Motion** (motion.dev), kun hvor det giver mening | Fysisk korrekt bevægelse, tree-shakeable |
| Bottom sheets | **Vaul** (eller egen på Radix Dialog) | Snap-punkter, træk-for-at-lukke, tilgængelig |
| Swipe/gestures | **@use-gesture/react** | Swipe mellem faner, swipe-tilbage, swipe i lister |
| Haptik | Vibration API (Android web), Capacitor Haptics i app | Let og sparsom: bud, træn nu, bekræft |
| Butik | **Capacitor** (Android først) | Samme kode; native push/del/haptik; Play Store-synlighed |
Alle versioner fastlåses (≥ 2 uger gamle) og måles mod bundle-budgettet. Biblioteker pakkes i egne moduler (`src/lib/mobile/`).

**Omkostninger:** Google Play-konto er et engangsbeløb (ca. 25 USD). Apple App Store koster 99 USD/år og er en løbende udgift, så den kommer først, når indtægten tillader det (ejer-regel). Ingen andre nye løbende udgifter.

## 3. Fundament-komponenter (bruges overalt)
`<MobileTabs>` (5 faner + badges) · `<Sheet>` (bottom sheet) · `<SwipeTabs>` · `<StickyAction>` (primær knap i tommelfingerzonen) · `<Skeleton>`-familie · `usePrefetchOnTouch` · `haptic()` · sideovergang-wrapper. Følger TASTE: én gold primary pr. view, hairlines, 5px radius, stroke-ikoner, tabular figures.

## 4. Udførelsesplan
| Fase | Indhold | Bevis |
|---|---|---|
| 0. Mockup + baseline | Klikbar mockup (faner, sheet-flow, overgange) på din Android + Clarity- og CWV-baseline | Dit go på mockup |
| 1. Fart | TanStack Query (cache, prefetch, persist), skeletter, sideovergange | Følt svartid < 100 ms; CWV mobil grøn; ingen regression |
| 2. Navigation | 5 faner, swipe-tilbage, swipe mellem faner, søge-knap (#6915) | Clarity: færre døde klik; Android-test |
| 3. Flows (med fokuslisten) | Udtagelse, træning, bud/taktik som én-tommel-sheets; Akademi/Klub døde klik løst | < 10 sek. pr. handling (målt), før/efter-billeder |
| 4. Beta-uge | Flag `mobile_v2` = beta | Clarity før/efter + feedback |
| 5. Live | For alle; patch note + Hjælp EN/DA | |
| 6. Google Play | Capacitor Android, native haptik/push/del, butikstekster | Intern test-track → offentlig |
Hver fase: én PR, før/efter-billede (375 + 390 Android), lint/test/build/verify-affected, review-gate, ejer-test på Android før merge.

## 5. Ikke i denne plan
Separat native-app. Apple App Store (løbende udgift). Tunge effekter (parallax/3D/lyd).
