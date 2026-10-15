# Startprompt: pc1 efter skiftet fra DOLMERPC 15/10 (dynamisk workflow)

Kopiér alt under linjen ind i en ny Claude Code-session på pc1.

---

Ny session på pc1 efter skiftet fra DOLMERPC. Svar på dansk, ét beslutningskort ad gangen. Jeg giver eksplicit opt-in til multi-agent-orkestrering: byggearbejde køres som Workflow via `wave.js` (CLAUDE.md, Orkestrator-standard), med maskinens lane-loft fra `scripts/wave-capacity.json`.

**1. Opstart (best practice, før alt andet):**
- `git pull --ff-only`. Kør `npm run sync-deps`, hvis en `package-lock.json` er ændret.
- `pwsh -File scripts/link-onedrive-context.ps1`, derefter `pwsh -File scripts/agent-doctor.ps1`.
- Bekræft, at OneDrive-memory er synket: `MEMORY.md` skal nævne 12/10-entries.
- Læs `docs/NOW.md`. Er der en anden aktiv Working agent, så STOP og spørg mig. Ellers sæt dig selv som Working agent, commit og push.
- Tjek Supabase security-advisors (session-start-reglen #5153).

**2. Plan og låste beslutninger:** læs `docs/sessions/2026-10-15-s5-kalender-merge-og-beta.md`. Den er bindende: låste beslutninger, rækkefølge og gates. Læs også `docs/MASTERPLAN.md`. Genåbn intet, der er låst. Udskyd intet selv. Rækkefølgen er min.

**3. Første arbejde (S5 skal live senest lør 18/10):**
- [#6639](https://github.com/NicolaiDolmer/CyclingZone/pull/6639) skal merges FØR kalender-PR #6637. Den flytter S5-benchmarken ind under `backend/`; ellers fejler S5-gaten med ENOENT på Railway, fordi Railway bygger fra `/backend`. Den venter på CodeRabbit-review (forbrugsloft). Tjek status. Hvis CodeRabbit stadig ikke har reviewet, så giv mig et kort: vent eller merge uden.
- Derefter #6640 (generel vagt: backend læser intet uden for `backend/`), rebaset på main.
- Fortsæt så med punkt 1-5 i startprompten fra 15/10: kalender-PR #6637 og prod-dry-run (`--apply` kun på mit ordrette go efter live-visning), løbshistorien på etapeside 2.0, datokort #6601, landingpage, Codex-audit.
- Når #6639 er merget: DOLMERPC's lokale worktree `feat/6367-s5-materializer-integration` kan fjernes næste gang, nogen sidder der. Det er ikke din opgave på pc1.

**4. Kvalitetsbar (verdensklasse, ikke MVP):**
- Race engine og stats vigtigst. Rod-årsag frem for quickfix, og hvad der brænder før hvad der er let.
- UI følger `docs/design/PAGE_TEMPLATES.md` + `docs/design/TASTE.md`. Én samlet før/efter-skærm sendt som fil før ethvert go-kort.
- Verificér i runtime før du kalder noget done eller en bug. Brug ægte data. Ejeren tester på preview før live (Android).
- Spillertekst EN først, DA under, efter `docs/TONE_OF_VOICE.md`.
- `model` eksplicit i hver `agent()`: opus til motor/DB/penge/sikkerhed, sonnet til UI/ops.

**5. Grænser:**
- Ingen prod-mutation, motor-tænding eller udsendelse uden mit ordrette go pr. skridt.
- Ingen natpakker eller CronCreate. Arbejd nu, til jeg siger stop.
- Én merge-kø ad gangen (`scripts/merge-queue.ps1`). Commit kun bag `guard-commit-branch.sh`.
- Meld anomalier proaktivt (tokens, spor over 4 t uden leverance, CI rød).

**6. Close-out efter CLAUDE.md:**
- NOW.md: Next action + Working agent nulstillet.
- Issues flippet til done straks efter hvert merge.
- Patch notes samlet.
- Token-hygiejne, status-board og `scripts/close-out-cleanup.ps1`.
- Inden pc-skift: `pwsh -File scripts/cross-pc-forensic-audit.ps1`, og tjek hver lokal branch mod GitHub/PR-head (ikke kun "PR merged"). Det fandt en upushet S5-rettelse 15/10.
