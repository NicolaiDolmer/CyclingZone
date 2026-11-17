# Rundvisningen startede ikke fra en knap på samme side (16/11, #8069)

**Symptom:** "Show me around" i Økonomis og Auktioners første-besøgs-kort gemte rundvisningens tilstand, men viste ingen rundvisning. Den dukkede først op efter et sideskift. Målt i preview-mocken på main: 0 synlige trin efter klik.

**Rodårsag:** `<OnboardingTour>` læser `cz-onboarding-tour-step` fra localStorage én gang, i `useState(() => readTour())`. `startTour()` skrev kun til localStorage, så en tour, der allerede var monteret på siden, fik aldrig besked. Det virkede kun, når knappen sad på en anden side end touren (navigation = ny mount).

**Fix:** `startTour()` sender `TOUR_START_EVENT` på `window`; `OnboardingTour` lytter og genlæser tilstanden. Test: `lib/onboardingTour.startEvent.test.ts`.

**Læring:** State i localStorage er ikke reaktiv. En komponent, der læser den ved mount, skal også have et signal, hvis den kan skrives, mens komponenten er monteret. Klik selv på knappen i preview, før en "Vis mig rundt"-vej regnes som virkende.
