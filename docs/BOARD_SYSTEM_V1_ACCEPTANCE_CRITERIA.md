# BOARD SYSTEM V1 — ACCEPTANCE CRITERIA & RISKS

_Formål: Sikre at implementeringen af Board System V1 bliver korrekt, testbar og robust._

---

## ✅ CORE ACCEPTANCE CRITERIA

### 1. Objective System
- Hver sæson genereres en målpakke med:
  - 1–2 sportslige mål
  - 1 økonomisk mål
  - 1 identitetsmål
  - 1 ranking/progression mål
- Mål er dynamiske og afhænger af:
  - division
  - ranking
  - økonomi
  - sidste sæson
  - board personality
  - specialisering
- Der genereres **ingen modstridende mål**

---

### 2. Evaluation Engine
- Alle mål evalueres gradvist (ikke binært)
- Overperformance giver bonus
- Systemet bruger vægtning:
  - 50% resultater
  - 20% økonomi
  - 20% identitet
  - 10% ranking
- Systemet tager højde for:
  - momentum
  - 2–3 sæsoners historik

---

### 3. Satisfaction System
- Satisfaction opdateres ved season-end
- Satisfaction påvirker:
  - sponsor multiplier
  - budget næste sæson
  - board feedback
  - request success chance
- Satisfaction vises korrekt i UI (bar + tekst)

---

### 4. Season-End Integration
- Board evaluation køres som en del af:
  - `execute-season-end`
- Systemet:
  - gemmer history
  - genererer nye mål
  - opdaterer board state
- Ingen manuel trigger nødvendig

---

### 5. Identity System
- Følgende virker:
  - nationalitet
  - ungdom
  - stjerner
  - specialisering
  - økonomisk disciplin
- Stjerneværdi er beregnet bagved
- Spilleren ser kun ét simpelt label

---

### 6. Board Requests
- Spilleren kan sende:
  - ændre krav
  - ændre retning
- Systemet returnerer:
  - approved
  - partial
  - rejected
  - tradeoff
- Tradeoffs påvirker fremtidige mål/logik

---

### 7. UI Integration
- Eksisterende UI bevares
- Nye data vises korrekt
- Dashboard viser:
  - satisfaction
  - kort feedback
- BoardPage fungerer stadig

---

## ⚠️ KNOWN RISKS / WATCHOUTS

### 1. Overkompleks objective generation
Risiko:
- For mange regler → uforudsigelige mål

Mitigation:
- Start simpelt
- Log genererede mål
- Test med flere holdtyper

---

### 2. Ubalance i scoring
Risiko:
- Resultater dominerer alt for meget
- Eller identitet føles irrelevant

Mitigation:
- Log score breakdown
- Justér weights senere

---

### 3. Economy mismatch
Risiko:
- Spilleren kan ikke realistisk opfylde mål pga. økonomi

Mitigation:
- Brug økonomi som input i objective generation
- Begræns ambitionsniveau

---

### 4. Performance / queries
Risiko:
- Mange beregninger ved season-end

Mitigation:
- Batch calculations
- Cache nødvendige data

---

### 5. Breaking existing flow
Risiko:
- BoardPage eller dashboard bryder

Mitigation:
- Behold API responses kompatible
- Tilføj felter — fjern ikke eksisterende

---

### 6. Board requests bliver for stærke
Risiko:
- Spilleren kan “game systemet”

Mitigation:
- Begræns antal requests
- Tilføj konsekvenser

---

## 🧪 TEST CASES (MINIMUM)

- Top hold + dårlig sæson → satisfaction falder moderat
- Lille hold + god sæson → satisfaction stiger meget
- Identitetsmål opfyldt uden resultater → mixed feedback
- Overperformance (top 3 vs top 10 mål) → bonus score
- Momentum: dårlig start + god slutning → bedre vurdering
- Board request med tradeoff → påvirker næste sæson

---

## 🎯 DEFINITION OF DONE

Systemet er færdigt når:

- objectives genereres korrekt
- evaluation engine virker
- satisfaction opdateres
- season-end integration virker
- UI viser korrekt data
- ingen kritiske bugs i board flow
- docs er opdateret

---

## 🔚 NOTE

Dette dokument bruges til:
- QA
- Claude review
- fremtidig iteration (v2)

