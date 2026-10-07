# Prompt til Codex: stabilitet (spor 1)

Kopiér alt under stregen ind som første besked i en ny Codex-session i `C:\Dev\CyclingZone`. Kan startes samtidig med Claude Codes roadmap-bølge, fordi første del er read-only.

---

Stabilitet er rykket op (ejer 4/10): "Det er vigtigt for mig, at infrastrukturen på hjemmesiden fungerer fantastisk igen snarligt." Du ejer spor 1 i `docs/OPERATING_PLAN.md`. Læs først `AGENTS.md`, `docs/NOW.md`, `docs/MASTERPLAN.md` (release-gate 1 og "Uge 41") og `docs/OPERATING_PLAN.md`.

**Del 1 · Status nu (read-only, må køre mens Claude Codes bølge kører)**
1. Mål tilstanden i prod uden at skrive noget: Supabase-advisors, langsomme forespørgsler, disk-IO (#3596), forbindelser, og hvor lang tid aftentræning og rangliste-opdatering tager. Slå kolonnenavne op i `database/schema-snapshot.json`, før du skriver SQL.
2. Skriv én kommentar på #5893 med overskriften "Stabilitets-status 4/10": hvad der er målt (med tal), hvad der mangler for release-gate 1, og din anbefalede rækkefølge. Skeln mellem målt, lokalt verificeret og antaget.
3. Foreslå et nyt, bredere filmandat som kommentar på hvert af #6132, #6120 og #5792 (de stoppede 4/10 på for snævert mandat). Byg dem ikke endnu.

**Del 2 · Byg (først når bølgelåsen er fri)**
Tjek `.claude/run/wave-active.json`. Findes den, ejer en anden bølge maskinen: vent, og start ikke uden om værnet.
1. Ret Codex-runneren først, som en committed rettelse: planfilen manglede `lanes=4` og titler, og standardrunneren valgte en ældre CLI. Genkør ikke den gamle `--run` på eksisterende PR'er eller worktrees.
2. Derefter i denne rækkefølge: #5904 (staging og load-test, variant A) → #6134 (jobkø i Postgres, variant C) → #6102 / PR #6136 (måles på staging) → #5911 (aftentræning under 2 minutter).
3. #5692 / PR #6153: del den, så SQL-overloads ligger i sin egen migration, der kan lægges i prod og verificeres FØR Node-koden aktiveres. Skriv go-kortets indhold (hvad der lægges, hvordan det verificeres, hvordan det rulles tilbage) som kommentar på #5692. Hold PR'en i draft.

**Grænser (uændrede)**
- Ingen prod-skrivning, ingen migration-apply, ingen flag-flip og ingen merge uden ejerens ordrette go.
- Rør ikke `docs/NOW.md`, `docs/MASTERPLAN.md`, spillertekst eller Claude Codes PR'er og worktrees (roadmap-hubben: #6149-#6152, #6154).
- Hvert resultat og næste skridt skrives som kommentar på issuet. Designspørgsmål får `needs-decision` og tages i morgenblokken.
- Preflight og tier-verifikation før hver PR. To CI-fejl på samme symptom: stop og skriv det på issuet.
