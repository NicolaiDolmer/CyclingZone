# 2026-05-30 — Preview-login: søg eksisterende infra før du antager den mangler (#767)

## Symptom
Issue #767: "Kunne ikke logge ind i test-/preview-versionen." Issuet listede
sandsynlige årsager som om infrastrukturen skulle bygges fra bunden — bl.a.
"ingen dedikeret test-konto med kendt password" og "evt. separat staging-Supabase".

## Hvad der faktisk var sandt
Hele test-konto-infrastrukturen fandtes allerede og var dokumenteret i
`docs/TESTING.md`:
- 3 dedikerede konti (`test-a/b/seller@cyclingzone.dev`, `is_test_account=true`).
- Et fælles `TEST_ACCOUNT_PASSWORD` + idempotent `scripts/setup-test-accounts.mjs`
  + `scripts/get-test-token.mjs`.

Rod-årsagen var **ikke** teknisk:
1. Preview peger på samme Supabase som prod (kun ét projekt) → enhver prod-konto
   virker i preview. Ingen SSO-væg. Env-vars til stede.
2. `TEST_ACCOUNT_PASSWORD` var bare ikke i lokal `backend/.env` / Infisical-sync,
   og preview-login var udokumenteret som *vejen* til at verificere PR-features.

Altså: **discoverability + secret-sync**, ikke manglende infrastruktur.

## Lektie / forward-guard
- Når et issue beskriver infrastruktur der "skal oprettes", **grep docs/ +
  scripts/ først** (her: `is_test_account`, `test-konto`, `TEST_ACCOUNT`).
  Issue-præmisser er hypoteser, ikke verificeret state — jf. "verificér FØR claim".
- Udeluk hypoteser empirisk og billigt før du bygger: probe Vercel-env (keys-only),
  `curl -I` preview-URL (SSO-væg?), grep public Supabase-URL ud af preview-bundlen,
  `list_projects` (findes der staging overhovedet?).
- Når fixet er "dokumentér det eksisterende", så placér doc'en hvor problemet
  opstår (her: `docs/TESTING.md`), ikke en ny isoleret fil.

## Secret-disciplin under arbejdet
- Publishable/anon-key er public-by-design, men `sanitize-secrets.sh` blokerer
  alligevel `sb_publishable_…` i tool-output. Print den ikke — udled kun
  status/boolean fra auth-kald (HTTP-kode + "har access_token JA/NEJ").
- Password til test-konti er en reel secret (test-konti kan logge ind i prod):
  aldrig i et publicly viewable repo — kun Infisical/`backend/.env`.
