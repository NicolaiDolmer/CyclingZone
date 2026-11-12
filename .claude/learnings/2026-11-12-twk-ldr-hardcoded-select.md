# TWK/LDR manglede paa Transferlisten (#7962)

**Symptom:** TWK og LDR viste '-' for alle ryttere paa Transferlisten og bud-/tilbuds-/bytte-kort.

**Aarsag:** Haandskrevne evne-lister i `rider_derived_abilities(...)`-selects i `backend/routes/api.js` blev kopieret, da registeret groede fra 15 til 17 evner (#5268). Teamwork og leadership blev aldrig tilfoejet i transfer-vejen.

**Fix:** Alle selects bruger `REGISTRY_ABILITY_KEYS`. Kontrakttesten `backend/routes/api.abilitySelect.test.js` fejler ved enhver ny haandskrevet noeglelist.

**Forebyggelse:** Hent aldrig evnelister fra haanden; registeret er eneste kilde.
