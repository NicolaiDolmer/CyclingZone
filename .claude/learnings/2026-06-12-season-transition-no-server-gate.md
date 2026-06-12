# Season-transition havde ingen server-side gate (#1346)

**Symptom:** POST /api/admin/season-transition kunne lukke en aktiv sæson
med åbent transfervindue/uafviklede løb. Eneste guard var window.confirm i UI.

**Rod-årsag:** Readiness-disciplinen levede proceduralt (checkliste ved
1→2-skiftet #1155, cron-pre-checks i seasonAutoTransition.js), men blev
aldrig enforced i den manuelle endpoint-sti. Klassisk "UI-confirm er ikke
en guard"-fejl.

**Fix:** assessTransitionReadiness (genbruger cron'ens wrapped-window-
semantik) håndhæves i endpointet: rød gate uden force = 409. Force er
eksplicit, UI-synlig og logges som manual_override. Preview og POST deler
samme beregning så UI/server ikke driver.

**Læring:** Når en cron-sti har guards og en manuel admin-sti deler motor,
skal guarden ligge i motoren ELLER eksplicit i HVER caller-sti. En guard
der kun findes i én caller er en latent P0 i de andre.
