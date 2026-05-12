# Bug

Natlig `@claude`-automation på [#260](https://github.com/NicolaiDolmer/CyclingZone/issues/260) ("audit alle steder holdnavn rendres → klikbart") fejlede med `error_max_turns` efter 51 turns / 6m39s / $1.51. Branch blev aldrig pushet; al arbejdet tabt.

Run: [25699672154](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/25699672154).

# Root cause

To sammenfaldende faktorer:

1. **Scope vs. turn-budget mismatch.** `--max-turns 50` i `.github/workflows/claude.yml` er kalibreret til typiske 1-3-fil bugfix. Issue #260 var en audit-style refactor med 12 todo-items (TeamNameLink-komponent + 9 sider + backend `riderBidTimeline.js` + close-out). Sonnet brugte ~3-5 turns per fil (Read → Edit → verify), så 50 turns dækker realistisk ~10 filer inkl. close-out.

2. **Ingen scope-detection up-front.** Agenten begyndte direkte at eksekvere de 12 sub-tasks i stedet for at flagge scope-mismatch og kalde `claude:blocked` med forslag om at splitte issuet. Den eksisterende blocker-mekanisme var dokumenteret i workflow-prompten, men kun for "mangler kontekst / fagligt valg" — ikke for "scope er for stort til ét run".

3. **Ingen WIP-commit-strategi.** Agenten planlagde alt arbejde i ét endeligt commit. Da max-turns ramte ved fil 2 af 12, var der ikke noget at salvage — branchen `claude/issue-260-20260511-2156` blev aldrig pushet.

# Fix

Workflow-ændring i `.github/workflows/claude.yml`:

- Bumpede `--max-turns` fra 50 → 120. Cap, ikke budget — typiske opgaver koster det samme.
- Tilføjede SCOPE-GUARD-blok til prompt: agenten skal lave scope-vurdering FØR edits og blokere med `claude:blocked` hvis acceptkriteriet siger "audit alle steder" / >8 filer.

Issue-split:

- #260 splittet i sub-issues: scaffolding (TeamNameLink-komponent + backend team_id-felt) + rollout (brug komponenten på alle 9 sider). Sekventielt: rollout afhænger af scaffolding merget først.

# Læring

- **Max-turns er et safety-net, ikke et scope-tool.** Bumping cap er gratis ved små tasks og kritisk ved store. 50 var underdimensioneret til repo'ets bredde.
- **Scope-blocker > halv-eksekvering.** Bedre at stoppe efter 5 turns med `claude:blocked` end at brænde 50 turns og tabe alt. Føj eksplicit scope-tærskel til prompts.
- **For agent-loops uden user-supervision: design for fail-mid.** Ved store refactors bør agenten committe scaffolding først (TeamNameLink-komponent isoleret) og pushe FØR den begynder på rollout-fasen. Næste session/run kan fortsætte fra branchen i stedet for at starte forfra. (Ikke implementeret endnu — kræver mere kompleks prompt-engineering; sub-issue-split løser samme problem enklere.)
- **Audit-acceptkriterier er røde flag.** Issues der siger "i hele app'en", "alle steder X", "konsistent overalt" bør pre-splittes til scaffolding + rollout før de får `claude:todo`-label.
