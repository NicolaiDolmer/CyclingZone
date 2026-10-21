# 2026-10-19: PR-verifikation ved draft til ready

Refs #6874.

Rodaarssag: check-verification havde draft == false som job-betingelse, men workflowets eksplicitte pull_request.types manglede ready_for_review. Draftens opened-run blev sprunget over, og markering som klar gav ingen ny validering uden et andet event.

Rettelse: tilfoej ready_for_review til den eksisterende eventliste; behold draft-betingelsen, permissions og merge_group-pass-through.

Gennemgang: review-gate har allerede ready_for_review paa pull_request_target og pull_request. done-guard og feature-registry-guard har ogsaa eventet. Oevrige PR-checks har ingen draft-betingelse og koerer derfor allerede ved opened/synchronize; auto-merge og dependabot-auto-merge er merge-automatik med egne actor/label-triggere, ikke samme draft-skip-hul.

Verifikation: lokal roed/groen kontrol af triggerlisten og draft-betingelsen; workflow-output-lint, review-gate-tests og PR-preflight. GitHub-eventet kan foerst afproeves paa den nye workflowversion i en rigtig PR.

Laering: naar et check springer drafts over, skal triggerlisten dække overgangen til ready. Ingen spilleradfaerd, feature eller flag aendres; patch notes og FEATURE_REGISTRY er derfor ikke relevante. NOW/MASTERPLAN-close-out ejes af Claude.
