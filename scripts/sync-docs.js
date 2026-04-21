#!/usr/bin/env node
/**
 * sync-docs — Cycling Zone Manager
 * Kør: npm run sync-docs
 * Bruges som checklist/prompt til at holde current docs alignet med runtime og den lean AI-doc struktur.
 */

const SYNC_PROMPT = `
Dette er en checklist/prompt — ikke en automatisk docs-sync.

Du skal opdatere current docs konservativt, så de matcher runtime og den lean AI-doc struktur.

Gør følgende i rækkefølge:

## 1. Læs kilderne i korrekt rækkefølge
- Læs docs/RUNTIME_GUARDRAILS.md
- Læs docs/AI_EXECUTION_STANDARD.md
- Læs docs/NOW.md
- Læs docs/FEATURE_STATUS.md
- Læs docs/ARCHITECTURE.md
- Læs docs/DOMAIN_REFERENCE.md
- Læs docs/CONVENTIONS.md
- Læs docs/TEST_SCENARIOS.md hvis verifikation er relevant
- Læs docs/DEPLOYMENT.md hvis deployment eller live-verifikation er relevant

## 2. Verificér current runtime før docs-opdatering
- Brug runtime som sandhed ved uenighed
- Tjek frontend -> API -> engine/service -> DB ved relevante flows
- Brug git som valgfri hjælp til at finde berørte filer, men ikke som eneste kilde

## 3. Opdatér kun relevante current docs
- Opdatér docs/NOW.md hvis aktiv status eller drift/ops-noter har ændret sig
- Opdatér docs/FEATURE_STATUS.md hvis feature-status eller kendte bugs reelt har ændret sig
- Opdatér docs/ARCHITECTURE.md hvis endpoints, tabeller, flows eller execution paths har ændret sig
- Opdatér docs/DOMAIN_REFERENCE.md kun ved ændrede domæneregler
- Opdatér docs/CONVENTIONS.md kun ved ændrede sprog-, naming- eller UI-konventioner
- Opdatér docs/TEST_SCENARIOS.md hvis nye smoke-checks eller regression-trin blev nødvendige
- Opdatér docs/DEPLOYMENT.md hvis live-URLs, deploy-path eller verifikationstrin ændres

## 4. Bevar den lean struktur
- docs/RUNTIME_GUARDRAILS.md og docs/AI_EXECUTION_STANDARD.md er de eneste kanoniske regeldocs
- Entry-filer må route, men ikke gentage regler
- Current docs beskriver nuværende adfærd
- Spec docs må ikke beskrives som implementeret adfærd

## 5. Rapport
Afslut med:
SYNC AFSLUTTET
Opdateret: [liste over ændrede filer]
Ingen ændringer: [liste over uændrede filer]
OBS: [eventuelle uoverensstemmelser du fandt]

Vigtigt: Vær konservativ. Opdatér kun det der faktisk har ændret sig.
Baser alt på runtime og de aktuelle docs. Opfind ikke indhold.
`;

console.log(SYNC_PROMPT);
