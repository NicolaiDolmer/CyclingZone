# 2026-05-13 — UCI sync schedule + Supabase WebSocket runtime

## Symptom
`UCI Rankings Sync` havde ingen scheduled GitHub Actions-run onsdag 2026-05-13 06:00 UTC. Manuel retry kørte scraperen færdig, men jobben fejlede bagefter i `Recalculate rider salaries`.

## Root cause
- Workflowet var planlagt til minut `0`, som GitHub dokumenterer som høj-load tidspunkt hvor scheduled jobs kan blive forsinket eller droppet.
- `backend/scripts/recalculateRiderSalaries.js` oprettede Supabase-klienten uden WebSocket-transport. Med `@supabase/supabase-js` 2.105.x på Node 20 fejler klient-init, fordi Node 20 ikke har native WebSocket support.

## Fix
- Flyt UCI cron til onsdag 06:17 UTC.
- Tilføj `ws` dependency og giv Supabase-klienten `realtime.transport`.

## Prevention
Planlæg GitHub Actions cron jobs væk fra minut `0`, især for drift-jobs hvor en droppet schedule er dyrere end 10-20 minutters offset.
