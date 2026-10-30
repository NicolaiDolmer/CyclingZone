# 30/10: Dependabot-bump af @vercel/og brød prod-deployet af frontenden

## Hvad skete
- #7328 (satori 0.29 → 0.33.5, @vercel/og 1.0.1 → 1.0.3) blev merget efter den stående Dependabot-regel: 29/29 påkrævede checks grønne, review-gaten grøn, diff'en kun package.json + lockfile.
- Prod-deployet på Vercel fejlede straks: Edge-middleware "referencing unsupported modules: @vercel". Prod kørte videre på forrige grønne deploy, men alle nye frontend-deploys (main + previews) fejlede.
- Ingen af de påkrævede GitHub-checks bygger Edge-middleware som Vercel gør, og Dependabot-PR'en havde ingen Vercel-preview, der kunne have fanget det.

## Regel fremad
- Dependabot-bump der rører `frontend/` og noget Vercel-/Edge-relateret (`@vercel/*`, `satori`, `next`, middleware-afhængigheder): merg først når **Vercel – cycling-zone** står grøn på PR'en. Mangler preview-checket, er det ikke "grøn CI".
- Efter merge af en frontend-dependency: læs prod-deployets status i Vercel (ikke kun GitHub-CI).
