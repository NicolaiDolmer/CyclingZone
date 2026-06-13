# Free-agent-sign-stier skal ekskludere mid-flow-ryttere

**Dato:** 2026-06-13
**Kontekst:** Akademi-MVP Fase B (#1308, PR #1372), code-review-fund før merge.

## Symptom
En ny "sign en fri ungdomsrytter"-sti (`signFreeAgentYouth` + `freeAgents`-listen i `GET /api/academy/me`) brugte kriterierne `team_id IS NULL` + `is_academy=false` + alder 16-21 til at definere "fri ungdom". Men intake-kandidater (`academy_intake.status='offered'`) og ryttere på en aktiv ungdomsauktion (`auctions.is_youth`, status active/extended) opfylder **præcis** de samme kriterier — de er ikke ejede endnu. Konsekvenser:
1. **Økonomisk bypass (alvorligst):** en rytter midt på en kørende auktion kunne signes gratis til minimumsløn via free-agent-ruten i stedet for at byde → auktionen undergraves.
2. **Dobbeltvisning + state-kollision:** samme rytter dukkede op i både intake- og free-agent-sektionen (delt `actionState` keyet på rider.id).

## Rod-årsag
"Fri/uejet rytter" blev defineret negativt (ingen ejer) frem for positivt (ikke i et igangværende flow). I et system med flere markeds-flows (intake, auktion, transfer) har en rytter mange mellem-tilstande hvor `team_id` er NULL men rytteren **ikke** er frit tilgængelig.

## Forward-guard (gjort)
- `signFreeAgentYouth` afviser nu (`not_free_agent`) hvis rytteren har en `offered` intake-række ELLER ligger på en aktiv/extended auktion — håndhævet **backend-side** (pengerelateret).
- `freeAgents`-listen ekskluderer samme to mængder, så UI og backend deler diskriminator (jf. [[feedback_match_ui_filter_for_capacity_logic]]).
- 2 nye tests: offered-intake → not_free_agent; på-auktion → not_free_agent (ingen bypass).

## Genbrugelig regel
Enhver fremtidig sti der lader en bruger **erhverve en uejet rytter** (free-agent-sign, "claim", gratis-pickup) skal eksplicit ekskludere ryttere der er midt i et andet flow: `offered` intake, aktiv auktion, åbent transfer/swap-tilbud. `team_id IS NULL` alene er IKKE "tilgængelig". Backwards-check ved sådanne features: list alle market-flows der efterlader `team_id=NULL` midlertidigt.

Relateret: [[feedback_backwards_check_forward_guard]], [[feedback_match_ui_filter_for_capacity_logic]].
