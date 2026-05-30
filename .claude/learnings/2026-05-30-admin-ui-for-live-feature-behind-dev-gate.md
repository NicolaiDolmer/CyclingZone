# Admin-UI til en live feature må ikke ligge bag en dev-only gate

**Dato:** 2026-05-30
**Issue/PR:** [#805](https://github.com/NicolaiDolmer/CyclingZone/issues/805) · PR [#810](https://github.com/NicolaiDolmer/CyclingZone/pull/810) (feature) → [#811](https://github.com/NicolaiDolmer/CyclingZone/pull/811) (fix)

## Hvad skete der

Board-test-mode-aktiveringen (admin-knap "Åbn board for test") blev placeret i
`BetaToolsSection`, der rendres bag:

```js
const BETA_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_BETA_TOOLS === "true";
```

På prod er `import.meta.env.DEV` false og `VITE_ENABLE_BETA_TOOLS` ikke sat → hele
sektionen skjult. Alle CI-checks, build og core-smoke var grønne (de logger ind som
ikke-admin og rører aldrig admin-System-fanen), så manglen blev først fanget da
brugeren ledte efter knappen efter merge.

## Rod-årsag

Jeg genbrugte den nærmeste eksisterende admin-sektion (`BetaToolsSection`) uden at
tjekke dens render-gate. `BETA_ENABLED` er bevidst dev-only fordi sektionen rummer
**destruktive** reset-knapper. Men board-test er en **admin-handling til en live
feature** (backend-beskyttet af `requireAdmin`) — den skal være synlig på prod.

## Forebyggelse

- Når en admin-kontrol skal **bruges på prod**, verificér render-gaten på dens
  container, ikke bare backend-`requireAdmin`. Søg efter `import.meta.env.DEV` /
  `*_ENABLED` / feature-flags op gennem komponent-træet før du genbruger en sektion.
- Lokal verify + core-smoke dækker IKKE admin-only UI (kører som ikke-admin). For
  admin-synlig UI: enten manuel admin-login i preview, eller bekræft render-gaten ved
  inspektion.
- Skel: dev-tools (destruktive, BETA_ENABLED) vs. admin-ops til live features
  (altid synlige for admin). Bland dem ikke i samme gated container.

Fix: udtrak til `BoardTestModeSection` + render i `AdminSystemTab` uden for gaten.
