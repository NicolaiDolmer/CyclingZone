# 2026-05-22 — Infisical `infisical init` picks cert-manager workspace by accident

## Symptom

After `infisical init` against the newly-created CyclingZone organization, every secrets-management CLI call failed with:

```
Response Code: 400 Bad Request
Message: The project is of type cert-manager. Operations of type secret-manager are not allowed.
```

The first `init` run cost ~10 minutes of confusion before the wrong-workspace nature became visible.

## Root cause

Infisical's signup flow auto-provisions a multi-product organization with starter workspaces for several product lines (Secrets Management, Certificate Manager, KMS, Secret Scanning, PAM). When the user creates ONE workspace via the dashboard (e.g. `Cycling Zone` under Secrets Management), the `Cycling Zone` *name* may already exist as a Certificate Manager workspace too.

`infisical init`'s workspace picker presents BOTH workspaces with the same display name — **no product-type label, no slug distinction**. The user (and CLI guide) cannot tell which is which until an actual API call returns the 400.

## Forward-guard

1. **Skip `infisical init` entirely if you know the workspaceId.** The dashboard URL contains it: `https://app.infisical.com/organizations/<orgId>/projects/secret-management/<workspaceId>/overview`. Write `.infisical.json` directly:

   ```json
   {
       "workspaceId": "<uuid>",
       "defaultEnvironment": "",
       "gitBranchToEnvironmentMapping": null
   }
   ```

2. **If `init` must be used, verify type immediately:**

   ```powershell
   infisical secrets --env=dev 2>&1 | Select-String "cert-manager|secret-manager"
   ```

   `cert-manager` in the error → wrong workspace. Delete `.infisical.json` and retry.

3. **For onboarding guides:** tell the user to copy the dashboard URL FIRST, never trust `init`'s picker when the org has multiple product workspaces with similar names.

## Related

- Cluster: same trap exists for any multi-product platform where one CLI subcommand operates on only one product type (Stripe Connect vs Connect Express, GCP project types, etc.). Pattern: "name uniqueness ≠ type uniqueness."
- `.infisical.json` was created with `workspaceId=98295b8e-e655-4bd1-8ca6-9eb12e7312e5` (cert-manager) first, then replaced with `681fe0be-2826-42f6-8792-444c10ef1cca` (secret-manager) after URL inspection.

## Time cost

~30 min total session friction. Avoidable in future runs via the URL-first approach above.
