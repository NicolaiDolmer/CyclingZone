# Supabase Context for Codex

Use this file as `.codex.local/SUPABASE_CONTEXT.md`.
Do not paste secrets here.

## Project
- Environment: production / staging / local
- Supabase project ref:
- App URL:
- Read-only env file: `.codex.local/supabase-readonly.env`

## Rules
- Read-only inspection by default.
- Do not echo credentials in chat, logs, docs, commits, or screenshots.
- Prefer `npm run db:ai:*` probes before ad hoc table inspection.
- Use live Supabase only to verify drift between repo/runtime and deployed data.

## Fast Probes
```powershell
npm run db:ai:status
npm run db:ai:schema
npm run db:ai:season-flow
npm run db:ai:import-health
npm run db:ai:views
npm run db:ai:all
```

## Known Live Checks
- Active season has races before result import verification.
- `race_results_sheets` import should insert/update rows when source rows are processed.
- `race_results` should drive standings, prize finance rows, and race completion.

## Current Notes
- Add short, dated observations here after live verification.
