# Tone-guard fejlede på PR men auto-merge mergede alligevel (Dagbølge 3)

**Dato:** 2026-06-12 · **Kontekst:** Dagbølge 3, PR #1320 (#788) + #1327 (#785)

## Symptom

Main blev rød på `i18n · Key coverage`-workflowet (tone-em-dash-jobbet) efter
bølge-merges: 4 em-dash i player-facing locale-værdier. Deploy-verify fangede
det post-merge; hotfix #1336.

## Rodårsag (to lag)

1. **Agent-lag:** To fleet-agenter skrev em-dash i locale-copy. Fleet-prompten
   krævede i18n-keys-check men nævnte ikke tone-guarden eksplicit; agenterne
   kørte ikke `tone-check-em-dash.mjs` lokalt (i modsætning til #645-agenten).
2. **Gate-lag (det reelle hul):** `tone-em-dash` KØRTE og FEJLEDE på begge
   PR'er (verificeret: `gh pr checks 1320` → tone-em-dash fail, 4s). Men jobbet
   er ikke i branch-protections required-liste (kun 4 checks er required), så
   `gh pr merge --auto` mergede på de grønne required checks. Workflow-kommentaren
   siger "REQUIRED (Refs #1172/#671)" — det er intention, ikke konfiguration.

## Hvorfor ikke bare gøre den required?

i18n-workflowet er path-filtreret. Required checks der aldrig rapporterer
(docs-only PR'er trigger ikke workflowet) blokerer merge for evigt. Required-
promotion kræver at path-filteret fjernes (jobs er ~30s) eller et altid-
rapporterende paraply-job. Ejer-beslutning: #1337.

## Forward-guards

- Fleet-playbook/bølge-prompts: verify-listen skal eksplicit inkludere HELE
  i18n/tone-batteriet (`tone-check-em-dash` + `i18n-check-leaks`), ikke kun keys.
- Orkestrator-tjek efter merge-salve: `gh run list --branch main` før
  deploy-verify erklæres grøn.
- Required-promotion af i18n/tone-jobs: issue #1337.

## Generalisering

"Grøn PR" betyder kun "grønne REQUIRED checks". Ved auto-merge-bølger skal
enhver guard man stoler på enten være required eller eksplicit i agenternes
lokale verify-liste. Advisory-jobs + auto-merge = stille rød main.
