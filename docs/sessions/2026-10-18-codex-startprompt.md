# Startprompt: Codex (NicolaiPC, søndag aften 18/10)

Du er Codex på NicolaiPC. Claude Code kører en merge-session på SAMME maskine: arbejd kun i dine egne worktrees (`scripts/new-worktree.ps1`), rør aldrig hovedcheckoutet eller Claudes worktrees, og merge aldrig selv. Claude reviewer og merger dine PR'er. Kør `git pull --ff-only`, læs `AGENTS.md`, `docs/NOW.md` og denne fil. Skriv til ejeren på dansk, kort og uden jargon.

Fælles regler: én PR pr. opgave · `Refs #N` · preflight i forgrunden (`pwsh -File scripts/preflight-pr.ps1`) · tunge verifikationer kun via `scripts/verify-lock.ps1 -Max 2 -- <kommando>` (loftet deles med Claude) · status som PR-kommentar hvert 30. min · ikke klar efter 90 min → push draft, skriv hvad der mangler, gå videre · ingen prod-skrivning, ingen flag-flip, ingen spillertekst i patch notes (samles ved close-out).

## Opgave 1: Forbedr din egen opsætning (først, én PR)

Ejeren oplever, at Codex er svag til workflows og subagenter. Fund 18/10 (verificér selv mod den officielle Codex-dokumentation, før du bygger):

1. **Ingen egne agenter.** `.codex/agents/` findes ikke; kun de indbyggede roller `default`, `worker` og `explorer`.
2. **Codex delegerer kun, når prompten eller AGENTS.md beder om det.** AGENTS.md siger aldrig, hvornår arbejdet skal deles op.
3. **AGENTS.md er 26,5 KB (~6.500 tok)** og læses ved hver start (Codex cold-start ~28.500 tok ifølge `scripts/check-agent-token-hygiene.ps1`). Der er risiko for afskæring ved `project_doc_max_bytes`.
4. **Ingen `[agents]`-standarder** i `~/.codex/config.toml` (standardmodel/effort for subagenter, `max_concurrent_threads_per_session`).

Lever:
- `.codex/agents/*.toml` med `name`, `description`, `developer_instructions` og eksplicit `model` + `model_reasoning_effort`:
  - `explorer`: kun læsning, billig model, lav effort
  - `worker`: snævre rettelser i ét worktree
  - `reviewer`: ingen edits; korrekthed, sikkerhed, regressioner, manglende tests
  - `verifier`: kører den rette verify-tier og rapporterer
  - `ui-checker`: skærmbilleder mod `docs/design/TASTE.md`

  Vælg modeller, der faktisk findes på kontoen. Billige til snævre gentagelser, stærke til tvetydigt arbejde i flere trin.
- **Et afsnit "Sådan deler du arbejdet op" i AGENTS.md:**
  - læsetungt arbejde går til parallelle `explorer`-agenter: vent på alle, og få ét samlet svar
  - skrivearbejde går ét worktree pr. opgave via `node scripts/codex-wave.mjs`, aldrig flere skrivende subagenter i samme checkout
  - review sker via en `reviewer` før push
- **AGENTS.md skæres ned til højst ca. 13 KB.** De sjældne regler flyttes til skills eller detaljedocs, som hentes ved behov. Alle bindende ankre skal stå: `agents-md-required-rules` i hygiejne-scriptet skal blive grøn.
- **`scripts/codex-setup.ps1`:** sætter idempotent `[agents]` i brugerens `~/.codex/config.toml` på hver maskine. Den rører aldrig nøgler eller tokens og har en dry-run som standard.
- **Mål før og efter i PR-body:**
  - Codex cold-start-tokens
  - tid til første svar på en fast testopgave
  - om en "spawn én explorer pr. område"-opgave faktisk kører parallelt

## Opgave 2: Fire små restopgaver, parallelt (test af den nye opsætning)

Én PR hver, i egne worktrees via `codex-wave.mjs` (lanes ≤ 4, så Claude har plads):
- **#6872:** løbsbibliotek. Et løb med ≥15 etaper skal klassificeres som Grand Tour i `frontend/src/lib/racePeek.ts` (CALENDAR_RULES.md:566). Rute-fallback til ældre udgaver i `RaceHistoryLibrary.tsx`. Byg på main, efter at #6680 er merget.
- **#6867:** udgået rytter i replayet, og kalender-cachen på admin-stierne.
- **#6866:** vægur-planlæggeren. Første tick efter boot må ikke springe en kadence over.
- **#6868:** ugentlig værdiopdatering. Et no-op boot-run om mandagen må ikke skrive check-in.

## Opgave 3: Løbsidentitet #6857 (byg, prøvekørsel til ejeren 21/10)

**Spec:** `docs/superpowers/specs/2026-10-18-6857-loebsidentitet-teknisk-design.md`. Ejerens beslutninger:
- alt kommer i S5
- 8 faste løbstyper
- signatur pr. løb
- håndskrevne monumenter
- fordeling A
- fiktive navne på stigninger
- vises kun i Hjælp

**Spor (§6):**
- **L1:** kontrakt og DB. Den skal ind først, og migrationen køres post-merge af Claude.
- **L2:** generatoren.
- **L3:** regen-script og rapport.
- **L4:** forfatning og Hjælp, EN+DA.

L1-L3 rører motor- og kalenderdata. Brug din stærkeste model med høj effort, offline fixture-baseline først (§4), og ingen prod-skrivning. Prøvekørslen mod prod 21/10 sker kun på ejerens go via Claude.
