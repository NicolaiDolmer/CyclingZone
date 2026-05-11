# Postmortem: Supabase service_role-nøgle rotation (#296)

**Dato:** 2026-05-11
**Issue:** [#296](https://github.com/NicolaiDolmer/CyclingZone/issues/296)
**Alert:** secret-scanning #1 (open siden 2026-04-17)
**Resultat:** ✅ Lækket nøgle revoked, ingen nedetid

## Hvad skete der

Initial commit `bc9204d` (2026-04-17) inkluderede `setup.py` med hardcoded legacy service_role JWT i klartekst på linje 27. GitHub's secret-scanning åbnede alert #1 samme dag. Nøglen var offentlig i 25 dage før rotation.

## Hvorfor blev det ikke fanget før

- Pre-commit/CI havde ingen secret-scanning (kun GitHub's eget post-push scan)
- Alert #1 lå open i 25 dage uden trigger
- Ingen periodisk credential-audit i workflow

## Hvad blev gjort

1. **Migration til Supabase's nye key-system** i stedet for JWT-rotation:
   - Oprettede `sb_secret_...` (backend) og brugte den eksisterende `sb_publishable_...` (frontend, via Supabase→Vercel integration synced 17:30 UTC)
   - Drop-in: Supabase JS SDK accepterer begge formater
2. **Backend (Railway):** `SUPABASE_SERVICE_KEY` opdateret til ny sb_secret → auto-redeploy → `/api/race-pool` smoke-test 200
3. **GitHub Actions:** `SUPABASE_SERVICE_KEY` secret opdateret
4. **Frontend (Vercel):** `VITE_SUPABASE_ANON_KEY` overskrevet med publishable-værdien → `vercel --prod` rebuild → bundle indeholder nu `sb_publishable_` (0× legacy JWT)
5. **`setup.py` cleanup:** hardcoded keys erstattet med `os.environ.get()` + fail-fast hvis env mangler (commit `73d79b7`)
6. **Disable legacy JWT-based keys** i Supabase Dashboard → verificeret med direkte REST call (legacy anon returnerer nu `401 "Legacy API keys are disabled"`)
7. **Alert lukket** som `resolved/revoked` via `gh api PATCH`

## Tooling-tilstand efter rotation

- **Vercel CLI 53.3.2 installeret + logged in** (`nicolaidolmer`)
- **Project linket:** `cycling-zone` (`prj_23QsiRSCv07gZUzbfaI8RzCwB7yO`)
- **`.vercel/` oprettet i repo-root** (auto-tilføjet til .gitignore af `vercel link`)
- **Railway CLI linket** til `fantastic-connection` / production / service `CyclingZone`
- **Supabase→Vercel integration aktiv** med env-sync (oprettede 16 vars 32 min før rotation)

## Kendte follow-ups

1. **Vercel Preview env `VITE_SUPABASE_ANON_KEY` mangler** — CLI v53 bug: `vercel env add ... preview --value ... --yes` fejler med `git_branch_required` selvom docs siger det skal virke uden branch-arg. Når Preview-deploy nødvendigt: sæt via Vercel Dashboard manuelt eller specifik branch via CLI.
2. **Vercel-integration brugte `NEXT_PUBLIC_*` / `SUPABASE_*` navne** (Next.js convention), ikke `VITE_*`. Frontend bruger Vite så vi måtte manuelt kopiere publishable-værdi til `VITE_SUPABASE_ANON_KEY`.

## Forward-guard (forebyg gentagelse)

Ide til separat issue (epic:quality-hardening):
- **Pre-commit hook med trufflehog/gitleaks** der scanner for høj-entropi JWT/secret-mønstre før push
- **Periodisk audit-script** (`backend/scripts/audit-credential-hygiene.js`?) der grep'er repo for `eyJh...` JWT-mønstre på `main` weekly
- **Alert-på-PR-template:** "Indeholder denne PR nye env vars eller secrets?" tjekboks

## Snapshot pre-rotation

Se [`2026-05-11-rotation-snapshot.txt`](2026-05-11-rotation-snapshot.txt) for env var-navne og `/health`-baseline før ændringerne.
