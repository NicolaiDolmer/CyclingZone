# MEMORY — Kontekst til AI-assistenter

Git-tracked, synces via GitHub på tværs af PC'er. Opdateres løbende.
Codex-sessioner læser herfra; Claude-sessioner har supplerende auto-memory i `~/.claude/`.

---

## Feedback — arbejdsstil

### Push følger commit automatisk
Push efter commit uden at spørge. Commit → push er én operation.

**Why:** Bruger spurgte "hvorfor spørger du om dette?" ved bekræftelsesspørgsmål om push.

**How to apply:** Commit → push til remote med det samme. Ingen bekræftelsesspørgsmål.

---

## Projekt-kontekst

### Økonomi-principper (gældende fra v1.46)
- `DEFAULT_BETA_BALANCE = 800.000 CZ$` (kode: `backend/lib/betaResetService.js`)
- Sponsor-indkomst: **240.000 CZ$/sæson** per team (med board-modifier)
- Rytterværdi = `uci_points × 4000` (generated column `price` i DB)
- `market_value = GREATEST(5, uci_points) × 4000 + prize_earnings_bonus` (generated)
- `salary` er IKKE generated — skal altid opdateres manuelt: `salary = uci_points × 400`
- Økonomi-target: **stram men fair** — aktive kompetente managers kan overleve uden automatisk gældsspiral

### Rytter-import og UCI-data
- **Autoritativ kilde:** Google Sheet `1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic` (3000 ryttere, opdateres af GitHub Actions)
- Lokal kopi: `scripts/uci_top1000.csv` — overskriv ved re-import med ny CSV fra Sheet
- Import-script: `scripts/import_riders.py` — bruger 5-lags navnematch + PCM_UCI_OVERRIDE
- Se `docs/CONVENTIONS.md` → "Import af ryttere" for komplet algoritme og invarianter
- **Fejlmønster der kendes:** PCM sammensatte efternavne, UCI mellemnavne, polske ł/Ø-tegn, alternativ translitteration (Tesfazion/Tesfatsion) — alle håndteres nu i scriptet

### Launch-kontekst (2026-04-30)
- **17 aktive managers** i nuværende beta
- **Open beta target: ~1 uge** — data resettes inden launch
- Launch = offentlig open beta; spillet fortsætter direkte derfra til produktion
- Pre-launch must-haves: profile-fix (S2), prize-money (S3-S5), onboarding (S6)

### Token-disciplin (gælder alle sessioner)
- `docs/NOW.md`: **maks 30 linjer** — kun aktiv slice, næste handlinger, blockers, invarianter
- `docs/PRODUCT_BACKLOG.md`: kun fremadskuende — ingen done-historik
- Færdige detaljer → `docs/FEATURE_STATUS.md` + `docs/archive/`
- Læs kun ekstra docs-filer når den konkrete opgave kræver det
- `docs/MEMORY.md`: læs kun ved ny session eller eksplicit behov

---

## Deploy-regler (lært den hårde vej — 3 fejlede Vercel deploys 2026-05-02)

- Kør altid `npm run build` i frontend FØR push, når `package.json` eller devDeps er ændret
- Kør `pwsh -File scripts/verify-deploy.ps1` EFTER push og vent på READY
- Hvis verify-deploy.ps1 ikke er tilgængelig: brug Vercel MCP (`list_deployments` + `get_deployment_build_logs`)
- `npm install --legacy-peer-deps` kan bryde transitive deps i lockfilen — altid byg lokalt bagefter
- **PatchNotesPage er obligatorisk ved enhver commit** — selv rene tekniske ændringer. Aldrig stille fravalg.

---

## Lokal PC-opsætning (kør ved første session på ny PC eller efter ny devDep)

```powershell
pwsh -File scripts/setup-local.ps1
```

Installerer `backend/node_modules` og `frontend/node_modules` (gitignored, skal køres lokalt).
Derefter virker: `npm run lint`, `npm run format`, `npm test`, `pwsh -File scripts/verify-invariants.ps1`.

**Hvad er installeret (v1.99):** ESLint + Prettier i backend og frontend · devDeps inkl. eslint-plugin-react/hooks · Supabase TypeScript types i `frontend/src/types/database.types.ts`.

---

## Windows: Undgå "command line too long"

Windows har 8191-tegns grænse for kommandolinjer. Overskrides ved meget lange inline PowerShell-kommandoer.

**Forebyggelse — altid:**
- Git commit-beskeder: brug PowerShell here-string `@'...'@`, maks 4 bullet points
- Aldrig bash heredoc-syntax (`$(cat <<'EOF'...)`) i PowerShell-tool — brug `@'...'@`
- Lange operationer: skriv til temp-fil med Write-tool, kør med `-File`

**Why:** Claude Code sender kommandoer som inline argument til `pwsh -Command "..."` — for lang tekst rammer Windows' grænse og fejler med exit code 1.

---

## Arbejdsmetode — effektive AI-sessioner

Disse mønstre viste sig særligt token-effektive og kvalitetsskabende i session 2026-05-02. Brug dem som default.

### Læs dybt før du foreslår noget
Læs 4–6 centrale filer (engine, routes, tests, schema) inden du foreslår arkitektur. I denne session afslørede det at infrastrukturen allerede var 80% færdig — det ændrede hele tilgangen fra "byg nyt" til "forbind eksisterende".

**Filer der altid er relevante at læse ved ny feature:**
- Den relevante engine-fil (`lib/xxxEngine.js`)
- `backend/lib/financeNotificationContract.test.js` — viser tilladte DB-typer
- `database/schema.sql` — faktisk tabelstruktur
- Eksisterende test-fil for den engine der skal ændres

### Migration sidst — ikke først
Kør aldrig migration før al kode er klar. En migration der er foran koden skaber inkonsistent state. Rækkefølge: skriv kode → tests grønne → kør migration → deploy. En enkelt deploy-begivenhed.

### Batch queries i engine-funktioner
Nye engine-funktioner skal hente al nødvendig data i 2–4 forespørgsler uanset antal løb/ryttere. Mønster fra `prizePayoutEngine.js`:
1. Hent alle relevante rækker med `.in("id", ids)` i én query
2. Group/aggregate i JavaScript, ikke i DB
3. Aldrig N+1 (én query per løb/rytter i en løkke)

### Cascading change detection
Når du fjerner et felt fra et return-objekt (f.eks. `teamsPaid`): søg alle kallers med Grep før du ændrer. Ret alle steder i samme commit. Kør tests umiddelbart efter hver fil-ændring — ikke samlet til sidst.

### Dekobler domæner i stedet for at tilføje betingelser
I stedet for at tilføje `if (shouldPay)` i eksisterende flow: opret en ny dedikeret funktion. Giver renere kode, lettere test, og administrativ kontrol som sideeffekt. Eksempel: `applyRaceResults` vs. `prizePayoutEngine.paySeasonPrizesToDate`.

---

## Arkitektur-beslutninger

### Præmieudbetaling (v1.98)
- `applyRaceResults` udbetaler **aldrig** præmier — kun resultater gemmes
- `prizePayoutEngine.paySeasonPrizesToDate(seasonId, adminUserId, supabase)` er den eneste vej til præmieudbetaling
- `races.prize_paid_at TIMESTAMPTZ` tracker hvornår et løb er udbetalt
- Re-import af resultater påvirker ikke allerede udbetalte præmier
- Preview (`getSeasonPrizePreview`) og udbetaling er adskilt — admin ser diff før godkendelse
