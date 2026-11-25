# 2026-11-24 · Rytterprofilens yderramme skifter bredde · #2230

Ved 1440 px genbrugte React profilens yderste DIV fra loading til indhold. Loading havde max-w-5xl på ydersiden, hvor den færdige profil havde en fuldbred ramme. Layoutsporet målte x 312 → 208 og bredde 1024 → 1232 i samme node. Breddeskiftet alene gav et målbart CLS-bidrag selv om spinneren blev stående i midten.

Rytterprofilen holder nu yderrammen fuldbred i loading, fejl og færdig. De indre bredder og indhold følger fortsat T3 og PAGE_TEMPLATES. En Playwright-regression holder rytterens første svar tilbage og sammenligner den samme rammes bredde og x-position før og efter.

Ved fremtidige ændringer på full-bleed-ruter skal loading og fejlruter eje deres indre bredde. En ændring af en genbrugt yderrammes mål rapporteres som et sideskift, selv om indholdet skiftes ud. Fejlsøg med rektangler for hver kilde og adskil dem fra samtidige skift i den delte navigation.
