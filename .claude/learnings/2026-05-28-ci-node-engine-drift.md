# 2026-05-28 — CI Node engine drift

## Symptom

GitHub Actions jobs that install backend dependencies can emit `EBADENGINE` warnings when they run on Node 20 while `backend/package.json` requires Node `>=22.0.0`.

## Root cause

The original #654 fix aligned `.github/workflows/ci.yml`, but scheduled/support workflows also install `backend/package-lock.json` dependencies: `drift-monitor.yml`, `uci_sync.yml`, and `quality-inbox.yml`.

## Fix

Pinned those backend-relevant jobs to Node 22 and left frontend-only Node 20 jobs unchanged.

## Forward guard

When changing package engines, grep all workflows for both `setup-node` and `cache-dependency-path: backend/package-lock.json` or `working-directory: backend`; the CI workflow is not the only runtime surface.

Refs #654.
