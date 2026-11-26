# UI color tokens

`frontend/src/theme/tokens.json` owns the existing light, dark and chart palettes.
It follows the DTCG 2025.10 format and color modules. Each color has an sRGB
`$value` with three normalized components and alpha. The existing portrait
palette under `docs/design/visual-identity/` has a separate purpose.

The `org.cyclingzone.css` extension records each group's destination marker,
each token's output format and any Tailwind alias. Channel tokens retain their
RGB triplet representation because callers use `rgb(var(--token))`. The
`@theme inline` aliases keep their current names and cascade position.

Run from the repository root after changing a color token.

```sh
node scripts/generate-design-tokens.mjs
node scripts/generate-design-tokens.mjs --check
node --test frontend/src/lib/designTokens.test.ts frontend/src/lib/contrastTokens.6768.test.ts frontend/src/components/ui/tokens.test.js
```

The generator updates values in the existing declarations. It retains comments,
spacing, selectors, `color-scheme`, typography and other CSS settings. Missing,
duplicate or unregistered palette declarations fail. The checked-in generated
CSS is required for normal Vite and Tailwind entry points. Frontend `npm test`
runs the synchronization test, so CI rejects token/CSS drift.

`scripts/lint-ui-slop.mjs` already rejects new raw hex colors and stock Tailwind
palette colors outside their allowed sources. Its per-file baseline can only
shrink. Both `scripts/preflight-pr.ps1` and the CI static guards invoke it. Keep
using that ratchet when adding components.

The existing theme provider in `frontend/src/lib/theme.jsx` continues to resolve
system preference and the player's explicit choice. A visual palette change
still follows the owner review on #8737 and the recipes in
[PAGE_TEMPLATES.md](PAGE_TEMPLATES.md) and [TASTE.md](TASTE.md).

The initial conversion preserves every palette declaration and Tailwind alias.
It does not need a player patch note because the rendered values are identical.

References

- [DTCG Format 2025.10](https://www.designtokens.org/tr/2025.10/format/)
- [DTCG Color 2025.10](https://www.designtokens.org/tr/2025.10/color/)
