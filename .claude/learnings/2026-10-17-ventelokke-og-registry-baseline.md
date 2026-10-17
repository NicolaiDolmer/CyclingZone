# 17/10: venteløkke der aldrig kunne lykkes + rød main fra registry-baseline

## Hvad skete
1. **Venteløkken til merge-køen** brugte `grep -oE "checks=...|ville merge nu" | head -1` og ventede på teksten "ville merge nu". Dry-run'en skriver altid `checks=...` FØR "ville merge nu", så `head -1` gav altid checks-linjen, og løkken brød aldrig. S5-tændingen (#6699) stod klar i ca. 50 min uden at blive merget, mens ejeren ventede.
2. **Close-out 16/10 flyttede `academy-intake-pull` til `state: live`** i FEATURE_REGISTRY.yml uden at fjerne posten fra `scripts/feature-registry-flag-expiry-baseline.json`. `feature-registry-flag-expiry.test.mjs` ("baseline er ikke forældet") blev rød på main og på alle PR'er (registry-freshness).
3. **GitHub-audit 17/10 flippede #6740 done → todo** på Discord-evidens fra morgenen, men DolmerPC havde allerede leveret #6747 og kørt engangsfrigivelsen. Flippet var forældet ved udførelse.

## Rettelse
1. Venteløkken tjekker nu hele outputtet: `echo "$out" | grep -q "ville merge nu" && ! echo "$out" | grep -q "STOP"`. Og: tjek selv en venteløkke efter 5 minutter, stol ikke på den.
2. Baseline-posten fjernet på main (1e13187fb).
3. #6740 sat tilbage til done med korrektionskommentar.

## Regel fremover
- En baggrundsløkke der venter på en tekst, testes én gang i forgrunden mod det faktiske output, før den startes.
- Flytter du en registry-post fra dormant/building/beta til live, så fjern den fra `feature-registry-flag-expiry-baseline.json` i samme commit og kør `node --test scripts/feature-registry-flag-expiry.test.mjs`.
- Done → todo på Discord-evidens: tjek først merged PR'er og andre sessioners NOW-noter fra samme døgn.
