#!/usr/bin/env node
/**
 * sync-docs — Cycling Zone Manager
 * Kør: npm run sync-docs
 * Bruges ved afslutning af arbejdssessioner.
 */

const SYNC_PROMPT = `
Du skal opdatere docs/-mappen så den afspejler den aktuelle tilstand i kodebasen.

Gør følgende i rækkefølge:

## 1. Læs den aktuelle tilstand
- Læs docs/NOW.md
- Læs docs/FEATURE_STATUS.md
- Kør: git log --oneline -10
- Kør: git diff HEAD~1 --name-only

## 2. Opdatér docs/NOW.md
Baseret på git log og ændrede filer:
- Flyt færdige opgaver fra 🟡 I gang → 🟢 Senest afsluttet (med commit hash)
- Tilføj nye bugs du finder i koden under 🔴 Broken
- Opdatér 🟡 I gang med det der stadig er uafsluttet
- Behold maks ~40 linjer

## 3. Opdatér docs/FEATURE_STATUS.md hvis nødvendigt
Kun hvis noget har skiftet status:
- Feature færdig → flyt fra 📋 Planlagt eller 🚧 I gang til ✅ Implementeret
- Ny bug → tilføj under 🔴 Broken
- Tilføj commit til versionshistorik

## 4. Opdatér docs/ARCHITECTURE.md hvis nødvendigt
Kun hvis der er tilføjet:
- Nye API endpoints i backend/routes/api.js
- Nye tabeller i database/schema.sql
- Nye frontend routes i frontend/src/App.jsx
- Nye lib-moduler i backend/lib/

## 5. Rapport
Afslut med:
SYNC AFSLUTTET
Opdateret: [liste over ændrede filer]
Ingen ændringer: [liste over uændrede filer]
OBS: [eventuelle uoverensstemmelser du fandt]

Vigtigt: Vær konservativ. Opdatér kun det der faktisk har ændret sig.
Baser alt på kode og git-historik. Opfind ikke indhold.
`;

console.log(SYNC_PROMPT);
