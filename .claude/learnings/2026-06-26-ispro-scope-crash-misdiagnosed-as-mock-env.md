# isPro-scope-crash maskerede sig som core-smoke mock-miljø-problem

**Dato:** 2026-06-26 · **Kontekst:** CZ Pro billing-rails (#1903, PR #1909) · **Type:** render-bug + misdiagnose

## Hvad skete
Jeg tilføjede et Founder/Pro-badge i `Layout.jsx`: kaldte `useSubscription` i **hoved**-komponenten, men renderede `{isPro && <ProBadge/>}` i sub-komponenten `SidebarContent`. `isPro` var ude af scope → `ReferenceError: isPro is not defined` → error boundary crashede **alle authed-sider** (Layout er app-shell'en).

`core-smoke` fejlede 24/24 data-tests med "heading 'E2E Racing' not found". Jeg **misdiagnosticerede** det som et preview-mock-miljø-problem (VITE_PREVIEW_MOCK ikke wired i Playwright) og brugte lang tid på den blindgyde — fordi fejlen så *uniform* og *environment-agtig* ud (alle authed-sider tomme).

Den faktiske årsag blev kun fanget da jeg **viste `/pro` visuelt i browseren** og så error boundary'en + konsol-fejlen.

## Rod-årsag
- **Bug:** state-hook i forkert komponent-scope ift. hvor værdien bruges.
- **Hvorfor unit-tests ikke fangede det:** frontend-tests er pure-logic + source/regex — de *renderer ikke* Layout. Kun faktisk rendering afslører scope-/crash-bugs.

## Lektie
1. **En crash i en delt shell-komponent ligner "data mangler overalt".** Uniform fejl på tværs af ALLE sider = mistænk din egen delte ændring FØR du konkluderer "miljø/mock". 0/N passerende = systemisk; det kan lige så godt være en shell-crash som et miljø-problem.
2. **Vis UI visuelt undervejs — det fanger render-bugs unit-tests aldrig ser.** Jeg var bogstaveligt ved at pushe en app-bred crash fordi jeg skød skylden på mocken. Browser-screenshot afslørede sandheden på sekunder. (Bekræfter [[feedback_show_visuals_proactively_during_work]] + [[feedback_verify_first]].)
3. **Verificér diagnosen før du graver i den.** Et hurtigt browser-kig FØR VITE_PREVIEW_MOCK-rabbit-hole havde sparet lang tid.

## Forebyggelse
- Når et badge/element gates på state: bekræft at hook'en bor i SAMME komponent som renderingen (eller send som prop).
- Ved authed-side-fejl i core-smoke: åbn én side i browseren og tjek for error boundary FØR du mistænker mock/seed-data.
