# Cycling Zone

> _Browser-baseret multiplayer cykelmanager-spil. Bygget af én person, gratis at spille, åben for testere._
>
> **Spil her:** [cycling-zone.vercel.app](https://cycling-zone.vercel.app)

[![CI](https://github.com/NicolaiDolmer/CyclingZone/actions/workflows/ci.yml/badge.svg)](https://github.com/NicolaiDolmer/CyclingZone/actions/workflows/ci.yml)

## What is this?

Cycling Zone is a small, browser-based multiplayer cycling manager game. You sign up, get a team, bid on riders in live auctions, set tactics, and compete against other managers across a season calendar. The game is free, has been free since launch, and will always remain free.

I'm a solo founder building this in public. The game has been in **open beta since 2026-05-08**, with a small group of testers actively playing. I share the thinking and trade-offs as they happen, not after the fact.

If you want to play, just sign up at [cycling-zone.vercel.app](https://cycling-zone.vercel.app).

## Tech stack

React + Vite (frontend), Node.js + Express (backend), Supabase (Postgres, Auth, RLS), Vercel + Railway (hosting).

## Status

Live and being actively developed. Open beta, so breaking changes happen. Patch notes are visible inside the app on the Patch Notes page.

---

## For contributors

This repo is **closed-source, made publicly viewable** for transparency, learning, and collaboration. The full terms are in [LICENSE](LICENSE).

- **Bug reports and ideas:** [open an issue](https://github.com/NicolaiDolmer/CyclingZone/issues/new/choose). Be specific and I'll get back to you.
- **Pull requests:** welcome. By submitting one, you grant me the contributor license described in [LICENSE](LICENSE).
- **Security issues:** please don't file public issues. See [SECURITY.md](SECURITY.md) for private reporting.

You can read the code, learn from it, and contribute back. You cannot fork, mirror, redistribute, or run your own instance of the game. Full terms in [LICENSE](LICENSE).

---

## Running it locally

You don't need to run this locally to play, just go to [cycling-zone.vercel.app](https://cycling-zone.vercel.app). The steps below are for contributors who want to work on the code.

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run `database/schema.sql`.
3. From **Settings → API**, copy `Project URL`, `anon public` key, and `service_role` key.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Fill in the Supabase keys you just copied, then:

```bash
npm run dev
```

Backend runs on `http://localhost:3001`.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then:

```bash
npm run dev
```

Frontend runs on `http://localhost:5173`.

### 4. Verify the build

From the repo root:

```powershell
pwsh -File scripts/verify-local.ps1
```

Runs backend tests and (if `frontend/node_modules` is present) the frontend build.

---

## Project docs

Canonical docs live in `docs/`:

- [`docs/NOW.md`](docs/NOW.md): active work and current status.
- [`docs/META_DOCS_INDEX.md`](docs/META_DOCS_INDEX.md): index of all docs (read this if you're looking for something specific).
- [`docs/GUARDRAILS_CORE.md`](docs/GUARDRAILS_CORE.md): invariants and stop conditions (read when changing shared contracts).
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): production deployment, observability, env vars.
- [`docs/PUBLIC_ROADMAP.md`](docs/PUBLIC_ROADMAP.md): what's planned, in player-facing language.

If you're an AI coding agent: start with [`CLAUDE.md`](CLAUDE.md) (Claude Code) or [`AGENTS.md`](AGENTS.md) (OpenAI Codex).

---

## Contact

Questions, ideas, or licensing inquiries: `nicolai.dolmer.mikkelsen@gmail.com`.
