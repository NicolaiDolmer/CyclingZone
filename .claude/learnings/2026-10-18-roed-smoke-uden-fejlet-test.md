# Rød natlig Playwright Smoke uden en eneste fejlet test (18/10, #5792)

**Symptom:** "Playwright Smoke" rød på main hver nat 11.-18/10. Antaget som en testfejl i 5+ dage.

**Rodårsag:** alle 7 e2e-laner var grønne. Det røde kom fra vækst-alarmen (#5309) i `Lane ceiling gate + plan verdict`, som kun håndhæves på den natlige kørsel: suiten var vokset, så `frontend/tests/e2e/shard-plan.json` var underforsynet (desktop-chromium 2→3, mobile-webkit 3→4). Rettelse #6879.

**Læring:** ved rød smoke, læs job-konklusionerne FØRST (`gh run view <id> --json jobs`): er alle `e2e-shard`-jobs grønne og kun `frontend-smoke` rød, er det plan-dommen, ikke en test. `--log-failed` viser kun flake-rapporten og leder på vildspor.

**Samme aften:** `pr-verification-check.yml` mangler `ready_for_review` i `types:`; en draft markeret klar får aldrig `check-verification`. Midlertidig løsning: redigér PR-teksten (udløser `edited`).
