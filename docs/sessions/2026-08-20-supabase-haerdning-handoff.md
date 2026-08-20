# Handoff: Supabase-hærdning (#4010) → master-sessionen 20/8

> Skrevet 20/8 af Supabase-sessionen ved close-out. Alt måleteknisk arbejde er
> gjort; det der står tilbage er merges, ét klik og fire planlagte opfølgninger.
> Detaljerne bor i issues + PR-body — dette er kun rækkefølgen og gates.

## Tilstand ved overdragelse

- Hoved-checkoutet står på `main`, synkront med origin. Ingen ucommittede
  ændringer fra denne session.
- `docs/NOW.md`: aften-sessionen har markeret sig aktiv (`c0a8c350e`).
- Token-gaten er grøn (MASTERPLAN 1498 tok; den var rød på 1610 før i dag).

## 1. PR #4013 — klar til merge, anbefales FØR søndag

Tre målte fixes: realtime-session-gate, sponsor-snapshot-cache, keyset-paginering.

| Fix | Målt før | Målt efter |
|---|---|---|
| Realtime-token | 7.727 `MalformedJWT`/døgn | abonnerer ikke uden ægte JWT |
| Sponsor-sweep | 203.849 læsninger/døgn | 1 pr. løb pr. proces |
| Offset-paginering | 376.260 buffere / 427 ms pr. side | 16.669 buffere / 39,6 ms |

Verificeret: backend 6.579 tests · frontend 2.206 · e2e 509 passed / 1 kendt flake
(`transfers-deadclick` hover på mobile-webkit, 6/6 grøn ved `--repeat-each=3`;
`TransfersPage` indeholder ingen realtime-kode, så den kan ikke være vores) ·
build · preflight GRØN · lint uændret.

**Hvorfor før cutover:** sponsor-sweepen og `balanceDriftWatch` kører videre
mens cutoveret arbejder på en 2 GB-instans, og `balanceDriftWatch` fyrer ved
HVER boot (`cron.js:1681`) — altså ved hver deploy i weekenden. Realtime skal
desuden virke til første løbsdag 25/8, hvor spillerne faktisk kigger med.

**Efter merge (ejer-mandat #2642 — kan køres selv):**

1. Apply `database/2026-08-20-4010-race-results-stage-window-index.sql`.
   Filen har INGEN `BEGIN/COMMIT` med vilje: `CREATE INDEX CONCURRENTLY` og
   `VACUUM` må ikke køre i en transaktion.
2. Kør post-verify-queries fra filens bund (index gyldigt · reloptions sat ·
   `last_vacuum` sat · plan bruger `Index Only Scan`).
3. Tjek `realtime_logs` at `MalformedJWT` falder mod nul.
4. Flip #4010 → `claude:done`.

## 2. Auth-fixet — reverteret, hentes tilbage i uge 35

Ejer-beslutning 20/8. `290d19090` reverterer `ac0d81200`. Rør den IKKE før S3 er
i gang — den ændrer `requireAuth` for hver eneste rute.

```bash
git cherry-pick ac0d81200
```

Gevinsten er latens (30-80 ms/request), ikke belastning: de ~515.000 sparede
queries koster 0,02-0,05 ms stykket.

## 3. Før tirsdag 25/8

- **#4017** — `frontend/src/pages/NotificationsPage.jsx:380` mangler
  `.eq("is_read", false)`. "Markér alle som læst" omskriver i dag hver eneste
  notifikation brugeren nogensinde har haft: 251 klik → 92.560 række-opdateringer,
  som Realtime så RLS-tjekker én for én. Én linje. Tjek også linje 346.

## 4. Ejer-klik i weekenden

- **Lørdag, sammen med generalprøven:** dispatch `restore-drill.yml` manuelt.
  Den er schedulet til den 1. i måneden, så næste automatiske kørsel er 1/9 —
  altså EFTER sæsonens største dataindgreb. Sidste kørsel (19/8) var grøn.
- **Søndag:** læg et manuelt log-tjek ind i cutover-drejebogen. Nye fejlklasser
  er mest sandsynlige netop den aften, og vagten (#4014) findes endnu ikke.

## 5. Uge 35

- **#4014 log-vagt** — den vigtigste af opfølgningerne. Der er 40+ `monitorCron`-
  vagter på spillogikken og NUL på platformen. Sentry ser exceptions i vores kode;
  et afvist WebSocket-handshake er ikke en af dem. Advisors ser skema og RLS; de
  ser aldrig loggen. Derfor kunne 7.727 fejl/døgn køre uset.
  **Vigtigt:** vagten skal kende accept-listen i
  `docs/audits/2026-08-04-supabase-hardening.md`, ellers larmer den dagligt og
  bliver ignoreret.
- **#4016 session-lås** — maskinlæsbart claim + worktree som standard. 6. bid af
  samme fejlklasse 20/8 (jeg skiftede selv branch i det delte checkout mens
  design-sessionen kørte).
- **#4015 request-budget** — mål ~1/9, en uge efter #4013 har ligget. 65
  indloggede brugere lavede 4.289 requests hver på et døgn. Gate for "compute op
  fra Small?" og skal besvares FØR #2853/launch-pakken bringer flere ind.

## 6. Friktion jeg ikke ryddede

- `git status` viser 153 poster: ~130 løse PNG'er i repo-roden plus scratch-JSON.
  Hver for sig ligegyldige; tilsammen betyder de at `git status` ikke længere er
  et signal man kan læse — og det er sådan en fremmed fil ender i en commit under
  tidspres. Det bed mig i dag.
- 39 stale lokale branches. SessionStart-hooken printer `git branch -D`-linjerne.

## Rettelse værd at kende

Jeg genrejste matviews og `is_admin()` som sikkerhedsfund. Det var forkert — de
var allerede ejer-besluttet (#2678, 23/7) og triageret. Genverificeret mod prod:
`anon` kan IKKE læse de fire matviews, og `is_admin()` returnerer altid `false`
til anon. Verifikations-SQL'en er skrevet ind i 4/8-auditten så den ikke
genrejses en tredje gang. **Læs den fil før du tager et advisor-fund op.**

## Links

[#4010](https://github.com/NicolaiDolmer/CyclingZone/issues/4010) ·
[PR #4013](https://github.com/NicolaiDolmer/CyclingZone/pull/4013) ·
[#4014](https://github.com/NicolaiDolmer/CyclingZone/issues/4014) ·
[#4015](https://github.com/NicolaiDolmer/CyclingZone/issues/4015) ·
[#4016](https://github.com/NicolaiDolmer/CyclingZone/issues/4016) ·
[#4017](https://github.com/NicolaiDolmer/CyclingZone/issues/4017) ·
[postmortem](../../.claude/learnings/2026-08-20-publishable-key-broke-realtime-silently.md) ·
[masterplan-artifact](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635)
