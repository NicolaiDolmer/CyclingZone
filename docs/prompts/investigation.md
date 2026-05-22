# Investigation session-prompt

> Genbrugbar template til en Claude Code-session der skal *forstå* et problem, ikke fixe det endnu. Designet 2026-05-22 per [#561](https://github.com/NicolaiDolmer/CyclingZone/issues/561) (B7). Komplementerer [`bugfix.md`](bugfix.md) (når rod-årsag allerede er kendt) og [`mobile-to-code.md`](mobile-to-code.md) (hand-off-formatet).

## Hvorfor templaten eksisterer

Investigation-sessioner glider af sporet på 2 forudsigelige måder:

1. **Investigation glider over i implementation** — du finder en mistænkelig linje og fixer den uden at have verificeret at det faktisk ER rod-årsagen. Du har fixet noget — bare måske ikke det rigtige.
2. **Investigation giver et fix-forslag uden evidens** — sessionen lukker med "det er sandsynligvis X" og brugeren bliver ladt alene med beslutningen om at handle på en hypotese der ikke er testet.

Templaten gør tre ting eksplicitte: (a) hvad du leder efter, (b) hvilke hypoteser du har testet og kasseret, (c) hvad du anbefaler — og om anbefalingen er evidens-baseret eller stadig et gæt.

## Session-skabelonen

```
Mål: <hvad skal forstås — ikke fixes>
Issue: #<nr>
Hypoteser-at-teste: <kort liste, eller "ingen forhåndshypoteser">
Out-of-scope: <hvad du IKKE skal grave i selv om det er fristende>
Deliverable: <postmortem · fix-plan · ADR · kommentar på issue — vælg én>
```

Gennemløb 4 faser:

### Fase 1 — Scope + kontekst

- Læs issue + relaterede issues + nyligt rørte filer (`git log -20 --name-only -- <path>`).
- Identificér: er det code-bug, data-issue, config-drift, eller forventnings-mismatch?
- **Gate:** hvis du ikke kan beskrive problemet i 2 sætninger efter 15 min → STOP. Bed brugeren om mere kontekst eller en reproducer. Investigation uden et veldefineret spørgsmål bliver kun støj.

### Fase 2 — Hypotese-tracking

Skriv hypoteserne ned EKSPLICIT (ikke i hovedet). Format:

```
H1: <hypotese> — Status: untested · testing · falsified · confirmed
   Evidence: <hvad ville bekræfte/falsificere denne hypotese>
   Result: <hvad fandt du faktisk>
```

- Start med 2-4 hypoteser. Hvis du har 8+, splittes investigation.
- En hypotese der ikke kan falsificeres er ikke en hypotese — det er en mavefornemmelse. Skip eller omformulér.
- **Gate:** hvis ALLE hypoteser bliver falsificeret → STOP. Du leder forkert sted. Gå tilbage til Fase 1 med ny indsigt.

### Fase 3 — Evidens-baseret konklusion

- For hver confirmed hypotese: hvilke filer/linjer/logs/queries beviser det?
- For hver falsified hypotese: hvad udelukkede den? (vigtigt — så fremtidige investigation ikke gentager arbejdet)
- Skriv konklusionen FØR fix-forslag: "Rod-årsag er X. Evidens: <konkret>."
- **Gate:** hvis du ikke har en evidens-baseret root-cause-sætning → deliverable er IKKE "her er fix'et". Det er "her er hvad jeg afkræftede + næste investigation-skridt".

### Fase 4 — Deliverable (vælg én)

- **Postmortem** (`.claude/learnings/<dato>-<slug>.md`) — hvis incident-driven eller bug-with-surprise.
- **Fix-plan** (kommentar på issue) — hvis rod-årsag er klar men fix er ikke i scope for denne session.
- **ADR** (`docs/decisions/<NNN>-<slug>.md`) — hvis investigation afdækker en arkitektur-beslutning der skal dokumenteres.
- **Spørgsmål til brugeren** — hvis investigation viser at brugerens forventning er forkert (ikke koden).

Tilføj altid: NOW.md opdateret + 🤖 Working agent nulstillet + issue-kommentar med 🟢 + `Refs #N`.

## Anti-patterns

- **"Investigation done, fix incoming"** uden hypotese-trail — du har sprunget Fase 2. Fix-forslaget er gætteri pakket som konklusion.
- **Fix midt i investigation** — selv "lille" fix flytter dig fra investigation til implementation. Det er en anden session-type (`bugfix.md`).
- **Investigation der vokser** — du startede med "hvorfor crasher cron søndag aften" og ender med "hele finalization-pipelinen er rådden". Stop ved første rod-årsag; større tema får sit eget issue.
- **Konklusion uden falsified hypoteser** — hvis alt du undersøgte bekræftede din første hypotese, har du sandsynligvis confirmation-bias'et. Test mindst én alternativ.

## Eksempel — udfyldt brief

```
Mål: Forstå hvorfor backend cron skipper finalization søndag aften (ikke fix endnu).
Issue: #XXX
Hypoteser-at-teste:
  H1 — Timezone-bug (UTC vs CET) i cron-trigger.
  H2 — Railway scheduler pauser om søndagen pga. cost-tier.
  H3 — Lock-konflikt med weekly aggregation-job.
Out-of-scope: refactor af cron.js · ny scheduler · alarmering (separat issue).
Deliverable: postmortem + fix-plan kommentar på #XXX.
```

Session-flow:
- Fase 1: læs `backend/cron.js`, `2026-05-07-auction-timezone-utc-vs-cet.md`, Railway-logs (mangler — bruger henter).
- Fase 2: track H1-H3 med evidens-felter.
- Fase 3: H1 falsified (cron-tider er CET-aware siden 2026-05-07). H2 confirmed via Railway dashboard. H3 untestable uden DB-snapshot.
- Fase 4: postmortem committed; fix-plan kommentar foreslår enten cost-tier upgrade eller cron-flytning til Vercel.

## Cross-refs

- Bugfix-template (når rod-årsag allerede kendes): [`bugfix.md`](bugfix.md).
- Hand-off-format (mobil → PC): [`mobile-to-code.md`](mobile-to-code.md) (B8, [#562](https://github.com/NicolaiDolmer/CyclingZone/issues/562)).
- Postmortem-template (Fase 4 deliverable): [`postmortem.md`](postmortem.md).
- Kanal-valg (investigation = Claude Code plan mode eller PC-chat read-only): [`docs/AI_CHANNEL_ROUTING.md`](../AI_CHANNEL_ROUTING.md).
- Tracker: [#555](https://github.com/NicolaiDolmer/CyclingZone/issues/555) → [#561](https://github.com/NicolaiDolmer/CyclingZone/issues/561).
