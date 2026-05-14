---
date: 2026-05-14
trigger: User asked AI to review two Manus-authored documents ("Strategic Audit Report" + "Detailed Action Plan") landed on desktop
---

# Lærepenge: Manus audit-rapport reviewet 2026-05-14

## Hvad skete der

Manus leverede to dokumenter (`Strategic Audit Report_ CyclingZone AI Setup and Scalability.md` + `Detailed Action Plan_ Scaling CyclingZone to 10,000 Users.md`) som beskrev fem strategiske anbefalinger for at skalere mod 5.000-10.000 brugere. Brugeren bad om kvalitetsvurdering og fit-vurdering inden eventuel commit.

Faktatjek mod runtime afslørede flere stale/fejlagtige claims:

| Manus-claim | Virkelighed |
|---|---|
| "Continuous RLS Auditing" som ny opgave | #325 CLOSED 2026-05-12 — helpers + RPCs + workflow grøn (PR #285 fra 2026-05-10) |
| "Migrate fra cron-polling til Realtime" | Realtime publication LIVE for auctions+auction_bids siden 2026-05-08 (memory: `reference_supabase_realtime_publication.md`); #333 handler om at gøre det til *primær* kanal, ikke greenfield migration |
| "Research & Evaluate Solutions" for secret management | Infisical allerede valgt; #327 Phase 6 LIVE; Phase 1 (#339) er det manuelle dashboard-setup |
| Reference [9] "Railway Pricing 2026" | Linket peger på Indian Railways pricing — hallucineret kilde |
| Timeline "1 week / 2 weeks" pr. task | One-size-fits-all consulting-skabelon; ingen evidens for kapacitet eller scope |
| Action item 5: "Cost Modeling" som top-strategisk anbefaling | Beta under 100 brugere — over-engineered. Hører hjemme i #332 (Fase 4) som allerede er priority:med, ikke high |

Alle fem anbefalinger har **eksisterende GitHub-issues** (#334 caching, #333 Realtime, #327+#339 secrets, #325 closed, #332 cost model). Parent-epic #323 "Verdensklasse AI/Ops setup mod 5.000-10.000 brugere" eksisterer allerede og dækker fuldt scope.

Pikant detalje: **#334 og #327 venter eksplicit på Manus's ADR-beslutning** (Redis vs in-process LRU; secret management platform). Audit-rapporten leverer ikke disse ADR'er — den foreslår bare at lave dem som nye tasks.

## Hvorfor det er et problem

1. **Dokumenter uden ny indsigt forplumrer task-state.** Hvis vi commit'er dem som `docs/audit/` eller åbner nye issues, dublerer vi NOW.md + #323-epic'en.
2. **Stale claims kan føre til genarbejde.** Hvis nogen følger "Action Item 4 — Develop RLS Audit Scripts/Tools (2 weeks)" uden at tjekke, genimplementerer de PR #285.
3. **Hallucinerede references undergraver tilliden.** Indian Railways som kilde for Railway.app pricing er en kvalitetsfejl der burde være fanget i Manus's egen review.

## Forward-guard

**Ved fremtidige Manus-leverancer (audit, action plan, strategic doc):**

1. **Verificér issue-state med `gh issue view N` for HVER referenceret issue** før vurdering — claude:done/closed issues skal ikke fremstå som åbent arbejde.
2. **Cross-check mod `docs/NOW.md` + memory** — hvis anbefalingen overlapper med eksisterende roadmap-fase, sig det eksplicit.
3. **Spot-check references** — minst ét link pr. dokument skal åbnes/læses for at validere kilde-kvalitet.
4. **Hvis ADR-beslutninger venter på Manus selv** (som #334/#327), så skal en Manus-leverance der ikke leverer ADR'en kaldes ud som procrastination — ikke pakkes som "ny action plan".

## Backwards-check

Dette er anden Manus-leverance i denne uge der duplikerer eksisterende roadmap. Hvis mønsteret fortsætter, foreslå brugeren at re-prompte Manus med:
- "Ikke skriv om eksisterende issues — find blind spots eller leverer ADR'er der venter på dig"
- "Verificér state med `gh issue view` før recommendations"
