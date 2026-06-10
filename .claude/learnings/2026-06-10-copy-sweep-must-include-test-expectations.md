# Copy-sweep skal inkludere test-forventninger (og advisory-jobs maskerer hullet)

**Dato:** 2026-06-10 · **Refs:** #1193 (em-dash-sweep), PR #1218 (fix)

## Hvad skete

Tone-sweepen 9/6 (PR #1193) ændrede al player-facing copy (em-dash → punktum/middot m.m.) i 38 locale-filer, men opdaterede IKKE e2e-spec-forventningerne der matcher på copy-strenge. To specs brød:

- `onboarding-setup-wizard.spec.js` forventede `"Kunne ikke nå serveren — tjek..."` (nu `". Tjek ... igen."`)
- `race-detail.spec.js` forventede `"Etape 1 — målrækkefølge"` (nu `"Etape 1 · målrækkefølge"`)

frontend-smoke var derfor rød (4 fails: 2 specs × 2 projekter) i ~1 døgn uden at nogen opdagede det, fordi jobbet er **advisory** (kendt teardown-flake gjorde det til ikke-hard-gate). Fundet ved manuel inspektion af en "forventet flake" under automode session 2.

## Læring

1. **Sweep af player-facing copy = grep også `tests/` for de gamle strenge.** En copy-ændring er ikke færdig før `grep -r "<gammel streng>" frontend/` er tom (locales + komponenter + tests + fixtures).
2. **Advisory CI-jobs kræver aktiv mistanke.** "frontend-smoke fejler, det er nok teardown-flaken" er et farligt default. Tjek ALTID fejl-listen: flaken har ét bestemt symptom (teardown); alt andet er reelt. Jf. `reference_frontend_smoke_teardown_flake`.
3. **Match-på-copy i specs er skørt design.** Hvor muligt: match på rolle/testid eller på locale-KEY-resultatet (importér locale-JSON i spec'en) i stedet for hardkodede prosa-strenge, så copy-ændringer ikke brækker specs stille.

## Forward-guard

Tone-guarden (`scripts/tone-check-em-dash.mjs`, PR #1215) forhindrer nye em-dashes i copy, men IKKE stale forventninger i specs. Regel 1 ovenfor er den reelle guard; den er nu del af sweep-definitionen.
