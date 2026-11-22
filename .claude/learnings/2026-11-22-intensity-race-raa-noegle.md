# 2026-11-22: Dagsloggen viste den rå nøgle training.intensity_race

**Hvad:** På løbsdage viste rytterprofilens dagslog teksten `training.intensity_race` i stedet for et ord. Nøglen manglede i alle 5 locale-filer (`rider.json`). Fejlen var ældre, men kunne først ses, da #8590 tændte Let/Mellem/Hård i prod den 22/11. Fundet ved prod-verifikationen af #8590 og rettet i PR #8597.

**Rodårsag:** Labelen bygges dynamisk (`training.intensity_${level}`). Derfor kunne key-coverage-vagten ikke se, at værdien `race` manglede en nøgle. Testene dækkede kun de niveauer, der kunne vælges (light/medium/hard/rest), og ikke `race`, som motoren skriver på løbsdage.

**Forebyggelse:** `frontend/src/lib/riderIntensityLabels.test.ts` slår nu hver intensitetsværdi, som motoren kan skrive, op i alle 5 sprog. Regel: når en label bygges dynamisk fra en enum, skal testen iterere over hele enum'en fra motoren, ikke kun over UI-valgene.

Refs #8541 #8597
