# Codex-prompter mandag 19/10 (skrevet af Claude, ejeren starter Codex)

Ejer 19/10: 2 Codex-opgaver ad gangen. Runde 1 = A + B. Runde 2 = C + D, når A eller B har afleveret.
Claude reviewer og merger Codex' PR'er. Codex rører aldrig `docs/NOW.md`.

---

## A: Sommer-/vintertid-audit (#6862) — model `gpt-6-astra` / `high`

```
Arbejd i C:\Dev\CyclingZone i et eget worktree (scripts/new-worktree.ps1). Svar på dansk. Læs AGENTS.md og issue #6862 (gh issue view 6862 --comments) først.

Opgave: Audit af sommer-/vintertid. Vintertid starter søndag 25/10 kl. 03:00 (03 -> 02), samme dag som sæsonskiftet S4 -> S5. Find alt, der regner med et fast klokkeslæt eller en dagsgrænse, og afgør, om det er korrekt over skiftet 25/10 og 29/3.

Prioriteret rækkefølge (stop ved tidsgrænsen, uanset hvor langt du er):
1. backend/cron.js og alt der kaldes derfra med "kl. X" eller dagsgate (træningssweep kl. 20, søndagsjob, sæsonskifte, deadline-day, e-mails, push). Bruger de copenhagenTime.js eller UTC-timer?
2. Sæsonskiftet 25/10: kan DST give dobbeltkørsel eller hul?
3. Kalender og etaper: race_stage_schedule.scheduled_at, slot-tider 12/15/18, LATEST_STAGE_SLOT, game_day, tick-vinduet HH:57-HH:03.
4. pg_cron/SQL (now(), date_trunc), GitHub Actions cron (UTC), Sentry cron-monitorer.
5. Frontend: formatClock24, nedtællinger, "i dag"-grænser.

Koordinér med #6858 (vægur-planlægger, allerede i gang): læs issuet, rør ikke de samme filer.

Leverance:
- Én kommentar på #6862 med tabellen: funktion -> hvordan tid beregnes -> korrekt over DST ja/nej -> risiko for 25/10 -> foreslået rettelse.
- Kun for fund der rammer 25/10: én PR pr. rettelse med test med fast ur for 25/10 og 29/3. Refs #6862. Ingen ændring af løbsmotorens regler, ingen prod-data, ingen migration.
- Lokalt verify før push (pwsh -File scripts/preflight-pr.ps1). Kør tests i forgrunden.

Tidsgrænse: 90 min. Status som kommentar på #6862 hvert 30. min. Ikke færdig efter 90 min -> skriv tabellen så langt den er, push evt. draft, skriv hvad der mangler, og stop.
```

---

## B: Måling af PR-CI-tid (#6864, kun måling) — model `gpt-6-luna` / `medium`

```
Arbejd i C:\Dev\CyclingZone. Svar på dansk. Read-only: ingen kodeændringer, ingen PR. Læs issue #6864 og #6859 først.

Opgave: Mål baseline for PR-CI de seneste 7 dage via gh run list / Actions API (kun pull_request-kørsler).
1. Median og p90 fra push til sidste påkrævede check grøn, pr. workflow og pr. job.
2. De 5 tungeste job, og for hver: hvor går tiden (install, build, test, ventetid i kø).
3. Antal kørsler der blev overhalet af et nyere push uden at blive aflyst (spild).
4. Tre konkrete forslag til tirsdagens byg, hver med forventet besparelse i minutter. Ingen gate må svækkes; ingen nye løbende udgifter.

Leverance: én kommentar på #6864 med tabellerne og forslagene, plus scriptet du brugte som kodeblok, så målingen kan gentages efter byg.
Tidsgrænse: 45 min. Ikke færdig -> post det du har og skriv hvad der mangler.
```

---

## C: Verifikations-tjek mangler ved "klar til review" — model `gpt-6.1-sol` / `medium`

```
Arbejd i C:\Dev\CyclingZone i et eget worktree. Svar på dansk.
Opgave: .github/workflows/pr-verification-check.yml mangler `ready_for_review` i `on.pull_request.types`, så en draft der markeres klar aldrig får check-verification. Tilføj den, tjek om andre PR-gates (review-gate m.fl.) har samme hul, og ret dem i samme PR. Én PR, label docs/ops, Refs #6874. Preflight før push. Tidsgrænse 30 min.
```

---

## D: merge-queue.ps1 melder main rød mens CI kører (#6081) — model `gpt-6.1-sol` / `medium`

```
Arbejd i C:\Dev\CyclingZone i et eget worktree. Svar på dansk. Læs issue #6081 (med kommentarer) først.
Opgave: scripts/merge-queue.ps1 melder main-CI rød, mens kørslen stadig er i gang. Ret så status "in_progress/queued" behandles som vent, og kun en afsluttet kørsel med conclusion failure tæller som rød. Tilføj test af statuslogikken. Én PR, Refs #6081. Preflight før push. Tidsgrænse 60 min; ikke færdig -> draft + hvad der mangler.
```
